// @vitest-environment jsdom
/**
 * The background runtime: the single writer of the selection, the catalogue, and
 * the projected canvas.
 *
 * The cases drive the runtime the way the settings page does and assert against
 * the document and the settings document a user would end up with, not against
 * the calls it made on the way.
 * @module dsh-plugin-ui-background-image/tests/client/background-runtime
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BACKGROUND_CATALOG_ROUTE,
  BACKGROUND_DELETE_ROUTE,
  BACKGROUND_IMAGE_ROUTE,
  BACKGROUND_REMOTE_ROUTE,
  BACKGROUND_UPLOAD_ROUTE,
  type BackgroundCatalogResponse,
  DEFAULT_MAX_UPLOAD_BYTES,
} from '../../src/background-api.ts'
import {
  BACKGROUND_CANVAS_STYLE_ID,
  BACKGROUND_IMAGE_VARIABLE,
  surfaceValue,
  SURFACE_BACKGROUND_PROPERTY,
} from '../../src/background-canvas.ts'
import { DEFAULT_BACKGROUND_OPACITY, surfaceAlphaPercent } from '../../src/background-opacity.ts'
import { backgroundPresetValue } from '../../src/background-presets.ts'
import type { BackgroundSettings } from '../../src/background-settings.ts'
import {
  BackgroundRuntime,
  isBackgroundNoticeFailure,
  type BackgroundNotice,
  type BackgroundRowSnapshot,
} from '../../src/client/background-runtime.ts'
import { FakeScope } from './scope-stub.ts'
import { FakeTheme } from './theme-stub.ts'

/** Composition layer every case starts from: the harness's own background. */
const BASE: BackgroundSettings = {
  source: 'preset',
  id: 'none',
  opacity: DEFAULT_BACKGROUND_OPACITY,
  url: '',
}

/** One stored image the Host reports. */
const STORED = { id: 'sunset-a1b2c3d4e5f6a7b8.png', name: 'sunset' }

/** A second stored image, for the cases that delete one of two. */
const OTHER_STORED = { id: 'dunes-b8a7c6d5e4f3a2b1.png', name: 'dunes' }

/** One request the runtime made. */
interface Recorded {
  url: string
  method: string
  body?: unknown
}

/** Entry an upload through the double stores. */
const UPLOADED = { id: 'uploaded-0123456789abcdef.png', name: 'uploaded' }

let scope: FakeScope
let theme: FakeTheme
let runtime: BackgroundRuntime
let requests: Recorded[]
let frames: FrameRequestCallback[]
/** Frame handles the runtime asked to drop. */
let cancelled: number[]
/** Images the Host double holds, which an upload adds to. */
let stored: (typeof STORED)[]
/** Answer one request the way the Host would, unless a case replaces this. */
let answer: (url: string, init: RequestInit | undefined) => Response

/**
 * Build one response.
 * @param status - HTTP status.
 * @param body - JSON body to answer with.
 * @returns the response.
 */
function respond(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    json: () => Promise.resolve(body),
  } as unknown as Response
}

/**
 * Build a refusal carrying the Host's reason.
 * @param status - HTTP status.
 * @param error - reason the Host refused.
 * @returns the response.
 */
function refuse(status: number, error: string): Response {
  return respond(status, { error })
}

/**
 * Answer the requests this plugin makes the way its Host half would.
 * @param url - request target.
 * @param init - request options.
 * @returns the response.
 */
function host(url: string, init?: RequestInit): Response {
  if (url === BACKGROUND_CATALOG_ROUTE) {
    const body: BackgroundCatalogResponse = {
      imageDir: '/home/example/.dsh/backgrounds',
      images: [...stored],
      maxUploadBytes: 1024,
      remoteImageAccess: 'strict',
    }
    return respond(200, body)
  }
  if (url === BACKGROUND_REMOTE_ROUTE) {
    const candidate = (JSON.parse(init?.body as string) as { url: string }).url
    return respond(201, { url: candidate, host: new URL(candidate).hostname })
  }
  if (url.startsWith(BACKGROUND_UPLOAD_ROUTE)) {
    // A stored upload is in the directory the next catalogue read reports.
    stored = [...stored, UPLOADED]
    return respond(201, UPLOADED)
  }
  return respond(204, undefined)
}

/**
 * Build a file double the runtime can read.
 * @param name - file name the browser reports.
 * @param size - size in bytes the browser reports.
 * @returns the file.
 */
function makeFile(name: string, size: number): File {
  return new File([new Uint8Array(size)], name, { type: 'image/png' })
}

/**
 * Let the catalogue read settle.
 * @returns a promise that resolves after the microtask and timer queues drain.
 */
async function settle(): Promise<void> {
  await new Promise(resolve => { setTimeout(resolve, 0) })
}

/** Run the frame the runtime is waiting on. */
function flushFrame(): void {
  const pending = frames
  frames = []
  for (const callback of pending) callback(0)
}

/**
 * Read the layer the theme service currently holds.
 * @returns the canvas value installed, or undefined when nothing is installed.
 */
function installedCanvas(): { light: string, dark: string } | undefined {
  return theme.layerFor('dsh-plugin-ui-background-image')?.[BACKGROUND_IMAGE_VARIABLE]
}

/**
 * Read the surface value the theme service currently holds.
 * @returns the value installed, or undefined when nothing is installed.
 */
function installedSurface(): { light: string, dark: string } | undefined {
  return theme.layerFor('dsh-plugin-ui-background-image')?.[SURFACE_BACKGROUND_PROPERTY]
}

/**
 * Read the current snapshot and the notice it reports.
 * @returns the snapshot.
 */
function snapshot(): BackgroundRowSnapshot {
  return runtime.getSnapshot()
}

/**
 * Replace the runtime with one whose composition layer paints a preset.
 * @param id - preset the composition selects.
 * @param opacity - opacity the composition carries.
 * @returns the runtime, for the case to start.
 */
function painted(id: 'mist' | 'dusk' | 'ember' | 'verdant', opacity = DEFAULT_BACKGROUND_OPACITY): BackgroundRuntime {
  scope = new FakeScope({ source: 'preset', id, opacity, url: '' })
  runtime = new BackgroundRuntime(scope.asScope(), theme.asService())
  return runtime
}

beforeEach(() => {
  requests = []
  frames = []
  cancelled = []
  stored = [STORED, OTHER_STORED]
  answer = host
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback)
    return frames.length
  })
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => {
    cancelled.push(handle)
    frames[handle - 1] = () => {}
  })
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    requests.push({ url, method: init?.method ?? 'GET', body: init?.body })
    try {
      return Promise.resolve(answer(url, init))
    } catch (error) {
      return Promise.reject(error)
    }
  })
  scope = new FakeScope(BASE)
  theme = new FakeTheme()
  runtime = new BackgroundRuntime(scope.asScope(), theme.asService())
})

afterEach(() => {
  runtime.dispose()
  vi.unstubAllGlobals()
  document.body.removeAttribute('style')
  document.head.replaceChildren()
})

describe('starting', () => {
  it('installs the canvas rule and reads the catalogue', async () => {
    runtime.start()
    expect(document.getElementById(BACKGROUND_CANVAS_STYLE_ID)).not.toBeNull()
    expect(requests.map(entry => entry.url)).toEqual([BACKGROUND_CATALOG_ROUTE])
    await settle()
    expect(snapshot().catalog).toBe('ready')
    expect(snapshot().directory).toBe('/home/example/.dsh/backgrounds')
    expect(snapshot().images).toEqual([STORED, OTHER_STORED])
  })

  it('leaves the first paint the served page wrote standing until the document resolves', () => {
    // The Host paints the stored background into the index before any script
    // runs; the runtime must not clear it while the namespace is still loading,
    // or the user's background would blink away for a round trip.
    document.body.style.setProperty(BACKGROUND_IMAGE_VARIABLE, 'url("/api/first-paint.png")')
    document.body.style.setProperty(SURFACE_BACKGROUND_PROPERTY, 'rgb(255, 255, 255)')
    scope.hideValue()
    runtime = new BackgroundRuntime(scope.asScope(), theme.asService())
    runtime.start()
    expect(document.body.style.getPropertyValue(BACKGROUND_IMAGE_VARIABLE)).toBe('url("/api/first-paint.png")')
    expect(document.body.style.getPropertyValue(SURFACE_BACKGROUND_PROPERTY)).toBe('rgb(255, 255, 255)')
    expect(theme.sources()).toEqual([])
    // The runtime reports the defaults it would fall back to, and the catalogue
    // read still runs, so the row has something to render either way.
    expect(snapshot().selection).toEqual(BASE)
    expect(requests.map(entry => entry.url)).toEqual([BACKGROUND_CATALOG_ROUTE])
  })

  it('replaces the first paint once the document resolves, without clearing it first', () => {
    document.body.style.setProperty(BACKGROUND_IMAGE_VARIABLE, 'url("/api/first-paint.png")')
    scope.hideValue()
    scope.setBase({ source: 'preset', id: 'verdant', opacity: 65, url: '' })
    runtime = new BackgroundRuntime(scope.asScope(), theme.asService())
    runtime.start()
    scope.revealValue()
    expect(installedCanvas()).toEqual(backgroundPresetValue('verdant'))
  })

  it('installs nothing for the harness\u2019s own background', async () => {
    runtime.start()
    await settle()
    // With no background chosen the document is left exactly as the harness
    // wrote it: no token layer, no inline write of this plugin\u2019s own.
    expect(theme.sources()).toEqual([])
    expect(document.body.style.getPropertyValue(BACKGROUND_IMAGE_VARIABLE)).toBe('')
    expect(document.body.style.getPropertyValue(SURFACE_BACKGROUND_PROPERTY)).toBe('')
  })

  it('paints a composition background from the first snapshot', () => {
    scope = new FakeScope({ source: 'preset', id: 'dusk', opacity: 50, url: '' })
    runtime = new BackgroundRuntime(scope.asScope(), theme.asService())
    runtime.start()
    expect(installedCanvas()).toEqual(backgroundPresetValue('dusk'))
    expect(installedSurface()).toEqual(surfaceValue(surfaceAlphaPercent(50)))
  })

  it('waits for the catalogue before resolving a stored image', async () => {
    scope = new FakeScope({ source: 'upload', id: STORED.id, opacity: 65, url: '' })
    runtime = new BackgroundRuntime(scope.asScope(), theme.asService())
    runtime.start()
    // Nothing installed yet, and nothing cleared either: the Host's first-paint
    // row already has the right background, and a guess here would replace it.
    expect(theme.sources()).toEqual([])
    await settle()
    expect(installedCanvas()?.light).toBe(`url("${BACKGROUND_IMAGE_ROUTE}?id=${STORED.id}")`)
  })

  it('clears the canvas once a read catalogue proves the file gone', async () => {
    answer = (_url, init) => init?.method === undefined
      ? respond(200, { imageDir: null, images: [], maxUploadBytes: 1024, remoteImageAccess: 'strict' })
      : respond(204, undefined)
    scope = new FakeScope({ source: 'upload', id: STORED.id, opacity: 65, url: '' })
    runtime = new BackgroundRuntime(scope.asScope(), theme.asService())
    runtime.start()
    await settle()
    expect(installedCanvas()).toBeUndefined()
    expect(snapshot().available).toBe(false)
  })
})

describe('choosing a background', () => {
  it('moves every field of the selection in one write, so none is validated against another', async () => {
    runtime.start()
    await settle()
    runtime.select('upload', STORED.id)
    expect(scope.batches.at(-1)).toEqual([
      { op: 'set', path: ['source'], value: 'upload' },
      { op: 'set', path: ['id'], value: STORED.id },
      { op: 'set', path: ['url'], value: '' },
    ])
  })

  it('projects the choice before the write has settled', async () => {
    runtime.start()
    await settle()
    runtime.select('preset', 'mist')
    expect(installedCanvas()).toEqual(backgroundPresetValue('mist'))
    expect(snapshot().selection.id).toBe('mist')
  })

  it('reports a stored image as available once the catalogue names it', async () => {
    runtime.start()
    await settle()
    runtime.select('upload', STORED.id)
    expect(snapshot().available).toBe(true)
    expect(snapshot().notice).toBe('')
  })

  it('reports a selection whose file is gone rather than leaving the row silent', async () => {
    runtime.start()
    await settle()
    runtime.select('upload', 'vanished-ffffffffffffffff.png')
    expect(snapshot().available).toBe(false)
    expect(installedCanvas()).toBeUndefined()
  })

  it('restores the profile default, clearing every field it owns', async () => {
    runtime.start()
    await settle()
    runtime.select('preset', 'ember')
    runtime.reset()
    expect(scope.batches.at(-1)).toEqual([
      { op: 'unset', path: ['source'] },
      { op: 'unset', path: ['id'] },
      { op: 'unset', path: ['url'] },
      { op: 'unset', path: ['opacity'] },
    ])
    expect(snapshot().selection).toEqual(BASE)
    expect(snapshot().notice).toBe('reset')
    expect(theme.sources()).toEqual([])
  })

  it('reports a refusal rather than dropping the write', async () => {
    runtime.start()
    await settle()
    scope.mutate = () => Promise.reject(new Error('read-only document'))
    runtime.select('preset', 'dusk')
    await settle()
    expect(snapshot().notice).toBe('settingsFailed')
    expect(snapshot().noticeDetail).toBe('read-only document')
  })

  it('reports a refusal that arrived as a value rather than as an error', async () => {
    runtime.start()
    await settle()
    scope.mutate = () => Promise.reject('preferences are read-only')
    runtime.select('preset', 'dusk')
    await settle()
    expect(snapshot().noticeDetail).toBe('preferences are read-only')
  })

  it('keeps its own selection until the namespace is handed to the client', async () => {
    scope.hideValue()
    runtime.start()
    scope.mutate = () => Promise.reject(new Error('read-only document'))
    runtime.select('preset', 'ember')
    await settle()
    // The document has not resolved, so the runtime stands on the selection the
    // row made rather than on a value it was never given.
    expect(snapshot().selection).toEqual({ source: 'preset', id: 'ember', opacity: 65, url: '' })
    expect(installedCanvas()).toEqual(backgroundPresetValue('ember'))
  })

  it('takes the document\u2019s value the moment the namespace arrives', async () => {
    scope.hideValue()
    runtime.start()
    scope.setBase({ source: 'preset', id: 'dusk', opacity: 30, url: '' })
    scope.revealValue()
    expect(installedCanvas()).toEqual(backgroundPresetValue('dusk'))
    expect(installedSurface()).toEqual(surfaceValue(surfaceAlphaPercent(30)))
  })
})

describe('the opacity a user drags', () => {
  it('shows the value on the snapshot before it is persisted', () => {
    runtime.start()
    runtime.previewOpacity(20)
    expect(snapshot().opacity).toBe(20)
    expect(scope.batches).toEqual([])
  })

  it('coalesces a drag into one document write per frame', () => {
    runtime = painted('mist')
    runtime.start()
    runtime.previewOpacity(20)
    runtime.previewOpacity(30)
    runtime.previewOpacity(40)
    expect(frames).toHaveLength(1)
    // The readout and the previews have moved; the document is still on the
    // value the drag started from, because one frame carries the whole drag.
    expect(installedSurface()).toEqual(surfaceValue(surfaceAlphaPercent(DEFAULT_BACKGROUND_OPACITY)))
    flushFrame()
    expect(installedSurface()).toEqual(surfaceValue(surfaceAlphaPercent(40)))
    expect(snapshot().opacity).toBe(40)
  })

  it('keeps the canvas on the dragged value across frames', () => {
    scope = new FakeScope({ source: 'preset', id: 'mist', opacity: 65, url: '' })
    runtime = new BackgroundRuntime(scope.asScope(), theme.asService())
    runtime.start()
    runtime.previewOpacity(90)
    flushFrame()
    expect(installedSurface()).toEqual(surfaceValue(surfaceAlphaPercent(90)))
    expect(installedCanvas()).toEqual(backgroundPresetValue('mist'))
  })

  it('writes once when the drag settles', () => {
    runtime = painted('mist')
    runtime.start()
    runtime.previewOpacity(20)
    flushFrame()
    runtime.commit(20)
    expect(scope.batches).toEqual([[{ op: 'set', path: ['opacity'], value: 20 }]])
    expect(snapshot().opacity).toBe(20)
  })

  it('writes nothing when the settled value is the one the document already holds', () => {
    runtime.start()
    runtime.previewOpacity(65)
    runtime.commit(65)
    expect(scope.batches).toEqual([])
  })

  it('puts the document back on the settled value when a drag moved it and back', () => {
    runtime = painted('mist', 30)
    runtime.start()
    runtime.previewOpacity(80)
    // A frame the drag scheduled, then a settle at the value the document holds:
    // the pending projection is dropped, so nothing writes the abandoned value.
    runtime.commit(30)
    expect(cancelled).toHaveLength(1)
    flushFrame()
    expect(installedSurface()).toEqual(surfaceValue(surfaceAlphaPercent(30)))
    expect(scope.batches).toEqual([])
  })

  it('forgets a preview when the whole selection is reset', () => {
    runtime.start()
    runtime.previewOpacity(20)
    runtime.reset()
    flushFrame()
    expect(snapshot().opacity).toBe(DEFAULT_BACKGROUND_OPACITY)
    expect(installedSurface()).toBeUndefined()
  })
})

describe('uploading an image', () => {
  it('stores the file and selects what came back', async () => {
    runtime.start()
    await settle()
    runtime.upload(makeFile('Sunset Photo.png', 64))
    await settle()
    expect(requests.some(entry => entry.method === 'POST')).toBe(true)
    expect(snapshot().notice).toBe('uploaded')
    expect(snapshot().selection).toEqual({ source: 'upload', id: 'uploaded-0123456789abcdef.png', opacity: 65, url: '' })
    expect(installedCanvas()?.light).toBe(`url("${BACKGROUND_IMAGE_ROUTE}?id=uploaded-0123456789abcdef.png")`)
  })

  it('refuses a file past the Host\u2019s limit before reading it', async () => {
    runtime.start()
    await settle()
    runtime.upload(makeFile('huge.png', 4096))
    expect(snapshot().notice).toBe('tooLarge')
    expect(snapshot().noticeDetail).toMatch(/KiB|KB|bytes/)
    expect(requests.some(entry => entry.method === 'POST')).toBe(false)
  })

  it('refuses a file past the default limit before the catalogue has answered', async () => {
    // With no number from the Host yet, the page still has to bound what it
    // reads: an unbounded read of a file the Host would refuse costs the tab.
    const file = makeFile('huge.png', 8)
    Object.defineProperty(file, 'size', { value: DEFAULT_MAX_UPLOAD_BYTES + 1 })
    runtime.upload(file)
    expect(snapshot().notice).toBe('tooLarge')
    expect(requests.some(entry => entry.method === 'POST')).toBe(false)
  })

  it('reports a refused upload with the Host\u2019s own reason', async () => {
    answer = url => url === BACKGROUND_CATALOG_ROUTE
      ? respond(200, { imageDir: null, images: [], maxUploadBytes: 1024, remoteImageAccess: 'strict' })
      : refuse(400, 'uploaded bytes are not one of .png')
    runtime.start()
    await settle()
    runtime.upload(makeFile('x.svg', 8))
    await settle()
    expect(snapshot().notice).toBe('uploadFailed')
    expect(snapshot().noticeDetail).toBe('uploaded bytes are not one of .png')
    expect(snapshot().busy).toBe(false)
  })

  it('reports an upload the Host refused as too large', async () => {
    answer = url => url === BACKGROUND_CATALOG_ROUTE
      ? respond(200, { imageDir: null, images: [], maxUploadBytes: 1024, remoteImageAccess: 'strict' })
      : refuse(413, 'upload exceeds the 1024 byte limit')
    runtime.start()
    await settle()
    runtime.upload(makeFile('x.png', 8))
    await settle()
    expect(snapshot().notice).toBe('tooLarge')
  })

  it('marks the row busy while the upload is in flight', async () => {
    runtime.start()
    await settle()
    runtime.upload(makeFile('Sunset.png', 64))
    expect(snapshot().busy).toBe(true)
    await settle()
    expect(snapshot().busy).toBe(false)
  })
})

describe('deleting an image', () => {
  it('clears the selection when the image in use is deleted', async () => {
    runtime.start()
    await settle()
    runtime.select('upload', STORED.id)
    runtime.remove(STORED.id)
    await settle()
    expect(snapshot().notice).toBe('removed')
    expect(snapshot().selection).toEqual(BASE)
    expect(theme.sources()).toEqual([])
    expect(scope.batches.at(-1)).toEqual([
      { op: 'unset', path: ['source'] },
      { op: 'unset', path: ['id'] },
      { op: 'unset', path: ['url'] },
    ])
  })

  it('keeps the strength the user set when the image in use is deleted', async () => {
    runtime.start()
    await settle()
    runtime.select('upload', STORED.id)
    runtime.previewOpacity(100)
    flushFrame()
    runtime.commit(100)
    runtime.remove(STORED.id)
    await settle()
    expect(snapshot().opacity).toBe(100)
    expect(scope.batches.at(-1)).toEqual([
      { op: 'unset', path: ['source'] },
      { op: 'unset', path: ['id'] },
      { op: 'unset', path: ['url'] },
    ])
  })

  it('leaves a selection alone when another image is deleted', async () => {
    runtime.start()
    await settle()
    runtime.select('upload', STORED.id)
    runtime.remove(OTHER_STORED.id)
    await settle()
    expect(snapshot().notice).toBe('removed')
    expect(snapshot().selection.id).toBe(STORED.id)
    expect(snapshot().images.map(entry => entry.id)).toEqual([STORED.id])
  })

  it('reports a deletion the Host refused', async () => {
    answer = url => url.startsWith(BACKGROUND_DELETE_ROUTE)
      ? refuse(500, 'could not delete the stored image: EACCES')
      : respond(200, {
        imageDir: null,
        images: [STORED],
        maxUploadBytes: 1024,
        remoteImageAccess: 'strict',
      })
    runtime.start()
    await settle()
    runtime.remove(STORED.id)
    await settle()
    expect(snapshot().notice).toBe('removeFailed')
    expect(snapshot().noticeDetail).toContain('EACCES')
  })
})

describe('reading the catalogue again', () => {
  it('keeps the canvas when the read fails, rather than replacing it with a guess', async () => {
    scope = new FakeScope({ source: 'preset', id: 'verdant', opacity: 65, url: '' })
    runtime = new BackgroundRuntime(scope.asScope(), theme.asService())
    runtime.start()
    const painted = installedCanvas()
    answer = () => refuse(500, 'the Host went away')
    runtime.reloadCatalog()
    await settle()
    expect(snapshot().catalog).toBe('failed')
    expect(snapshot().catalogError).toBe('the Host went away')
    expect(installedCanvas()).toEqual(painted)
  })

  it('reports the catalogue as loading while the read is in flight', async () => {
    runtime.start()
    runtime.reloadCatalog()
    expect(snapshot().catalog).toBe('loading')
    await settle()
    expect(snapshot().catalog).toBe('ready')
  })
})

describe('adopting the settings document', () => {
  it('re-projects a value the document changed underneath it', async () => {
    runtime.start()
    await settle()
    await scope.mutate([
      { op: 'set', path: ['source'], value: 'preset' },
      { op: 'set', path: ['id'], value: 'dusk' },
      { op: 'set', path: ['opacity'], value: 80 },
    ])
    expect(installedCanvas()).toEqual(backgroundPresetValue('dusk'))
    expect(installedSurface()).toEqual(surfaceValue(surfaceAlphaPercent(80)))
  })

  it('does not rewrite the document when a publication resolves to the same selection', async () => {
    scope = new FakeScope({ source: 'preset', id: 'dusk', opacity: 65, url: '' })
    runtime = new BackgroundRuntime(scope.asScope(), theme.asService())
    runtime.start()
    const installed = installedCanvas()
    scope.notify()
    // Every settings write republishes each namespace; re-installing the layer
    // would rewrite the document for an unchanged background.
    expect(installedCanvas()).toEqual(installed)
    expect(installedCanvas()).toBe(installed)
  })

  it('publishes a snapshot for a subscriber that arrives after start', async () => {
    runtime.start()
    await settle()
    const seen: number[] = []
    const stop = runtime.subscribe(() => { seen.push(snapshot().seq) })
    runtime.select('preset', 'mist')
    stop()
    runtime.select('preset', 'dusk')
    expect(seen).toHaveLength(1)
    expect(seen[0]).toBeGreaterThan(0)
  })
})

describe('the palette mode', () => {
  it('carries the mode the previews must render in', () => {
    runtime.start()
    expect(snapshot().colorScheme).toBe('light')
    runtime.setColorScheme('dark')
    expect(snapshot().colorScheme).toBe('dark')
  })

  it('carries the surface a preview composites, following the drag and the mode', () => {
    runtime.start()
    expect(snapshot().surfaceTint).toBe(surfaceValue(surfaceAlphaPercent(DEFAULT_BACKGROUND_OPACITY)).light)
    runtime.previewOpacity(10)
    expect(snapshot().surfaceTint).toBe(surfaceValue(surfaceAlphaPercent(10)).light)
    runtime.setColorScheme('dark')
    expect(snapshot().surfaceTint).toBe(surfaceValue(surfaceAlphaPercent(10)).dark)
  })

  it('publishes nothing when the mode did not move', () => {
    runtime.start()
    const before = snapshot()
    runtime.setColorScheme('light')
    expect(snapshot()).toBe(before)
  })
})

describe('disposal', () => {
  it('stops projecting once the plugin is gone', async () => {
    runtime.start()
    await settle()
    runtime.dispose()
    runtime.select('preset', 'ember')
    await settle()
    expect(theme.sources()).toEqual([])
    expect(document.getElementById(BACKGROUND_CANVAS_STYLE_ID)).toBeNull()
  })

  it('drops a frame a drag had scheduled', () => {
    runtime.start()
    runtime.previewOpacity(10)
    runtime.dispose()
    flushFrame()
    expect(theme.sources()).toEqual([])
  })

  it('ignores a request that resolves after disposal', async () => {
    runtime.start()
    runtime.dispose()
    await settle()
    expect(snapshot().catalog).toBe('loading')
  })

  it('reports nothing when the catalogue read fails after disposal', async () => {
    // A read still in flight when the plugin unloads must not report a failure
    // to a row that no longer exists.
    let fail: (reason: Error) => void = () => {}
    answer = url => url === BACKGROUND_CATALOG_ROUTE
      ? (new Promise<Response>((_resolve, reject) => { fail = reject }) as unknown as Response)
      : respond(204, undefined)
    runtime.start()
    runtime.dispose()
    fail(new Error('the Host went away'))
    await settle()
    expect(snapshot().catalog).toBe('loading')
    expect(snapshot().catalogError).toBe('')
  })

  it('reports nothing when a request fails after disposal', async () => {
    // A refusal that arrives once the plugin is gone has no row to report to,
    // so the failure path stops where the success path does.
    answer = () => refuse(500, 'the Host failed')
    runtime.start()
    await settle()
    runtime.upload(makeFile('Sunset.png', 64))
    runtime.remove('sunset-0123456789abcdef.png')
    runtime.dispose()
    await settle()
    expect(snapshot().notice).toBe('')
    expect(theme.sources()).toEqual([])
  })

  it('ignores an upload that resolves after disposal', async () => {
    runtime.start()
    await settle()
    runtime.upload(makeFile('Sunset.png', 64))
    runtime.dispose()
    await settle()
    // The upload answered a plugin that is no longer loaded: the row it would
    // have reported to is gone, and the canvas stays as the teardown left it.
    expect(snapshot().notice).toBe('')
    expect(snapshot().selection).toEqual(BASE)
    expect(theme.sources()).toEqual([])
  })

  it('ignores a deletion that resolves after disposal', async () => {
    runtime.start()
    await settle()
    runtime.remove(STORED.id)
    runtime.dispose()
    await settle()
    expect(snapshot().notice).toBe('')
  })

  it('reports nothing when the catalogue read fails after disposal', async () => {
    // A read still in flight when the plugin unloads must not report a failure
    // to a row that no longer exists.
    let fail: (reason: Error) => void = () => {}
    answer = url => url === BACKGROUND_CATALOG_ROUTE
      ? (new Promise<Response>((_resolve, reject) => { fail = reject }) as unknown as Response)
      : respond(204, undefined)
    runtime.start()
    runtime.dispose()
    fail(new Error('the Host went away'))
    await settle()
    expect(snapshot().catalog).toBe('loading')
    expect(snapshot().catalogError).toBe('')
  })

  it('reports nothing when a request fails after disposal', async () => {
    runtime.start()
    runtime.dispose()
    await settle()
    expect(snapshot().notice).toBe('')
    expect(theme.sources()).toEqual([])
  })

  it('reports nothing after disposal, whatever a write answers', async () => {
    runtime.start()
    await settle()
    scope.mutate = () => Promise.reject(new Error('read-only document'))
    runtime.select('preset', 'mist')
    runtime.dispose()
    await settle()
    expect(snapshot().notice).toBe('')
  })
})

describe('isBackgroundNoticeFailure', () => {
  it('separates a completed action from a refusal', () => {
    expect(isBackgroundNoticeFailure('')).toBe(false)
    for (const code of ['uploaded', 'removed', 'reset'] satisfies BackgroundNotice[]) {
      expect(isBackgroundNoticeFailure(code), code).toBe(false)
    }
    for (const code of ['uploadFailed', 'removeFailed', 'settingsFailed', 'tooLarge'] satisfies BackgroundNotice[]) {
      expect(isBackgroundNoticeFailure(code), code).toBe(true)
    }
  })
})

describe('choosing a remote image', () => {
  it('writes the URL the Host approved, and names its host', async () => {
    runtime.start()
    await settle()
    runtime.selectRemote('https://CDN.Example.com/a b.png')
    await settle()
    expect(scope.batches.at(-1)).toEqual([
      { op: 'set', path: ['source'], value: 'remote' },
      { op: 'set', path: ['id'], value: '' },
      { op: 'set', path: ['url'], value: 'https://cdn.example.com/a%20b.png' },
    ])
    expect(snapshot().selection).toEqual({
      source: 'remote',
      id: '',
      opacity: DEFAULT_BACKGROUND_OPACITY,
      url: 'https://cdn.example.com/a%20b.png',
    })
    expect(snapshot().notice).toBe('remoteAdded')
    expect(snapshot().noticeDetail).toBe('cdn.example.com')
    expect(installedCanvas()).toEqual({
      light: 'url("https://cdn.example.com/a%20b.png")',
      dark: 'url("https://cdn.example.com/a%20b.png")',
    })
  })

  it('refuses text the policy refuses without asking the Host', async () => {
    runtime.start()
    await settle()
    const before = requests.length
    runtime.selectRemote('http://cdn.example.com/a.png')
    await settle()
    expect(requests).toHaveLength(before)
    expect(snapshot().notice).toBe('remoteRefused')
    expect(snapshot().noticeDetail).toBe('scheme')
    expect(scope.batches).toHaveLength(0)
  })

  it('reports the reason the Host refused, as the code the row localizes', async () => {
    answer = () => respond(400, { code: 'private', error: 'remote image URL refused: private' })
    runtime.start()
    await settle()
    runtime.selectRemote('https://cdn.example.com/a.png')
    await settle()
    expect(snapshot().notice).toBe('remoteRefused')
    expect(snapshot().noticeDetail).toBe('private')
    expect(scope.batches).toHaveLength(0)
  })

  it('reports a request that never reached the Host', async () => {
    answer = () => { throw new TypeError('network down') }
    runtime.start()
    await settle()
    runtime.selectRemote('https://cdn.example.com/a.png')
    await settle()
    expect(snapshot().notice).toBe('remoteFailed')
    expect(snapshot().noticeDetail).toBe('network down')
  })

  it('reports an answer that was not JSON at all', async () => {
    answer = () => ({
      ok: true,
      status: 201,
      json: () => Promise.reject(new SyntaxError('Unexpected token <')),
    }) as unknown as Response
    runtime.start()
    await settle()
    runtime.selectRemote('https://cdn.example.com/a.png')
    await settle()
    expect(snapshot().notice).toBe('remoteFailed')
    expect(snapshot().noticeDetail).toContain('Unexpected token')
  })

  it('reports a write the Host refused after approving the URL', async () => {
    runtime.start()
    await settle()
    scope.mutate = () => Promise.reject(new Error('read-only document'))
    runtime.selectRemote('https://cdn.example.com/a.png')
    await settle()
    expect(snapshot().notice).toBe('remoteFailed')
  })

  it('stops reporting once the runtime is disposed', async () => {
    runtime.start()
    await settle()
    runtime.selectRemote('https://cdn.example.com/a.png')
    runtime.dispose()
    await settle()
    expect(theme.sources()).toEqual([])
  })

  it('stops reporting a refusal once the runtime is disposed', async () => {
    answer = () => respond(400, { code: 'private', error: 'refused' })
    runtime.start()
    await settle()
    runtime.selectRemote('https://cdn.example.com/a.png')
    runtime.dispose()
    await settle()
    expect(snapshot().notice).toBe('')
  })

  it('stops reporting a failure once the runtime is disposed', async () => {
    runtime.start()
    await settle()
    let reject: (cause: unknown) => void = () => {}
    answer = () => {
      // Held open so the case can dispose the runtime before the request fails.
      throw Object.assign(new Error('pending'), {})
    }
    const gate = new Promise<never>((_resolve, fail) => { reject = fail })
    vi.stubGlobal('fetch', () => gate)
    runtime.selectRemote('https://cdn.example.com/a.png')
    runtime.dispose()
    reject(new TypeError('network down'))
    await settle()
    expect(snapshot().notice).toBe('')
  })
})
