import { describe, expect, it } from 'vitest'
import {
  acceptedBackgroundFileExtension,
  BACKGROUND_CONTENT_TYPES,
  BACKGROUND_FILE_EXTENSIONS,
  backgroundFileExtension,
  isBackgroundFileName,
} from '../src/background-formats.ts'

describe('backgroundFileExtension', () => {
  it('reads the lower-case extension of a name', () => {
    expect(backgroundFileExtension('Sunset.PNG')).toBe('.png')
    expect(backgroundFileExtension('/tmp/a.b/sunset.webp')).toBe('.webp')
  })

  it('reports no extension for a name that has none', () => {
    expect(backgroundFileExtension('sunset')).toBeUndefined()
    expect(backgroundFileExtension('.hidden')).toBeUndefined()
  })
})

describe('acceptedBackgroundFileExtension', () => {
  it('accepts every declared extension', () => {
    for (const extension of BACKGROUND_FILE_EXTENSIONS) {
      expect(acceptedBackgroundFileExtension(`sunset${extension}`)).toBe(extension)
    }
  })

  it('refuses an extension this plugin does not accept', () => {
    expect(acceptedBackgroundFileExtension('sunset.svg')).toBeUndefined()
    expect(acceptedBackgroundFileExtension('sunset.png.txt')).toBeUndefined()
  })
})

describe('isBackgroundFileName', () => {
  it('judges a name by its extension', () => {
    expect(isBackgroundFileName('sunset.jpeg')).toBe(true)
    expect(isBackgroundFileName('sunset')).toBe(false)
  })
})

describe('the accepted formats', () => {
  it('serves every accepted extension with the media type of its container', () => {
    for (const extension of BACKGROUND_FILE_EXTENSIONS) {
      expect(BACKGROUND_CONTENT_TYPES[extension]).toMatch(/^image\//)
    }
    // Both JPEG spellings name the same container, so they share one type.
    expect(BACKGROUND_CONTENT_TYPES['.jpg']).toBe(BACKGROUND_CONTENT_TYPES['.jpeg'])
  })

  it('leaves no extension of the list without a media type', () => {
    expect(Object.keys(BACKGROUND_CONTENT_TYPES).sort()).toEqual([...BACKGROUND_FILE_EXTENSIONS].sort())
  })
})
