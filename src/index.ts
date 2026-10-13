/**
 * Host half of `dsh-plugin-ui-background-image`: the persisted background, the
 * shipped presets, the user image directory, the HTTP routes the settings page
 * calls, and the first-paint rows that install the chosen background before the
 * shell mounts.
 *
 * The client module system discovers this module: the Loader entry pointing
 * here leads to the nearest `package.json`, whose `dsh.client` and
 * `exports["./client"]` name the browser half. An entry that does not reach
 * this module mounts no browser half either.
 * @module dsh-plugin-ui-background-image
 */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Context, Volatile } from '@deepseek-ai/cordis'
// Type-only: the `loader/volatile-update` event declaration the Host listens for.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type {} from '@deepseek-ai/dsh-host-webserver'
// Type-only: the `settings` service this plugin turns its generated settings
// page off through; the browser half owns the row that replaces it.
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { DEFAULT_MAX_UPLOAD_BYTES } from './background-api.ts'
import {
  DEFAULT_REMOTE_ACCESS,
  isRemoteHostAllowlistEntry,
  REMOTE_ACCESS_MODES,
  type RemoteAccessMode,
  type RemotePolicy,
} from './background-remote.ts'
import { ApprovedRemoteImages } from './background-remote-approval.ts'
import { bootBackgroundInjections } from './boot-background.ts'
import { registerBackgroundRoutes } from './background-fetch-routes.ts'
import {
  BACKGROUND_CONFIG_FIELD,
  DEFAULT_BACKGROUND_SETTINGS,
  validateBackgroundSettings,
  type BackgroundSettings,
} from './background-settings.ts'
import { BackgroundSettingsSchema } from './background-settings-schema.ts'
import { USER_BACKGROUND_DIR_NAME, UserBackgroundDirectory } from './user-backgrounds.ts'

/** Plugin name the Loader reports in diagnostics and fiber dumps. */
export const name = 'ui-background-image'

/**
 * Required services: the web server this plugin's routes live on, and the API
 * channel those routes are registered through. The browser half has nothing to
 * read or write without them, so a profile that serves no web surface leaves
 * this plugin inactive rather than half mounted.
 */
export const inject = ['webServer', 'connection']

/** Plugin config: where images live, what the profile starts with, and the upload limit. */
export interface Config {
  /** User image directory; defaults to `backgrounds` under the harness home. */
  imageDir?: string
  /** Harness home used when `imageDir` is omitted; defaults to `$DSH_HOME` or `~/.dsh`. */
  dshHome?: string
  /** Largest accepted upload in bytes; defaults to {@link DEFAULT_MAX_UPLOAD_BYTES}. */
  maxUploadBytes?: number
  /**
   * Hostnames a remote background image URL may name, each a bare hostname or a
   * `*.suffix` wildcard. Unset lets any host pass that clears the gate below; set
   * to an empty array to refuse every remote image.
   */
  remoteImageHosts?: string[]
  /**
   * How far a remote image URL may reach. `strict` requires `https`, a hostname
   * rather than an address, nothing reserved for local networks, and a name that
   * resolves to public addresses. `any` keeps only the rules that hold the
   * stored value well-formed, and lets this deployment point its own browsers
   * anywhere — including at its own network.
   */
  remoteImageAccess?: RemoteAccessMode
  /**
   * Background this profile starts with, overridden by any user choice; read
   * through the reference the Loader hands the plugin. Absent until a
   * composition layer or a form write supplies one.
   */
  defaultBackground?: Volatile<BackgroundSettings | undefined>
}

/** Fully resolved plugin parameters; defaulting happens here, never inline. */
interface ResolvedSpec {
  /** Absolute user image directory. */
  imageDir: string
  /** Largest accepted upload in bytes. */
  maxUploadBytes: number
  /** Hostname allowlist for remote image URLs; empty places no host restriction. */
  remoteImageHosts: readonly string[]
  /** Remote image policy this deployment applies. */
  remotePolicy: RemotePolicy
}

/**
 * Resolve the runtime spec from plugin config.
 *
 * An unusable value fails here, at load, rather than at the first request that
 * would have used it. The selection is validated the same way, over the value
 * this load starts from; later values are validated by the Host against this
 * entry's Config schema before any volatile edit persists.
 * @param config - raw plugin config.
 * @returns the fully resolved parameters.
 * @throws {TypeError} when a configured value could not be served.
 */
export function resolveSpec(config: Config): ResolvedSpec {
  const maxUploadBytes = config.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES
  if (!Number.isSafeInteger(maxUploadBytes) || maxUploadBytes <= 0) {
    throw new TypeError(`ui-background-image: maxUploadBytes must be a positive integer, got ${String(config.maxUploadBytes)}`)
  }
  const remoteImageHosts = config.remoteImageHosts ?? []
  for (const entry of remoteImageHosts) {
    // A malformed entry fails the load rather than silently matching nothing or
    // matching more than it spells.
    if (!isRemoteHostAllowlistEntry(entry)) {
      throw new TypeError(`ui-background-image: remoteImageHosts entry ${JSON.stringify(entry)} is not a bare hostname or "*.suffix"`)
    }
  }
  const remotePolicy: RemotePolicy = {
    access: config.remoteImageAccess ?? DEFAULT_REMOTE_ACCESS,
    hostAllowlist: remoteImageHosts,
  }
  validateBackgroundSettings(config.defaultBackground?.get() ?? DEFAULT_BACKGROUND_SETTINGS, remotePolicy)
  return {
    imageDir: config.imageDir ?? join(resolveDshHome(config.dshHome), USER_BACKGROUND_DIR_NAME),
    maxUploadBytes,
    remoteImageHosts,
    remotePolicy,
  }
}

/** Schema of this plugin's composition entry, so a profile gets its values validated. */
export const Config = z.object({
  imageDir: z.string(),
  dshHome: z.string(),
  maxUploadBytes: z.number().default(DEFAULT_MAX_UPLOAD_BYTES),
  remoteImageHosts: z.array(z.string()),
  remoteImageAccess: z.union([...REMOTE_ACCESS_MODES]).default(DEFAULT_REMOTE_ACCESS),
  // Volatile: the settings form edits this field on the live instance, and a
  // write preserves the fiber instead of remounting the plugin.
  defaultBackground: BackgroundSettingsSchema.volatile(),
})

/**
 * Register the image routes, the first-paint rows, and the follow-up that keeps
 * the remote-approval record on whatever background is currently committed.
 * @param ctx - owning Host context; every registration is an effect it releases.
 * @param config - composition entry for this plugin, resolved by the Loader
 * through the Config schema.
 * @throws when an explicitly configured image directory cannot be created: the
 * throw reaches the loader before any registration exists, so the plugin fails
 * rather than mounting a feature with nowhere to store an image.
 */
export function apply(ctx: Context, config: Config = {}): void {
  // This plugin owns its settings surface: the Background image row registers
  // the selection, so the settings UI must not also generate a page from the raw
  // profile config. The namespace itself still comes from the Loader entry, so
  // the browser half reads the same form either way.
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })

  const spec = resolveSpec(config)
  const images = new UserBackgroundDirectory(spec.imageDir, ctx.logger)

  if (config.imageDir !== undefined) {
    // A path the operator chose is configuration, and configuration that cannot
    // be served fails at load. The default path only warns: a harness home this
    // process cannot write to must not take the whole settings page down.
    mkdirSync(spec.imageDir, { recursive: true })
  } else {
    void images.ensure().catch((error: unknown) => {
      ctx.logger.warn(`ui-background-image: could not read the user image directory ${spec.imageDir}: ${String(error)}`)
    })
  }

  // The live Config reference is the one reader: it already answers the latest
  // committed value, whatever composition or form write last set it.
  const currentSettings = (): BackgroundSettings =>
    config.defaultBackground?.get() ?? DEFAULT_BACKGROUND_SETTINGS
  const approvals = new ApprovedRemoteImages()
  // A remote URL paints on the first frame only once this process has judged the
  // name it resolves to. The write path approves what the user picks; this
  // re-judges a document this process did not write, so a restart paints the
  // chosen background again without ever assuming the previous verdict.
  const judgePersistedRemote = (): void => {
    void approvals.refresh(currentSettings(), spec.remotePolicy).then((refusal) => {
      if (refusal !== undefined) {
        ctx.logger.warn(`ui-background-image: remote background ${currentSettings().url} was not approved: ${refusal}`)
      }
    })
  }

  // A selection change commits the reference, then reports it here, so the
  // approval record follows whatever the user chose without a remount. The
  // first-paint row reads that record when an index asks for the rows.
  ctx.on('loader/volatile-update', (paths) => {
    if (!paths.some(path => path[0] === BACKGROUND_CONFIG_FIELD)) return
    judgePersistedRemote()
  })

  // This process may be starting on a document it did not write, so the stored
  // selection is judged once here rather than assumed.
  judgePersistedRemote()

  ctx.on('webserver/index-inject', (table) => {
    const settings = currentSettings()
    // The row is judged, not assumed: an index render cannot await a name
    // resolution, so a remote selection waits for the approval the write path or
    // the startup judgement recorded.
    if (settings.source === 'remote' && !approvals.isApproved(settings.url)) return
    table.push(...bootBackgroundInjections(settings, spec.remotePolicy))
  })

  registerBackgroundRoutes(ctx, {
    images,
    maxUploadBytes: spec.maxUploadBytes,
    remotePolicy: spec.remotePolicy,
    approvals,
  })
}

export { DEFAULT_MAX_UPLOAD_BYTES } from './background-api.ts'
export { BACKGROUND_SETTINGS_NAMESPACE } from './background-settings.ts'
export { BackgroundSettingsSchema } from './background-settings-schema.ts'
export type { BackgroundSettings, BackgroundSource } from './background-settings.ts'
