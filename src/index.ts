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
import type { Context } from '@deepseek-ai/cordis'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type {} from '@deepseek-ai/dsh-host-webserver'
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
  BACKGROUND_SETTINGS_NAMESPACE,
  DEFAULT_BACKGROUND_SETTINGS,
  validateBackgroundSettings,
  type BackgroundSettings,
} from './background-settings.ts'
import { BackgroundSettingsSchema } from './background-settings-schema.ts'
import { USER_BACKGROUND_DIR_NAME, UserBackgroundDirectory } from './user-backgrounds.ts'

/**
 * Required service: the web server this plugin's routes live on. The browser
 * half has nothing to read or write without it, so a profile that serves no
 * web surface leaves this plugin inactive rather than half mounted.
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
  /** Background this profile starts with, overridden by any user choice. */
  defaultBackground?: BackgroundSettings
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
  /** Background installed as the settings section's composition base. */
  defaultBackground: BackgroundSettings
}

/**
 * Resolve the runtime spec from plugin config.
 *
 * An unusable value fails here, at load, rather than at the first request that
 * would have used it.
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
  const defaultBackground = config.defaultBackground ?? DEFAULT_BACKGROUND_SETTINGS
  validateBackgroundSettings(defaultBackground, remotePolicy)
  return {
    imageDir: config.imageDir ?? join(resolveDshHome(config.dshHome), USER_BACKGROUND_DIR_NAME),
    maxUploadBytes,
    remoteImageHosts,
    remotePolicy,
    defaultBackground,
  }
}

/** Schema of this plugin's composition entry, so a profile gets its values validated. */
export const Config: z<Config> = z.object({
  imageDir: z.string(),
  dshHome: z.string(),
  maxUploadBytes: z.number().default(DEFAULT_MAX_UPLOAD_BYTES),
  remoteImageHosts: z.array(z.string()),
  remoteImageAccess: z.union([...REMOTE_ACCESS_MODES]).default(DEFAULT_REMOTE_ACCESS),
  defaultBackground: BackgroundSettingsSchema,
})

/**
 * Register the settings section, the image routes, and the first-paint rows.
 * @param ctx - owning Host context; every registration is an effect it releases.
 * @param config - composition entry for this plugin.
 * @throws when an explicitly configured image directory cannot be created: the
 * throw reaches the loader before any registration exists, so the plugin fails
 * rather than mounting a feature with nowhere to store an image.
 */
export function apply(ctx: Context, config: Config = {}): void {
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

  let currentSettings: () => BackgroundSettings = () => spec.defaultBackground
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

  // The composition entry supplies the section's base layer, so a profile can
  // pin a house background that every user choice overrides and a reset returns
  // to.
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(
      settingsCtx,
      BACKGROUND_SETTINGS_NAMESPACE,
      BackgroundSettingsSchema,
      spec.defaultBackground,
      {
        setSource: (current) => { currentSettings = current },
        // A selection change is what the approval record has to follow: the
        // first-paint row reads it when an index asks for the rows.
        onChange: () => { judgePersistedRemote() },
        validate: value => { validateBackgroundSettings(value, spec.remotePolicy) },
      },
    )
    judgePersistedRemote()
  })

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
