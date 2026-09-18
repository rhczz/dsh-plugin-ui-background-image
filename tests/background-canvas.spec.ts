import { describe, expect, it } from 'vitest'
import { BACKGROUND_IMAGE_ROUTE } from '../src/background-api.ts'
import { judgeRemoteImageUrl, STRICT_REMOTE_POLICY } from '../src/background-remote.ts'
import {
  BACKGROUND_CANVAS_RULE,
  BACKGROUND_CANVAS_STYLE_ID,
  BACKGROUND_IMAGE_VARIABLE,
  backgroundImageValue,
  remoteImageValue,
  SIDEBAR_FILL_PROPERTY,
  sidebarFillValue,
  SURFACE_BACKGROUND_PROPERTY,
  surfaceValue,
} from '../src/background-canvas.ts'

describe('the canvas rule', () => {
  it('paints the variable this plugin writes and nothing when it is unset', () => {
    expect(BACKGROUND_CANVAS_RULE).toContain(`background-image:var(${BACKGROUND_IMAGE_VARIABLE},none)`)
  })

  it('fills the viewport, so a selection cannot expose the browser canvas', () => {
    expect(BACKGROUND_CANVAS_RULE).toContain('background-size:cover')
    expect(BACKGROUND_CANVAS_RULE).toContain('background-position:center center')
    expect(BACKGROUND_CANVAS_RULE).toContain('background-repeat:no-repeat')
  })

  it('anchors the image to the viewport rather than to the document', () => {
    expect(BACKGROUND_CANVAS_RULE).toContain('background-attachment:fixed')
  })

  it('targets the element the palette is declared on, which is the element that paints the canvas', () => {
    expect(BACKGROUND_CANVAS_RULE.startsWith('body{')).toBe(true)
    expect(BACKGROUND_CANVAS_RULE.endsWith('}')).toBe(true)
  })

  it('names one element id, shared with the row the Host renders', () => {
    expect(BACKGROUND_CANVAS_STYLE_ID).toBe('dsh-ui-background-image-canvas')
  })
})

describe('backgroundImageValue', () => {
  it('points at the route that serves the stored file', () => {
    expect(backgroundImageValue('sunset-a1b2c3d4e5f6a7b8.png').light)
      .toBe(`url("${BACKGROUND_IMAGE_ROUTE}?id=sunset-a1b2c3d4e5f6a7b8.png")`)
  })

  it('installs the same value in both palettes, because a file is not a colour', () => {
    const layer = backgroundImageValue('sunset-a1b2c3d4e5f6a7b8.png')
    expect(layer.light).toBe(layer.dark)
  })

  it('escapes an id rather than letting it end the URL or the string', () => {
    // The id is a Host file name, but it arrives from a settings document, so
    // the two characters that mean something in a URL and in a CSS string are
    // encoded rather than trusted.
    expect(backgroundImageValue('a b"c.png').light).toContain('a%20b%22c.png')
  })
})

describe('sidebarFillValue', () => {
  it('keeps the sidebar palette colour and lowers only its alpha', () => {
    expect(sidebarFillValue(29)).toEqual({
      light: 'color-mix(in srgb, var(--dsw-static-neutral-bluish-50) 29%, transparent)',
      dark: 'color-mix(in srgb, var(--dsw-static-neutral-bluish-900) 29%, transparent)',
    })
  })

  it('overrides the token the sidebar column and its content both paint', () => {
    expect(SIDEBAR_FILL_PROPERTY).toBe('--dsw-specific-sidebar-fill')
  })

  it('carries each palette its own sidebar colour, so a mode switch stays legible', () => {
    expect(sidebarFillValue(29).light).not.toBe(sidebarFillValue(29).dark)
  })

  it('draws from a different palette primitive than the base surface, so the column stays distinct', () => {
    expect(sidebarFillValue(29).light).not.toBe(surfaceValue(29).light)
  })
})

describe('surfaceValue', () => {
  it('keeps the palette own colour and lowers only its alpha', () => {
    const layer = surfaceValue(58)
    expect(layer.light).toBe('color-mix(in srgb, var(--dsw-static-neutral-bluish-00) 58%, transparent)')
    expect(layer.dark).toBe('color-mix(in srgb, var(--dsw-static-neutral-bluish-950) 58%, transparent)')
  })

  it('overrides the one official token the canvas needs, and only that token', () => {
    expect(SURFACE_BACKGROUND_PROPERTY).toBe('--dsw-alias-bg-base')
  })

  it('carries each palette its own base colour, so a mode switch stays legible', () => {
    expect(surfaceValue(100).light).not.toBe(surfaceValue(100).dark)
  })

  it('leaves the surfaces fully opaque at full alpha', () => {
    expect(surfaceValue(100).light).toContain('100%, transparent')
  })
})

describe('remoteImageValue', () => {
  it('writes the URL into a CSS url() in both colour schemes', () => {
    expect(remoteImageValue('https://cdn.example.com/a.png')).toEqual({
      light: 'url("https://cdn.example.com/a.png")',
      dark: 'url("https://cdn.example.com/a.png")',
    })
  })

  it('cannot be closed early by anything the URL text carried', () => {
    const verdict = judgeRemoteImageUrl('https://cdn.example.com/a"b\\c.png', STRICT_REMOTE_POLICY)
    if (verdict.kind !== 'accepted') throw new Error('the policy refused a URL this case needs')
    // The parser serializes the URL before it is stored, which percent-encodes
    // the quote and the backslash a CSS string would otherwise end on.
    expect(verdict.url).not.toContain('"')
    expect(verdict.url).not.toContain('\\')
    expect(remoteImageValue(verdict.url).light).toBe(`url("${verdict.url}")`)
  })
})
