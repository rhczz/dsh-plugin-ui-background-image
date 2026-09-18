import { describe, expect, it } from 'vitest'
import { backgroundFileSlug, detectBackgroundFileExtension, isMissingEntry } from '../src/background-files.ts'

/**
 * Build one file's leading bytes.
 * @param groups - byte groups to place at their offsets.
 * @param length - total length to pad to.
 * @returns the bytes.
 */
function bytes(groups: readonly { offset: number; value: string }[], length: number): Buffer {
  const buffer = Buffer.alloc(length)
  for (const group of groups) buffer.write(group.value, group.offset, 'latin1')
  return buffer
}

describe('detectBackgroundFileExtension', () => {
  it('identifies a PNG from its signature', () => {
    expect(detectBackgroundFileExtension(bytes([{ offset: 0, value: '\u0089PNG\r\n\u001a\n' }], 16))).toBe('.png')
  })

  it('identifies a JPEG from its start-of-image marker', () => {
    expect(detectBackgroundFileExtension(bytes([{ offset: 0, value: '\u00ff\u00d8\u00ff' }], 16))).toBe('.jpg')
  })

  it('identifies both GIF spellings', () => {
    expect(detectBackgroundFileExtension(bytes([{ offset: 0, value: 'GIF87a' }], 16))).toBe('.gif')
    expect(detectBackgroundFileExtension(bytes([{ offset: 0, value: 'GIF89a' }], 16))).toBe('.gif')
  })

  it('identifies a WebP from its container and form', () => {
    const webp = bytes([{ offset: 0, value: 'RIFF' }, { offset: 8, value: 'WEBP' }], 16)
    expect(detectBackgroundFileExtension(webp)).toBe('.webp')
  })

  it('identifies both AVIF brands', () => {
    for (const brand of ['avif', 'avis']) {
      const avif = bytes([{ offset: 4, value: 'ftyp' }, { offset: 8, value: brand }], 16)
      expect(detectBackgroundFileExtension(avif)).toBe('.avif')
    }
  })

  it('identifies an AVIF that names another major brand', () => {
    // Encoders write `mif1` as the major brand and the real one among the
    // compatible brands that follow it.
    const avif = bytes([
      { offset: 4, value: 'ftyp' },
      { offset: 8, value: 'mif1' },
      { offset: 20, value: 'avif' },
    ], 32)
    expect(detectBackgroundFileExtension(avif)).toBe('.avif')
  })

  it('reads no brand past the box that declares it', () => {
    // A four byte box ends before the brand that follows it, so those bytes
    // describe something else and cannot identify the file.
    const truncated = bytes([
      { offset: 0, value: '\u0000\u0000\u0000\u0010' },
      { offset: 4, value: 'ftyp' },
      { offset: 8, value: 'mif1' },
      { offset: 24, value: 'avif' },
    ], 32)
    expect(detectBackgroundFileExtension(truncated)).toBeUndefined()
  })

  it('identifies no ISO media file whose brands this plugin does not serve', () => {
    const heic = bytes([{ offset: 4, value: 'ftyp' }, { offset: 8, value: 'heic' }], 32)
    expect(detectBackgroundFileExtension(heic)).toBeUndefined()
  })

  it('refuses bytes that are not an image container this build accepts', () => {
    expect(detectBackgroundFileExtension(bytes([{ offset: 0, value: 'OTTO' }], 16))).toBeUndefined()
    expect(detectBackgroundFileExtension(Buffer.from('<!doctype html>'))).toBeUndefined()
  })

  it('refuses a file too short to carry the tag it is judged on', () => {
    // A truncated upload must not be identified by the bytes it does have.
    expect(detectBackgroundFileExtension(Buffer.alloc(0))).toBeUndefined()
    expect(detectBackgroundFileExtension(bytes([{ offset: 0, value: 'RIFF' }], 4))).toBeUndefined()
  })
})

describe('backgroundFileSlug', () => {
  it('reads the file name without its extension', () => {
    expect(backgroundFileSlug('Sunset Photo.png')).toBe('sunset-photo')
  })

  it('ignores a directory part the browser may have sent', () => {
    expect(backgroundFileSlug('C:\\Users\\me\\Sunset.png')).toBe('c-users-me-sunset')
    expect(backgroundFileSlug('/tmp/sunset.png')).toBe('tmp-sunset')
  })

  it('keeps the letters of a name in any script', () => {
    // The readable part of a stored name is what the picker shows, and only
    // letters, digits, and hyphens survive into a safe path segment.
    expect(backgroundFileSlug('我的图片.png')).toBe('我的图片')
  })

  it('collapses runs of punctuation into one hyphen and trims the ends', () => {
    expect(backgroundFileSlug('a (1) -- b.png')).toBe('a-1-b')
    expect(backgroundFileSlug('...x....png')).toBe('x')
  })

  it('caps a long name so a stored id stays a usable file name', () => {
    const slug = backgroundFileSlug(`${'a'.repeat(120)}.png`)
    expect(slug).toBe('a'.repeat(48))
  })

  it('names an upload nothing readable survived from', () => {
    expect(backgroundFileSlug('***.png')).toBe('image')
    expect(backgroundFileSlug('')).toBe('image')
  })

  it('reads a dotfile name as its whole stem, since it carries no stem of its own', () => {
    expect(backgroundFileSlug('.png')).toBe('png')
  })
})

describe('isMissingEntry', () => {
  it('recognises the absence code the platform reports', () => {
    expect(isMissingEntry(Object.assign(new Error('gone'), { code: 'ENOENT' }))).toBe(true)
  })

  it('does not read every failure as an absence', () => {
    expect(isMissingEntry(Object.assign(new Error('denied'), { code: 'EACCES' }))).toBe(false)
    expect(isMissingEntry(new Error('plain'))).toBe(false)
    expect(isMissingEntry(undefined)).toBe(false)
  })
})
