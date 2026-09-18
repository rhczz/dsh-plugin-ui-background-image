/**
 * The Host-side half of the remote image gate: whether the hostname a URL names
 * resolves to public addresses only.
 *
 * A background image is a request the interface makes on every page load, from
 * the browser. The Host never fetches it, so this module does not either: it
 * resolves the name and judges the answer, which is what keeps a URL from
 * pointing that request at a service on the user's own machine or network.
 *
 * The classification of one address is the judgement this repository's fetch
 * provider applies to its own destinations, kept in step with it through the
 * same `ipaddr.js` ranges: only a globally reachable unicast address passes.
 * That single rule is also what refuses the transition and translation prefixes
 * — 6to4, Teredo, and NAT64 among them — whose real destination is an IPv4
 * address the DNS answer does not state, and which this reader therefore cannot
 * prove public.
 * @module dsh-plugin-ui-background-image/background-remote-approval
 */

import { lookup } from 'node:dns/promises'
import ipaddr from 'ipaddr.js'
import type { RemoteAddressRefusal, RemotePolicy } from './background-remote.ts'
import { judgeRemoteImageUrl } from './background-remote.ts'

/** How long one resolution may take before the URL is refused. */
const RESOLUTION_TIMEOUT_MS = 5_000

/** How many addresses one hostname may answer with and still be judged. */
const MAX_RESOLVED_ADDRESSES = 16

/**
 * Judge whether one address is a globally reachable unicast destination.
 * @param input - textual IPv4 or IPv6 address.
 * @returns whether the address is public.
 */
export function isPublicAddress(input: string): boolean {
  let parsed: ipaddr.IPv4 | ipaddr.IPv6
  try {
    parsed = ipaddr.parse(input)
  } catch {
    // Text that is not an address reaches no destination this plugin knows.
    return false
  }
  if (parsed instanceof ipaddr.IPv4) return parsed.range() === 'unicast'
  // An IPv4-mapped address is judged as the IPv4 address it carries, which the
  // classifier reports as its own range rather than as unicast.
  if (parsed.isIPv4MappedAddress()) return isPublicAddress(parsed.toIPv4Address().toString())
  return parsed.range() === 'unicast'
}

/**
 * Resolve one hostname and judge the whole answer set.
 *
 * Every address has to be public: a name that answers with a public and a
 * private address is refused, because the browser may reach either.
 * @param host - lowercased hostname from a judged URL.
 * @returns undefined when the host is public, else why it was refused.
 */
export async function judgeRemoteHost(host: string): Promise<RemoteAddressRefusal | undefined> {
  let addresses: readonly { address: string }[]
  try {
    addresses = await withTimeout(lookup(host, { all: true, order: 'verbatim' }))
  } catch {
    // A name that does not resolve cannot be judged, and an unjudged name is
    // refused rather than stored.
    return 'unresolved'
  }
  if (addresses.length === 0 || addresses.length > MAX_RESOLVED_ADDRESSES) return 'unresolved'
  return addresses.every(entry => isPublicAddress(entry.address)) ? undefined : 'private'
}

/**
 * Reject after one resolution budget.
 *
 * The timer is unref'd, so a lookup that never settles cannot hold the process
 * open even though the race may be won by the resolution first.
 * @returns a promise that only ever rejects.
 */
function resolutionDeadline(): Promise<never> {
  return new Promise((_resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error('name resolution timed out')) }, RESOLUTION_TIMEOUT_MS)
    timer.unref()
  })
}

/**
 * Wait for one resolution, refusing rather than hanging when it does not settle.
 * @param resolution - the lookup in flight.
 * @returns its answer.
 */
async function withTimeout(
  resolution: Promise<readonly { address: string }[]>,
): Promise<readonly { address: string }[]> {
  return await Promise.race([resolution, resolutionDeadline()])
}

/**
 * How many approvals this process remembers. Each one is a URL the user supplied
 * and this Host judged, so the set stays small; the bound keeps a client that
 * posts candidate URLs in a loop from growing it without end.
 */
const MAX_APPROVALS = 32

/**
 * The remote URLs this Host has judged this process.
 *
 * An index render cannot await a name resolution, so the first paint asks this
 * record instead: a persisted remote URL paints only once the write path or the
 * startup refresh has approved it. A verdict is never assumed — an unknown URL
 * is simply not approved, and a URL that later resolves somewhere private loses
 * its approval.
 */
export class ApprovedRemoteImages {
  private readonly approved = new Set<string>()

  /**
   * @param url - URL to test, as the document holds it.
   * @returns whether this process approved that exact URL.
   */
  isApproved(url: string): boolean {
    return this.approved.has(url)
  }

  /**
   * Record one approved URL, keeping the record bounded.
   * @param url - serialized URL the Host judged public.
   */
  approve(url: string): void {
    const known = [...this.approved].filter(entry => entry !== url)
    known.push(url)
    // The record keeps the most recent approvals and retires the oldest, so a
    // client that keeps posting candidate URLs cannot grow it without end.
    this.approved.clear()
    for (const entry of known.slice(-MAX_APPROVALS)) this.approved.add(entry)
  }

  /**
   * Judge the URL a persisted selection names and remember the verdict.
   *
   * Called for a document this process has not seen written, so a restart paints
   * a chosen remote background once the name has been judged again.
   * @param selection - the resolved section.
   * @param policy - deployment policy for remote URLs.
   * @returns the refusal when the URL was refused, for the caller to report.
   */
  async refresh(
    selection: { readonly source: string, readonly url: string },
    policy: RemotePolicy,
  ): Promise<RemoteAddressRefusal | undefined> {
    if (selection.source !== 'remote') return undefined
    const verdict = judgeRemoteImageUrl(selection.url, policy)
    if (verdict.kind === 'refused') return undefined
    // `any` is the deployment saying its own browsers may be pointed anywhere,
    // so there is nothing left for a resolution to decide.
    const refusal = policy.access === 'strict' && verdict.host !== ''
      ? await judgeRemoteHost(verdict.host)
      : undefined
    if (refusal === undefined) this.approve(verdict.url)
    else this.approved.delete(verdict.url)
    return refusal
  }
}
