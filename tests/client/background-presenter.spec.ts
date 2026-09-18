// @vitest-environment jsdom
/**
 * The plugin's document writer: the canvas rule it owns, the token layer it
 * hands the theme service, and the retraction that leaves the harness's own
 * background behind.
 * @module dsh-plugin-ui-background-image/tests/client/background-presenter
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  BACKGROUND_CANVAS_RULE,
  BACKGROUND_CANVAS_STYLE_ID,
  BACKGROUND_IMAGE_VARIABLE,
  SIDEBAR_FILL_PROPERTY,
  sidebarFillValue,
  surfaceValue,
  SURFACE_BACKGROUND_PROPERTY,
} from '../../src/background-canvas.ts'
import { sidebarAlphaPercent, surfaceAlphaPercent } from '../../src/background-opacity.ts'
import { BACKGROUND_LAYER_SOURCE, BackgroundPresenter } from '../../src/client/background-presenter.ts'
import { FakeTheme } from './theme-stub.ts'

/** One canvas value pair, as a preset or a stored image would resolve to. */
const LAYER = {
  light: 'linear-gradient(rgb(245, 243, 255) 0%, rgb(233, 230, 251) 100%)',
  dark: 'linear-gradient(rgb(20, 16, 33) 0%, rgb(27, 21, 51) 100%)',
}

/** A second writer of the same surface token, standing in for a theme plugin. */
const OTHER_SOURCE = 'example-theme'
const OTHER_SURFACE = '#123456'

let theme: FakeTheme
let presenter: BackgroundPresenter

beforeEach(() => {
  theme = new FakeTheme()
  presenter = new BackgroundPresenter(theme.asService())
})

afterEach(() => {
  presenter.dispose()
  document.head.replaceChildren()
  document.body.removeAttribute('style')
})

/**
 * Read the element carrying the canvas rule.
 * @returns the element, or null when none is in the document.
 */
function canvasElement(): HTMLStyleElement | null {
  const element = document.getElementById(BACKGROUND_CANVAS_STYLE_ID)
  return element instanceof HTMLStyleElement ? element : null
}

describe('the canvas rule', () => {
  it('is installed when the presenter starts', () => {
    presenter.start()
    expect(canvasElement()?.textContent).toBe(BACKGROUND_CANVAS_RULE)
  })

  it('adopts the element the Host already rendered rather than adding a second rule', () => {
    const rendered = document.createElement('style')
    rendered.id = BACKGROUND_CANVAS_STYLE_ID
    rendered.textContent = 'body{background-image:url("stale")}'
    document.head.append(rendered)
    presenter.start()
    expect(document.querySelectorAll(`#${BACKGROUND_CANVAS_STYLE_ID}`)).toHaveLength(1)
    expect(rendered.textContent).toBe(BACKGROUND_CANVAS_RULE)
  })

  it('keeps writing the element it already owns when start runs twice', () => {
    presenter.start()
    const element = canvasElement()
    presenter.start()
    expect(canvasElement()).toBe(element)
  })

  it('leaves nothing in the document when the plugin unloads', () => {
    const stop = presenter.start()
    stop()
    expect(canvasElement()).toBeNull()
  })

  it('removes an element it never adopted, because the Host rendered it for this plugin', () => {
    // The served page carries the rule before any plugin runs; a presenter that
    // only removed what it created would leave the canvas painted forever.
    document.head.append(Object.assign(document.createElement('style'), {
      id: BACKGROUND_CANVAS_STYLE_ID,
      textContent: BACKGROUND_CANVAS_RULE,
    }))
    presenter.dispose()
    expect(canvasElement()).toBeNull()
  })

  it('survives a second disposal', () => {
    presenter.start()
    presenter.dispose()
    presenter.dispose()
    expect(canvasElement()).toBeNull()
  })
})

describe('installing a background', () => {
  it('writes the canvas and the surface through the theme service', () => {
    presenter.start()
    presenter.install(LAYER, 65)
    const layer = theme.layerFor(BACKGROUND_LAYER_SOURCE)
    expect(layer?.[BACKGROUND_IMAGE_VARIABLE]).toEqual(LAYER)
    expect(layer?.[SURFACE_BACKGROUND_PROPERTY]).toEqual(surfaceValue(surfaceAlphaPercent(65)))
  })

  it('opens the sidebar column, which paints a fill of its own', () => {
    presenter.start()
    presenter.install(LAYER, 65)
    const expected = sidebarFillValue(sidebarAlphaPercent(65))
    expect(theme.layerFor(BACKGROUND_LAYER_SOURCE)?.[SIDEBAR_FILL_PROPERTY]).toEqual(expected)
    expect(document.body.style.getPropertyValue(SIDEBAR_FILL_PROPERTY)).toBe(expected.light)
  })

  it('puts the values where the theme presenter writes them', () => {
    presenter.start()
    presenter.install(LAYER, 65)
    expect(document.body.style.getPropertyValue(BACKGROUND_IMAGE_VARIABLE)).toBe(LAYER.light)
    expect(document.body.style.getPropertyValue(SURFACE_BACKGROUND_PROPERTY))
      .toBe(surfaceValue(surfaceAlphaPercent(65)).light)
  })

  it('replaces its own layer rather than stacking a second one', () => {
    presenter.start()
    presenter.install(LAYER, 65)
    presenter.install({ ...LAYER, light: 'linear-gradient(red, blue)', dark: 'linear-gradient(black, navy)' }, 65)
    expect(theme.sources()).toEqual([BACKGROUND_LAYER_SOURCE])
    expect(theme.layerFor(BACKGROUND_LAYER_SOURCE)?.[BACKGROUND_IMAGE_VARIABLE]?.light)
      .toBe('linear-gradient(red, blue)')
  })

  it('opens the surfaces further as the user raises the opacity', () => {
    presenter.start()
    presenter.install(LAYER, 0)
    expect(document.body.style.getPropertyValue(SURFACE_BACKGROUND_PROPERTY)).toContain('100%, transparent')
    presenter.install(LAYER, 100)
    expect(document.body.style.getPropertyValue(SURFACE_BACKGROUND_PROPERTY)).toContain('36%, transparent')
  })
})

describe('clearing a background', () => {
  it('removes the layer and the writes this plugin made on the body', () => {
    presenter.start()
    presenter.install(LAYER, 65)
    presenter.install(undefined, 65)
    expect(theme.sources()).toEqual([])
    expect(document.body.style.getPropertyValue(BACKGROUND_IMAGE_VARIABLE)).toBe('')
    expect(document.body.style.getPropertyValue(SURFACE_BACKGROUND_PROPERTY)).toBe('')
    expect(document.body.style.getPropertyValue(SIDEBAR_FILL_PROPERTY)).toBe('')
  })

  it('removes the first-paint write when no layer was ever installed', () => {
    // The Host writes the same names before the theme service exists; nothing
    // but this presenter knows about that write.
    document.body.style.setProperty(BACKGROUND_IMAGE_VARIABLE, 'url("/api/old.png")')
    document.body.style.setProperty(SURFACE_BACKGROUND_PROPERTY, 'rgb(255, 255, 255)')
    document.body.style.setProperty(SIDEBAR_FILL_PROPERTY, 'rgb(249, 250, 251)')
    presenter.start()
    presenter.install(undefined, 65)
    expect(document.body.style.getPropertyValue(BACKGROUND_IMAGE_VARIABLE)).toBe('')
    expect(document.body.style.getPropertyValue(SURFACE_BACKGROUND_PROPERTY)).toBe('')
    expect(document.body.style.getPropertyValue(SIDEBAR_FILL_PROPERTY)).toBe('')
  })

  it('leaves another source surface value standing', () => {
    // The retraction removes this plugin's own write before dropping its layer,
    // so the value the theme service republishes for someone else survives.
    presenter.start()
    theme.overrideTokens(OTHER_SOURCE, {
      [SURFACE_BACKGROUND_PROPERTY]: { light: OTHER_SURFACE, dark: OTHER_SURFACE },
      [SIDEBAR_FILL_PROPERTY]: { light: OTHER_SURFACE, dark: OTHER_SURFACE },
    })
    presenter.install(LAYER, 65)
    expect(document.body.style.getPropertyValue(SURFACE_BACKGROUND_PROPERTY))
      .toBe(surfaceValue(surfaceAlphaPercent(65)).light)
    presenter.install(undefined, 65)
    expect(document.body.style.getPropertyValue(SURFACE_BACKGROUND_PROPERTY)).toBe(OTHER_SURFACE)
    expect(document.body.style.getPropertyValue(SIDEBAR_FILL_PROPERTY)).toBe(OTHER_SURFACE)
  })
})

describe('disposal', () => {
  it('removes the layer and the canvas rule together', () => {
    presenter.start()
    presenter.install(LAYER, 65)
    presenter.dispose()
    expect(theme.sources()).toEqual([])
    expect(canvasElement()).toBeNull()
    expect(document.body.style.getPropertyValue(BACKGROUND_IMAGE_VARIABLE)).toBe('')
  })
})
