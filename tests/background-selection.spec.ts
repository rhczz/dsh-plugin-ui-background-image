import { describe, expect, it } from 'vitest'
import { BACKGROUND_IMAGE_ROUTE } from '../src/background-api.ts'
import type { ColorSchemeValue } from '../src/background-canvas.ts'
import { backgroundPresetValue } from '../src/background-presets.ts'
import type { BackgroundSettings } from '../src/background-settings.ts'
import {
  isBackgroundSelectionAvailable,
  resolveBackgroundProjection,
  resolveBootBackgroundValue,
  UNREAD_BACKGROUND_CATALOGUES,
  type BackgroundCatalogues,
} from '../src/background-selection.ts'

/** One stored image id in the shape this plugin's directory mints. */
const STORED_ID = 'sunset-a1b2c3d4e5f6a7b8.png'

/** Catalogue naming one stored file. */
const WITH_IMAGE: BackgroundCatalogues = { images: new Set([STORED_ID]) }

/** Catalogue that has been read and does not hold the selection. */
const EMPTY_CATALOGUE: BackgroundCatalogues = { images: new Set() }

/** A selection the schema would refuse, standing in for a document that drifted. */
function foreign(source: string, id: string): BackgroundSettings {
  return { source, id, opacity: 65, url: '' } as unknown as BackgroundSettings
}

describe('resolveBackgroundProjection', () => {
  it('installs the canvas a shipped preset names', () => {
    expect(resolveBackgroundProjection({ source: 'preset', id: 'dusk', opacity: 65, url: '' }, UNREAD_BACKGROUND_CATALOGUES))
      .toEqual({ kind: 'values', values: backgroundPresetValue('dusk') })
  })

  it('installs nothing for the preset that names the harness background', () => {
    // `none` is the harness's own background, and the only way to install that
    // background is to install nothing.
    expect(resolveBackgroundProjection({ source: 'preset', id: 'none', opacity: 65, url: '' }, UNREAD_BACKGROUND_CATALOGUES))
      .toEqual({ kind: 'none' })
  })

  it('installs nothing for a preset this build dropped', () => {
    expect(resolveBackgroundProjection({ source: 'preset', id: 'comic', opacity: 65, url: '' }, UNREAD_BACKGROUND_CATALOGUES))
      .toEqual({ kind: 'none' })
  })

  it('resolves a preset without consulting the catalogue', () => {
    expect(resolveBackgroundProjection({ source: 'preset', id: 'mist', opacity: 65, url: '' }, WITH_IMAGE))
      .toEqual(resolveBackgroundProjection({ source: 'preset', id: 'mist', opacity: 65, url: '' }, UNREAD_BACKGROUND_CATALOGUES))
  })

  it('waits for the catalogue before resolving a stored image', () => {
    // An unread catalogue proves nothing: resolving it to the default would
    // replace the background the Host already painted with a guess.
    expect(resolveBackgroundProjection({ source: 'upload', id: STORED_ID, opacity: 65, url: '' }, UNREAD_BACKGROUND_CATALOGUES))
      .toEqual({ kind: 'unresolved' })
  })

  it('points the canvas at the route that serves a stored image', () => {
    const projection = resolveBackgroundProjection({ source: 'upload', id: STORED_ID, opacity: 65, url: '' }, WITH_IMAGE)
    const values: ColorSchemeValue = {
      light: `url("${BACKGROUND_IMAGE_ROUTE}?id=${STORED_ID}")`,
      dark: `url("${BACKGROUND_IMAGE_ROUTE}?id=${STORED_ID}")`,
    }
    expect(projection).toEqual({ kind: 'values', values })
  })

  it('installs nothing once a read catalogue proves the file gone', () => {
    expect(resolveBackgroundProjection({ source: 'upload', id: STORED_ID, opacity: 65, url: '' }, EMPTY_CATALOGUE))
      .toEqual({ kind: 'none' })
  })

  it('falls back to the harness background for a catalogue it does not know', () => {
    // The selection crosses two files this build does not own — settings.yaml
    // and the Host's answer — so a source outside the union is a value that can
    // arrive, and the canvas has to fall back rather than vanish.
    expect(resolveBackgroundProjection(foreign('network', 'x'), WITH_IMAGE)).toEqual({ kind: 'none' })
  })
})

describe('resolveBootBackgroundValue', () => {
  it('paints the canvas a shipped preset names', () => {
    expect(resolveBootBackgroundValue({ source: 'preset', id: 'ember', opacity: 65, url: '' }))
      .toEqual(backgroundPresetValue('ember'))
  })

  it('paints nothing for the harness background', () => {
    expect(resolveBootBackgroundValue({ source: 'preset', id: 'none', opacity: 65, url: '' })).toBeUndefined()
    expect(resolveBootBackgroundValue({ source: 'preset', id: 'comic', opacity: 65, url: '' })).toBeUndefined()
  })

  it('names a stored image optimistically, because an index render cannot await a catalogue', () => {
    // The route either serves the file or answers 404, which paints the
    // harness's background rather than a wrong one.
    const values: ColorSchemeValue = {
      light: `url("${BACKGROUND_IMAGE_ROUTE}?id=${STORED_ID}")`,
      dark: `url("${BACKGROUND_IMAGE_ROUTE}?id=${STORED_ID}")`,
    }
    expect(resolveBootBackgroundValue({ source: 'upload', id: STORED_ID, opacity: 65, url: '' })).toEqual(values)
  })

  it('paints nothing for a stored id the Host directory could not hold', () => {
    expect(resolveBootBackgroundValue({ source: 'upload', id: '../x.png', opacity: 65, url: '' })).toBeUndefined()
  })
})

describe('isBackgroundSelectionAvailable', () => {
  it('reports a shipped preset as available', () => {
    expect(isBackgroundSelectionAvailable({ source: 'preset', id: 'mist', opacity: 65, url: '' }, UNREAD_BACKGROUND_CATALOGUES))
      .toBe(true)
  })

  it('reports an id this build does not ship as unavailable', () => {
    expect(isBackgroundSelectionAvailable({ source: 'preset', id: 'comic', opacity: 65, url: '' }, UNREAD_BACKGROUND_CATALOGUES))
      .toBe(false)
  })

  it('waits for the catalogue before calling a stored image missing', () => {
    const selection: BackgroundSettings = { source: 'upload', id: STORED_ID, opacity: 65, url: '' }
    expect(isBackgroundSelectionAvailable(selection, UNREAD_BACKGROUND_CATALOGUES)).toBe(true)
    expect(isBackgroundSelectionAvailable(selection, WITH_IMAGE)).toBe(true)
    expect(isBackgroundSelectionAvailable(selection, EMPTY_CATALOGUE)).toBe(false)
  })

  it('calls a catalogue it does not know unavailable', () => {
    expect(isBackgroundSelectionAvailable(foreign('sepia', 'old-paper'), WITH_IMAGE)).toBe(false)
  })
})

describe('the unread catalogue', () => {
  it('carries no images and is frozen', () => {
    expect(UNREAD_BACKGROUND_CATALOGUES.images).toBeUndefined()
    expect(Object.isFrozen(UNREAD_BACKGROUND_CATALOGUES)).toBe(true)
  })
})

describe('a remote selection', () => {
  it('installs the URL the browser loads itself', () => {
    const projection = resolveBackgroundProjection(
      { source: 'remote', id: '', opacity: 65, url: 'https://cdn.example.com/a.png' },
      UNREAD_BACKGROUND_CATALOGUES,
    )
    expect(projection).toEqual({
      kind: 'values',
      values: { light: 'url("https://cdn.example.com/a.png")', dark: 'url("https://cdn.example.com/a.png")' },
    })
  })

  it('normalizes the URL before it is painted', () => {
    const projection = resolveBackgroundProjection(
      { source: 'remote', id: '', opacity: 65, url: 'https://CDN.Example.com/a b.png' },
      UNREAD_BACKGROUND_CATALOGUES,
    )
    expect(projection.kind === 'values' && projection.values.light).toBe('url("https://cdn.example.com/a%20b.png")')
  })

  it('paints the harness background when the stored URL is not one this plugin loads', () => {
    for (const url of ['http://cdn.example.com/a.png', 'https://127.0.0.1/a.png', 'https://printer.local/a.png', '']) {
      expect(resolveBackgroundProjection(
        { source: 'remote', id: '', opacity: 65, url },
        UNREAD_BACKGROUND_CATALOGUES,
      )).toEqual({ kind: 'none' })
    }
  })

  it('needs no catalogue, so a remote background paints on the first frame', () => {
    expect(resolveBootBackgroundValue({ source: 'remote', id: '', opacity: 65, url: 'https://cdn.example.com/a.png' }))
      .toEqual({ light: 'url("https://cdn.example.com/a.png")', dark: 'url("https://cdn.example.com/a.png")' })
  })

  it('reports availability from the URL text alone', () => {
    const remote = (url: string): BackgroundSettings => ({ source: 'remote', id: '', opacity: 65, url })
    expect(isBackgroundSelectionAvailable(remote('https://cdn.example.com/a.png'), UNREAD_BACKGROUND_CATALOGUES))
      .toBe(true)
    expect(isBackgroundSelectionAvailable(remote('http://cdn.example.com/a.png'), UNREAD_BACKGROUND_CATALOGUES))
      .toBe(false)
  })
})
