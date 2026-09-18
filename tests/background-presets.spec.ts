import { describe, expect, it } from 'vitest'
import {
  BACKGROUND_PRESET_IDS,
  backgroundPresetValue,
  DEFAULT_BACKGROUND_PRESET_ID,
  isBackgroundPresetId,
} from '../src/background-presets.ts'

/** Presets that install a canvas of their own. */
const PAINTED = BACKGROUND_PRESET_IDS.filter(id => id !== DEFAULT_BACKGROUND_PRESET_ID)

describe('the shipped presets', () => {
  it('names the harness background as the one a fresh installation gets', () => {
    expect(DEFAULT_BACKGROUND_PRESET_ID).toBe('none')
    expect(backgroundPresetValue(DEFAULT_BACKGROUND_PRESET_ID)).toEqual({ light: '', dark: '' })
  })

  it('offers more than the harness background, or the picker would be empty', () => {
    expect(PAINTED.length).toBeGreaterThanOrEqual(3)
  })

  it('carries a value for both palettes, in every preset that paints one', () => {
    for (const id of PAINTED) {
      const layer = backgroundPresetValue(id)
      expect(layer.light, `${id} has no light value`).not.toBe('')
      expect(layer.dark, `${id} has no dark value`).not.toBe('')
      // A light value under the dark palette reads as a washed-out page, and a
      // dark one under the light palette as a hole in it, so the two differ.
      expect(layer.light).not.toBe(layer.dark)
    }
  })

  it('paints every preset with a gradient rather than a file', () => {
    for (const id of PAINTED) {
      const layer = backgroundPresetValue(id)
      expect(layer.light).toMatch(/^linear-gradient\(/)
      expect(layer.dark).toMatch(/^linear-gradient\(/)
    }
  })

  it('keeps every value out of the text sinks it is written into', () => {
    // The values are written into a stylesheet and a script literal; a brace or
    // an angle bracket would end the declaration or the element carrying them.
    for (const id of BACKGROUND_PRESET_IDS) {
      const layer = backgroundPresetValue(id)
      for (const value of [layer.light, layer.dark]) {
        expect(value).not.toMatch(/[<>{};]/)
      }
    }
  })

  it('gives every preset its own canvas, so two tiles never preview the same thing', () => {
    const seen = new Set(PAINTED.map(id => backgroundPresetValue(id).light))
    expect(seen.size).toBe(PAINTED.length)
  })
})

describe('isBackgroundPresetId', () => {
  it('accepts every id this build ships', () => {
    for (const id of BACKGROUND_PRESET_IDS) expect(isBackgroundPresetId(id)).toBe(true)
  })

  it('refuses an id this build does not ship', () => {
    expect(isBackgroundPresetId('comic')).toBe(false)
    expect(isBackgroundPresetId('')).toBe(false)
  })
})
