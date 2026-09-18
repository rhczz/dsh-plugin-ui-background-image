/**
 * The policy a remote background image URL must satisfy before this plugin
 * stores or paints it.
 *
 * The image is loaded by the user's browser, never by the Host: the Host
 * validates the URL and serves nothing from it. What the policy decides is
 * therefore which destinations the interface may be told to request, not what
 * this process may reach.
 *
 * Two classes of rule live here, and the deployment chooses between them:
 *
 * - **Closure rules** hold in every mode, because the stored value reaches a
 *   settings document and a CSS string: the text has to be an absolute URL this
 *   plugin can serialize, and it has to fit the document.
 * - **Destination rules** are the `strict` default: `https` only, no
 *   credentials, a hostname rather than an address, nothing reserved for local
 *   networks, and — in the Host, which is where resolution lives — a name that
 *   resolves to public addresses only. A deployment that would rather point its
 *   own browsers at its own network sets `remoteImageAccess: any`, which keeps
 *   the closure rules and the allowlist and drops the rest.
 * @module dsh-plugin-ui-background-image/background-remote
 */

/** Longest accepted URL in `strict` mode, matching this repository's fetch limit. */
export const REMOTE_URL_MAX_LENGTH = 2048

/**
 * Longest accepted URL in `any` mode.
 *
 * The bound exists so one stored background cannot grow the settings document
 * without end; it is generous enough for a small inline `data:` image.
 */
export const REMOTE_ANY_URL_MAX_LENGTH = 256 * 1024

/** How a deployment treats the destination of a remote image URL. */
export const REMOTE_ACCESS_MODES = ['strict', 'any'] as const

/** One of {@link REMOTE_ACCESS_MODES}. */
export type RemoteAccessMode = typeof REMOTE_ACCESS_MODES[number]

/** Mode a deployment gets when it configures none. */
export const DEFAULT_REMOTE_ACCESS: RemoteAccessMode = 'strict'

/** What the policy applies to one candidate URL. */
export interface RemotePolicy {
  /** Destination rules to apply. */
  readonly access: RemoteAccessMode
  /** Hostnames this deployment names; empty places no host restriction. */
  readonly hostAllowlist: readonly string[]
}

/** Policy a deployment that configured nothing gets. */
export const STRICT_REMOTE_POLICY: RemotePolicy = Object.freeze({
  access: DEFAULT_REMOTE_ACCESS,
  hostAllowlist: [],
})

/**
 * Hostname suffixes that only ever name a machine on the local network.
 *
 * They are refused by name rather than left to resolution, so an obvious
 * misconfiguration is rejected with the reason it is wrong.
 */
const RESERVED_HOST_SUFFIXES: readonly string[] = ['.localhost', '.local', '.internal', '.home.arpa']

/** A dotted-quad IPv4 address, which is the canonical spelling a URL parser produces. */
const IPV4_LITERAL = /^\d{1,3}(?:\.\d{1,3}){3}$/

/** Why a candidate URL was refused. Codes, because copy belongs to the locale dictionary. */
export type RemoteUrlRefusal =
  /** The text is not an absolute URL this plugin can store. */
  | 'url'
  /** Longer than the accepted bound for this deployment's mode. */
  | 'length'
  /** Carries `user:password@`; `strict` only. */
  | 'credentials'
  /** Not an `https` URL; `strict` only. */
  | 'scheme'
  /** Names an IP address instead of a hostname; `strict` only. */
  | 'literal'
  /** Names a hostname reserved for local networks; `strict` only. */
  | 'reserved'
  /** Not named by the deployment's allowlist. */
  | 'host'

/**
 * Why a hostname was refused by resolution.
 *
 * Declared beside the text policy so the code a refusal carries is one closed
 * set: the wire type, the Host's judgement, and the row's copy all name these.
 */
export type RemoteAddressRefusal =
  /** The name resolved to at least one address that is not public. */
  | 'private'
  /** The name did not resolve, or answered with an unusable address count. */
  | 'unresolved'

/** Outcome of judging one candidate URL. */
export type RemoteUrlVerdict =
  | {
    readonly kind: 'accepted'
    /** Serialized URL to store, which is the form the parser normalized. */
    readonly url: string
    /** Hostname the URL names, lowercased, or empty text for an inline image. */
    readonly host: string
  }
  | { readonly kind: 'refused', readonly reason: RemoteUrlRefusal }

/**
 * Judge whether one configured allowlist entry is usable.
 *
 * An entry is a bare hostname or a `*.`-prefixed suffix: anything a URL could
 * carry beyond that (scheme, port, path, credentials) would silently broaden or
 * narrow the grant it looks like it makes.
 * @param entry - configured value, verbatim.
 * @returns whether the entry is a bare hostname or `*.suffix`.
 */
export function isRemoteHostAllowlistEntry(entry: string): boolean {
  const bare = entry.startsWith('*.') ? entry.slice(2) : entry
  if (bare === '' || entry !== entry.toLowerCase()) return false
  if (bare.includes('/') || bare.includes(':') || bare.includes('@') || bare.includes('*')) return false
  return !IPV4_LITERAL.test(bare) && !bare.startsWith('[')
}

/**
 * Judge whether one hostname is named by the allowlist.
 *
 * An empty allowlist places no host restriction of its own.
 * @param host - lowercased hostname from a parsed URL, empty for an inline image.
 * @param allowlist - configured entries, validated by {@link isRemoteHostAllowlistEntry}.
 * @returns whether the host is allowed.
 */
export function isAllowedRemoteHost(host: string, allowlist: readonly string[]): boolean {
  if (allowlist.length === 0) return true
  return allowlist.some((entry) => {
    if (!entry.startsWith('*.')) return host === entry
    // The suffix keeps its leading dot, so the host has to carry at least one
    // label of its own and cannot be the suffix itself.
    const suffix = entry.slice(1)
    return host.endsWith(suffix) && host.length > suffix.length
  })
}

/**
 * Judge one candidate remote background URL against one deployment's policy.
 *
 * The URL is never fetched here, and no name is resolved here: this decides
 * whether the text may be stored and painted at all.
 * @param input - URL text the user supplied.
 * @param policy - the deployment's destination rules and allowlist.
 * @returns the normalized URL, or the reason it was refused.
 */
export function judgeRemoteImageUrl(input: string, policy: RemotePolicy): RemoteUrlVerdict {
  const limit = policy.access === 'strict' ? REMOTE_URL_MAX_LENGTH : REMOTE_ANY_URL_MAX_LENGTH
  if (input.length > limit) return { kind: 'refused', reason: 'length' }
  let parsed: URL
  try {
    parsed = new URL(input)
  } catch {
    // Text no URL parser accepts reaches nothing, in either mode.
    return { kind: 'refused', reason: 'url' }
  }
  // An inline image states its own bytes, so it names no host to judge and has
  // no destination to restrict.
  const inline = parsed.protocol === 'data:'
  if (policy.access === 'strict' && !inline) {
    if (parsed.protocol !== 'https:') return { kind: 'refused', reason: 'scheme' }
    if (parsed.username !== '' || parsed.password !== '') return { kind: 'refused', reason: 'credentials' }
    const named = parsed.hostname.toLowerCase()
    // The parser writes an IPv6 literal in brackets, and normalizes every other
    // spelling of an address to its canonical form, so the text alone is enough
    // to tell an address from a name.
    if (named.startsWith('[') || IPV4_LITERAL.test(named)) return { kind: 'refused', reason: 'literal' }
    const bare = named.endsWith('.') ? named.slice(0, -1) : named
    if (bare === 'localhost' || RESERVED_HOST_SUFFIXES.some(suffix => bare.endsWith(suffix))) {
      return { kind: 'refused', reason: 'reserved' }
    }
    if (!isAllowedRemoteHost(bare, policy.hostAllowlist)) return { kind: 'refused', reason: 'host' }
    return { kind: 'accepted', url: parsed.href, host: bare }
  }
  const host = inline ? '' : parsed.hostname.toLowerCase().replace(/\.$/, '')
  if (!isAllowedRemoteHost(host, policy.hostAllowlist)) return { kind: 'refused', reason: 'host' }
  return { kind: 'accepted', url: parsed.href, host }
}

/**
 * Whether one stored URL carries its image inline rather than naming a host.
 * @param url - URL as the document holds it.
 * @returns whether it is a `data:` URL.
 */
export function isInlineImageUrl(url: string): boolean {
  return url.startsWith('data:')
}

/**
 * Name one stored remote URL the way the row and the picker show it.
 * @param url - URL as the document holds it.
 * @returns its hostname, or empty text when the URL names no host this can read.
 */
export function remoteHostLabel(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    // A document edited by hand can hold text that is no longer a URL; the row
    // then falls back to the copy for an unnamed background.
    return ''
  }
}
