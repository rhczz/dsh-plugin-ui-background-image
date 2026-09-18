/**
 * The Host's public-address judgement: which addresses a remote background may
 * resolve to, and how a name that does not resolve is refused.
 * @module dsh-plugin-ui-background-image/tests/background-remote-approval
 */

import { STRICT_REMOTE_POLICY } from '../src/background-remote.ts'
import { describe, expect, it, vi } from 'vitest'

/**
 * Whether the mocked resolver answers, and with what. A resolution that never
 * settles is the timeout path, which no real lookup can be driven into.
 */
const dnsMock = vi.hoisted(() => ({ answer: [] as { address: string }[], fail: false, hold: false }))

vi.mock('node:dns/promises', () => ({
  lookup: () => {
    if (dnsMock.fail) return Promise.reject(new Error('ENOTFOUND'))
    if (dnsMock.hold) return new Promise(() => {})
    return Promise.resolve(dnsMock.answer)
  },
}))

const { ApprovedRemoteImages, isPublicAddress, judgeRemoteHost } = await import('../src/background-remote-approval.ts')

describe('isPublicAddress', () => {
  it('accepts globally reachable unicast addresses', () => {
    for (const address of ['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111']) {
      expect(isPublicAddress(address)).toBe(true)
    }
  })

  it('refuses addresses that only reach the local machine or network', () => {
    for (const address of [
      '127.0.0.1',
      '0.0.0.0',
      '10.1.2.3',
      '172.16.0.1',
      '192.168.1.10',
      '169.254.169.254',
      '100.64.0.1',
      '224.0.0.1',
      '::1',
      '::',
      'fe80::1',
      'fd00::1',
      'ff02::1',
      '::ffff:127.0.0.1',
    ]) {
      expect(isPublicAddress(address)).toBe(false)
    }
  })

  it('refuses text that is not an address', () => {
    expect(isPublicAddress('example.com')).toBe(false)
    expect(isPublicAddress('')).toBe(false)
  })

  it('refuses every transition and translation prefix outright', () => {
    // 6to4, Teredo, and NAT64 all state an IPv4 destination the DNS answer does
    // not carry, so neither a public- nor a private-looking one is trusted.
    for (const address of [
      '2002:5db8:d822::1',
      '2002:0a00:0001::1',
      '64:ff9b::5db8:d822',
      '64:ff9b::0a00:0001',
      '64:ff9b:1::1',
      '2001:0:4136:e378:8000:63bf:a244:db7d',
    ]) {
      expect(isPublicAddress(address)).toBe(false)
    }
  })

  it('refuses a reserved IPv6 range that is not unicast', () => {
    expect(isPublicAddress('2001:db8::1')).toBe(false)
  })

  it('judges an IPv4-mapped address as the address it carries', () => {
    expect(isPublicAddress('::ffff:93.184.216.34')).toBe(true)
    expect(isPublicAddress('::ffff:10.0.0.1')).toBe(false)
  })
})

describe('judgeRemoteHost', () => {
  it('accepts a name whose every address is public', async () => {
    dnsMock.answer = [{ address: '93.184.216.34' }, { address: '2606:4700::1' }]
    dnsMock.fail = false
    await expect(judgeRemoteHost('cdn.example.com')).resolves.toBeUndefined()
  })

  it('refuses a name that answers with any private address', async () => {
    dnsMock.answer = [{ address: '93.184.216.34' }, { address: '10.0.0.5' }]
    await expect(judgeRemoteHost('cdn.example.com')).resolves.toBe('private')
  })

  it('refuses a name that does not resolve', async () => {
    dnsMock.fail = true
    await expect(judgeRemoteHost('missing.example.com')).resolves.toBe('unresolved')
    dnsMock.fail = false
  })

  it('refuses an answer set too large to judge', async () => {
    dnsMock.answer = Array.from({ length: 17 }, () => ({ address: '93.184.216.34' }))
    await expect(judgeRemoteHost('cdn.example.com')).resolves.toBe('unresolved')
  })

  it('refuses an empty answer set', async () => {
    dnsMock.answer = []
    await expect(judgeRemoteHost('cdn.example.com')).resolves.toBe('unresolved')
  })

  it('refuses a resolution that does not settle in time', async () => {
    vi.useFakeTimers()
    dnsMock.hold = true
    const judgement = judgeRemoteHost('slow.example.com')
    await vi.advanceTimersByTimeAsync(5_000)
    await expect(judgement).resolves.toBe('unresolved')
    vi.useRealTimers()
    dnsMock.hold = false
  })
})

describe('ApprovedRemoteImages', () => {
  it('approves nothing until a URL has been judged', () => {
    const approvals = new ApprovedRemoteImages()
    expect(approvals.isApproved('https://cdn.example.com/a.png')).toBe(false)
  })

  it('remembers one approved URL exactly', () => {
    const approvals = new ApprovedRemoteImages()
    approvals.approve('https://cdn.example.com/a.png')
    expect(approvals.isApproved('https://cdn.example.com/a.png')).toBe(true)
    expect(approvals.isApproved('https://cdn.example.com/b.png')).toBe(false)
  })

  it('keeps the record bounded, dropping the URL approved longest ago', () => {
    const approvals = new ApprovedRemoteImages()
    for (let index = 0; index < 33; index += 1) approvals.approve(`https://cdn.example.com/${String(index)}.png`)
    expect(approvals.isApproved('https://cdn.example.com/0.png')).toBe(false)
    expect(approvals.isApproved('https://cdn.example.com/32.png')).toBe(true)
  })

  it('re-approving a URL keeps it in the record rather than duplicating it', () => {
    const approvals = new ApprovedRemoteImages()
    approvals.approve('https://cdn.example.com/a.png')
    approvals.approve('https://cdn.example.com/a.png')
    expect(approvals.isApproved('https://cdn.example.com/a.png')).toBe(true)
  })

  it('judges a persisted selection once the document reaches this process', async () => {
    dnsMock.answer = [{ address: '93.184.216.34' }]
    const approvals = new ApprovedRemoteImages()
    await expect(approvals.refresh({ source: 'remote', url: 'https://cdn.example.com/a.png' }, STRICT_REMOTE_POLICY))
      .resolves.toBeUndefined()
    expect(approvals.isApproved('https://cdn.example.com/a.png')).toBe(true)
  })

  it('leaves a persisted selection unapproved when its name resolves privately', async () => {
    dnsMock.answer = [{ address: '10.0.0.5' }]
    const approvals = new ApprovedRemoteImages()
    await expect(approvals.refresh({ source: 'remote', url: 'https://cdn.example.com/a.png' }, STRICT_REMOTE_POLICY))
      .resolves.toBe('private')
    expect(approvals.isApproved('https://cdn.example.com/a.png')).toBe(false)
  })

  it('drops a previous approval once the URL stops resolving publicly', async () => {
    dnsMock.answer = [{ address: '93.184.216.34' }]
    const approvals = new ApprovedRemoteImages()
    await approvals.refresh({ source: 'remote', url: 'https://cdn.example.com/a.png' }, STRICT_REMOTE_POLICY)
    expect(approvals.isApproved('https://cdn.example.com/a.png')).toBe(true)
    dnsMock.answer = [{ address: '192.168.1.10' }]
    await approvals.refresh({ source: 'remote', url: 'https://cdn.example.com/a.png' }, STRICT_REMOTE_POLICY)
    expect(approvals.isApproved('https://cdn.example.com/a.png')).toBe(false)
  })

  it('approves a persisted inline image without resolving anything', async () => {
    dnsMock.fail = true
    const approvals = new ApprovedRemoteImages()
    const inline = 'data:image/png;base64,AAAA'
    await expect(approvals.refresh({ source: 'remote', url: inline }, STRICT_REMOTE_POLICY)).resolves.toBeUndefined()
    expect(approvals.isApproved(inline)).toBe(true)
    dnsMock.fail = false
  })

  it('judges nothing when the selection is not remote', async () => {
    dnsMock.fail = true
    const approvals = new ApprovedRemoteImages()
    await expect(approvals.refresh({ source: 'preset', url: '' }, STRICT_REMOTE_POLICY)).resolves.toBeUndefined()
    dnsMock.fail = false
  })

  it('leaves a URL the policy refuses unapproved without resolving it', async () => {
    dnsMock.answer = [{ address: '93.184.216.34' }]
    const approvals = new ApprovedRemoteImages()
    await expect(approvals.refresh({ source: 'remote', url: 'http://cdn.example.com/a.png' }, STRICT_REMOTE_POLICY))
      .resolves.toBeUndefined()
    expect(approvals.isApproved('http://cdn.example.com/a.png')).toBe(false)
  })

  it('leaves a URL outside the allowlist unapproved without resolving it', async () => {
    dnsMock.answer = [{ address: '93.184.216.34' }]
    const approvals = new ApprovedRemoteImages()
    await expect(approvals.refresh(
      { source: 'remote', url: 'https://cdn.example.com/a.png' },
      { access: 'strict', hostAllowlist: ['other.example'] },
    )).resolves.toBeUndefined()
    expect(approvals.isApproved('https://cdn.example.com/a.png')).toBe(false)
  })
})
