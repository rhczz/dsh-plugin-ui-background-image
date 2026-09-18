/**
 * Schema of the `ui-background-image` settings section.
 *
 * It lives apart from `background-settings.ts` because it is the only part of
 * the section that needs schemastery, and the browser half imports that module
 * for its constants: a schema the browser never resolves would otherwise be
 * bundled into the page along with the whole library.
 * @module dsh-plugin-ui-background-image/background-settings-schema
 */

import z from '@deepseek-ai/schemastery'
import {
  DEFAULT_BACKGROUND_OPACITY,
  BACKGROUND_OPACITY_MAX,
  BACKGROUND_OPACITY_MIN,
} from './background-opacity.ts'
import { DEFAULT_BACKGROUND_PRESET_ID } from './background-presets.ts'
import {
  BACKGROUND_ID_FIELD,
  BACKGROUND_OPACITY_FIELD,
  BACKGROUND_SOURCE_FIELD,
  BACKGROUND_SOURCES,
  BACKGROUND_URL_FIELD,
  DEFAULT_BACKGROUND_SOURCE,
  type BackgroundSettings,
} from './background-settings.ts'

/**
 * Schema of `ui-background-image`. Defaults live here so a document that omits
 * the section, or omits one field, still resolves to a usable background.
 */
export const BackgroundSettingsSchema: z<BackgroundSettings> = z.object({
  [BACKGROUND_SOURCE_FIELD]: z.union([...BACKGROUND_SOURCES]).default(DEFAULT_BACKGROUND_SOURCE),
  [BACKGROUND_ID_FIELD]: z.string().default(DEFAULT_BACKGROUND_PRESET_ID),
  // `.step(1)` is what makes a hand-edited fraction a refused document rather
  // than one the schema accepts and the section's own validation then rejects.
  [BACKGROUND_OPACITY_FIELD]: z.number()
    .step(1)
    .min(BACKGROUND_OPACITY_MIN)
    .max(BACKGROUND_OPACITY_MAX)
    .default(DEFAULT_BACKGROUND_OPACITY),
  // Empty for every catalogue but `remote`, where the section's validation is
  // what decides whether the URL is one this plugin may load.
  [BACKGROUND_URL_FIELD]: z.string().default(''),
})
