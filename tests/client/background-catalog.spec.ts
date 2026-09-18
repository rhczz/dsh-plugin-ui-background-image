/**
 * The browser's access to the Host image routes: what it sends, and how it
 * reports what came back.
 * @module dsh-plugin-ui-background-image/tests/client/background-catalog
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BACKGROUND_CATALOG_ROUTE,
  BACKGROUND_DELETE_ROUTE,
  BACKGROUND_IMAGE_ID_FIELD,
  BACKGROUND_REMOTE_ROUTE,
  BACKGROUND_UPLOAD_NAME_FIELD,
  BACKGROUND_UPLOAD_ROUTE,
  type BackgroundCatalogResponse,
} from '../../src/background-api.ts'
import {
  approveRemoteImage,
  BackgroundRequestError,
  deleteBackgroundImage,
  fetchBackgroundCatalog,
  uploadBackgroundImage,
} from '../../src/client/background-catalog.ts'

const SIGNAL = new AbortController().signal

/** One stored image the Host reports. */
const SUMMARY = { id: 'sunset-a1b2c3d4e5f6a7b8.png', name: 'sunset' }

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Answer every request with one response.
 * @param response - response to answer with, or an error to throw.
 * @returns the fetch double, which records the requests it received.
 */
function stubFetch(response: Response | Error): { calls: [string, RequestInit | undefined][] } {
  const calls: [string, RequestInit | undefined][] = []
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    calls.push([url, init])
    return response instanceof Error ? Promise.reject(response) : Promise.resolve(response)
  })
  return { calls }
}

/**
 * Build one response.
 * @param options - status, body, and whether the body is JSON.
 * @returns the response.
 */
function respond(options: { status?: number, body?: unknown, text?: string } = {}): Response {
  const status = options.status ?? 200
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 404 ? 'Not Found' : 'OK',
    json: () => options.text !== undefined
      ? Promise.reject(new Error('not json'))
      : Promise.resolve(options.body),
  } as unknown as Response
}

describe('fetchBackgroundCatalog', () => {
  it('reads the catalogue the Host reports', async () => {
    const body: BackgroundCatalogResponse = {
      imageDir: '/home/example/.dsh/backgrounds',
      images: [SUMMARY],
      maxUploadBytes: 1024,
      remoteImageAccess: 'strict',
    }
    stubFetch(respond({ body }))
    expect(await fetchBackgroundCatalog(SIGNAL)).toEqual({
      directory: '/home/example/.dsh/backgrounds',
      images: [SUMMARY],
      maxUploadBytes: 1024,
      remoteImageAccess: 'strict',
    })
  })

  it('reads a catalogue that answers with nothing it may name', async () => {
    stubFetch(respond({ body: { imageDir: null, images: [], maxUploadBytes: 2048, remoteImageAccess: 'any' } }))
    expect(await fetchBackgroundCatalog(SIGNAL))
      .toEqual({ directory: null, images: [], maxUploadBytes: 2048, remoteImageAccess: 'any' })
  })

  it('calls the route the Host serves', async () => {
    const fetchDouble = stubFetch(respond({ body: { imageDir: null, images: [], maxUploadBytes: 1 } }))
    await fetchBackgroundCatalog(SIGNAL)
    expect(fetchDouble.calls[0]?.[0]).toBe(BACKGROUND_CATALOG_ROUTE)
  })

  it('reports the reason a refusal carried', async () => {
    stubFetch(respond({ status: 403, body: { error: 'a request from another site may not change the images' } }))
    await expect(fetchBackgroundCatalog(SIGNAL)).rejects.toThrow('a request from another site may not change the images')
  })

  it('carries the status of a refusal', async () => {
    stubFetch(respond({ status: 413, body: { error: 'too large' } }))
    const failure = await fetchBackgroundCatalog(SIGNAL).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(BackgroundRequestError)
    expect((failure as BackgroundRequestError).status).toBe(413)
  })

  it('names itself with the status line when the refusal carried no readable body', async () => {
    stubFetch(respond({ status: 404, text: '<html>' }))
    await expect(fetchBackgroundCatalog(SIGNAL)).rejects.toThrow('404 Not Found')
  })

  it('reports a request that never completed with no status at all', async () => {
    stubFetch(new Error('connection refused'))
    const failure = await fetchBackgroundCatalog(SIGNAL).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(BackgroundRequestError)
    expect((failure as BackgroundRequestError).status).toBe(0)
    expect((failure as BackgroundRequestError).message).toBe('connection refused')
  })

  it('reads a thrown value that is not an error', async () => {
    vi.stubGlobal('fetch', () => Promise.reject('offline'))
    await expect(fetchBackgroundCatalog(SIGNAL)).rejects.toThrow('offline')
  })
})

describe('uploadBackgroundImage', () => {
  it('sends the bytes with the file name beside them', async () => {
    const fetchDouble = stubFetch(respond({ status: 201, body: SUMMARY }))
    const bytes = new Uint8Array([1, 2, 3]).buffer
    expect(await uploadBackgroundImage(bytes, '我的 图片.png', SIGNAL)).toEqual(SUMMARY)
    const [url, init] = fetchDouble.calls[0] ?? []
    // The name travels percent-encoded, so a name in any script survives a
    // header-free wire and still cannot decide where the file lands.
    expect(url).toBe(`${BACKGROUND_UPLOAD_ROUTE}?${BACKGROUND_UPLOAD_NAME_FIELD}=${encodeURIComponent('我的 图片.png')}`)
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe(bytes)
  })

  it('reports the Host reason a refused upload carried', async () => {
    stubFetch(respond({ status: 400, body: { error: 'uploaded bytes are not one of .png' } }))
    await expect(uploadBackgroundImage(new ArrayBuffer(0), 'x.svg', SIGNAL))
      .rejects.toThrow('uploaded bytes are not one of .png')
  })
})

describe('deleteBackgroundImage', () => {
  it('asks for the stored id, percent-encoded', async () => {
    const fetchDouble = stubFetch(respond({ status: 204 }))
    await deleteBackgroundImage('sun set.png', SIGNAL)
    expect(fetchDouble.calls[0]?.[0]).toBe(`${BACKGROUND_DELETE_ROUTE}?${BACKGROUND_IMAGE_ID_FIELD}=sun%20set.png`)
    // The shared API channel carries no DELETE, so deleting is a POST to an
    // action path.
    expect(fetchDouble.calls[0]?.[1]?.method).toBe('POST')
  })

  it('reports a refusal rather than resolving', async () => {
    stubFetch(respond({ status: 404, body: { error: 'no stored image named "x.png"' } }))
    await expect(deleteBackgroundImage('x.png', SIGNAL)).rejects.toThrow('no stored image named "x.png"')
  })

  it('reports a refusal that carried no readable body', async () => {
    stubFetch(respond({ status: 500, text: 'boom' }))
    await expect(deleteBackgroundImage('x.png', SIGNAL)).rejects.toThrow('500 OK')
  })
})

describe('approveRemoteImage', () => {
  it('posts the URL and answers with what the Host approved', async () => {
    const { calls } = stubFetch(respond({ status: 201, body: { url: 'https://cdn.example.com/a.png', host: 'cdn.example.com' } }))
    await expect(approveRemoteImage('https://cdn.example.com/a.png', SIGNAL))
      .resolves.toEqual({ url: 'https://cdn.example.com/a.png', host: 'cdn.example.com' })
    const [url, init] = calls[0] ?? []
    expect(url).toBe(BACKGROUND_REMOTE_ROUTE)
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe('{"url":"https://cdn.example.com/a.png"}')
  })

  it('reports the refusal code the Host named, so the row can localize it', async () => {
    stubFetch(respond({ status: 400, body: { code: 'private', error: 'remote image URL refused: private' } }))
    await expect(approveRemoteImage('https://cdn.example.com/a.png', SIGNAL)).rejects.toMatchObject({
      status: 400,
      code: 'private',
    })
  })

  it('reports a refusal that carried no code as text', async () => {
    stubFetch(respond({ status: 400, body: { error: 'the request body is not JSON' } }))
    const error = await approveRemoteImage('https://cdn.example.com/a.png', SIGNAL).catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(BackgroundRequestError)
    expect((error as BackgroundRequestError).code).toBeUndefined()
  })
})
