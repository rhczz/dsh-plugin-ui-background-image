import { describe, expect, it } from 'vitest'
import {
  BACKGROUND_OPACITY_MAX,
  BACKGROUND_OPACITY_MIN,
  DEFAULT_BACKGROUND_OPACITY,
  isBackgroundOpacity,
  sidebarAlphaPercent,
  surfaceAlphaPercent,
} from '../src/background-opacity.ts'

/** Alpha a full-strength selection leaves the outermost surface. */
const FULL_STRENGTH_ALPHA = 36

describe('surfaceAlphaPercent', () => {
  it('leaves the surfaces fully opaque at zero, so the harness shows through nothing', () => {
    expect(surfaceAlphaPercent(0)).toBe(100)
  })

  it('opens the surfaces further at every step the user takes', () => {
    expect(surfaceAlphaPercent(25)).toBe(84)
    expect(surfaceAlphaPercent(50)).toBe(68)
    expect(surfaceAlphaPercent(DEFAULT_BACKGROUND_OPACITY)).toBe(58)
    expect(surfaceAlphaPercent(85)).toBe(46)
    expect(surfaceAlphaPercent(100)).toBe(FULL_STRENGTH_ALPHA)
  })

  it('keeps the surfaces at or above the floor a full selection reaches', () => {
    // The transcript cards nest three surfaces deep; an alpha below the floor
    // would put the image under body text.
    for (let opacity = BACKGROUND_OPACITY_MIN; opacity <= BACKGROUND_OPACITY_MAX; opacity += 1) {
      expect(surfaceAlphaPercent(opacity)).toBeGreaterThanOrEqual(FULL_STRENGTH_ALPHA)
      expect(surfaceAlphaPercent(opacity)).toBeLessThanOrEqual(100)
    }
  })

  it('never rises as the user asks for more background', () => {
    let previous = 100
    for (let opacity = BACKGROUND_OPACITY_MIN; opacity <= BACKGROUND_OPACITY_MAX; opacity += 1) {
      const alpha = surfaceAlphaPercent(opacity)
      expect(alpha).toBeLessThanOrEqual(previous)
      previous = alpha
    }
  })

  it('rounds to whole percents, so the value written into the token is a percent', () => {
    for (let opacity = BACKGROUND_OPACITY_MIN; opacity <= BACKGROUND_OPACITY_MAX; opacity += 1) {
      expect(Number.isInteger(surfaceAlphaPercent(opacity))).toBe(true)
    }
  })
})

describe('sidebarAlphaPercent', () => {
  it('leaves the sidebar as opaque as the harness shipped it when no background shows', () => {
    expect(sidebarAlphaPercent(0)).toBe(100)
  })

  it('opens the two layers the sidebar paints to exactly one surface', () => {
    // The column and the element inside it each paint the fill, and the frame's
    // own surface is beneath both, so the square of its openness is what the
    // sidebar shows — the same amount the conversation area shows through its
    // own single surface.
    for (let opacity = BACKGROUND_OPACITY_MIN; opacity <= BACKGROUND_OPACITY_MAX; opacity += 1) {
      const sidebar = 1 - (sidebarAlphaPercent(opacity) / 100)
      const surface = 1 - (surfaceAlphaPercent(opacity) / 100)
      // Whole percents leave the two a rounding step apart, never more.
      expect(sidebar ** 2, `opacity ${opacity}`).toBeCloseTo(surface, 1)
    }
  })

  it('opens the sidebar further at every step the user takes', () => {
    expect(sidebarAlphaPercent(0)).toBe(100)
    expect(sidebarAlphaPercent(25)).toBe(60)
    expect(sidebarAlphaPercent(50)).toBe(43)
    expect(sidebarAlphaPercent(DEFAULT_BACKGROUND_OPACITY)).toBe(35)
    expect(sidebarAlphaPercent(100)).toBe(20)
  })

  it('never rises as the user asks for more background', () => {
    let previous = 100
    for (let opacity = BACKGROUND_OPACITY_MIN; opacity <= BACKGROUND_OPACITY_MAX; opacity += 1) {
      const alpha = sidebarAlphaPercent(opacity)
      expect(alpha).toBeLessThanOrEqual(previous)
      previous = alpha
    }
  })

  it('opens each of the two fills wider than one surface, since the sidebar paints both', () => {
    for (let opacity = BACKGROUND_OPACITY_MIN + 1; opacity <= BACKGROUND_OPACITY_MAX; opacity += 1) {
      expect(sidebarAlphaPercent(opacity), `opacity ${opacity}`).toBeLessThan(surfaceAlphaPercent(opacity))
    }
  })
})

describe('isBackgroundOpacity', () => {
  it('accepts every whole percent in the range', () => {
    expect(isBackgroundOpacity(BACKGROUND_OPACITY_MIN)).toBe(true)
    expect(isBackgroundOpacity(DEFAULT_BACKGROUND_OPACITY)).toBe(true)
    expect(isBackgroundOpacity(BACKGROUND_OPACITY_MAX)).toBe(true)
  })

  it('refuses a fraction, which the token could not carry', () => {
    expect(isBackgroundOpacity(64.5)).toBe(false)
  })

  it('refuses a value outside the range', () => {
    expect(isBackgroundOpacity(BACKGROUND_OPACITY_MIN - 1)).toBe(false)
    expect(isBackgroundOpacity(BACKGROUND_OPACITY_MAX + 1)).toBe(false)
  })

  it('refuses a value that is not a number at all', () => {
    expect(isBackgroundOpacity(Number.NaN)).toBe(false)
    expect(isBackgroundOpacity(Number.POSITIVE_INFINITY)).toBe(false)
  })
})
