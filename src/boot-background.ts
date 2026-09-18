/**
 * Host bootstrap rows for the browser's pre-plugin interval.
 *
 * The head stylesheet carries the canvas rule and the current background's
 * value for both palettes, so the first paint already shows the chosen
 * background. The body script then copies the values its palette resolved to
 * onto the `body` element as the properties the browser half writes later:
 * the theme service's presenter overwrites them when the plugin's own layer
 * arrives, and removes them when it retracts, so a background the user clears
 * in this session cannot come back from the served page.
 * @module dsh-plugin-ui-background-image/boot-background
 */

import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import {
  BACKGROUND_CANVAS_RULE,
  BACKGROUND_IMAGE_VARIABLE,
  SIDEBAR_FILL_PROPERTY,
  sidebarFillValue,
  SURFACE_BACKGROUND_PROPERTY,
  surfaceValue,
  type ColorSchemeValue,
} from './background-canvas.ts'
import { sidebarAlphaPercent, surfaceAlphaPercent } from './background-opacity.ts'
import { resolveBootBackgroundValue } from './background-selection.ts'
import { STRICT_REMOTE_POLICY, type RemotePolicy } from './background-remote.ts'
import type { BackgroundSettings } from './background-settings.ts'

/**
 * Custom properties the bootstrap stylesheet resolves per palette, so the body
 * script needs no copy of the palette decision itself.
 */
const BOOT_IMAGE_VARIABLE = '--dsh-ui-boot-image'
const BOOT_SURFACE_VARIABLE = '--dsh-ui-boot-surface'
const BOOT_SIDEBAR_VARIABLE = '--dsh-ui-boot-sidebar'

/**
 * Build the body script. It reads the values the head rule already resolved for
 * the active palette and writes them where the browser half will write its own,
 * so the two writers name the same properties and the retraction that follows a
 * cleared background removes the bootstrap's write with it.
 * @returns the script row text.
 */
function bootBackgroundScript(): string {
  return `(() => {
  const resolved = getComputedStyle(document.body)
  const values = [
    [${JSON.stringify(BACKGROUND_IMAGE_VARIABLE)}, ${JSON.stringify(BOOT_IMAGE_VARIABLE)}],
    [${JSON.stringify(SURFACE_BACKGROUND_PROPERTY)}, ${JSON.stringify(BOOT_SURFACE_VARIABLE)}],
    [${JSON.stringify(SIDEBAR_FILL_PROPERTY)}, ${JSON.stringify(BOOT_SIDEBAR_VARIABLE)}],
  ]
  for (const [property, source] of values) {
    const value = resolved.getPropertyValue(source).trim()
    if (value !== '') document.body.style.setProperty(property, value)
  }
})()`
}

/**
 * Render one mode's three boot values.
 * @param image - canvas value to paint.
 * @param surface - surface override that lets the canvas show.
 * @param sidebar - sidebar override, which opens a column the surface cannot.
 * @returns the declaration list for one selector.
 */
function bootDeclarations(image: string, surface: string, sidebar: string): string {
  return `${BOOT_IMAGE_VARIABLE}:${image};${BOOT_SURFACE_VARIABLE}:${surface};${BOOT_SIDEBAR_VARIABLE}:${sidebar}`
}

/**
 * Build the head stylesheet: the canvas rule, then this mode's values.
 * @param image - canvas background-image value to paint.
 * @param surface - surface override that lets the canvas show.
 * @param sidebar - sidebar override that lets the column show.
 * @returns the stylesheet text.
 */
function bootBackgroundStyle(image: ColorSchemeValue, surface: ColorSchemeValue, sidebar: ColorSchemeValue): string {
  return BACKGROUND_CANVAS_RULE
    + `body{${bootDeclarations(image.light, surface.light, sidebar.light)}}`
    + `body[data-ds-dark-theme]{${bootDeclarations(image.dark, surface.dark, sidebar.dark)}}`
}

/**
 * Build the rows that paint the selected background before the shell mounts.
 * @param settings - current Host-backed selection, already validated.
 * @param policy - remote policy this deployment applies.
 * @returns the head row followed by the body script, or no rows when the
 * selection installs no background.
 */
export function bootBackgroundInjections(
  settings: BackgroundSettings,
  policy: RemotePolicy = STRICT_REMOTE_POLICY,
): IndexInjection[] {
  const image = resolveBootBackgroundValue(settings, policy)
  if (image === undefined) return []
  return [
    {
      kind: 'style',
      text: bootBackgroundStyle(
        image,
        surfaceValue(surfaceAlphaPercent(settings.opacity)),
        sidebarFillValue(sidebarAlphaPercent(settings.opacity)),
      ),
    },
    { kind: 'script', placement: 'body', text: bootBackgroundScript() },
  ]
}
