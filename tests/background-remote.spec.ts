/**
 * The remote image URL policy: what the URL text alone decides, and what the
 * deployment's allowlist adds to it.
 * @module dsh-plugin-ui-background-image/tests/background-remote
 */

import { describe, expect, it } from 'vitest'
import {
  isAllowedRemoteHost,
  isRemoteHostAllowlistEntry,
  judgeRemoteImageUrl,
  remoteHostLabel,
  REMOTE_URL_MAX_LENGTH,
  STRICT_REMOTE_POLICY,
  type RemotePolicy,
} from '../src/background-remote.ts'

/**
 * Judge one URL with no allowlist configured.
 * @param input - URL text.
 * @returns the verdict.
 */
function judge(input: string): ReturnType<typeof judgeRemoteImageUrl> {
  return judgeRemoteImageUrl(input, STRICT_REMOTE_POLICY)
}

describe('remote image URLs', () => {
  it('accepts an https URL and normalizes what it stores', () => {
    expect(judge('https://Images.Example.COM/a/b.png?x=1#frag')).toEqual({
      kind: 'accepted',
      url: 'https://images.example.com/a/b.png?x=1#frag',
      host: 'images.example.com',
    })
  })

  it('accepts a host with a trailing dot under its real name', () => {
    expect(judge('https://example.com./a.png')).toEqual({
      kind: 'accepted',
      url: 'https://example.com./a.png',
      host: 'example.com',
    })
  })

  it('refuses every network scheme but https', () => {
    for (const input of ['http://example.com/a.png', 'file:///etc/passwd', 'javascript:alert(1)', 'ftp://example.com/a.png']) {
      expect(judge(input)).toEqual({ kind: 'refused', reason: 'scheme' })
    }
  })

  it('accepts an inline image, which names no destination to restrict', () => {
    expect(judge('data:image/png;base64,AAAA')).toEqual({
      kind: 'accepted',
      url: 'data:image/png;base64,AAAA',
      host: '',
    })
  })

  it('refuses text no URL parser accepts', () => {
    expect(judge('not a url')).toEqual({ kind: 'refused', reason: 'url' })
    expect(judge('')).toEqual({ kind: 'refused', reason: 'url' })
  })

  it('refuses a URL carrying credentials', () => {
    expect(judge('https://user:secret@example.com/a.png')).toEqual({ kind: 'refused', reason: 'credentials' })
  })

  it('refuses a URL past the accepted length', () => {
    const long = `https://example.com/${'a'.repeat(REMOTE_URL_MAX_LENGTH)}.png`
    expect(long.length).toBeGreaterThan(REMOTE_URL_MAX_LENGTH)
    expect(judge(long)).toEqual({ kind: 'refused', reason: 'length' })
  })

  it('refuses an address instead of a hostname, in every spelling a parser accepts', () => {
    for (const input of [
      'https://127.0.0.1/a.png',
      'https://0x7f.0.0.1/a.png',
      'https://2130706433/a.png',
      'https://[::1]/a.png',
      'https://[::ffff:127.0.0.1]/a.png',
      'https://192.168.1.10/a.png',
      'https://[fd00::1]/a.png',
    ]) {
      expect(judge(input)).toEqual({ kind: 'refused', reason: 'literal' })
    }
  })

  it('refuses a hostname reserved for local networks', () => {
    for (const input of [
      'https://localhost/a.png',
      'https://images.localhost/a.png',
      'https://printer.local/a.png',
      'https://wiki.internal/a.png',
      'https://router.home.arpa/a.png',
    ]) {
      expect(judge(input)).toEqual({ kind: 'refused', reason: 'reserved' })
    }
  })

  it('lets a public hostname through when no allowlist is configured', () => {
    expect(judge('https://cdn.example.org/a.png').kind).toBe('accepted')
  })
})

describe('the remote host allowlist', () => {
  it('accepts a bare hostname or a suffix wildcard', () => {
    expect(isRemoteHostAllowlistEntry('cdn.example.com')).toBe(true)
    expect(isRemoteHostAllowlistEntry('*.example.com')).toBe(true)
  })

  it('refuses an entry that is not a bare hostname', () => {
    for (const entry of ['', '*', 'https://example.com', 'example.com/path', 'example.com:8443', 'user@example.com', 'Example.com', '192.168.1.1', '[::1]', 'a.*.example.com']) {
      expect(isRemoteHostAllowlistEntry(entry)).toBe(false)
    }
  })

  it('matches an exact host and a wildcard suffix, and nothing else', () => {
    const allowlist = ['cdn.example.com', '*.images.example.org']
    expect(isAllowedRemoteHost('cdn.example.com', allowlist)).toBe(true)
    expect(isAllowedRemoteHost('a.images.example.org', allowlist)).toBe(true)
    expect(isAllowedRemoteHost('images.example.org', allowlist)).toBe(false)
    expect(isAllowedRemoteHost('evil-example.com', allowlist)).toBe(false)
    expect(isAllowedRemoteHost('cdn.example.com.evil.test', allowlist)).toBe(false)
  })

  it('places no host restriction of its own when empty', () => {
    expect(isAllowedRemoteHost('anything.example', [])).toBe(true)
  })

  /** One strict policy naming hosts. */
  function naming(hostAllowlist: readonly string[]): RemotePolicy {
    return { access: 'strict', hostAllowlist }
  }

  it('refuses a host the allowlist does not name', () => {
    expect(judgeRemoteImageUrl('https://cdn.example.com/a.png', naming(['other.example'])))
      .toEqual({ kind: 'refused', reason: 'host' })
    expect(judgeRemoteImageUrl('https://cdn.example.com/a.png', naming(['cdn.example.com'])).kind).toBe('accepted')
  })

  it('judges the URL rules before the allowlist, so a bad URL keeps its own reason', () => {
    expect(judgeRemoteImageUrl('http://cdn.example.com/a.png', naming(['cdn.example.com'])))
      .toEqual({ kind: 'refused', reason: 'scheme' })
    expect(judgeRemoteImageUrl('https://127.0.0.1/a.png', naming(['127.0.0.1'])))
      .toEqual({ kind: 'refused', reason: 'literal' })
  })

  it('places no host restriction on a deployment that named none', () => {
    expect(judgeRemoteImageUrl('https://cdn.example.com/a.png', STRICT_REMOTE_POLICY).kind).toBe('accepted')
  })
})

describe('remoteHostLabel', () => {
  it('names the host a stored URL points at', () => {
    expect(remoteHostLabel('https://Images.Example.COM/a.png')).toBe('images.example.com')
    expect(remoteHostLabel('https://example.com:8443/a.png')).toBe('example.com')
  })

  it('names nothing when the stored text is no longer a URL', () => {
    // A hand-edited document can hold anything; the row falls back to its own
    // copy for an unnamed background rather than showing broken text.
    expect(remoteHostLabel('not a url')).toBe('')
    expect(remoteHostLabel('')).toBe('')
  })
})
