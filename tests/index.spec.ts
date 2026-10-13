/**
 * The Host plugin body: what it registers, what it refuses at load, and what a
 * render collects from it.
 * @module dsh-plugin-ui-background-image/tests/index
 */

import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context, Volatile } from '@deepseek-ai/cordis'
import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import {
  BACKGROUND_CATALOG_ROUTE,
  BACKGROUND_DELETE_ROUTE,
  BACKGROUND_IMAGE_ROUTE,
  BACKGROUND_UPLOAD_ROUTE,
  BACKGROUND_REMOTE_ROUTE,
} from '../src/background-api.ts'
import {
  BACKGROUND_CONFIG_FIELD,
  DEFAULT_BACKGROUND_SETTINGS,
  type BackgroundSettings,
} from '../src/background-settings.ts'
import { apply, DEFAULT_MAX_UPLOAD_BYTES, inject, resolveSpec, type Config } from '../src/index.ts'

/** The resolver's answer for the cases that drive a persisted remote selection. */
const dnsMock = vi.hoisted(() => ({ answer: [{ address: '93.184.216.34' }] }))

vi.mock('node:dns/promises', () => ({ lookup: () => Promise.resolve(dnsMock.answer) }))

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

/**
 * Create a temporary directory to serve as the harness home.
 * @returns its absolute path.
 */
async function createHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-background-home-'))
  directories.push(dir)
  return dir
}

/**
 * A volatile Config reference double, as the Loader hands the plugin.
 *
 * `set` stands in for the Loader's commit: the plugin reads the reference, and
 * this is the only way a spec moves what the next read answers with.
 */
export interface SettingsRef extends Volatile<BackgroundSettings | undefined> {
  /** Commit one background, the way the Host does before it reports the change. */
  set(next: BackgroundSettings | undefined): void
}

/**
 * Build a reference whose snapshot answers one background.
 * @param initial - background the reference holds; absent resolves to none.
 * @returns the reference, with the committing method the spec drives.
 */
function settingsRef(initial?: BackgroundSettings): SettingsRef {
  let value = initial
  return {
    get: () => value,
    set: (next) => { value = next },
  }
}

/** A Host context double recording the registrations `apply` makes. */
interface TestHost {
  ctx: Context
  /** Presentation policies the plugin registered on its own instance. */
  presentations: { auto?: boolean }[]
  routes: string[]
  logger: { warn: ReturnType<typeof vi.fn> }
  /** Fire one volatile commit the way the Loader reports it. */
  volatileUpdate: (...paths: (readonly string[])[]) => void
  /** Push one index injection table the way a render would. */
  render: () => readonly IndexInjection[]
  /** Release every effect and listener `apply` registered. */
  dispose: () => void
}

/**
 * Build a context exposing the services `apply` consumes.
 * @param options - whether the composition provides the optional settings service.
 * @returns the context double.
 */
function makeHost(options: { settings?: boolean } = {}): TestHost {
  const presentations: { auto?: boolean }[] = []
  const routes: string[] = []
  const disposers: (() => void)[] = []
  const listeners = new Map<string, ((payload: unknown) => void)[]>()
  const logger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }

  const ctx = {
    logger,
    connection: {
      fetch: {
        register(route: { path: string }) {
          routes.push(route.path)
          // The channel returns an asynchronous disposer.
          return () => {
            const index = routes.indexOf(route.path)
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
    on(event: string, listener: (payload: unknown) => void) {
      const known = listeners.get(event) ?? []
      known.push(listener)
      listeners.set(event, known)
      // A listener rides the calling fiber, so disposing the context releases it.
      const dispose = () => {
        listeners.set(event, (listeners.get(event) ?? []).filter(entry => entry !== listener))
      }
      disposers.push(dispose)
      return dispose
    },
    inject(_deps: readonly string[], callback: (scoped: unknown) => void) {
      if (options.settings === false) return
      const child = {
        effect(run: () => unknown) {
          const disposer = run()
          if (typeof disposer === 'function') disposers.push(disposer as () => void)
          return disposer
        },
        settings: {
          configure(presentation: { auto?: boolean }) {
            presentations.push(presentation)
            return () => {}
          },
        },
      }
      callback(child)
    },
    webServer: {
      register(route: { path: string }) {
        routes.push(route.path)
        return () => {
          const index = routes.indexOf(route.path)
          if (index !== -1) routes.splice(index, 1)
        }
      },
    },
  } as unknown as Context

  return {
    ctx,
    presentations,
    routes,
    logger,
    volatileUpdate: (...paths) => {
      for (const listener of listeners.get('loader/volatile-update') ?? []) listener(paths)
    },
    render: () => {
      const table: IndexInjection[] = []
      for (const listener of listeners.get('webserver/index-inject') ?? []) listener(table)
      return table
    },
    dispose: () => {
      for (const dispose of disposers.reverse()) dispose()
    },
  }
}

/**
 * Wait for the directory creation `apply` starts to reach the filesystem.
 *
 * The load does not await it, so the case polls the outcome rather than a fixed
 * delay: under a loaded machine a timer can fire before the syscall answers.
 * @param directory - directory the load was asked to create.
 */
async function waitForDirectory(directory: string): Promise<void> {
  await vi.waitFor(async () => { await expect(stat(directory)).resolves.toBeDefined() })
}

/** The composition values a spec can set, with the selection spelled directly. */
type SpecConfig = Omit<Config, 'defaultBackground'> & { defaultBackground?: BackgroundSettings | undefined }

/**
 * Assemble the plugin Config the Loader would hand it: the selection always
 * rides a volatile reference, whatever the composition wrote.
 * @param overrides - composition values, with the selection as plain data.
 * @returns the Config record.
 */
function specConfig(overrides: SpecConfig = {}): Config {
  const { defaultBackground, ...rest } = overrides
  return {
    ...rest,
    defaultBackground: settingsRef(defaultBackground),
  }
}

describe('resolveSpec', () => {
  it('puts the image directory under the harness home by default', async () => {
    const home = await createHome()
    expect(resolveSpec(specConfig({ dshHome: home })).imageDir).toBe(join(home, 'backgrounds'))
  })

  it('takes the directory the composition names', () => {
    expect(resolveSpec(specConfig({ imageDir: '/srv/backgrounds' })).imageDir).toBe('/srv/backgrounds')
  })

  it('accepts a composition background a deployment pinned', () => {
    expect(() => resolveSpec(specConfig({
      defaultBackground: { source: 'preset', id: 'mist', opacity: 20, url: '' },
    }))).not.toThrow()
  })

  it('refuses a composition background it could not serve', () => {
    // Misconfiguration fails at load, not at the first request that would have
    // used the value.
    expect(() => resolveSpec(specConfig({
      defaultBackground: { source: 'preset', id: 'comic', opacity: 65, url: '' },
    }))).toThrow(/names no shipped background preset/)
    expect(() => resolveSpec(specConfig({
      defaultBackground: { source: 'upload', id: '../x.png', opacity: 65, url: '' },
    }))).toThrow(/not a usable stored image id/)
    expect(() => resolveSpec(specConfig({
      defaultBackground: { source: 'preset', id: 'mist', opacity: 101, url: '' },
    }))).toThrow(/whole percent/)
  })

  it('refuses an upload limit it could not apply', () => {
    for (const value of [0, -1, 1.5, Number.NaN]) {
      expect(() => { resolveSpec(specConfig({ maxUploadBytes: value })) }).toThrow(/must be a positive integer/)
    }
  })

  it('accepts a positive whole upload limit', () => {
    expect(resolveSpec(specConfig({ maxUploadBytes: 1 })).maxUploadBytes).toBe(1)
  })
})

describe('the plugin body', () => {
  it('declares the services it cannot work without', () => {
    expect(inject).toEqual(['webServer', 'connection'])
  })

  it('turns its own generated settings page off', async () => {
    // The Background image row is this plugin's settings surface; a page the
    // service generates from the raw profile config would duplicate it.
    const home = await createHome()
    const host = makeHost()
    apply(host.ctx, specConfig({ dshHome: home }))
    expect(host.presentations).toEqual([{ auto: false }])
    host.dispose()
  })

  it('registers every route as an effect', async () => {
    const home = await createHome()
    const host = makeHost()
    apply(host.ctx, specConfig({ dshHome: home }))
    expect(host.routes.sort()).toEqual(
      [
        BACKGROUND_CATALOG_ROUTE,
        BACKGROUND_DELETE_ROUTE,
        BACKGROUND_IMAGE_ROUTE,
        BACKGROUND_REMOTE_ROUTE,
        BACKGROUND_UPLOAD_ROUTE,
      ].sort(),
    )
    host.dispose()
    expect(host.routes).toEqual([])
  })

  it('stops answering the index once it is disposed', async () => {
    const home = await createHome()
    const host = makeHost()
    apply(host.ctx, specConfig({
      dshHome: home,
      defaultBackground: { source: 'preset', id: 'mist', opacity: 65, url: '' },
    }))
    expect(host.render()).toHaveLength(2)
    host.dispose()
    expect(host.render()).toEqual([])
  })

  it('paints nothing before any selection is committed', async () => {
    // The composition default is the harness background, so a render before any
    // user choice contributes nothing.
    const home = await createHome()
    const host = makeHost()
    apply(host.ctx, specConfig({ dshHome: home }))
    expect(host.render()).toEqual([])
    expect(DEFAULT_BACKGROUND_SETTINGS.source).toBe('preset')
    host.dispose()
  })

  it('collects the rows for the selection a form write commits', async () => {
    const home = await createHome()
    const host = makeHost()
    const ref = settingsRef()
    apply(host.ctx, { dshHome: home, defaultBackground: ref })
    expect(host.render()).toEqual([])
    // A committed volatile value is what the next render is served from; the
    // Loader reports the change after it has already installed the value.
    ref.set({ source: 'preset', id: 'ember', opacity: 90, url: '' })
    host.volatileUpdate([BACKGROUND_CONFIG_FIELD])
    expect(host.render()).toHaveLength(2)
    host.dispose()
  })

  it('creates the image directory at load', async () => {
    const home = await createHome()
    const directory = join(home, 'images')
    const host = makeHost()
    apply(host.ctx, specConfig({ dshHome: home, imageDir: directory }))
    await waitForDirectory(directory)
    expect(host.logger.warn).not.toHaveBeenCalled()
    expect(host.routes).toHaveLength(5)
  })

  it('fails the load when a configured image directory cannot be created', async () => {
    // A path the operator chose is configuration: a plugin that cannot serve
    // it must fail at load rather than mount a feature with nowhere to store
    // an image.
    const home = await createHome()
    const notADirectory = join(home, 'a-file')
    await writeFile(notADirectory, 'x')
    const host = makeHost()
    expect(() => { apply(host.ctx, specConfig({ imageDir: notADirectory })) }).toThrow(/EEXIST/)
    // Nothing was registered: the fiber fails before the plugin contributes.
    expect(host.routes).toEqual([])
  })

  it('reports a default directory it could not create rather than failing the load', async () => {
    // The default path is not configuration the operator wrote, and a harness
    // home this process cannot write to must not take the settings page down.
    const home = await createHome()
    const notADirectory = join(home, 'a-file')
    await writeFile(notADirectory, 'x')
    const host = makeHost()
    apply(host.ctx, specConfig({ dshHome: notADirectory }))
    await vi.waitFor(() => {
      expect(host.logger.warn).toHaveBeenCalledWith(expect.stringContaining('could not read the user image directory'))
    })
  })

  it('serves the upload limit a deployment configured', () => {
    expect(resolveSpec(specConfig({ maxUploadBytes: 4096 })).maxUploadBytes).toBe(4096)
    expect(DEFAULT_MAX_UPLOAD_BYTES).toBe(20 * 1024 * 1024)
  })

  it('mounts without a settings provider, keeping the composition default', async () => {
    const home = await createHome()
    const host = makeHost({ settings: false })
    expect(() => { apply(host.ctx, specConfig({ dshHome: home })) }).not.toThrow()
    // The routes still answer and a render still serves the composition
    // default, so a deployment without preferences loses only the row.
    expect(host.routes).toHaveLength(5)
    expect(host.presentations).toEqual([])
    expect(host.render()).toEqual([])
    host.dispose()
  })

  it('reports the configuration a profile would write', () => {
    const config: Config = { imageDir: '/srv/backgrounds', maxUploadBytes: 1024 }
    expect(resolveSpec(config).maxUploadBytes).toBe(1024)
  })
})

describe('the remote image policy', () => {
  it('places no host restriction when the composition names none', () => {
    expect(resolveSpec(specConfig()).remoteImageHosts).toEqual([])
  })

  it('takes the hosts the composition names', () => {
    expect(resolveSpec(specConfig({ remoteImageHosts: ['cdn.example.com', '*.images.example.org'] })).remoteImageHosts)
      .toEqual(['cdn.example.com', '*.images.example.org'])
  })

  it('fails the load on an entry that is not a bare hostname', () => {
    for (const entry of ['*', 'https://cdn.example.com', 'cdn.example.com/path', 'CDN.example.com']) {
      expect(() => resolveSpec(specConfig({ remoteImageHosts: [entry] })))
        .toThrow(/is not a bare hostname or "\*\.suffix"/)
    }
  })
})

describe('the first-paint approval gate', () => {
  it('withholds a remote background until this process has judged the name', async () => {
    const home = await createHome()
    const host = makeHost()
    apply(host.ctx, specConfig({
      dshHome: home,
      defaultBackground: { source: 'remote', id: '', opacity: 65, url: 'https://cdn.example.com/a.png' },
    }))
    // The startup judgement resolves a name, so a render before it settles
    // carries nothing rather than a URL nothing has judged.
    expect(host.render()).toEqual([])
    host.dispose()
  })

  it('paints the remote background once the name has been judged public', async () => {
    dnsMock.answer = [{ address: '93.184.216.34' }]
    const home = await createHome()
    const host = makeHost()
    apply(host.ctx, specConfig({
      dshHome: home,
      defaultBackground: { source: 'remote', id: '', opacity: 65, url: 'https://cdn.example.com/a.png' },
    }))
    await vi.waitFor(() => { expect(host.render()).toHaveLength(2) })
    expect(JSON.stringify(host.render())).toContain('https://cdn.example.com/a.png')
    host.dispose()
  })

  it('judges only a commit that names the field this plugin owns', async () => {
    dnsMock.answer = [{ address: '10.0.0.5' }]
    const home = await createHome()
    const host = makeHost()
    const ref = settingsRef()
    apply(host.ctx, { dshHome: home, defaultBackground: ref })
    ref.set({ source: 'remote', id: '', opacity: 65, url: 'https://cdn.example.com/a.png' })
    // A commit naming another field of the same entry is not a selection
    // change, so nothing is judged and nothing is reported.
    host.volatileUpdate(['imageDir'])
    await new Promise((resolve) => { setTimeout(resolve, 0) })
    expect(host.logger.warn).not.toHaveBeenCalled()
    // The same value committed at the field this plugin owns is judged, which
    // is what shows the first commit was the one that did nothing.
    host.volatileUpdate([BACKGROUND_CONFIG_FIELD])
    await vi.waitFor(() => { expect(host.logger.warn).toHaveBeenCalledWith(expect.stringContaining('private')) })
    host.dispose()
    dnsMock.answer = [{ address: '93.184.216.34' }]
  })

  it('keeps a remote background unpainted and reports a name that resolves privately', async () => {
    dnsMock.answer = [{ address: '10.0.0.5' }]
    const home = await createHome()
    const host = makeHost()
    const ref = settingsRef()
    apply(host.ctx, { dshHome: home, defaultBackground: ref })
    ref.set({ source: 'remote', id: '', opacity: 65, url: 'https://cdn.example.com/a.png' })
    // The Loader installs the value and then reports the change; the judgement
    // follows the change, not the value alone.
    host.volatileUpdate([BACKGROUND_CONFIG_FIELD])
    await vi.waitFor(() => { expect(host.logger.warn).toHaveBeenCalledWith(expect.stringContaining('private')) })
    expect(host.render()).toEqual([])
    host.dispose()
    dnsMock.answer = [{ address: '93.184.216.34' }]
  })
})
