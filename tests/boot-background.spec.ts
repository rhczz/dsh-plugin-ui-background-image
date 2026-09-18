/**
 * The rows the Host renders into the served page: what a chosen background puts
 * there, and what it leaves out.
 * @module dsh-plugin-ui-background-image/tests/boot-background
 */

import { describe, expect, it } from 'vitest'
import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import { BACKGROUND_IMAGE_ROUTE } from '../src/background-api.ts'
import {
  BACKGROUND_CANVAS_RULE,
  BACKGROUND_IMAGE_VARIABLE,
  SIDEBAR_FILL_PROPERTY,
  SURFACE_BACKGROUND_PROPERTY,
} from '../src/background-canvas.ts'
import { backgroundPresetValue } from '../src/background-presets.ts'
import type { BackgroundSettings } from '../src/background-settings.ts'
import { bootBackgroundInjections } from '../src/boot-background.ts'

/** One stored image id in the shape this plugin's directory mints. */
const STORED_ID = 'sunset-a1b2c3d4e5f6a7b8.png'

/**
 * Read the rows one selection contributes.
 * @param settings - selection to render.
 * @returns the rows, in table order.
 */
function rows(settings: BackgroundSettings): IndexInjection[] {
  return bootBackgroundInjections(settings)
}

/**
 * Read the head stylesheet out of a row set.
 * @param table - rows one selection contributed.
 * @returns the stylesheet text.
 */
function styleText(table: readonly IndexInjection[]): string {
  const row = table.find(entry => entry.kind === 'style')
  if (row?.kind !== 'style') throw new Error('no stylesheet row')
  return row.text
}

/**
 * Read the body script out of a row set.
 * @param table - rows one selection contributed.
 * @returns the script text.
 */
function scriptText(table: readonly IndexInjection[]): string {
  const row = table.find(entry => entry.kind === 'script')
  if (row?.kind !== 'script') throw new Error('no script row')
  return row.text
}

describe('a background the harness already ships', () => {
  it('contributes no rows at all', () => {
    // Installing nothing is the only way to leave the harness's own background
    // in place, so the page it serves is the page it would have served without
    // this plugin.
    expect(rows({ source: 'preset', id: 'none', opacity: 65, url: '' })).toEqual([])
    expect(rows({ source: 'preset', id: 'comic', opacity: 65, url: '' })).toEqual([])
  })
})

describe('a shipped preset', () => {
  const table = rows({ source: 'preset', id: 'dusk', opacity: 65, url: '' })

  it('paints the canvas before any script runs', () => {
    expect(table[0]?.kind).toBe('style')
    expect(styleText(table)).toContain(BACKGROUND_CANVAS_RULE)
  })

  it('carries this preset\u2019s own value for each palette', () => {
    const layer = backgroundPresetValue('dusk')
    const text = styleText(table)
    expect(text).toContain(layer.light)
    expect(text).toContain(layer.dark)
    expect(text).toContain('body[data-ds-dark-theme]')
  })

  it('opens the surfaces by exactly the alpha the user\u2019s opacity asks for', () => {
    // The value reaches the surfaces through the variable the body script
    // copies, so the two palettes each carry their own base colour at 58%.
    expect(styleText(table)).toContain('--dsh-ui-boot-surface:color-mix(in srgb, var(--dsw-static-neutral-bluish-00) 58%, transparent)')
    expect(styleText(table)).toContain('var(--dsw-static-neutral-bluish-950) 58%, transparent')
  })

  it('writes the properties where the browser half will write its own', () => {
    // Same names, so the retraction that follows a cleared background removes
    // this row's write with it.
    const text = scriptText(table)
    expect(text).toContain(JSON.stringify(BACKGROUND_IMAGE_VARIABLE))
    expect(text).toContain(JSON.stringify(SURFACE_BACKGROUND_PROPERTY))
    expect(text).toContain(JSON.stringify(SIDEBAR_FILL_PROPERTY))
  })

  it('opens the sidebar column before the shell mounts', () => {
    // The column is opaque on its own, so a first paint without this value
    // would show the background everywhere but the interface's left half.
    const text = styleText(table)
    expect(text).toContain('--dsh-ui-boot-sidebar:color-mix(in srgb, var(--dsw-static-neutral-bluish-50) 35%, transparent)')
    expect(text).toContain('var(--dsw-static-neutral-bluish-900) 35%, transparent')
  })

  it('runs after the palette attribute is decided, so it reads the serving mode', () => {
    expect(table[1]?.kind).toBe('script')
    expect(table[1]?.kind === 'script' && table[1].placement).toBe('body')
    expect(scriptText(table)).toContain('getComputedStyle(document.body)')
  })

  it('reads the mode-specific values from the stylesheet rather than deciding the mode itself', () => {
    const text = scriptText(table)
    expect(text).toContain('--dsh-ui-boot-image')
    expect(text).toContain('--dsh-ui-boot-surface')
    expect(text).toContain('--dsh-ui-boot-sidebar')
    expect(text).not.toContain('data-ds-dark-theme')
  })
})

describe('a stored image', () => {
  it('names its route optimistically, because an index render cannot await a catalogue', () => {
    const text = styleText(rows({ source: 'upload', id: STORED_ID, opacity: 40, url: '' }))
    expect(text).toContain(`url("${BACKGROUND_IMAGE_ROUTE}?id=${STORED_ID}")`)
  })

  it('carries the opacity the document holds', () => {
    expect(styleText(rows({ source: 'upload', id: STORED_ID, opacity: 100, url: '' })))
      .toContain('36%, transparent')
  })

  it('contributes nothing for an id the directory could not hold', () => {
    expect(rows({ source: 'upload', id: '../secrets.png', opacity: 65, url: '' })).toEqual([])
  })
})

describe('the rows themselves', () => {
  it('close neither the style element nor the script element early', () => {
    for (const settings of [
      { source: 'preset', id: 'mist', opacity: 65, url: '' },
      { source: 'upload', id: STORED_ID, opacity: 65, url: '' },
    ] satisfies BackgroundSettings[]) {
      const table = rows(settings)
      expect(styleText(table)).not.toContain('</style')
      expect(scriptText(table)).not.toContain('</script')
    }
  })

  it('leave nothing applied when the whole set is skipped', () => {
    expect(rows({ source: 'preset', id: 'none', opacity: 65, url: '' })).toHaveLength(0)
  })
})

describe('a remote selection', () => {
  it('paints the URL before the shell mounts, without reading a catalogue', () => {
    const text = styleText(rows({ source: 'remote', id: '', opacity: 65, url: 'https://cdn.example.com/a.png' }))
    expect(text).toContain('url("https://cdn.example.com/a.png")')
  })

  it('paints the harness background for a URL this plugin does not load', () => {
    expect(rows({ source: 'remote', id: '', opacity: 65, url: 'http://cdn.example.com/a.png' })).toEqual([])
  })
})
