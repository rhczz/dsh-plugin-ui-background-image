/**
 * The one definition of what the user's opacity setting means.
 *
 * The background is painted on the document canvas and every official surface
 * keeps painting itself from `--dsw-alias-bg-base`; the setting lowers that
 * *surface* colour's alpha, which is what lets the canvas show through. The
 * mapping lives here, in one place, because the Host's first-paint row and the
 * browser's live projection both apply it and the two must never differ.
 * @module dsh-plugin-ui-background-image/background-opacity
 */

/** Lowest opacity a settings document may carry. */
export const BACKGROUND_OPACITY_MIN = 0

/** Highest opacity a settings document may carry. */
export const BACKGROUND_OPACITY_MAX = 100

/** Opacity applied before any user choice. */
export const DEFAULT_BACKGROUND_OPACITY = 65

/**
 * Transparency the outermost surface reaches at full opacity, in percent.
 *
 * The surfaces that paint `--dsw-alias-bg-base` nest — the frame, the
 * conversation column, and the panels drawn from the same token inside it — and
 * each one multiplies what is left of the image below it. A ceiling of 64% at
 * full opacity therefore leaves the outermost layer at 36% of its own colour
 * while the image behind text on such a panel is (1 - 0.36)³, about a quarter of
 * its strength. Raising the ceiling would make the surfaces' own colour the
 * smaller part of what the interface shows.
 */
const MAX_SURFACE_TRANSPARENCY = 64

/**
 * Judge a value read from the settings document for naming an opacity this
 * plugin can apply.
 * @param value - candidate opacity.
 * @returns whether the value is a whole percent inside the accepted range.
 */
export function isBackgroundOpacity(value: number): boolean {
  return Number.isInteger(value) && value >= BACKGROUND_OPACITY_MIN && value <= BACKGROUND_OPACITY_MAX
}

/**
 * Translate the user's opacity into the alpha the harness's surfaces keep.
 *
 * Linear in the user's number, so a drag moves the image at a steady rate:
 * percent 0 leaves the official surfaces fully opaque, percent 100 is
 * {@link MAX_SURFACE_TRANSPARENCY} short of it.
 * @param opacity - user-facing background opacity, 0..100.
 * @returns alpha for `--dsw-alias-bg-base`, as an integer percent.
 */
export function surfaceAlphaPercent(opacity: number): number {
  return Math.round(BACKGROUND_OPACITY_MAX - MAX_SURFACE_TRANSPARENCY * (opacity / BACKGROUND_OPACITY_MAX))
}

/**
 * Alpha the sidebar's own fill keeps at one opacity.
 *
 * The sidebar column and the element inside it each paint this fill over the
 * frame's own surface, while the conversation area is one surface deep. Giving
 * the fill {@link surfaceAlphaPercent} would therefore leave the sidebar plain
 * while the area beside it showed the background. The value whose square is the
 * surface's own openness leaves the two showing the same amount of the canvas,
 * and reaches fully opaque at 0 like the surfaces do.
 * @param opacity - the user's background opacity in whole percent.
 * @returns the alpha to keep, 0..100.
 */
export function sidebarAlphaPercent(opacity: number): number {
  const openness = (BACKGROUND_OPACITY_MAX - surfaceAlphaPercent(opacity)) / BACKGROUND_OPACITY_MAX
  return Math.round((1 - Math.sqrt(openness)) * BACKGROUND_OPACITY_MAX)
}
