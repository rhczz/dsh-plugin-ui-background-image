/**
 * The plugin's HTTP surface, registered on the shared API channel.
 *
 * `ctx.connection.fetch` is the seam the browser already talks to: the physical
 * carrier applies the deployment's Host and Origin fence plus browser
 * authentication, and only then calls one of these handlers with a Fetch-shaped
 * request. Nothing here repeats that judgement, and nothing here can be reached
 * without it — which is why an unauthenticated process cannot read the image
 * directory or choose a background for the browsers that are authenticated.
 *
 * The channel's shape shows through in two places: routes are exact paths
 * carrying `GET` and `POST` only, so an image is addressed by a query parameter
 * and deleting one is a `POST` to an action path.
 * @module dsh-plugin-ui-background-image/background-fetch-routes
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import {
  BACKGROUND_CATALOG_ROUTE,
  BACKGROUND_DELETE_ROUTE,
  BACKGROUND_IMAGE_ID_FIELD,
  BACKGROUND_IMAGE_ROUTE,
  BACKGROUND_REMOTE_ROUTE,
  BACKGROUND_UPLOAD_NAME_FIELD,
  BACKGROUND_UPLOAD_ROUTE,
  type BackgroundCatalogResponse,
  type BackgroundErrorResponse,
  type BackgroundImageSummary,
  type BackgroundRemoteApprovalRequest,
  type BackgroundRemoteApprovalResponse,
  type BackgroundRemoteRefusalCode,
  type BackgroundRemoteRefusalResponse,
} from './background-api.ts'
import { detectBackgroundFileExtension } from './background-files.ts'
import { BACKGROUND_CONTENT_TYPES, type BackgroundFileExtension } from './background-formats.ts'
import { judgeRemoteImageUrl, REMOTE_ANY_URL_MAX_LENGTH, type RemotePolicy } from './background-remote.ts'
import { judgeRemoteHost, type ApprovedRemoteImages } from './background-remote-approval.ts'
import {
  isMintedBackgroundId,
  UnsupportedImageError,
  type StoredImage,
  type UserBackgroundDirectory,
} from './user-backgrounds.ts'

/** Longest accepted approval body: one URL of the widest mode, plus JSON punctuation. */
const REMOTE_BODY_LIMIT_BYTES = REMOTE_ANY_URL_MAX_LENGTH + 1024

/** How long a minted image's bytes may be kept by one browser, in seconds. */
const IMAGE_CACHE_MAX_AGE_SECONDS = 31_536_000

/**
 * Methods every route accepts.
 *
 * The channel dispatches on an exact path and a declared method, and a method a
 * route does not declare falls through to the shared channel's own 404. Both
 * methods this API uses are therefore declared everywhere, and a handler answers
 * 405 itself for the one it does not serve — a wrong method on a known path is
 * the client's mistake, and saying so is more useful than "not found".
 */
const ROUTE_METHODS = ['GET', 'POST'] as const

/** Everything the handlers read. */
export interface BackgroundRouteDeps {
  /** Directory holding stored images. */
  images: UserBackgroundDirectory
  /** Largest accepted upload body in bytes. */
  maxUploadBytes: number
  /** Remote image policy this deployment applies. */
  remotePolicy: RemotePolicy
  /** Approvals the first paint consults. */
  approvals: ApprovedRemoteImages
}

/** One route this plugin answers on the shared API channel. */
interface PluginRoute {
  /** Exact path, as {@link BACKGROUND_API_PREFIX} states it. */
  path: string
  /** Body handling: uploads stream so their own limit applies while reading. */
  requestBody: 'buffered' | 'streaming'
  /** Serve one request. */
  serve: (request: Request, deps: BackgroundRouteDeps) => Promise<Response>
}

/**
 * Register every route this plugin owns. Each is a registration effect, so
 * disposing the owning context stops the plugin answering.
 * @param ctx - context carrying the Connection service.
 * @param deps - directory, limits, and policy the handlers read.
 */
export function registerBackgroundRoutes(ctx: Context, deps: BackgroundRouteDeps): void {
  for (const route of PLUGIN_ROUTES) {
    ctx.effect(
      () => ctx.connection.fetch.register({
        path: route.path,
        methods: [...ROUTE_METHODS],
        requestBody: route.requestBody,
        fetch: request => route.serve(request, deps),
      }),
      `ui-background-image: ${route.path}`,
    )
  }
}

/** The routes, in the order they are documented. */
const PLUGIN_ROUTES: readonly PluginRoute[] = [
  { path: BACKGROUND_CATALOG_ROUTE, requestBody: 'buffered', serve: serveCatalog },
  { path: BACKGROUND_IMAGE_ROUTE, requestBody: 'buffered', serve: serveImage },
  { path: BACKGROUND_UPLOAD_ROUTE, requestBody: 'streaming', serve: serveUpload },
  { path: BACKGROUND_DELETE_ROUTE, requestBody: 'buffered', serve: serveDelete },
  { path: BACKGROUND_REMOTE_ROUTE, requestBody: 'buffered', serve: serveRemoteApproval },
]

/**
 * Answer the catalogue: what the directory holds, the deployment's upload
 * limit, and the remote policy the page applies before it asks for a judgement.
 * @param request - GET request.
 * @param deps - directory and policy.
 * @returns the catalogue, or a refusal.
 */
async function serveCatalog(request: Request, deps: BackgroundRouteDeps): Promise<Response> {
  const wrongMethod = refuseMethod(request, 'GET')
  if (wrongMethod !== undefined) return wrongMethod
  // The directory's own contract is to report what it holds and warn about the
  // rest, so an unreadable directory answers an empty catalogue rather than a
  // failure the row could not act on.
  const images: readonly BackgroundImageSummary[] = await deps.images.list()
  const body: BackgroundCatalogResponse = {
    // A page on another machine cannot copy a file into this directory, so the
    // path would tell it nothing but where this Host keeps its home.
    imageDir: isLoopbackHost(request.headers.get('host')) ? deps.images.path : null,
    images,
    maxUploadBytes: deps.maxUploadBytes,
    remoteImageAccess: deps.remotePolicy.access,
  }
  return Response.json(body, { headers: { 'cache-control': 'no-store' } })
}

/**
 * Whether a request reached this machine by a name that only names this machine.
 *
 * Mirrors the fence's own loopback rule: a Host header naming `localhost`, the
 * IPv6 loopback, or any address in 127/8 is a browser on this machine. A
 * deployment reached by another name is a browser that can reach this Host from
 * elsewhere, and it is told nothing about the filesystem.
 * @param host - Host header as the request carried it, port included.
 * @returns whether the request came from a browser on this machine.
 */
function isLoopbackHost(host: string | null): boolean {
  const hostname = (host ?? '')
    .replace(/:\d+$/, '')
    .replace(/^\[|\]$/g, '')
  if (hostname === 'localhost' || hostname === '::1') return true
  const parts = hostname.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/**
 * Serve one stored image's bytes.
 *
 * A name this plugin minted is immutable and is served to be kept; a name a
 * user copied into the directory can name different bytes after the next copy,
 * so it answers with the write time and a browser that already has it
 * revalidates.
 * @param request - GET request naming the image.
 * @param deps - directory.
 * @returns the image, or a refusal.
 */
async function serveImage(request: Request, deps: BackgroundRouteDeps): Promise<Response> {
  const wrongMethod = refuseMethod(request, 'GET')
  if (wrongMethod !== undefined) return wrongMethod
  const id = imageIdOf(request)
  if (id === undefined) return errorResponse(400, `a "?${BACKGROUND_IMAGE_ID_FIELD}=" query parameter is required`)
  let stored: StoredImage | undefined
  try {
    stored = await deps.images.read(id)
  } catch (error) {
    // The file is there and the Host could not read it, which is not the "no
    // such image" answer and must not be reported as one.
    return errorResponse(500, `could not read the stored image: ${String(error)}`)
  }
  if (stored === undefined) return errorResponse(404, `no stored image named "${id}"`)
  const lastModified = stored.modifiedAt.toUTCString()
  const cacheControl = imageCacheControl(id)
  if (isUnmodifiedSince(request.headers.get('if-modified-since'), stored.modifiedAt)) {
    // The browser's copy is current: answer with the headers alone and no body.
    return new Response(null, { status: 304, headers: { 'cache-control': cacheControl, 'last-modified': lastModified } })
  }
  // The media type restates what these bytes are rather than what the name
  // claims, so a file whose name lies cannot mislabel a response.
  const extension: BackgroundFileExtension | undefined = detectBackgroundFileExtension(stored.bytes)
  return new Response(imageBody(stored.bytes), {
    status: 200,
    headers: {
      'content-type': extension === undefined ? 'application/octet-stream' : BACKGROUND_CONTENT_TYPES[extension],
      'content-length': String(stored.bytes.length),
      'cache-control': cacheControl,
      'last-modified': lastModified,
    },
  })
}

/**
 * Store one uploaded image and answer with the entry the selection persists.
 * @param request - POST request carrying the image bytes.
 * @param deps - directory and limit.
 * @returns the stored entry, or a refusal.
 */
async function serveUpload(request: Request, deps: BackgroundRouteDeps): Promise<Response> {
  const wrongMethod = refuseMethod(request, 'POST')
  if (wrongMethod !== undefined) return wrongMethod
  const bytes = await readBoundedBody(request, deps.maxUploadBytes)
  if (bytes === OVER_LIMIT) {
    return errorResponse(413, `upload exceeds the ${deps.maxUploadBytes} byte limit`)
  }
  const url = new URL(request.url)
  const name = url.searchParams.get(BACKGROUND_UPLOAD_NAME_FIELD) ?? ''
  let summary: BackgroundImageSummary
  try {
    summary = await deps.images.save(bytes, name)
  } catch (error) {
    if (error instanceof UnsupportedImageError) return errorResponse(400, error.message)
    return errorResponse(500, `could not store the uploaded image: ${String(error)}`)
  }
  return Response.json(summary, { status: 201, headers: { 'cache-control': 'no-store' } })
}

/**
 * Delete one stored image.
 * @param request - POST request naming the image.
 * @param deps - directory.
 * @returns an empty answer, or a refusal.
 */
async function serveDelete(request: Request, deps: BackgroundRouteDeps): Promise<Response> {
  const wrongMethod = refuseMethod(request, 'POST')
  if (wrongMethod !== undefined) return wrongMethod
  const id = imageIdOf(request)
  if (id === undefined) return errorResponse(400, `a "?${BACKGROUND_IMAGE_ID_FIELD}=" query parameter is required`)
  let removed: boolean
  try {
    removed = await deps.images.remove(id)
  } catch (error) {
    // The file is there and the Host could not remove it, which is not the
    // "no such image" answer and must not be reported as one.
    return errorResponse(500, `could not delete the stored image: ${String(error)}`)
  }
  if (!removed) return errorResponse(404, `no stored image named "${id}"`)
  return new Response(null, { status: 204 })
}

/**
 * Judge one candidate remote image URL and approve it when it passes.
 *
 * Both halves of the gate run here: the text policy, with this deployment's
 * mode and allowlist, and — in `strict` mode — the judgement of the addresses
 * the hostname resolves to. The URL itself is never fetched: approving one
 * decides whether the browser may be asked to load it, nothing more.
 * @param request - POST request carrying `{ url }`.
 * @param deps - policy and approval record.
 * @returns the approved URL and host, or a refusal.
 */
async function serveRemoteApproval(request: Request, deps: BackgroundRouteDeps): Promise<Response> {
  const wrongMethod = refuseMethod(request, 'POST')
  if (wrongMethod !== undefined) return wrongMethod
  let candidate: unknown
  try {
    candidate = await request.json()
  } catch {
    // The body is a wire boundary, so its shape is checked rather than trusted.
    return errorResponse(400, 'the request body is not JSON')
  }
  const url = (candidate as Partial<BackgroundRemoteApprovalRequest> | null)?.url
  if (typeof url !== 'string') return errorResponse(400, 'the request body must carry a "url" string')
  if (url.length > REMOTE_BODY_LIMIT_BYTES) {
    return errorResponse(413, `the URL exceeds the ${REMOTE_BODY_LIMIT_BYTES} byte limit`)
  }
  const verdict = judgeRemoteImageUrl(url, deps.remotePolicy)
  if (verdict.kind === 'refused') return remoteRefusal(verdict.reason)
  if (deps.remotePolicy.access === 'strict' && verdict.host !== '') {
    const refusal = await judgeRemoteHost(verdict.host)
    if (refusal !== undefined) return remoteRefusal(refusal)
  }
  deps.approvals.approve(verdict.url)
  return Response.json(
    { url: verdict.url, host: verdict.host } satisfies BackgroundRemoteApprovalResponse,
    { status: 201, headers: { 'cache-control': 'no-store' } },
  )
}

/**
 * Read the image id a request names.
 * @param request - request carrying the query.
 * @returns the id, or undefined when the query names none.
 */
function imageIdOf(request: Request): string | undefined {
  return new URL(request.url).searchParams.get(BACKGROUND_IMAGE_ID_FIELD) ?? undefined
}

/**
 * Refuse a method a route does not serve, naming the one it does.
 * @param request - request to judge.
 * @param allowed - method this route serves.
 * @returns the refusal, or undefined when the request carries that method.
 */
function refuseMethod(request: Request, allowed: 'GET' | 'POST'): Response | undefined {
  if (request.method === allowed) return undefined
  return errorResponse(405, `method ${request.method} is not allowed here`, { allow: allowed })
}

/**
 * Answer a refusal, naming the reason as a code the row localizes.
 * @param code - why the URL was refused.
 * @returns the refusal.
 */
function remoteRefusal(code: BackgroundRemoteRefusalCode): Response {
  return Response.json(
    { code, error: `remote image URL refused: ${code}` } satisfies BackgroundRemoteRefusalResponse,
    { status: 400, headers: { 'cache-control': 'no-store' } },
  )
}

/**
 * Answer one refusal.
 * @param status - HTTP status.
 * @param error - reason to show the operator.
 * @param headers - response headers beyond the defaults.
 * @returns the refusal.
 */
function errorResponse(status: number, error: string, headers: Record<string, string> = {}): Response {
  return Response.json({ error } satisfies BackgroundErrorResponse, {
    status,
    headers: { 'cache-control': 'no-store', ...headers },
  })
}

/** Read one request body no larger than a limit, cancelling the stream past it. */
const OVER_LIMIT = Symbol('over limit')

/**
 * Read one request body, refusing rather than buffering past a limit.
 *
 * Streaming mode hands the body over with backpressure and no aggregate cap, so
 * the limit this plugin documents is the limit that applies: the stream is
 * cancelled as soon as the body is known to exceed it.
 * @param request - request carrying the body.
 * @param limit - largest accepted body in bytes.
 * @returns the bytes, or {@link OVER_LIMIT}.
 */
async function readBoundedBody(request: Request, limit: number): Promise<Buffer | typeof OVER_LIMIT> {
  const declared = request.headers.get('content-length')
  if (declared !== null && Number(declared) > limit) {
    await request.body?.cancel()
    return OVER_LIMIT
  }
  const chunks: Buffer[] = []
  let total = 0
  const reader = request.body?.getReader()
  if (reader === undefined) return Buffer.alloc(0)
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel()
      return OVER_LIMIT
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks)
}

/**
 * View one stored buffer as a Fetch body, without copying it.
 *
 * A Node buffer is already a typed-array view over the bytes; the assertion
 * restores the concrete backing-buffer type the Fetch body types expect.
 * @param bytes - stored image bytes.
 * @returns the same memory as a body the Fetch constructor accepts.
 */
function imageBody(bytes: Buffer): BodyInit {
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) as unknown as BodyInit
}

/**
 * Judge one conditional request against the image it asked for.
 *
 * HTTP dates carry whole seconds and a file's timestamp does not, so the
 * validator sent is that timestamp truncated to its second: two writes inside
 * one second serialise to one date, which is the resolution a browser can
 * revalidate at, and the reload after that second sees the later write.
 * @param header - `if-modified-since` as the request carried it.
 * @param modifiedAt - when the stored bytes were last written.
 * @returns whether the browser's copy is still current.
 */
function isUnmodifiedSince(header: string | null, modifiedAt: Date): boolean {
  if (header === null) return false
  const since = Date.parse(header)
  return !Number.isNaN(since) && Math.floor(modifiedAt.getTime() / 1000) * 1000 <= since
}

/**
 * Name the cache directive for one stored image.
 *
 * An id this plugin minted carries a random suffix no later write repeats, so
 * its bytes are immutable and the page may keep them. A name a user copied into
 * the directory can name different bytes after the next copy, so it is
 * revalidated on every use.
 * @param id - stored image id.
 * @returns the `cache-control` directive for that id.
 */
function imageCacheControl(id: string): string {
  return isMintedBackgroundId(id)
    ? `private, max-age=${IMAGE_CACHE_MAX_AGE_SECONDS}, immutable`
    : 'private, max-age=0, must-revalidate'
}
