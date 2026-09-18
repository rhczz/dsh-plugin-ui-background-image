// @vitest-environment jsdom
/**
 * The browser plugin body: what it contributes to the shell, what it writes
 * through the theme service, and what it takes back when it unloads.
 * @module dsh-plugin-ui-background-image/tests/client/index
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { apply, inject } from '../../src/client/index.ts'
import { BackgroundImageRow } from '../../src/client/BackgroundImageRow.tsx'
import { BACKGROUND_LOCALE_NAMESPACE, en, zh } from '../../src/client/locales.ts'
import {
  BACKGROUND_CATALOG_ROUTE,
  BACKGROUND_DELETE_ROUTE,
  BACKGROUND_REMOTE_ROUTE,
  BACKGROUND_UPLOAD_ROUTE,
} from '../../src/background-api.ts'
import { BACKGROUND_IMAGE_VARIABLE, SURFACE_BACKGROUND_PROPERTY } from '../../src/background-canvas.ts'
import { surfaceAlphaPercent } from '../../src/background-opacity.ts'
import { backgroundPresetValue } from '../../src/background-presets.ts'
import { BACKGROUND_SETTINGS_NAMESPACE } from '../../src/background-settings.ts'
import { FakeScope } from './scope-stub.ts'
import { FakeTheme } from './theme-stub.ts'

/** One stored image the Host double holds. */
const STORED = { id: 'sunset-a1b2c3d4e5f6a7b8.png', name: 'sunset' }

/** One contribution the plugin body registered through `ctx.effect`. */
interface Effect {
  label: string
  dispose: () => void
}

/** One row the plugin body registered into a slot. */
interface Row {
  row: Record<string, unknown>
  component: unknown
}

/** Everything one mounted plugin body exposes to a spec. */
interface Mounted {
  ctx: ClientContext
  scope: FakeScope
  boundNamespace: () => string | undefined
  theme: FakeTheme
  effects: Effect[]
  dictionaries: { namespace: string; values: Record<string, unknown> }[]
  rows: Row[]
  slotsInjected: string[]
  /** Announce a theme change the way the theme service does. */
  announceTheme: (colorScheme: 'light' | 'dark') => void
}

/**
 * Mount the plugin body over service doubles that record what it contributes,
 * the way the client Loader would hand it the real ones.
 * @returns the mounted body and its contributions.
 */
function mount(): Mounted {
  const scope = new FakeScope({ source: 'preset', id: 'none', opacity: 65, url: '' })
  const theme = new FakeTheme()
  const effects: Effect[] = []
  const dictionaries: Mounted['dictionaries'] = []
  const rows: Row[] = []
  const slotsInjected: string[] = []
  const themeListeners: ((snapshot: { active: { colorScheme: 'light' | 'dark' } }) => void)[] = []
  let namespace: string | undefined

  const ctx = {
    settingsScope: {
      bind: (spec: { namespace: string }) => {
        namespace = spec.namespace
        return scope.asScope()
      },
    },
    locale: {
      register: (dictionaryNamespace: string, values: Record<string, unknown>) => {
        dictionaries.push({ namespace: dictionaryNamespace, values })
        return () => { dictionaries.pop() }
      },
    },
    theme: Object.assign(theme.asService(), { getTheme: () => ({ active: { colorScheme: 'light' } }) }),
    on: (event: string, listener: (snapshot: { active: { colorScheme: 'light' | 'dark' } }) => void) => {
      if (event === 'theme/change') themeListeners.push(listener)
      return () => { themeListeners.splice(themeListeners.indexOf(listener), 1) }
    },
    effect: (run: () => unknown, label: string) => {
      const dispose = run()
      effects.push({ label, dispose: typeof dispose === 'function' ? dispose as () => void : () => {} })
    },
    slots: {
      inject: (name: string, body: () => unknown) => { slotsInjected.push(name); body() },
      register: (row: Record<string, unknown>, component: unknown) => {
        rows.push({ row, component })
        return () => {}
      },
    },
  }

  const context = ctx as unknown as ClientContext
  apply(context)
  return {
    ctx: context,
    scope,
    boundNamespace: () => namespace,
    theme,
    effects,
    dictionaries,
    rows,
    slotsInjected,
    announceTheme: (colorScheme) => {
      for (const listener of [...themeListeners]) listener({ active: { colorScheme } })
    },
  }
}

/**
 * Ask the registered row for its injected actions, the way the slot renderer
 * does when it first renders the row.
 * @param mounted - the mounted body.
 * @param sync - records the snapshots the row publishes into its store.
 * @returns the action bag the row was handed.
 */
function actionsOf(mounted: Mounted, sync: (snapshot: unknown) => void): Record<string, unknown> {
  const injectActions = mounted.rows[0]?.row.inject as (actions: unknown) => Record<string, unknown>
  return injectActions({ sync })
}

/** One request the runtime sent, in the order it sent them. */
interface SentRequest {
  url: string
  method: string
}

/** Every request the runtime sent during the current case. */
const sent: SentRequest[] = []

/**
 * Answer the routes the runtime talks to, the way the Host would.
 * @param url - request target.
 * @returns a JSON response carrying that route's body.
 */
async function hostAnswer(url: string, init?: RequestInit): Promise<unknown> {
  if (url === BACKGROUND_REMOTE_ROUTE) {
    const candidate = (JSON.parse(init?.body as string) as { url: string }).url
    return { ok: true, status: 201, json: async () => ({ url: candidate, host: new URL(candidate).hostname }) }
  }
  const body = url === BACKGROUND_CATALOG_ROUTE
    ? { imageDir: '/home/example/.dsh/backgrounds', images: [STORED], maxUploadBytes: 1024, remoteImageAccess: 'strict' }
    : { id: 'uploaded-0123456789abcdef.png', name: 'uploaded' }
  return { ok: true, status: 200, json: async () => body }
}

/**
 * Read the token layer this plugin installed.
 * @param mounted - the mounted body.
 * @returns the layer, or undefined when nothing is installed.
 */
function installedLayer(mounted: Mounted): Record<string, { light: string, dark: string }> | undefined {
  return mounted.theme.layerFor('dsh-plugin-ui-background-image')
}

let mounted: Mounted

beforeEach(() => {
  sent.length = 0
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    sent.push({ url: input, method: init?.method ?? 'GET' })
    return hostAnswer(input, init)
  }))
  mounted = mount()
})

afterEach(() => {
  for (const effect of mounted.effects) effect.dispose()
  vi.unstubAllGlobals()
  document.body.removeAttribute('style')
  for (const style of document.head.querySelectorAll('style')) style.remove()
})

describe('the plugin body', () => {
  it('declares the services it cannot run without', () => {
    expect([...inject].sort()).toEqual(['locale', 'remote', 'settingsScope', 'slots', 'theme'])
  })

  it('binds its own settings namespace, not another feature\u2019s', () => {
    expect(mounted.boundNamespace()).toBe(BACKGROUND_SETTINGS_NAMESPACE)
  })

  it('registers its dictionaries under its own namespace, in both locales', () => {
    expect(mounted.dictionaries).toHaveLength(1)
    expect(mounted.dictionaries[0]?.namespace).toBe(BACKGROUND_LOCALE_NAMESPACE)
    expect(mounted.dictionaries[0]?.values).toEqual({ zh, en })
  })

  it('registers one row into the General section item slot', () => {
    expect(mounted.slotsInjected).toEqual(['settings.general.item'])
    expect(mounted.rows).toHaveLength(1)
    expect(mounted.rows[0]?.row).toMatchObject({
      name: 'settings.general.item',
      id: 'background-image',
      locale: BACKGROUND_LOCALE_NAMESPACE,
    })
  })

  it('sits directly under the font row and above the transcript-view row', () => {
    expect(mounted.rows[0]?.row.order).toBe(11.6)
  })

  it('renders the background row and hands it the store the row reads', () => {
    expect(mounted.rows[0]?.component).toBe(BackgroundImageRow)
    expect(mounted.rows[0]?.row.store).toBeDefined()
  })

  it('names every effect it registers, so a teardown is traceable', () => {
    expect(mounted.effects.map(effect => effect.label)).toEqual([
      'ui-background-image: settings row dictionaries',
      'ui-background-image: background runtime',
    ])
  })
})

describe('what the row can do', () => {
  it('publishes a snapshot as soon as the row asks for its actions', () => {
    const sync = vi.fn()
    actionsOf(mounted, sync)
    expect(sync).toHaveBeenCalledTimes(1)
    expect(sync.mock.calls[0]?.[0]).toMatchObject({ selection: { source: 'preset', id: 'none' } })
  })

  it('writes a chosen preset through to the settings namespace', async () => {
    const actions = actionsOf(mounted, vi.fn())
    ;(actions.select as (source: string, id: string) => void)('preset', 'dusk')
    await vi.waitFor(() => { expect(mounted.scope.batches).toHaveLength(1) })
    expect(mounted.scope.batches[0]).toEqual([
      { op: 'set', path: ['source'], value: 'preset' },
      { op: 'set', path: ['id'], value: 'dusk' },
      { op: 'set', path: ['url'], value: '' },
    ])
  })

  it('projects the chosen preset onto the canvas', async () => {
    const actions = actionsOf(mounted, vi.fn())
    ;(actions.select as (source: string, id: string) => void)('preset', 'dusk')
    await vi.waitFor(() => { expect(installedLayer(mounted)).toBeDefined() })
    expect(installedLayer(mounted)?.[BACKGROUND_IMAGE_VARIABLE]).toEqual(backgroundPresetValue('dusk'))
  })

  it('carries the opacity the user settles on', async () => {
    const actions = actionsOf(mounted, vi.fn())
    ;(actions.select as (source: string, id: string) => void)('preset', 'dusk')
    ;(actions.commitOpacity as (opacity: number) => void)(30)
    await vi.waitFor(() => { expect(mounted.scope.batches).toHaveLength(2) })
    expect(mounted.scope.batches[1]).toEqual([{ op: 'set', path: ['opacity'], value: 30 }])
    expect(installedLayer(mounted)?.[SURFACE_BACKGROUND_PROPERTY]?.light)
      .toContain(`${surfaceAlphaPercent(30)}%, transparent`)
  })

  it('shows a dragged opacity without persisting it', async () => {
    const actions = actionsOf(mounted, vi.fn())
    ;(actions.select as (source: string, id: string) => void)('preset', 'dusk')
    await vi.waitFor(() => { expect(installedLayer(mounted)).toBeDefined() })
    ;(actions.previewOpacity as (opacity: number) => void)(10)
    expect(mounted.scope.batches).toHaveLength(1)
  })

  it('clears the canvas again when the row asks for the default', async () => {
    const actions = actionsOf(mounted, vi.fn())
    ;(actions.select as (source: string, id: string) => void)('preset', 'dusk')
    await vi.waitFor(() => { expect(installedLayer(mounted)).toBeDefined() })
    ;(actions.reset as () => void)()
    await vi.waitFor(() => { expect(installedLayer(mounted)).toBeUndefined() })
    expect(mounted.scope.batches).toHaveLength(2)
    expect(mounted.scope.batches[1]).toEqual([
      { op: 'unset', path: ['source'] },
      { op: 'unset', path: ['id'] },
      { op: 'unset', path: ['url'] },
      { op: 'unset', path: ['opacity'] },
    ])
  })

  it('stores a file the row uploads, under the collection route', async () => {
    const actions = actionsOf(mounted, vi.fn())
    ;(actions.upload as (file: File) => void)(new File([new Uint8Array([0, 1, 2, 3])], 'Sunset.png'))
    await vi.waitFor(() => { expect(sent.some(request => request.method === 'POST')).toBe(true) })
    const posted = sent.find(request => request.method === 'POST')
    expect(posted?.url).toContain(BACKGROUND_UPLOAD_ROUTE)
    expect(posted?.url).toContain('Sunset.png')
  })

  it('deletes the stored image the row names', async () => {
    const actions = actionsOf(mounted, vi.fn())
    ;(actions.remove as (id: string) => void)(STORED.id)
    // The shared API channel carries no DELETE, so deleting is a POST to the
    // action path that names the image.
    await vi.waitFor(() => {
      expect(sent.some(request => request.method === 'POST' && request.url.startsWith(BACKGROUND_DELETE_ROUTE)))
        .toBe(true)
    })
    expect(sent.find(request => request.url.startsWith(BACKGROUND_DELETE_ROUTE))?.url)
      .toContain(`?id=${STORED.id}`)
  })

  it('reads the catalogue again on demand', async () => {
    const actions = actionsOf(mounted, vi.fn())
    ;(actions.reload as () => void)()
    await vi.waitFor(() => { expect(sent).toHaveLength(2) })
    expect(sent[1]?.url).toBe(BACKGROUND_CATALOG_ROUTE)
  })
})

describe('the palette the previews render in', () => {
  it('follows the theme the shell resolved', async () => {
    const sync = vi.fn()
    actionsOf(mounted, sync)
    mounted.announceTheme('dark')
    expect(sync.mock.calls.at(-1)?.[0]).toMatchObject({ colorScheme: 'dark' })
  })

  it('stops following the theme once the plugin unloads', () => {
    const sync = vi.fn()
    actionsOf(mounted, sync)
    for (const effect of mounted.effects) effect.dispose()
    sync.mockClear()
    mounted.announceTheme('dark')
    expect(sync).not.toHaveBeenCalled()
  })
})

describe('unloading', () => {
  it('takes the canvas and its rule back', async () => {
    const actions = actionsOf(mounted, vi.fn())
    ;(actions.select as (source: string, id: string) => void)('preset', 'dusk')
    await vi.waitFor(() => { expect(installedLayer(mounted)).toBeDefined() })
    for (const effect of mounted.effects) effect.dispose()
    expect(installedLayer(mounted)).toBeUndefined()
    expect(document.getElementById('dsh-ui-background-image-canvas')).toBeNull()
    expect(document.body.style.getPropertyValue(BACKGROUND_IMAGE_VARIABLE)).toBe('')
  })
})

describe('what the row can do with a remote image', () => {
  it('judges the URL through the Host and writes what it approved', async () => {
    const actions = actionsOf(mounted, vi.fn())
    ;(actions.selectRemote as (url: string) => void)('https://cdn.example.com/a.png')
    await vi.waitFor(() => { expect(mounted.scope.batches).toHaveLength(1) })
    expect(mounted.scope.batches[0]).toEqual([
      { op: 'set', path: ['source'], value: 'remote' },
      { op: 'set', path: ['id'], value: '' },
      { op: 'set', path: ['url'], value: 'https://cdn.example.com/a.png' },
    ])
  })

  it('writes nothing for a URL the text policy refuses', async () => {
    const actions = actionsOf(mounted, vi.fn())
    ;(actions.selectRemote as (url: string) => void)('http://cdn.example.com/a.png')
    await vi.waitFor(() => { expect(mounted.scope.batches).toHaveLength(0) })
  })
})
