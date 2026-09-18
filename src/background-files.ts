/**
 * Reading image files on the Host. One module owns the containers this plugin
 * accepts and the readable name a stored file is given, so upload validation
 * and directory listing cannot drift apart on what counts as an image.
 * @module dsh-plugin-ui-background-image/background-files
 */

import type { BackgroundFileExtension } from './background-formats.ts'

/** Longest readable part of a stored file name. */
const MAX_SLUG_LENGTH = 48

/** Characters a readable name may not carry, replaced by a single hyphen. */
const NON_NAME_CHARACTERS = /[^\p{L}\p{N}]+/gu

/**
 * Judge whether a read failed because the entry is not there. A file deleted
 * between a catalogue read and a request is an ordinary absence, not a fault.
 * @param error - error a directory or file read rejected with.
 * @returns whether the entry was absent.
 */
export function isMissingEntry(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

/** One container's leading bytes, at the offsets that identify it. */
interface ImageSignature {
  /** Extension a file of this container is stored with. */
  extension: BackgroundFileExtension
  /** Byte groups that must all match, read as latin1 so the comparison is byte-exact. */
  groups: readonly { offset: number; bytes: string }[]
  /**
   * Brands any one of which also identifies the container, read from the brand
   * list an ISO base media file's `ftyp` box opens with. Absent for containers
   * whose fixed tags are the whole of their identity.
   */
  brands?: readonly string[]
}

/** Offset of a `ftyp` box's brand list: its major brand, then its version field. */
const FTYP_BRANDS_OFFSET = 8

/**
 * Bytes of a `ftyp` box this reader inspects, from the file start.
 *
 * The major brand, the version field, and six compatible brand slots: past this
 * point a brand would sit in a part of the file no encoder writes one to, and
 * reading further would let unrelated bytes identify the file.
 */
const FTYP_BRANDS_WINDOW = 32

/**
 * Leading tags of every container this plugin accepts.
 *
 * An upload carries no trustworthy file name and a hand-copied file's name may
 * lie, so the stored extension comes from the bytes themselves. Two entries
 * share an extension where one container has two spellings (GIF87a and GIF89a),
 * which keeps the table a flat list rather than a matcher.
 */
const BACKGROUND_FILE_MAGIC: readonly ImageSignature[] = [
  { extension: '.png', groups: [{ offset: 0, bytes: '\u0089PNG\r\n\u001a\n' }] },
  { extension: '.jpg', groups: [{ offset: 0, bytes: '\u00ff\u00d8\u00ff' }] },
  { extension: '.gif', groups: [{ offset: 0, bytes: 'GIF87a' }] },
  { extension: '.gif', groups: [{ offset: 0, bytes: 'GIF89a' }] },
  { extension: '.webp', groups: [{ offset: 0, bytes: 'RIFF' }, { offset: 8, bytes: 'WEBP' }] },
  // Encoders disagree on which brand is major: a still image may declare
  // `mif1` and carry `avif` among its compatible brands, so the whole brand
  // list is read rather than the major brand alone.
  { extension: '.avif', groups: [{ offset: 4, bytes: 'ftyp' }], brands: ['avif', 'avis'] },
]

/**
 * Test a file's brand list for one of the brands this plugin serves.
 *
 * The list is bounded by both the box's own declared length and
 * {@link FTYP_BRANDS_WINDOW}, so bytes that follow a short box cannot identify
 * the file, and a box that claims an impossible length is read as far as the
 * bytes actually go.
 * The caller reaches this with a `ftyp` tag already matched, so the box's own
 * length field is present.
 * @param bytes - complete file contents.
 * @param brands - brands that identify the container.
 * @returns whether any of them appears in the brand list.
 */
function hasIsoMediaBrand(bytes: Buffer, brands: readonly string[]): boolean {
  const declared = bytes.readUInt32BE(0)
  const end = Math.min(
    bytes.length,
    declared >= FTYP_BRANDS_OFFSET ? declared : bytes.length,
    FTYP_BRANDS_WINDOW,
  )
  for (let offset = FTYP_BRANDS_OFFSET; offset + 4 <= end; offset += 4) {
    if (brands.includes(bytes.toString('latin1', offset, offset + 4))) return true
  }
  return false
}

/**
 * Identify an image container from its leading bytes.
 * @param bytes - complete file contents.
 * @returns the matching extension, or undefined when the tag is not an image
 * container this plugin accepts.
 */
export function detectBackgroundFileExtension(bytes: Buffer): BackgroundFileExtension | undefined {
  for (const candidate of BACKGROUND_FILE_MAGIC) {
    const matches = candidate.groups.every((group) => {
      const end = group.offset + group.bytes.length
      return bytes.length >= end && bytes.toString('latin1', group.offset, end) === group.bytes
    })
    if (!matches) continue
    if (candidate.brands !== undefined && !hasIsoMediaBrand(bytes, candidate.brands)) continue
    return candidate.extension
  }
  return undefined
}

/**
 * Turn an uploaded file's own name into the readable part of a stored file name.
 *
 * The name is client-supplied and never decides what lands on disk: only
 * letters, digits, and single hyphens survive, so the result is a safe path
 * segment and a safe CSS string whatever the browser sent. Letters are matched
 * by Unicode category, so a name in any script stays readable.
 * @param name - uploaded file name, with or without a directory part.
 * @returns a lower-case name of letters, digits, and single hyphens.
 */
export function backgroundFileSlug(name: string): string {
  const dot = name.lastIndexOf('.')
  const stem = dot <= 0 ? name : name.slice(0, dot)
  const slug = stem
    .toLowerCase()
    .replace(NON_NAME_CHARACTERS, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, '')
  return slug === '' ? 'image' : slug
}
