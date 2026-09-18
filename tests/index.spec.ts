/**
 * The Host plugin body: what it registers, what it refuses at load, and what a
 * render collects from it.
 * @module dsh-plugin-ui-background-image/tests/index
 */

import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import {
  BACKGROUND_CATALOG_ROUTE,
  BACKGROUND_DELETE_ROUTE,
  BACKGROUND_IMAGE_ROUTE,
  BACKGROUND_UPLOAD_ROUTE,
  BACKGROUND_REMOTE_ROUTE,
} from '../src/background-api.ts'
import {
  BACKGROUND_SETTINGS_NAMESPACE,
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

/** One `installSection` call as the fake settings service recorded it. */
interface RecordedSection {
  owner: unknown
  namespace: string
  schema: unknown
  base: BackgroundSettings
  setSource: (current: () => BackgroundSettings) => void
  validate: (value: BackgroundSettings) => void
  onChange: () => void
}

/** A Host context double recording the registrations `apply` makes. */
interface TestHost {
  ctx: Context
  /** The scoped context the fake `inject` handed to a consumer. */
  scoped: unknown
  sections: RecordedSection[]
  routes: string[]
  logger: { warn: ReturnType<typeof vi.fn> }
  /** Push one index injection table the way a render would. */
  render: () => readonly IndexInjection[]
  /** Release every effect `apply` registered. */
  dispose: () => void
}

/**
 * Build a context exposing the services `apply` consumes.
 * @param options - whether the composition provides the optional settings service.
 * @returns the context double.
 */
function makeHost(options: { settings?: boolean } = {}): TestHost {
  const sections: RecordedSection[] = []
  const routes: string[] = []
  const disposers: (() => void)[] = []
  const listeners = new Map<string, ((payload: unknown) => void)[]>()
  const logger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }

  // The scoped context an optional service is delivered on; the plugin body
  // hands it to installSection, which is what the record has to name.
  const scoped: { settings?: unknown } = {}
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
      Object.assign(scoped, {
        settings: {
          installSection(
            owner: unknown,
            namespace: string,
            schema: unknown,
            base: BackgroundSettings,
            hooks: Omit<RecordedSection, 'owner' | 'namespace' | 'schema' | 'base'>,
          ) {
            sections.push({ owner, namespace, schema, base, ...hooks })
            return () => {}
          },
        },
      })
      callback(scoped)
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
    scoped,
    sections,
    routes,
    logger,
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

describe('resolveSpec', () => {
  it('puts the image directory under the harness home by default', async () => {
    const home = await createHome()
    expect(resolveSpec({ dshHome: home }).imageDir).toBe(join(home, 'backgrounds'))
  })

  it('takes the directory the composition names', () => {
    expect(resolveSpec({ imageDir: '/srv/backgrounds' }).imageDir).toBe('/srv/backgrounds')
  })

  it('starts from the harness background and the default opacity', () => {
    expect(resolveSpec({}).defaultBackground).toEqual(DEFAULT_BACKGROUND_SETTINGS)
  })

  it('accepts a composition background a deployment pinned', () => {
    const spec = resolveSpec({ defaultBackground: { source: 'preset', id: 'mist', opacity: 20, url: '' } })
    expect(spec.defaultBackground).toEqual({ source: 'preset', id: 'mist', opacity: 20, url: '' })
  })

  it('refuses a composition background it could not serve', () => {
    // Misconfiguration fails at load, not at the first request that would have
    // used the value.
    expect(() => resolveSpec({ defaultBackground: { source: 'preset', id: 'comic', opacity: 65, url: '' } }))
      .toThrow(/names no shipped background preset/)
    expect(() => resolveSpec({ defaultBackground: { source: 'upload', id: '../x.png', opacity: 65, url: '' } }))
      .toThrow(/not a usable stored image id/)
    expect(() => resolveSpec({ defaultBackground: { source: 'preset', id: 'mist', opacity: 101, url: '' } }))
      .toThrow(/whole percent/)
  })

  it('refuses an upload limit it could not apply', () => {
    for (const value of [0, -1, 1.5, Number.NaN]) {
      expect(() => { resolveSpec({ maxUploadBytes: value }) }).toThrow(/must be a positive integer/)
    }
  })

  it('accepts a positive whole upload limit', () => {
    expect(resolveSpec({ maxUploadBytes: 1 }).maxUploadBytes).toBe(1)
  })
})

describe('the plugin body', () => {
  it('declares the services it cannot work without', () => {
    expect(inject).toEqual(['webServer', 'connection'])
  })

  it('installs the settings section on the composition base', async () => {
    const home = await createHome()
    const host = makeHost()
    apply(host.ctx, { dshHome: home, defaultBackground: { source: 'preset', id: 'mist', opacity: 30, url: '' } })
    expect(host.sections).toHaveLength(1)
    const section = host.sections[0]
    expect(section?.namespace).toBe(BACKGROUND_SETTINGS_NAMESPACE)
    expect(section?.base).toEqual({ source: 'preset', id: 'mist', opacity: 30, url: '' })
    expect(section?.owner).toBe(host.scoped)
    expect(() => { section?.validate({ source: 'preset', id: 'comic', opacity: 65, url: '' }) })
      .toThrow(/names no shipped background preset/)
  })

  it('registers every route as an effect', async () => {
    const home = await createHome()
    const host = makeHost()
    apply(host.ctx, { dshHome: home })
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
    apply(host.ctx, { dshHome: home, defaultBackground: { source: 'preset', id: 'mist', opacity: 65, url: '' } })
    expect(host.render()).toHaveLength(2)
    host.dispose()
    expect(host.render()).toEqual([])
  })

  it('collects the rows for the selection the settings service resolves', async () => {
    const home = await createHome()
    const host = makeHost()
    apply(host.ctx, { dshHome: home })
    // The composition default is the harness background, so a render before any
    // user choice contributes nothing.
    expect(host.render()).toEqual([])
    host.sections[0]?.setSource(() => ({ source: 'preset', id: 'ember', opacity: 90, url: '' }))
    expect(host.render()).toHaveLength(2)
  })

  it('creates the image directory at load', async () => {
    const home = await createHome()
    const directory = join(home, 'images')
    const host = makeHost()
    apply(host.ctx, { dshHome: home, imageDir: directory })
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
    expect(() => { apply(host.ctx, { imageDir: notADirectory }) }).toThrow(/EEXIST/)
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
    apply(host.ctx, { dshHome: notADirectory })
    await vi.waitFor(() => {
      expect(host.logger.warn).toHaveBeenCalledWith(expect.stringContaining('could not read the user image directory'))
    })
  })

  it('answers a render with the rows the current selection asks for', async () => {
    const home = await createHome()
    const host = makeHost()
    apply(host.ctx, { dshHome: home })
    expect(host.render()).toEqual([])
    // A settings change re-reads the section: the next render is served from
    // the value the service resolves at that moment.
    host.sections[0]?.onChange()
    expect(host.render()).toEqual([])
  })

  it('serves the upload limit a deployment configured', () => {
    expect(resolveSpec({ maxUploadBytes: 4096 }).maxUploadBytes).toBe(4096)
    expect(DEFAULT_MAX_UPLOAD_BYTES).toBe(20 * 1024 * 1024)
  })

  it('mounts without a settings provider, keeping the composition default', async () => {
    const home = await createHome()
    const host = makeHost({ settings: false })
    expect(() => { apply(host.ctx, { dshHome: home }) }).not.toThrow()
    // The routes still answer and a render still serves the composition
    // default, so a deployment without preferences loses only the row.
    expect(host.routes).toHaveLength(5)
    expect(host.sections).toEqual([])
    expect(host.render()).toEqual([])
  })

  it('reports the configuration a profile would write', () => {
    const config: Config = { imageDir: '/srv/backgrounds', maxUploadBytes: 1024 }
    expect(resolveSpec(config).maxUploadBytes).toBe(1024)
  })
})

describe('the remote image policy', () => {
  it('places no host restriction when the composition names none', () => {
    expect(resolveSpec({}).remoteImageHosts).toEqual([])
  })

  it('takes the hosts the composition names', () => {
    expect(resolveSpec({ remoteImageHosts: ['cdn.example.com', '*.images.example.org'] }).remoteImageHosts)
      .toEqual(['cdn.example.com', '*.images.example.org'])
  })

  it('fails the load on an entry that is not a bare hostname', () => {
    for (const entry of ['*', 'https://cdn.example.com', 'cdn.example.com/path', 'CDN.example.com']) {
      expect(() => resolveSpec({ remoteImageHosts: [entry] }))
        .toThrow(/is not a bare hostname or "\*\.suffix"/)
    }
  })
})

describe('the first-paint approval gate', () => {
  it('withholds a remote background until this process has judged the name', async () => {
    const home = await createHome()
    const host = makeHost()
    apply(host.ctx, {
      dshHome: home,
      defaultBackground: { source: 'remote', id: '', opacity: 65, url: 'https://cdn.example.com/a.png' },
    })
    // The startup judgement resolves a name, so a render before it settles
    // carries nothing rather than a URL nothing has judged.
    expect(host.render()).toEqual([])
    host.dispose()
  })

  it('paints the remote background once the name has been judged public', async () => {
    dnsMock.answer = [{ address: '93.184.216.34' }]
    const home = await createHome()
    const host = makeHost()
    apply(host.ctx, {
      dshHome: home,
      defaultBackground: { source: 'remote', id: '', opacity: 65, url: 'https://cdn.example.com/a.png' },
    })
    await vi.waitFor(() => { expect(host.render()).toHaveLength(2) })
    expect(JSON.stringify(host.render())).toContain('https://cdn.example.com/a.png')
    host.dispose()
  })

  it('keeps a remote background unpainted and reports a name that resolves privately', async () => {
    dnsMock.answer = [{ address: '10.0.0.5' }]
    const home = await createHome()
    const host = makeHost()
    apply(host.ctx, { dshHome: home })
    host.sections[0]?.setSource(() => ({
      source: 'remote',
      id: '',
      opacity: 65,
      url: 'https://cdn.example.com/a.png',
    }))
    // The settings service resolves a write and then reports it; the judgement
    // follows the change, not the value alone.
    host.sections[0]?.onChange()
    await vi.waitFor(() => { expect(host.logger.warn).toHaveBeenCalledWith(expect.stringContaining('private')) })
    expect(host.render()).toEqual([])
    host.dispose()
    dnsMock.answer = [{ address: '93.184.216.34' }]
  })
})
