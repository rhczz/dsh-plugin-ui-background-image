/**
 * The plugin's routes on the shared API channel: what each one answers, and
 * what it does with the request the carrier already authenticated.
 *
 * The carrier applies the deployment's Host and Origin fence plus browser
 * authentication before any of this runs, so nothing here tests that: these
 * cases drive one handler at a time with a plain Fetch request, which is the
 * whole request the handler is promised.
 * @module dsh-plugin-ui-background-image/tests/background-fetch-routes
 */

import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import {
  BACKGROUND_CATALOG_ROUTE,
  BACKGROUND_DELETE_ROUTE,
  BACKGROUND_IMAGE_ROUTE,
  BACKGROUND_REMOTE_ROUTE,
  BACKGROUND_UPLOAD_ROUTE,
  type BackgroundCatalogResponse,
  type BackgroundErrorResponse,
  type BackgroundImageSummary,
  type BackgroundRemoteApprovalResponse,
  type BackgroundRemoteRefusalResponse,
} from '../src/background-api.ts'
import { REMOTE_ANY_URL_MAX_LENGTH, STRICT_REMOTE_POLICY, type RemotePolicy } from '../src/background-remote.ts'
import { ApprovedRemoteImages } from '../src/background-remote-approval.ts'
import { registerBackgroundRoutes } from '../src/background-fetch-routes.ts'
import { UserBackgroundDirectory } from '../src/user-backgrounds.ts'

/** The resolver's answer, or a failure, for the approval cases. */
const dnsMock = vi.hoisted(() => ({ answer: [{ address: '93.184.216.34' }], fail: false }))

vi.mock('node:dns/promises', () => ({
  lookup: () => (dnsMock.fail ? Promise.reject(new Error('ENOTFOUND')) : Promise.resolve(dnsMock.answer)),
}))

/** Bytes that identify as a PNG. */
const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(8),
])

/** One route as the fake Connection service recorded it. */
interface RecordedRoute {
  path: string
  methods: readonly string[]
  requestBody: 'buffered' | 'streaming'
  fetch: (request: Request) => Promise<Response>
}

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

/** A context double recording fetch-route registrations as disposables. */
interface TestHost {
  ctx: Context
  routes: RecordedRoute[]
  dispose: () => void
}

/**
 * Build a context whose Connection service records registrations and whose
 * effects can be disposed, so the registration behaviour is observable.
 * @returns the context double.
 */
function makeHost(): TestHost {
  const routes: RecordedRoute[] = []
  const disposers: (() => void)[] = []
  const ctx = {
    connection: {
      fetch: {
        register(route: RecordedRoute) {
          routes.push(route)
          return () => {
            const index = routes.indexOf(route)
            if (index !== -1) routes.splice(index, 1)
            return Promise.resolve()
          }
        },
      },
    },
    effect(callback: () => unknown) {
      const disposer = callback()
      if (typeof disposer === 'function') disposers.push(disposer as () => void)
      return disposer
    },
  } as unknown as Context
  return {
    ctx,
    routes,
    dispose: () => {
      for (const dispose of disposers.reverse()) dispose()
    },
  }
}

/** One registered route together with the state a test asserts against. */
interface Fixture {
  host: TestHost
  images: UserBackgroundDirectory
  imageDir: string
  approvals: ApprovedRemoteImages
  /** Answer one request through the named route. */
  send: (path: string, request: Request) => Promise<Response>
}

/**
 * Register the routes over a temporary image directory.
 * @param options - upload limit, remote policy, and whether the directory exists.
 * @returns the recorded routes and the directory backing them.
 */
async function register(
  options: { maxUploadBytes?: number, policy?: RemotePolicy, directory?: 'file' } = {},
): Promise<Fixture> {
  const parent = await mkdtemp(join(tmpdir(), 'dsh-background-routes-'))
  directories.push(parent)
  const imageDir = join(parent, 'backgrounds')
  if (options.directory === 'file') await writeFile(imageDir, 'not a directory')
  else await mkdir(imageDir, { recursive: true })
  const host = makeHost()
  const images = new UserBackgroundDirectory(imageDir, { warn: vi.fn() })
  const approvals = new ApprovedRemoteImages()
  registerBackgroundRoutes(host.ctx, {
    images,
    maxUploadBytes: options.maxUploadBytes ?? 1024,
    remotePolicy: options.policy ?? STRICT_REMOTE_POLICY,
    approvals,
  })
  return {
    host,
    images,
    imageDir,
    approvals,
    send: async (path, request) => {
      const route = host.routes.find(entry => entry.path === path)
      if (route === undefined) throw new Error(`route ${path} was not registered`)
      return await route.fetch(request)
    },
  }
}

/**
 * Build one request the way the carrier would hand it over.
 * @param url - absolute request URL, query included.
 * @param init - method, body, and headers.
 * @returns the request.
 */
function request(url: string, init: RequestInit = {}): Request {
  return new Request(`http://dsh.internal${url}`, init)
}

/**
 * Read one response body as JSON.
 * @param response - response to read.
 * @returns the parsed body.
 */
async function bodyOf<T>(response: Response): Promise<T> {
  return await response.json() as T
}

describe('registration', () => {
  it('registers every route as a registration effect', async () => {
    const { host } = await register()
    expect(host.routes.map(route => route.path).sort()).toEqual([
      BACKGROUND_CATALOG_ROUTE,
      BACKGROUND_DELETE_ROUTE,
      BACKGROUND_IMAGE_ROUTE,
      BACKGROUND_REMOTE_ROUTE,
      BACKGROUND_UPLOAD_ROUTE,
    ].sort())
    expect(host.routes.every(route => route.methods.join() === 'GET,POST')).toBe(true)
    expect(host.routes.filter(route => route.requestBody === 'streaming').map(route => route.path))
      .toEqual([BACKGROUND_UPLOAD_ROUTE])
    host.dispose()
    expect(host.routes).toEqual([])
  })
})

describe('the catalogue route', () => {
  it('names the image directory to a browser on this machine', async () => {
    const { send, imageDir } = await register()
    const response = await send(BACKGROUND_CATALOG_ROUTE, request(BACKGROUND_CATALOG_ROUTE, {
      headers: { host: '127.0.0.1:3080' },
    }))
    expect(response.status).toBe(200)
    const body = await bodyOf<BackgroundCatalogResponse>(response)
    expect(body.imageDir).toBe(imageDir)
    expect(body.maxUploadBytes).toBe(1024)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('counts every spelling of this machine as this machine', async () => {
    const { send, imageDir } = await register()
    for (const host of ['localhost', 'localhost:3080', '[::1]:3080', '127.9.9.9']) {
      const response = await send(BACKGROUND_CATALOG_ROUTE, request(BACKGROUND_CATALOG_ROUTE, { headers: { host } }))
      expect((await bodyOf<BackgroundCatalogResponse>(response)).imageDir).toBe(imageDir)
    }
  })

  it('withholds the directory path from a browser that reached another name', async () => {
    const { send } = await register()
    for (const host of ['192.168.1.10:3080', 'harness.example', '']) {
      const response = await send(BACKGROUND_CATALOG_ROUTE, request(BACKGROUND_CATALOG_ROUTE, { headers: { host } }))
      // A page on another machine cannot copy a file into that directory, so the
      // path would say nothing but where this Host keeps its home.
      expect((await bodyOf<BackgroundCatalogResponse>(response)).imageDir).toBeNull()
    }
  })

  it('withholds the directory path from a request that named no host at all', async () => {
    const { send } = await register()
    // A wire boundary is checked rather than trusted: a request that carries no
    // Host header is not a request from this machine.
    const hostless = {
      url: `http://dsh.internal${BACKGROUND_CATALOG_ROUTE}`,
      method: 'GET',
      headers: new Headers(),
    } as unknown as Request
    expect((await bodyOf<BackgroundCatalogResponse>(await send(BACKGROUND_CATALOG_ROUTE, hostless))).imageDir)
      .toBeNull()
  })

  it('reports the remote policy the deployment applies', async () => {
    const { send } = await register({ policy: { access: 'any', hostAllowlist: [] } })
    const response = await send(BACKGROUND_CATALOG_ROUTE, request(BACKGROUND_CATALOG_ROUTE))
    expect((await bodyOf<BackgroundCatalogResponse>(response)).remoteImageAccess).toBe('any')
  })

  it('lists the images the directory holds', async () => {
    const { send, images } = await register()
    const stored = await images.save(PNG_BYTES, 'Sunset.png')
    const response = await send(BACKGROUND_CATALOG_ROUTE, request(BACKGROUND_CATALOG_ROUTE))
    expect((await bodyOf<BackgroundCatalogResponse>(response)).images).toEqual([stored])
  })

  it('answers an empty catalogue for a directory it could not read', async () => {
    const warn = vi.fn()
    const parent = await mkdtemp(join(tmpdir(), 'dsh-background-routes-'))
    directories.push(parent)
    const imageDir = join(parent, 'backgrounds')
    await mkdir(imageDir, { recursive: true })
    await writeFile(join(imageDir, 'sunset.png'), PNG_BYTES)
    const host = makeHost()
    registerBackgroundRoutes(host.ctx, {
      images: new UserBackgroundDirectory(imageDir, { warn }),
      maxUploadBytes: 1024,
      remotePolicy: STRICT_REMOTE_POLICY,
      approvals: new ApprovedRemoteImages(),
    })
    // A directory the process may not read is not an empty directory: the row
    // still shows nothing, and the reason reaches the operator's log.
    await chmod(imageDir, 0o000)
    try {
      const route = host.routes.find(entry => entry.path === BACKGROUND_CATALOG_ROUTE)
      const response = await route?.fetch(request(BACKGROUND_CATALOG_ROUTE))
      expect(response?.status).toBe(200)
      expect((await bodyOf<BackgroundCatalogResponse>(response as Response)).images).toEqual([])
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not read the image directory'))
    } finally {
      await chmod(imageDir, 0o755)
    }
  })

  it('refuses a method it does not answer, naming the one it does', async () => {
    const { send, host } = await register()
    const response = await send(BACKGROUND_CATALOG_ROUTE, request(BACKGROUND_CATALOG_ROUTE, { method: 'POST' }))
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET')
    expect(host.routes).toHaveLength(5)
  })
})

describe('the image route', () => {
  /** Store one image and answer the selection id it produced. */
  async function store(fixture: Fixture, bytes = PNG_BYTES): Promise<string> {
    return (await fixture.images.save(bytes, 'Sunset.png')).id
  }

  it('serves the bytes with the media type the bytes carry', async () => {
    const fixture = await register()
    const id = await store(fixture)
    const response = await fixture.send(BACKGROUND_IMAGE_ROUTE, request(`${BACKGROUND_IMAGE_ROUTE}?id=${id}`))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG_BYTES)
  })

  it('labels bytes it cannot identify as an opaque body rather than guessing', async () => {
    const fixture = await register()
    // A hand-copied file can carry a name the bytes do not agree with.
    await writeFile(join(fixture.imageDir, 'copied.png'), Buffer.from('not an image'))
    const response = await fixture.send(BACKGROUND_IMAGE_ROUTE, request(`${BACKGROUND_IMAGE_ROUTE}?id=copied.png`))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/octet-stream')
  })

  it('lets a browser keep a minted image and revalidate a hand-copied one', async () => {
    const fixture = await register()
    const minted = await store(fixture)
    const copied = 'sunset.png'
    await writeFile(join(fixture.imageDir, copied), PNG_BYTES)
    const immutable = await fixture.send(BACKGROUND_IMAGE_ROUTE, request(`${BACKGROUND_IMAGE_ROUTE}?id=${minted}`))
    expect(immutable.headers.get('cache-control')).toMatch(/immutable$/)
    const revalidated = await fixture.send(BACKGROUND_IMAGE_ROUTE, request(`${BACKGROUND_IMAGE_ROUTE}?id=${copied}`))
    expect(revalidated.headers.get('cache-control')).toBe('private, max-age=0, must-revalidate')
  })

  it('answers a conditional request with the date the bytes were written', async () => {
    const fixture = await register()
    const id = await store(fixture)
    const first = await fixture.send(BACKGROUND_IMAGE_ROUTE, request(`${BACKGROUND_IMAGE_ROUTE}?id=${id}`))
    const lastModified = first.headers.get('last-modified')
    expect(lastModified).not.toBeNull()
    const again = await fixture.send(BACKGROUND_IMAGE_ROUTE, request(`${BACKGROUND_IMAGE_ROUTE}?id=${id}`, {
      headers: { 'if-modified-since': String(lastModified) },
    }))
    expect(again.status).toBe(304)
    expect(again.headers.get('last-modified')).toBe(lastModified)
    expect((await again.arrayBuffer()).byteLength).toBe(0)
  })

  it('serves the image again when it was written after the date asked about', async () => {
    const fixture = await register()
    const id = await store(fixture)
    const response = await fixture.send(BACKGROUND_IMAGE_ROUTE, request(`${BACKGROUND_IMAGE_ROUTE}?id=${id}`, {
      headers: { 'if-modified-since': 'Thu, 01 Jan 1970 00:00:00 GMT' },
    }))
    expect(response.status).toBe(200)
  })

  it('serves the image when the date it was asked about is unreadable', async () => {
    const fixture = await register()
    const id = await store(fixture)
    const response = await fixture.send(BACKGROUND_IMAGE_ROUTE, request(`${BACKGROUND_IMAGE_ROUTE}?id=${id}`, {
      headers: { 'if-modified-since': 'not a date' },
    }))
    expect(response.status).toBe(200)
  })

  it('answers a name the directory does not hold', async () => {
    const fixture = await register()
    const response = await fixture.send(BACKGROUND_IMAGE_ROUTE, request(`${BACKGROUND_IMAGE_ROUTE}?id=gone.png`))
    expect(response.status).toBe(404)
    expect((await bodyOf<BackgroundErrorResponse>(response)).error).toMatch(/no stored image named/)
  })

  it('reports a file it could not read rather than calling it missing', async () => {
    const fixture = await register()
    await mkdir(join(fixture.imageDir, 'sunset.png'), { recursive: true })
    const response = await fixture.send(BACKGROUND_IMAGE_ROUTE, request(`${BACKGROUND_IMAGE_ROUTE}?id=sunset.png`))
    expect(response.status).toBe(500)
    expect((await bodyOf<BackgroundErrorResponse>(response)).error).toMatch(/could not read the stored image/)
  })

  it('requires the query that names the image', async () => {
    const fixture = await register()
    const response = await fixture.send(BACKGROUND_IMAGE_ROUTE, request(BACKGROUND_IMAGE_ROUTE))
    expect(response.status).toBe(400)
    expect((await bodyOf<BackgroundErrorResponse>(response)).error).toMatch(/query parameter is required/)
  })

  it('refuses a method it does not answer', async () => {
    const fixture = await register()
    const response = await fixture.send(BACKGROUND_IMAGE_ROUTE, request(BACKGROUND_IMAGE_ROUTE, { method: 'POST' }))
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET')
  })
})

describe('the upload route', () => {
  it('stores an image and answers with the entry the selection persists', async () => {
    const fixture = await register()
    const response = await fixture.send(
      BACKGROUND_UPLOAD_ROUTE,
      request(`${BACKGROUND_UPLOAD_ROUTE}?name=${encodeURIComponent('Sunset.png')}`, {
        method: 'POST',
        body: PNG_BYTES,
      }),
    )
    expect(response.status).toBe(201)
    const summary = await bodyOf<BackgroundImageSummary>(response)
    expect(summary.name).toBe('sunset')
    expect(summary.id).toMatch(/^sunset-[0-9a-f]{16}\.png$/)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('names an upload the query did not name', async () => {
    const fixture = await register()
    const response = await fixture.send(BACKGROUND_UPLOAD_ROUTE, request(BACKGROUND_UPLOAD_ROUTE, {
      method: 'POST',
      body: PNG_BYTES,
    }))
    expect((await bodyOf<BackgroundImageSummary>(response)).name).toBe('image')
  })

  it('refuses bytes that are no image this plugin stores', async () => {
    const fixture = await register()
    const response = await fixture.send(BACKGROUND_UPLOAD_ROUTE, request(BACKGROUND_UPLOAD_ROUTE, {
      method: 'POST',
      body: Buffer.from('not an image'),
    }))
    expect(response.status).toBe(400)
    expect((await bodyOf<BackgroundErrorResponse>(response)).error).toMatch(/not one of/)
  })

  it('refuses an upload past the limit before reading it', async () => {
    const fixture = await register({ maxUploadBytes: 8 })
    const response = await fixture.send(BACKGROUND_UPLOAD_ROUTE, request(BACKGROUND_UPLOAD_ROUTE, {
      method: 'POST',
      body: PNG_BYTES,
    }))
    expect(response.status).toBe(413)
    expect((await bodyOf<BackgroundErrorResponse>(response)).error).toMatch(/exceeds the 8 byte limit/)
  })

  it('refuses an upload whose declared length is past the limit', async () => {
    const fixture = await register({ maxUploadBytes: 8 })
    const response = await fixture.send(BACKGROUND_UPLOAD_ROUTE, request(BACKGROUND_UPLOAD_ROUTE, {
      method: 'POST',
      body: PNG_BYTES,
      headers: { 'content-length': '9999' },
    }))
    expect(response.status).toBe(413)
  })

  it('refuses an upload that streams past the limit without declaring it', async () => {
    const fixture = await register({ maxUploadBytes: 8 })
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(PNG_BYTES))
        controller.close()
      },
    })
    // A chunked body declares no length, so the limit is enforced while reading.
    const response = await fixture.send(BACKGROUND_UPLOAD_ROUTE, new Request(`http://dsh.internal${BACKGROUND_UPLOAD_ROUTE}`, {
      method: 'POST',
      body: stream,
      duplex: 'half',
    } as RequestInit))
    expect(response.status).toBe(413)
  })

  it('stores an upload that carries no body at all as an unusable image', async () => {
    const fixture = await register()
    const response = await fixture.send(BACKGROUND_UPLOAD_ROUTE, request(BACKGROUND_UPLOAD_ROUTE, { method: 'POST' }))
    expect(response.status).toBe(400)
  })

  it('reports a directory that could not store the upload', async () => {
    const fixture = await register({ directory: 'file' })
    const response = await fixture.send(BACKGROUND_UPLOAD_ROUTE, request(BACKGROUND_UPLOAD_ROUTE, {
      method: 'POST',
      body: PNG_BYTES,
    }))
    expect(response.status).toBe(500)
    expect((await bodyOf<BackgroundErrorResponse>(response)).error).toMatch(/could not store the uploaded image/)
  })

  it('refuses a method it does not answer, naming the one it does', async () => {
    const fixture = await register()
    const response = await fixture.send(BACKGROUND_UPLOAD_ROUTE, request(BACKGROUND_UPLOAD_ROUTE))
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('POST')
  })
})

describe('the delete route', () => {
  it('deletes a stored image and answers with nothing', async () => {
    const fixture = await register()
    const stored = await fixture.images.save(PNG_BYTES, 'Sunset.png')
    const response = await fixture.send(
      BACKGROUND_DELETE_ROUTE,
      request(`${BACKGROUND_DELETE_ROUTE}?id=${stored.id}`, { method: 'POST' }),
    )
    expect(response.status).toBe(204)
    expect(await fixture.images.list()).toEqual([])
  })

  it('answers a name the directory does not hold', async () => {
    const fixture = await register()
    const response = await fixture.send(
      BACKGROUND_DELETE_ROUTE,
      request(`${BACKGROUND_DELETE_ROUTE}?id=gone.png`, { method: 'POST' }),
    )
    expect(response.status).toBe(404)
  })

  it('reports a file it could not delete rather than calling it missing', async () => {
    const fixture = await register()
    await mkdir(join(fixture.imageDir, 'sunset.png'), { recursive: true })
    await writeFile(join(fixture.imageDir, 'sunset.png', 'inner.png'), PNG_BYTES)
    const response = await fixture.send(
      BACKGROUND_DELETE_ROUTE,
      request(`${BACKGROUND_DELETE_ROUTE}?id=sunset.png`, { method: 'POST' }),
    )
    expect(response.status).toBe(500)
    expect((await bodyOf<BackgroundErrorResponse>(response)).error).toMatch(/could not delete the stored image/)
  })

  it('requires the query that names the image, and the method that deletes', async () => {
    const fixture = await register()
    const unnamed = await fixture.send(BACKGROUND_DELETE_ROUTE, request(BACKGROUND_DELETE_ROUTE, { method: 'POST' }))
    expect(unnamed.status).toBe(400)
    const wrongMethod = await fixture.send(BACKGROUND_DELETE_ROUTE, request(BACKGROUND_DELETE_ROUTE))
    expect(wrongMethod.status).toBe(405)
    expect(wrongMethod.headers.get('allow')).toBe('POST')
  })
})

describe('the remote approval route', () => {
  /** Post one candidate URL the way the row does. */
  async function approve(
    url: unknown,
    options: { policy?: RemotePolicy, body?: BodyInit, host?: string } = {},
  ): Promise<Fixture & { response: Response }> {
    const fixture = await register(options.policy === undefined ? {} : { policy: options.policy })
    const response = await fixture.send(BACKGROUND_REMOTE_ROUTE, request(BACKGROUND_REMOTE_ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: options.body ?? JSON.stringify({ url }),
    }))
    return { ...fixture, response }
  }

  it('approves a URL whose every address is public, and remembers it', async () => {
    const { response, approvals } = await approve('https://CDN.Example.com/a b.png')
    expect(response.status).toBe(201)
    // The URL is stored in the form the parser produced, which is the form the
    // canvas writes into CSS.
    expect(await bodyOf<BackgroundRemoteApprovalResponse>(response))
      .toEqual({ url: 'https://cdn.example.com/a%20b.png', host: 'cdn.example.com' })
    expect(approvals.isApproved('https://cdn.example.com/a%20b.png')).toBe(true)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('refuses text the policy refuses, naming the reason as a code', async () => {
    const refused = [
      ['not a url', 'url'],
      ['http://cdn.example.com/a.png', 'scheme'],
      ['https://user:secret@cdn.example.com/a.png', 'credentials'],
      ['https://127.0.0.1/a.png', 'literal'],
      ['https://[::1]/a.png', 'literal'],
      ['https://localhost/a.png', 'reserved'],
      ['https://printer.local/a.png', 'reserved'],
      [`https://cdn.example.com/${'a'.repeat(2048)}.png`, 'length'],
    ] as const
    for (const [url, code] of refused) {
      const { response, approvals } = await approve(url)
      expect(response.status).toBe(400)
      expect(await bodyOf<BackgroundRemoteRefusalResponse>(response))
        .toEqual({ code, error: `remote image URL refused: ${code}` })
      expect(approvals.isApproved(url)).toBe(false)
    }
  })

  it('refuses a name that resolves to a private address', async () => {
    dnsMock.answer = [{ address: '93.184.216.34' }, { address: '192.168.1.10' }]
    const { response, approvals } = await approve('https://cdn.example.com/a.png')
    expect(response.status).toBe(400)
    expect((await bodyOf<BackgroundRemoteRefusalResponse>(response)).code).toBe('private')
    expect(approvals.isApproved('https://cdn.example.com/a.png')).toBe(false)
    dnsMock.answer = [{ address: '93.184.216.34' }]
  })

  it('refuses a name that does not resolve', async () => {
    dnsMock.fail = true
    const { response } = await approve('https://cdn.example.com/a.png')
    expect(response.status).toBe(400)
    expect((await bodyOf<BackgroundRemoteRefusalResponse>(response)).code).toBe('unresolved')
    dnsMock.fail = false
  })

  it('refuses a host the deployment does not allow', async () => {
    const { response } = await approve('https://cdn.example.com/a.png', {
      policy: { access: 'strict', hostAllowlist: ['other.example'] },
    })
    expect(response.status).toBe(400)
    expect((await bodyOf<BackgroundRemoteRefusalResponse>(response)).code).toBe('host')
  })

  it('approves a host the deployment names', async () => {
    const { response } = await approve('https://cdn.example.com/a.png', {
      policy: { access: 'strict', hostAllowlist: ['*.example.com'] },
    })
    expect(response.status).toBe(201)
  })

  it('takes the deployment at its word in any mode: http, addresses, and inline images', async () => {
    const policy: RemotePolicy = { access: 'any', hostAllowlist: [] }
    for (const url of [
      'http://192.168.1.10/a.png',
      'http://printer.local/a.png',
      'https://127.0.0.1/a.png',
      'file:///Users/example/photo.png',
    ]) {
      const { response, approvals } = await approve(url, { policy })
      expect(response.status).toBe(201)
      expect(approvals.isApproved(new URL(url).href)).toBe(true)
    }
    // An inline image carries its own bytes, so it names no host to restrict.
    const inline = `data:image/png;base64,${PNG_BYTES.toString('base64')}`
    const { response } = await approve(inline, { policy })
    expect(response.status).toBe(201)
    expect((await bodyOf<BackgroundRemoteApprovalResponse>(response)).host).toBe('')
  })

  it('still holds the closure rules in any mode', async () => {
    const policy: RemotePolicy = { access: 'any', hostAllowlist: [] }
    const tooLong = await approve(`https://cdn.example.com/${'a'.repeat(REMOTE_ANY_URL_MAX_LENGTH)}.png`, { policy })
    expect(tooLong.response.status).toBe(400)
    expect((await bodyOf<BackgroundRemoteRefusalResponse>(tooLong.response)).code).toBe('length')
    const pastTheBodyCap = await approve(`https://cdn.example.com/${'a'.repeat(REMOTE_ANY_URL_MAX_LENGTH + 2048)}.png`, { policy })
    expect(pastTheBodyCap.response.status).toBe(413)
    const notAUrl = await approve('not a url', { policy })
    expect(notAUrl.response.status).toBe(400)
    expect((await bodyOf<BackgroundRemoteRefusalResponse>(notAUrl.response)).code).toBe('url')
    const unlisted = await approve('https://cdn.example.com/a.png', {
      policy: { access: 'any', hostAllowlist: ['other.example'] },
    })
    expect(unlisted.response.status).toBe(400)
    expect((await bodyOf<BackgroundRemoteRefusalResponse>(unlisted.response)).code).toBe('host')
  })

  it('resolves no name in any mode', async () => {
    dnsMock.fail = true
    const { response } = await approve('https://cdn.example.com/a.png', {
      policy: { access: 'any', hostAllowlist: [] },
    })
    expect(response.status).toBe(201)
    dnsMock.fail = false
  })

  it('refuses a body that is not JSON, or that carries no URL', async () => {
    const notJson = await approve('', { body: '{' })
    expect(notJson.response.status).toBe(400)
    expect((await bodyOf<BackgroundErrorResponse>(notJson.response)).error).toMatch(/is not JSON/)
    const noUrl = await approve(undefined, { body: '{"candidate":"https://cdn.example.com/a.png"}' })
    expect(noUrl.response.status).toBe(400)
    expect((await bodyOf<BackgroundErrorResponse>(noUrl.response)).error).toMatch(/must carry a "url" string/)
    const notString = await approve(7)
    expect(notString.response.status).toBe(400)
  })

  it('refuses a method it does not answer, naming the one it does', async () => {
    const fixture = await register()
    const response = await fixture.send(BACKGROUND_REMOTE_ROUTE, request(BACKGROUND_REMOTE_ROUTE))
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('POST')
  })
})
