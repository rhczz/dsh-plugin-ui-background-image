/**
 * The CSS this plugin installs on the document canvas, and the values that
 * reach it.
 *
 * The background is painted on the `body` element's canvas background rather
 * than on a surface of this plugin's own, so every official panel, card, and
 * overlay keeps drawing itself exactly as it did; what lets the canvas show
 * through is the alpha the surfaces carry, never a change to their layout. The
 * Host's first-paint row and the browser's live projection build their values
 * here, so the two cannot install different backgrounds for one document.
 * @module dsh-plugin-ui-background-image/background-canvas
 */

import { BACKGROUND_IMAGE_ID_FIELD, BACKGROUND_IMAGE_ROUTE } from './background-api.ts'

/**
 * Custom property carrying the canvas background.
 *
 * Named here because the Host's first-paint row and the browser's live
 * projection both write it, and the two must never name different properties.
 */
export const BACKGROUND_IMAGE_VARIABLE = '--dsh-ui-background-image'

/**
 * Custom property the theme declares the harness's base surface colour on.
 *
 * One of the two official tokens this plugin overrides, and only while a
 * background is installed: lowering its alpha is what lets the canvas show
 * through the frame, the conversation column, and every panel drawn from it.
 */
export const SURFACE_BACKGROUND_PROPERTY = '--dsw-alias-bg-base'

/**
 * Official token the sidebar column and the element inside it paint.
 *
 * The second of the two official tokens this plugin overrides, and only while a
 * background is installed: the sidebar's fill covers a whole column, so leaving
 * it opaque would hide the background from the interface's left half.
 */
export const SIDEBAR_FILL_PROPERTY = '--dsw-specific-sidebar-fill'

/**
 * Id of the element holding the canvas rule.
 *
 * The Host renders the rule into the served page and the browser adopts that
 * same element rather than adding a second rule for the canvas it already
 * paints.
 */
export const BACKGROUND_CANVAS_STYLE_ID = 'dsh-ui-background-image-canvas'

/**
 * The rule that paints the canvas. `cover` and `center` are the whole of this
 * plugin's placement policy: one image, filled to the viewport, so a selection
 * can never expose the browser's own canvas behind a letterboxed edge.
 */
export const BACKGROUND_CANVAS_RULE = 'body{'
  + `background-image:var(${BACKGROUND_IMAGE_VARIABLE},none);`
  + 'background-size:cover;'
  + 'background-position:center center;'
  + 'background-repeat:no-repeat;'
  + 'background-attachment:fixed}'

/** One CSS value per colour scheme, which is how the theme takes an override. */
export interface ColorSchemeValue {
  /** Value applied while the light base palette is active. */
  light: string
  /** Value applied while the dark base palette is active. */
  dark: string
}

/**
 * Palette primitives each colour scheme's base surface colour is declared from.
 *
 * Read from the official palette rather than restated as literals, so a
 * background that is installed keeps the harness's own colour at a lower alpha
 * instead of a colour this plugin guessed.
 */
const BASE_SURFACE_PRIMITIVES: ColorSchemeValue = {
  light: 'var(--dsw-static-neutral-bluish-00)',
  dark: 'var(--dsw-static-neutral-bluish-950)',
}

/** Palette primitives the sidebar's own fill is declared from. */
const SIDEBAR_FILL_PRIMITIVES: ColorSchemeValue = {
  light: 'var(--dsw-static-neutral-bluish-50)',
  dark: 'var(--dsw-static-neutral-bluish-900)',
}

/**
 * Build the URL one stored image is served at.
 *
 * The shared API channel carries exact paths only, so the image is named by a
 * query parameter rather than by a path segment.
 * @param id - stored image id.
 * @returns the absolute path the browser fetches it from.
 */
export function backgroundImageUrl(id: string): string {
  return `${BACKGROUND_IMAGE_ROUTE}?${BACKGROUND_IMAGE_ID_FIELD}=${encodeURIComponent(id)}`
}

/**
 * Build the canvas value for one stored image.
 *
 * The id is a file name the Host owns, but it arrives from a settings document,
 * so it is percent-encoded into the path and quoted inside a CSS string rather
 * than trusted; the shape it may take is gated at the write.
 * @param id - stored image id.
 * @returns the value to install, identical in both colour schemes.
 */
export function backgroundImageValue(id: string): ColorSchemeValue {
  const value = `url("${backgroundImageUrl(id)}")`
  return { light: value, dark: value }
}

/**
 * Build the canvas value for one remote image URL.
 *
 * The URL is written into a double-quoted CSS string. It reaches this function
 * only after a URL parse serialized it, and that serialization percent-encodes
 * every quote and backslash the text could carry, so the string cannot be
 * closed early.
 * @param url - serialized absolute `https` URL.
 * @returns the value to install, identical in both colour schemes.
 */
export function remoteImageValue(url: string): ColorSchemeValue {
  const value = `url("${url}")`
  return { light: value, dark: value }
}

/**
 * Build one palette colour at a lower alpha, in each colour scheme.
 * @param primitives - palette primitives to keep.
 * @param alphaPercent - alpha to keep, 0..100.
 * @returns the value per colour scheme.
 */
function mixedValue(primitives: ColorSchemeValue, alphaPercent: number): ColorSchemeValue {
  return {
    light: `color-mix(in srgb, ${primitives.light} ${alphaPercent}%, transparent)`,
    dark: `color-mix(in srgb, ${primitives.dark} ${alphaPercent}%, transparent)`,
  }
}

/**
 * Build the surface override for one alpha.
 * @param alphaPercent - alpha the surfaces keep, 0..100.
 * @returns `--dsw-alias-bg-base` per colour scheme.
 */
export function surfaceValue(alphaPercent: number): ColorSchemeValue {
  return mixedValue(BASE_SURFACE_PRIMITIVES, alphaPercent)
}

/**
 * Build the sidebar override for one alpha.
 * @param alphaPercent - alpha the sidebar's fill keeps, 0..100.
 * @returns `--dsw-specific-sidebar-fill` per colour scheme.
 */
export function sidebarFillValue(alphaPercent: number): ColorSchemeValue {
  return mixedValue(SIDEBAR_FILL_PRIMITIVES, alphaPercent)
}
