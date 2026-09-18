/**
 * HTTP surface of this plugin: the paths the Host serves and the browser
 * fetches, plus the bodies crossing between them. Both halves import this
 * module so a path, a parameter name, or a field can never drift to one side
 * only.
 *
 * The routes are registered on the shared API channel (`ctx.connection.fetch`),
 * which is the only reason they are shaped the way they are: that channel
 * carries `GET` and `POST` on exact paths and applies the deployment's Host and
 * Origin fence plus browser authentication before a handler runs. An image is
 * therefore addressed by a query parameter rather than by a path segment, and
 * deleting one is a `POST` to an action path rather than a `DELETE`.
 * @module dsh-plugin-ui-background-image/background-api
 */

import type { RemoteAccessMode, RemoteAddressRefusal, RemoteUrlRefusal } from './background-remote.ts'

/**
 * Largest accepted upload before any composition override, in bytes.
 *
 * Both halves read it: the Host defaults its `maxUploadBytes` config to it, and
 * the page refuses an oversized file against it before the first catalogue read
 * has told it what this deployment configured. Leaving the page without a
 * number would make it read a file of any size into memory to find out.
 */
export const DEFAULT_MAX_UPLOAD_BYTES = 20 * 1024 * 1024

/** Prefix every route of this plugin shares. */
export const BACKGROUND_API_PREFIX = '/api/ui-background-image'

/** Route answering {@link BackgroundCatalogResponse}. */
export const BACKGROUND_CATALOG_ROUTE = `${BACKGROUND_API_PREFIX}/catalog`

/** Route serving one stored image's bytes, named by {@link BACKGROUND_IMAGE_ID_FIELD}. */
export const BACKGROUND_IMAGE_ROUTE = `${BACKGROUND_API_PREFIX}/image`

/** Route storing one uploaded image, named by {@link BACKGROUND_UPLOAD_NAME_FIELD}. */
export const BACKGROUND_UPLOAD_ROUTE = `${BACKGROUND_API_PREFIX}/upload`

/** Route deleting one stored image, named by {@link BACKGROUND_IMAGE_ID_FIELD}. */
export const BACKGROUND_DELETE_ROUTE = `${BACKGROUND_API_PREFIX}/delete`

/** Route approving one candidate remote image URL. */
export const BACKGROUND_REMOTE_ROUTE = `${BACKGROUND_API_PREFIX}/remote`

/** Query field naming one stored image on the read and delete routes. */
export const BACKGROUND_IMAGE_ID_FIELD = 'id'

/**
 * Query field a `POST` carries the uploaded file's own name in.
 *
 * Percent-encoded, so a name in any script survives the wire; the name only
 * ever reaches the readable part of a stored file name.
 */
export const BACKGROUND_UPLOAD_NAME_FIELD = 'name'

/** One stored image as the catalogue and upload answers report it. */
export interface BackgroundImageSummary {
  /** File name, which is also the selection's id. */
  id: string
  /** Readable name derived from the file name. */
  name: string
}

/**
 * Body of {@link BACKGROUND_CATALOG_ROUTE}. The Host names its image directory
 * to a browser on the same machine, reports the deployment's upload limit, and
 * states the remote image policy the page applies before it asks the Host to
 * judge a URL.
 */
export interface BackgroundCatalogResponse {
  /** Directory absolute path for a browser on this machine, else null. */
  imageDir: string | null
  /** Images the directory holds, sorted by name. */
  images: readonly BackgroundImageSummary[]
  /** Largest accepted upload in bytes, this deployment's own limit. */
  maxUploadBytes: number
  /** Policy this deployment applies to remote image URLs. */
  remoteImageAccess: RemoteAccessMode
}

/** Body of a `POST` to {@link BACKGROUND_REMOTE_ROUTE}. */
export interface BackgroundRemoteApprovalRequest {
  /** Candidate URL, as the user supplied it. */
  url: string
}

/** Body answering a URL the Host judged loadable. */
export interface BackgroundRemoteApprovalResponse {
  /** Serialized URL to store, which is the form the URL parser produced. */
  url: string
  /** Hostname the URL names, or empty text for an inline image. */
  host: string
}

/** Why the Host refused a candidate URL. */
export type BackgroundRemoteRefusalCode = RemoteUrlRefusal | RemoteAddressRefusal

/** Body refusing a candidate URL: a code the row localizes, and a reason for the operator. */
export interface BackgroundRemoteRefusalResponse {
  /** Machine-readable reason, which the row turns into copy. */
  code: BackgroundRemoteRefusalCode
  /** The same reason in operator-readable English. */
  error: string
}

/** Body of every refusal that carries no code of its own. */
export interface BackgroundErrorResponse {
  /** Reason to show the operator. */
  error: string
}
