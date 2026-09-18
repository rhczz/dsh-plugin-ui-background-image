/**
 * Turning a persisted selection into the background installed on the document.
 *
 * {@link resolveBackgroundProjection} decides what the canvas should carry;
 * {@link isBackgroundSelectionAvailable} decides what the settings row reports
 * about a selection whose file may be gone. The Host's first-paint row and the
 * browser's live projection both take the first step, so the two cannot install
 * different backgrounds for one document.
 * @module dsh-plugin-ui-background-image/background-selection
 */

import { backgroundImageValue, remoteImageValue, type ColorSchemeValue } from './background-canvas.ts'
import { backgroundPresetValue, isBackgroundPresetId } from './background-presets.ts'
import { judgeRemoteImageUrl, STRICT_REMOTE_POLICY, type RemotePolicy } from './background-remote.ts'
import { isStoredBackgroundId, type BackgroundSettings } from './background-settings.ts'

/**
 * Dynamic catalogues a resolution may consult. Presets are compiled in and so
 * are absent here.
 */
export interface BackgroundCatalogues {
  /**
   * Ids of the images the Host's directory holds, or `undefined` while the
   * catalogue has not been read.
   *
   * The distinction is load-bearing: a loaded set without the id proves the file
   * is gone and the canvas resolves to the harness's own background, while an
   * unread catalogue proves nothing and leaves the current canvas alone.
   */
  images: ReadonlySet<string> | undefined
}

/** Catalogue state before the browser has read anything from the Host. */
export const UNREAD_BACKGROUND_CATALOGUES: BackgroundCatalogues = Object.freeze({ images: undefined })

/**
 * What the document should carry for one selection.
 *
 * - `none` — nothing this plugin installs. The harness's own background stands,
 *   which is what the `none` preset and a deleted upload both resolve to.
 * - `values` — install these canvas values.
 * - `unresolved` — the selection names a stored image and the catalogue that
 *   would prove it is there has not been read. A caller keeps what the document
 *   already carries rather than replacing a correct background with a guess.
 */
export type BackgroundProjection =
  | { readonly kind: 'none' }
  | { readonly kind: 'values', readonly values: ColorSchemeValue }
  | { readonly kind: 'unresolved' }

/**
 * Resolve a selection to the background to install.
 *
 * Total over what the settings service can deliver: an id that names nothing
 * yields the harness's background rather than an error, so a deleted image or a
 * preset this build dropped degrades to the interface the harness shipped
 * instead of a blank canvas.
 * @param settings - selection read from the settings document.
 * @param catalogues - dynamic catalogues currently known.
 * @returns what the document should carry for this selection.
 */
export function resolveBackgroundProjection(
  settings: BackgroundSettings,
  catalogues: BackgroundCatalogues,
  policy: RemotePolicy = STRICT_REMOTE_POLICY,
): BackgroundProjection {
  switch (settings.source) {
    case 'preset': {
      if (!isBackgroundPresetId(settings.id)) return { kind: 'none' }
      const values = backgroundPresetValue(settings.id)
      // The `none` preset is the harness's own background, and the only way to
      // install that background is to install nothing.
      return values.light === '' ? { kind: 'none' } : { kind: 'values', values }
    }
    case 'upload': {
      const images = catalogues.images
      if (images === undefined) return { kind: 'unresolved' }
      return images.has(settings.id)
        ? { kind: 'values', values: backgroundImageValue(settings.id) }
        : { kind: 'none' }
    }
    case 'remote': {
      // The browser loads this URL itself, so nothing here has to exist on the
      // Host; the policy is what decides whether the text may be painted.
      const verdict = judgeRemoteImageUrl(settings.url, policy)
      return verdict.kind === 'accepted'
        ? { kind: 'values', values: remoteImageValue(verdict.url) }
        : { kind: 'none' }
    }
    default:
      // The settings service admits only ids in BACKGROUND_SOURCES, so a third
      // case cannot reach here without a schema change that must also change
      // this switch. The harness background keeps a page rendering if that ever
      // drifts.
      return { kind: 'none' }
  }
}

/**
 * Judge whether a selection still names a background the user can get. What the
 * row reports, and more forgiving than {@link resolveBackgroundProjection}: an
 * `upload` selection counts as available until a read catalogue proves the file
 * gone.
 * @param settings - selection read from the settings document.
 * @param catalogues - dynamic catalogues currently known.
 * @returns whether the selection names a background that still exists.
 */
export function isBackgroundSelectionAvailable(
  settings: BackgroundSettings,
  catalogues: BackgroundCatalogues,
  policy: RemotePolicy = STRICT_REMOTE_POLICY,
): boolean {
  switch (settings.source) {
    case 'preset':
      return isBackgroundPresetId(settings.id)
    case 'upload':
      return catalogues.images === undefined || catalogues.images.has(settings.id)
    case 'remote':
      return judgeRemoteImageUrl(settings.url, policy).kind === 'accepted'
    default:
      return false
  }
}

/**
 * Resolve the background the first paint should carry.
 *
 * The Host renders the index before any browser has read the catalogue, and an
 * index render cannot await one, so a stored image is named optimistically:
 * the route either serves it or answers 404, which paints the harness's own
 * background rather than a wrong one. Everything else follows
 * {@link resolveBackgroundProjection}.
 * @param settings - selection read from the settings document.
 * @returns the canvas values to install, or undefined for the harness's own
 * background.
 */
export function resolveBootBackgroundValue(
  settings: BackgroundSettings,
  policy: RemotePolicy = STRICT_REMOTE_POLICY,
): ColorSchemeValue | undefined {
  if (settings.source === 'upload') {
    return isStoredBackgroundId(settings.id) ? backgroundImageValue(settings.id) : undefined
  }
  const projection = resolveBackgroundProjection(settings, UNREAD_BACKGROUND_CATALOGUES, policy)
  return projection.kind === 'values' ? projection.values : undefined
}
