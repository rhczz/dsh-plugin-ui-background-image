/**
 * The backgrounds this plugin ships. Both halves import them, so a preset id
 * persisted by the browser always resolves to the same canvas value on the Host.
 * @module dsh-plugin-ui-background-image/background-presets
 */

import type { ColorSchemeValue } from './background-canvas.ts'

/** Preset ids in presentation order. Every id needs a value in {@link BACKGROUND_PRESET_VALUES}. */
export const BACKGROUND_PRESET_IDS = ['none', 'mist', 'dusk', 'ember', 'verdant'] as const

/** One of the backgrounds this plugin ships. */
export type BackgroundPresetId = typeof BACKGROUND_PRESET_IDS[number]

/** Preset applied when a selection names nothing usable. */
export const DEFAULT_BACKGROUND_PRESET_ID: BackgroundPresetId = 'none'

/**
 * Canvas value each preset installs, per palette mode.
 *
 * A preset is a gradient rather than a file, so choosing one costs no bytes and
 * works on an offline machine. Each carries both modes because the canvas sits
 * behind every surface at every strength: a light value under the dark palette
 * would read as a washed-out page, and a dark value under the light palette as
 * a hole in it.
 *
 * Every value is a wash of its own hue rather than a picture. The canvas is
 * where the whole gradient shows, and the surfaces above it are translucent, so
 * the wash still reaches the interface at the strength the user asked for while
 * the text above it keeps the contrast the harness measured for.
 *
 * `none` names nothing: it restores the harness's own background, which no
 * installed canvas can extend.
 */
const BACKGROUND_PRESET_VALUES: Readonly<Record<BackgroundPresetId, ColorSchemeValue>> = {
  none: { light: '', dark: '' },
  mist: {
    light: 'linear-gradient(160deg, rgb(222, 232, 247) 0%, rgb(178, 199, 232) 55%, rgb(196, 214, 240) 100%)',
    dark: 'linear-gradient(160deg, rgb(12, 17, 30) 0%, rgb(24, 44, 78) 55%, rgb(16, 28, 52) 100%)',
  },
  dusk: {
    light: 'linear-gradient(150deg, rgb(228, 220, 248) 0%, rgb(192, 176, 231) 55%, rgb(210, 194, 242) 100%)',
    dark: 'linear-gradient(150deg, rgb(17, 12, 32) 0%, rgb(44, 30, 80) 55%, rgb(28, 18, 56) 100%)',
  },
  ember: {
    light: 'linear-gradient(150deg, rgb(252, 232, 214) 0%, rgb(240, 196, 158) 55%, rgb(240, 203, 200) 100%)',
    dark: 'linear-gradient(150deg, rgb(28, 15, 10) 0%, rgb(62, 32, 18) 55%, rgb(42, 21, 15) 100%)',
  },
  verdant: {
    light: 'linear-gradient(150deg, rgb(224, 242, 229) 0%, rgb(174, 220, 190) 55%, rgb(190, 226, 208) 100%)',
    dark: 'linear-gradient(150deg, rgb(10, 22, 15) 0%, rgb(20, 50, 34) 55%, rgb(13, 34, 24) 100%)',
  },
}

/**
 * Read the canvas value one preset installs.
 * @param id - preset to read.
 * @returns the value per mode; both sides are empty for the preset that names
 * none, which a caller resolves to the harness's own background.
 */
export function backgroundPresetValue(id: BackgroundPresetId): ColorSchemeValue {
  return BACKGROUND_PRESET_VALUES[id]
}

/**
 * Test a value read from the settings document for naming a preset this build
 * ships.
 * @param value - candidate preset id.
 * @returns whether `value` is a known preset id.
 */
export function isBackgroundPresetId(value: string): value is BackgroundPresetId {
  return BACKGROUND_PRESET_IDS.some(id => id === value)
}
