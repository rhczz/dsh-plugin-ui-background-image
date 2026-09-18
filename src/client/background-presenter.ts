/**
 * The single writer of this plugin's background on the document: the canvas rule
 * it owns outright, and the token layer it hands to the theme service.
 *
 * The two writes exist because the harness offers exactly one seam for each.
 * A `background-image` on the document canvas is not a theme token, so the rule
 * is this plugin's own stylesheet; the surface alpha *is* a theme token
 * (`--dsw-alias-bg-base` for the surfaces, `--dsw-specific-sidebar-fill` for the
 * sidebar column), so they go through `ctx.theme.overrideTokens`, which keeps one
 * layer per source and replaces it on every call. Everything this
 * class writes is retracted on disposal, so disabling the plugin restores the
 * interface the harness shipped.
 * @module dsh-plugin-ui-background-image/client/background-presenter
 */

import type { ThemeRuntime } from '@deepseek-ai/dsh-client-ui-theme/client'
import {
  BACKGROUND_CANVAS_RULE,
  BACKGROUND_CANVAS_STYLE_ID,
  BACKGROUND_IMAGE_VARIABLE,
  SIDEBAR_FILL_PROPERTY,
  sidebarFillValue,
  SURFACE_BACKGROUND_PROPERTY,
  surfaceValue,
  type ColorSchemeValue,
} from '../background-canvas.ts'
import { sidebarAlphaPercent, surfaceAlphaPercent } from '../background-opacity.ts'

/** Layer identity; one layer per source, so a re-apply replaces rather than stacks. */
export const BACKGROUND_LAYER_SOURCE = 'dsh-plugin-ui-background-image'

/** The slice of the theme service this presenter writes through. */
export type ThemeTokenWriter = Pick<ThemeRuntime, 'overrideTokens'>

/** Paints the document canvas and lowers the surfaces that draw over it. */
export class BackgroundPresenter {
  private readonly theme: ThemeTokenWriter
  private element: HTMLStyleElement | undefined
  private retractLayer: (() => void) | undefined

  /**
   * @param theme - the client theme service; it owns the token write.
   */
  constructor(theme: ThemeTokenWriter) {
    this.theme = theme
  }

  /**
   * Install the canvas rule, adopting the element the Host already rendered
   * when there is one, and hand back the disposer that removes every write this
   * presenter makes.
   * @returns the disposer owned by the caller's effect.
   */
  start(): () => void {
    // The rule is installed before anything is projected: it is inert while no
    // background is chosen, and having it in place means the first projection
    // paints on the frame it is made rather than one later.
    this.element = this.ensureElement()
    this.element.textContent = BACKGROUND_CANVAS_RULE
    return () => { this.dispose() }
  }

  /**
   * Install one background, or clear this plugin's writes when the selection
   * asks for the harness's own background.
   * @param values - canvas value per colour scheme to install, or undefined to
   * reveal the harness's own background.
   * @param opacity - the user's opacity, which sets how far the surfaces open.
   */
  install(values: ColorSchemeValue | undefined, opacity: number): void {
    if (values === undefined) {
      this.retract()
      return
    }
    this.retractLayer = this.theme.overrideTokens(BACKGROUND_LAYER_SOURCE, {
      [BACKGROUND_IMAGE_VARIABLE]: values,
      [SURFACE_BACKGROUND_PROPERTY]: surfaceValue(surfaceAlphaPercent(opacity)),
      // The sidebar is a column of its own fill rather than a card on the base
      // surface, so it needs its own alpha to show the background at all.
      [SIDEBAR_FILL_PROPERTY]: sidebarFillValue(sidebarAlphaPercent(opacity)),
    })
  }

  /**
   * Remove this plugin's layer, its own earlier writes on `body`, and the canvas
   * rule element.
   *
   * The `body` properties are removed *before* the layer is retracted: while a
   * layer stands they are this plugin's own values, and with no layer they are
   * the first-paint row's, which the theme service knows nothing about. Removing
   * them first means the retraction that follows republishes the folded snapshot
   * — another plugin's override of the same token included — over a clean slate.
   */
  private retract(): void {
    document.body.style.removeProperty(BACKGROUND_IMAGE_VARIABLE)
    document.body.style.removeProperty(SURFACE_BACKGROUND_PROPERTY)
    document.body.style.removeProperty(SIDEBAR_FILL_PROPERTY)
    this.retractLayer?.()
    this.retractLayer = undefined
  }

  /** Remove everything this presenter wrote, including the canvas rule. */
  dispose(): void {
    this.retract()
    this.element?.remove()
    this.element = undefined
    const rendered = document.getElementById(BACKGROUND_CANVAS_STYLE_ID)
    if (rendered instanceof HTMLStyleElement) rendered.remove()
  }

  /**
   * @returns the element to write, adopting the Host's own canvas rule when it
   * is already in the document.
   */
  private ensureElement(): HTMLStyleElement {
    if (this.element !== undefined) return this.element
    const existing = document.getElementById(BACKGROUND_CANVAS_STYLE_ID)
    const element = existing instanceof HTMLStyleElement ? existing : document.createElement('style')
    if (element !== existing) {
      element.id = BACKGROUND_CANVAS_STYLE_ID
      document.head.append(element)
    }
    return element
  }
}
