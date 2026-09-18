/**
 * Browser-side access to the Host image routes under this plugin's own prefix.
 * @module dsh-plugin-ui-background-image/client/background-catalog
 */

import { DEFAULT_REMOTE_ACCESS, type RemoteAccessMode } from '../background-remote.ts'
import {
  BACKGROUND_CATALOG_ROUTE,
  BACKGROUND_DELETE_ROUTE,
  BACKGROUND_IMAGE_ID_FIELD,
  BACKGROUND_UPLOAD_ROUTE,
  BACKGROUND_REMOTE_ROUTE,
  BACKGROUND_UPLOAD_NAME_FIELD,
  type BackgroundCatalogResponse,
  type BackgroundErrorResponse,
  type BackgroundImageSummary,
  type BackgroundRemoteApprovalRequest,
  type BackgroundRemoteApprovalResponse,
  type BackgroundRemoteRefusalResponse,
} from '../background-api.ts'
import { DEFAULT_MAX_UPLOAD_BYTES } from '../background-api.ts'

/** Catalogue as the settings row needs it. */
export interface BackgroundCatalog {
  /**
   * Absolute directory holding uploaded images, so the page can name where a
   * hand-copied file belongs. Null before the first successful read, and null
   * when the Host declined to name it because this page runs elsewhere.
   */
  directory: string | null
  /** Images the Host's directory holds. */
  images: readonly BackgroundImageSummary[]
  /**
   * Policy the Host applies to remote image URLs, so the page can refuse a URL
   * the deployment would refuse without a round trip. Strict until the first
   * read answers, which refuses more rather than less.
   */
  remoteImageAccess: RemoteAccessMode
  /**
   * Largest upload the Host accepts: its own number once a read has succeeded,
   * and the default until then, so the page can refuse an oversized file before
   * reading it whatever the catalogue says.
   */
  maxUploadBytes: number
}

/** Catalogue state before anything has been read. */
export const EMPTY_BACKGROUND_CATALOG: BackgroundCatalog = Object.freeze({
  directory: null,
  images: [],
  maxUploadBytes: DEFAULT_MAX_UPLOAD_BYTES,
  remoteImageAccess: DEFAULT_REMOTE_ACCESS,
})

/** An image request the Host refused, or one that never reached it. */
export class BackgroundRequestError extends Error {
  /** HTTP status, or 0 when the request never completed. */
  readonly status: number
  /**
   * Machine-readable reason the Host sent, when it sent one; a refusal the row
   * localizes rather than shows as text.
   */
  readonly code: string | undefined

  /**
   * @param message - reason to show the operator.
   * @param status - HTTP status, or 0 for a transport failure.
   * @param code - refusal code the Host sent, when it sent one.
   */
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'BackgroundRequestError'
    this.status = status
    this.code = code
  }
}

/**
 * Send one request, turning a transport failure into {@link BackgroundRequestError}.
 * @param url - route to call.
 * @param init - fetch options.
 * @returns the raw response, refusals included.
 * @throws {BackgroundRequestError} when the request never completed.
 */
async function send(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch (error) {
    throw new BackgroundRequestError(error instanceof Error ? error.message : String(error), 0)
  }
}

/**
 * Read the Host's reason from a refusal.
 * @param response - refused response.
 * @returns the reason, and the refusal code when the body carried one.
 */
async function refusalReason(response: Response): Promise<{ message: string, code?: string }> {
  try {
    const body = await response.json() as BackgroundErrorResponse & Partial<BackgroundRemoteRefusalResponse>
    return body.code === undefined ? { message: body.error } : { message: body.error, code: body.code }
  } catch {
    // A refusal without a readable body still has to name itself, and the
    // status line is the only fact left to name it with.
    return { message: `${response.status} ${response.statusText}` }
  }
}

/**
 * Read one successful response body.
 * @param response - response to read.
 * @returns the parsed body.
 * @throws {BackgroundRequestError} when the Host refused the request.
 */
async function readBody<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const { message, code } = await refusalReason(response)
    throw new BackgroundRequestError(message, response.status, code)
  }
  return await response.json() as T
}

/**
 * Read the catalogue.
 * @param signal - aborts the request, e.g. when the plugin unloads.
 * @returns the catalogue the row renders.
 * @throws {BackgroundRequestError} when the Host refused or the request failed.
 */
export async function fetchBackgroundCatalog(signal: AbortSignal): Promise<BackgroundCatalog> {
  const body = await readBody<BackgroundCatalogResponse>(await send(BACKGROUND_CATALOG_ROUTE, { signal }))
  return {
    directory: body.imageDir,
    images: body.images,
    maxUploadBytes: body.maxUploadBytes,
    remoteImageAccess: body.remoteImageAccess,
  }
}

/**
 * Store one image file. The file's own name travels beside the bytes so the
 * entry can be named readably; it never decides where the file lands.
 * @param bytes - file contents.
 * @param name - file name the browser reported.
 * @param signal - aborts the request.
 * @returns the stored entry, whose id the selection persists.
 * @throws {BackgroundRequestError} when the bytes are not an accepted image or
 * the request failed.
 */
export async function uploadBackgroundImage(
  bytes: ArrayBuffer,
  name: string,
  signal: AbortSignal,
): Promise<BackgroundImageSummary> {
  const url = `${BACKGROUND_UPLOAD_ROUTE}?${BACKGROUND_UPLOAD_NAME_FIELD}=${encodeURIComponent(name)}`
  const response = await send(url, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: bytes,
    signal,
  })
  return readBody<BackgroundImageSummary>(response)
}

/**
 * Ask the Host to approve one remote image URL.
 *
 * The Host judges what this half cannot: the deployment's allowlist, and whether
 * the hostname resolves to public addresses only. The URL is not fetched by
 * either half here — approving it only decides whether the browser may be asked
 * to load it.
 * @param url - URL already accepted by the shared text policy.
 * @param signal - aborts the request.
 * @returns the approved URL and the hostname it names.
 * @throws {BackgroundRequestError} when the Host refused, carrying its reason code.
 */
export async function approveRemoteImage(
  url: string,
  signal: AbortSignal,
): Promise<BackgroundRemoteApprovalResponse> {
  const response = await send(BACKGROUND_REMOTE_ROUTE, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url } satisfies BackgroundRemoteApprovalRequest),
    signal,
  })
  return readBody<BackgroundRemoteApprovalResponse>(response)
}

/**
 * Delete one stored image.
 * @param id - stored image id.
 * @param signal - aborts the request.
 * @throws {BackgroundRequestError} when the Host refused or the request failed.
 */
export async function deleteBackgroundImage(id: string, signal: AbortSignal): Promise<void> {
  const response = await send(`${BACKGROUND_DELETE_ROUTE}?${BACKGROUND_IMAGE_ID_FIELD}=${encodeURIComponent(id)}`, {
    method: 'POST',
    signal,
  })
  if (!response.ok) {
    const { message, code } = await refusalReason(response)
    throw new BackgroundRequestError(message, response.status, code)
  }
}
