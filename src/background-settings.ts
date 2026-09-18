/**
 * The `ui-background-image` settings section: the persisted background both
 * halves read, and the rule deciding which values it may carry. The Host
 * registers the section and paints the canvas from it before the shell mounts;
 * the browser renders the row and projects every later change.
 *
 * This module imports nothing but plain data modules: the browser half reaches
 * it for these constants, so anything added here is bundled into the page. The
 * schema lives in `background-settings-schema.ts`, which only the Host half
 * loads.
 * @module dsh-plugin-ui-background-image/background-settings
 */

import { isBackgroundFileName } from './background-formats.ts'
import { judgeRemoteImageUrl, STRICT_REMOTE_POLICY, type RemotePolicy } from './background-remote.ts'
import {
  BACKGROUND_OPACITY_MAX,
  BACKGROUND_OPACITY_MIN,
  DEFAULT_BACKGROUND_OPACITY,
} from './background-opacity.ts'
import { DEFAULT_BACKGROUND_PRESET_ID, isBackgroundPresetId } from './background-presets.ts'

/** Settings namespace owned by this plugin; lower-case and hyphenated by contract. */
export const BACKGROUND_SETTINGS_NAMESPACE = 'ui-background-image'

/** Field naming the catalogue the selected background belongs to. */
export const BACKGROUND_SOURCE_FIELD = 'source'

/** Field naming the selected background within its catalogue. */
export const BACKGROUND_ID_FIELD = 'id'

/** Field carrying the user's background opacity. */
export const BACKGROUND_OPACITY_FIELD = 'opacity'

/** Field carrying the `https` URL of a `remote` selection. */
export const BACKGROUND_URL_FIELD = 'url'

/**
 * Catalogues a selection can come from.
 *
 * - `preset` — a gradient compiled into this plugin.
 * - `upload` — a file in the Host's image directory, held by its file name.
 * - `remote` — an `https` URL the browser loads directly, held by
 *   {@link BACKGROUND_URL_FIELD} rather than by an id.
 */
export const BACKGROUND_SOURCES = ['preset', 'upload', 'remote'] as const

/** One of {@link BACKGROUND_SOURCES}. */
export type BackgroundSource = typeof BACKGROUND_SOURCES[number]

/** Catalogue a selection falls back to when nothing else resolves. */
export const DEFAULT_BACKGROUND_SOURCE: BackgroundSource = 'preset'

/** Background applied before any user choice. */
export interface BackgroundSettings {
  /** Catalogue {@link BackgroundSettings.id} indexes. */
  source: BackgroundSource
  /** Preset id for `preset`; file name for `upload`; empty for `remote`. */
  id: string
  /** How strongly the background shows through the interface, 0..100. */
  opacity: number
  /** Absolute `https` URL for `remote`; empty for every other catalogue. */
  url: string
}

/** Background a profile gets when neither the document nor the composition names one. */
export const DEFAULT_BACKGROUND_SETTINGS: BackgroundSettings = Object.freeze({
  source: DEFAULT_BACKGROUND_SOURCE,
  id: DEFAULT_BACKGROUND_PRESET_ID,
  opacity: DEFAULT_BACKGROUND_OPACITY,
  url: '',
})

/** Characters that end the path, string, declaration, or script element an image id is written into. */
const UNSAFE_ID_CHARACTERS = '{};<>"\'\\'

/** Characters that may not appear in a stored image id. */
const PATH_SEPARATORS = /[/\\]/

/**
 * Judge one character of an image id.
 *
 * An id reaches three text sinks this plugin builds by hand: a percent-encoded
 * URL path, a quoted CSS string, and the CSS text of the first-paint row. There,
 * a quote or a backslash ends or escapes the string, `<` opens markup, and a
 * control character ends the line the value is written on.
 * @param character - one character, read as a code point by the caller.
 * @returns whether an id carrying it could not be written safely.
 */
function isUnsafeIdCharacter(character: string): boolean {
  // The first UTF-16 unit decides this: every code point at or below U+009F is
  // one unit, and a surrogate half of anything above it is never a control.
  const unit = character.charCodeAt(0)
  const control = unit < 0x20 || (unit >= 0x7f && unit <= 0x9f)
  return control || UNSAFE_ID_CHARACTERS.includes(character)
}

/**
 * Test an id for naming a file the Host's image directory owns.
 *
 * Ids round-trip through an HTTP path and the settings document, so this is the
 * single gate that keeps a stored id from escaping the directory and from
 * breaking out of the CSS text it is written into. The directory lists only
 * files this accepts, so a hand-copied file with an unusable name is not
 * offered as a choice the settings would then refuse.
 * @param id - candidate file name.
 * @returns whether the id is a bare file name with an accepted extension.
 */
export function isStoredBackgroundId(id: string): boolean {
  if (id === '' || id === '.' || id === '..') return false
  if (PATH_SEPARATORS.test(id) || !isBackgroundFileName(id)) return false
  for (const character of id) {
    if (isUnsafeIdCharacter(character)) return false
  }
  return true
}

/**
 * Reject a resolved section this plugin could not act on: no id, an opacity
 * outside the range it can apply, a preset id this build does not ship, an
 * `upload` id that is not a name the Host's directory could hold, or a `remote`
 * URL that fails the policy in `background-remote.ts`.
 *
 * The remote check here is the text-only half of that policy. A deployment's
 * allowlist and the public-address judgement belong to the Host, which applies
 * them through the settings section's own validation and the approval route.
 *
 * The settings service reports a rejected section, keeps the last good value,
 * and refuses a write that resolves to one, so neither a hand-edited document
 * nor a client write leaves the plugin holding a selection it would have to
 * sanitize before serving.
 * @param settings - the resolved section, schema-valid by construction.
 * @param policy - remote policy this deployment applies; the strict default is
 * what a caller without a resolved configuration can judge against.
 * @throws {TypeError} when the selection names no background this plugin can serve.
 */
export function validateBackgroundSettings(
  settings: BackgroundSettings,
  policy: RemotePolicy = STRICT_REMOTE_POLICY,
): void {
  if (!Number.isInteger(settings.opacity)
    || settings.opacity < BACKGROUND_OPACITY_MIN || settings.opacity > BACKGROUND_OPACITY_MAX) {
    throw new TypeError(
      `${BACKGROUND_SETTINGS_NAMESPACE}.${BACKGROUND_OPACITY_FIELD} must be a whole percent in `
      + `${BACKGROUND_OPACITY_MIN}..${BACKGROUND_OPACITY_MAX}, got ${settings.opacity}`,
    )
  }
  if (settings.source === 'remote') {
    if (settings.id !== '') {
      throw new TypeError(
        `${BACKGROUND_SETTINGS_NAMESPACE}.${BACKGROUND_ID_FIELD} must be empty for a remote background, got "${settings.id}"`,
      )
    }
    const verdict = judgeRemoteImageUrl(settings.url, policy)
    if (verdict.kind === 'refused') {
      throw new TypeError(
        `${BACKGROUND_SETTINGS_NAMESPACE}.${BACKGROUND_URL_FIELD} is not a usable image URL (${verdict.reason}): "${settings.url}"`,
      )
    }
    return
  }
  if (settings.id === '') {
    throw new TypeError(`${BACKGROUND_SETTINGS_NAMESPACE}.${BACKGROUND_ID_FIELD} must not be empty`)
  }
  if (settings.url !== '') {
    throw new TypeError(
      `${BACKGROUND_SETTINGS_NAMESPACE}.${BACKGROUND_URL_FIELD} belongs to a remote background, not to "${settings.source}"`,
    )
  }
  if (settings.source === 'preset' && !isBackgroundPresetId(settings.id)) {
    throw new TypeError(
      `${BACKGROUND_SETTINGS_NAMESPACE}.${BACKGROUND_ID_FIELD} names no shipped background preset: "${settings.id}"`,
    )
  }
  if (settings.source === 'upload' && !isStoredBackgroundId(settings.id)) {
    throw new TypeError(
      `${BACKGROUND_SETTINGS_NAMESPACE}.${BACKGROUND_ID_FIELD} is not a usable stored image id: "${settings.id}"`,
    )
  }
}
