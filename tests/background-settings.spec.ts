import { describe, expect, it } from 'vitest'
import { BACKGROUND_DELETE_ROUTE, BACKGROUND_IMAGE_ROUTE } from '../src/background-api.ts'
import { DEFAULT_BACKGROUND_OPACITY } from '../src/background-opacity.ts'
import { DEFAULT_BACKGROUND_PRESET_ID } from '../src/background-presets.ts'
import {
  BACKGROUND_ID_FIELD,
  BACKGROUND_OPACITY_FIELD,
  BACKGROUND_SETTINGS_NAMESPACE,
  BACKGROUND_SOURCE_FIELD,
  BACKGROUND_SOURCES,
  DEFAULT_BACKGROUND_SETTINGS,
  DEFAULT_BACKGROUND_SOURCE,
  isStoredBackgroundId,
  validateBackgroundSettings,
  type BackgroundSettings,
} from '../src/background-settings.ts'
import { BackgroundSettingsSchema } from '../src/background-settings-schema.ts'

/** One stored image id in the shape this plugin's directory mints. */
const STORED_ID = 'sunset-a1b2c3d4e5f6a7b8.png'

/**
 * Resolve one settings section the way the settings service does.
 * @param section - raw fields as a settings document would hold them, which is
 * what the schema exists to narrow; callers here deliberately hand it partial
 * and ill-typed documents.
 * @returns the resolved selection.
 */
function resolve(section: Record<string, unknown>): BackgroundSettings {
  return BackgroundSettingsSchema(section as unknown as BackgroundSettings)
}

describe('background settings schema', () => {
  it('resolves an absent section to the default selection', () => {
    expect(resolve({})).toEqual(DEFAULT_BACKGROUND_SETTINGS)
  })

  it('fills only the field a document omitted', () => {
    expect(resolve({ [BACKGROUND_SOURCE_FIELD]: 'upload' }))
      .toEqual({
        source: 'upload',
        id: DEFAULT_BACKGROUND_SETTINGS.id,
        opacity: DEFAULT_BACKGROUND_OPACITY,
        url: '',
      })
    expect(resolve({ [BACKGROUND_OPACITY_FIELD]: 20 }))
      .toEqual({ source: DEFAULT_BACKGROUND_SOURCE, id: DEFAULT_BACKGROUND_PRESET_ID, opacity: 20, url: '' })
  })

  it('accepts every declared catalogue', () => {
    for (const source of BACKGROUND_SOURCES) {
      expect(resolve({ [BACKGROUND_SOURCE_FIELD]: source, [BACKGROUND_ID_FIELD]: 'x' }).source).toBe(source)
    }
  })

  it('refuses a catalogue this build does not declare', () => {
    expect(() => resolve({ [BACKGROUND_SOURCE_FIELD]: 'network' })).toThrow()
  })

  it('refuses an opacity outside the range it could apply', () => {
    expect(() => resolve({ [BACKGROUND_OPACITY_FIELD]: -1 })).toThrow()
    expect(() => resolve({ [BACKGROUND_OPACITY_FIELD]: 101 })).toThrow()
  })

  it('refuses a fraction of a percent, the way the section validation does', () => {
    // The control moves in whole percents, so a document holding a fraction is
    // one this plugin could not have written and will not act on.
    expect(() => resolve({ [BACKGROUND_OPACITY_FIELD]: 64.5 })).toThrow()
  })
})

describe('the default selection', () => {
  it('is the harness background, so a fresh install looks untouched', () => {
    expect(DEFAULT_BACKGROUND_SETTINGS).toEqual({
      source: 'preset',
      id: 'none',
      opacity: DEFAULT_BACKGROUND_OPACITY,
      url: '',
    })
  })

  it('is frozen, so no consumer can edit the value every other one reads', () => {
    expect(Object.isFrozen(DEFAULT_BACKGROUND_SETTINGS)).toBe(true)
  })

  it('sits inside the namespace this plugin registers', () => {
    expect(BACKGROUND_SETTINGS_NAMESPACE).toBe('ui-background-image')
  })
})

describe('isStoredBackgroundId', () => {
  it('accepts a name the plugin directory itself mints', () => {
    expect(isStoredBackgroundId(STORED_ID)).toBe(true)
  })

  it('accepts a readable name a user copied in by hand', () => {
    expect(isStoredBackgroundId('My Sunset (2026).jpeg')).toBe(true)
  })

  it('refuses an empty id and the two directory walks', () => {
    expect(isStoredBackgroundId('')).toBe(false)
    expect(isStoredBackgroundId('.')).toBe(false)
    expect(isStoredBackgroundId('..')).toBe(false)
  })

  it('refuses a name that could leave the directory', () => {
    expect(isStoredBackgroundId('../secrets.png')).toBe(false)
    expect(isStoredBackgroundId('nested/sunset.png')).toBe(false)
    expect(isStoredBackgroundId('nested\\sunset.png')).toBe(false)
  })

  it('refuses a name whose extension this plugin does not accept', () => {
    expect(isStoredBackgroundId('sunset.svg')).toBe(false)
    expect(isStoredBackgroundId('sunset')).toBe(false)
    // The staging suffix a write leaves behind is not an id either.
    expect(isStoredBackgroundId(`${STORED_ID}.staging`)).toBe(false)
  })

  it('refuses a character that would end the CSS string or the element carrying it', () => {
    for (const character of ['"', "'", '\\', '<', '>', '{', '}', ';']) {
      expect(isStoredBackgroundId(`sunset${character}.png`), `accepted ${character}`).toBe(false)
    }
  })

  it('refuses a control character, which would end the line the id is written on', () => {
    expect(isStoredBackgroundId('sunset\n.png')).toBe(false)
    expect(isStoredBackgroundId('sunset\u007f.png')).toBe(false)
    expect(isStoredBackgroundId('sunset\u009c.png')).toBe(false)
  })
})

describe('validateBackgroundSettings', () => {
  it('accepts a shipped preset', () => {
    expect(() => { validateBackgroundSettings({ source: 'preset', id: 'dusk', opacity: 65, url: '' }) }).not.toThrow()
  })

  it('accepts a stored image name', () => {
    expect(() => { validateBackgroundSettings({ source: 'upload', id: STORED_ID, opacity: 0, url: '' }) }).not.toThrow()
  })

  it('refuses an empty id', () => {
    expect(() => { validateBackgroundSettings({ source: 'preset', id: '', opacity: 65, url: '' }) })
      .toThrow(/must not be empty/)
  })

  it('refuses a preset this build does not ship', () => {
    expect(() => { validateBackgroundSettings({ source: 'preset', id: 'comic', opacity: 65, url: '' }) })
      .toThrow(/names no shipped background preset/)
  })

  it('refuses an upload id the Host directory could not hold', () => {
    expect(() => { validateBackgroundSettings({ source: 'upload', id: '../x.png', opacity: 65, url: '' }) })
      .toThrow(/not a usable stored image id/)
  })

  it('refuses an opacity the token could not carry', () => {
    expect(() => { validateBackgroundSettings({ source: 'preset', id: 'dusk', opacity: 64.5, url: '' }) })
      .toThrow(/must be a whole percent/)
    expect(() => { validateBackgroundSettings({ source: 'preset', id: 'dusk', opacity: 101, url: '' }) })
      .toThrow(/must be a whole percent/)
  })

  it('names the namespace and the field it refused', () => {
    expect(() => { validateBackgroundSettings({ source: 'preset', id: 'comic', opacity: 65, url: '' }) })
      .toThrow(new RegExp(`^${BACKGROUND_SETTINGS_NAMESPACE}\\.${BACKGROUND_ID_FIELD}`))
  })
})

describe('the collection route the canvas points at', () => {
  it('is the prefix every stored image is served under', () => {
    // The shared API channel carries exact paths only, so an image is named by
    // a query parameter and deleting one is a POST to an action path.
    expect(BACKGROUND_IMAGE_ROUTE).toBe('/api/ui-background-image/image')
    expect(BACKGROUND_DELETE_ROUTE).toBe('/api/ui-background-image/delete')
  })
})

describe('a remote selection', () => {
  it('accepts an https URL and no id', () => {
    expect(() => {
      validateBackgroundSettings({ source: 'remote', id: '', opacity: 65, url: 'https://cdn.example.com/a.png' })
    }).not.toThrow()
  })

  it('refuses a remote selection that also carries an id', () => {
    expect(() => {
      validateBackgroundSettings({ source: 'remote', id: 'mist', opacity: 65, url: 'https://cdn.example.com/a.png' })
    }).toThrow(/id must be empty for a remote background/)
  })

  it('refuses every URL the text policy refuses, naming the reason', () => {
    const refused = [
      ['http://cdn.example.com/a.png', /not a usable image URL \(scheme\)/],
      ['https://user:secret@cdn.example.com/a.png', /not a usable image URL \(credentials\)/],
      ['https://127.0.0.1/a.png', /not a usable image URL \(literal\)/],
      ['https://localhost/a.png', /not a usable image URL \(reserved\)/],
      ['not a url', /not a usable image URL \(url\)/],
    ] as const
    for (const [url, expected] of refused) {
      expect(() => { validateBackgroundSettings({ source: 'remote', id: '', opacity: 65, url }) }).toThrow(expected)
    }
  })

  it('refuses a URL on a selection that is not remote', () => {
    expect(() => {
      validateBackgroundSettings({ source: 'preset', id: 'mist', opacity: 65, url: 'https://cdn.example.com/a.png' })
    }).toThrow(/belongs to a remote background/)
  })
})
