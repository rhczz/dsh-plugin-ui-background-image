/**
 * The user image directory under the harness home: the `upload` catalogue.
 * Images uploaded from the settings page and images copied in by hand are the
 * same kind of entry and reach the browser the same way.
 *
 * A write stages its bytes as `<stored id>.staging` and renames them into
 * place, so a crash mid-write leaves at most one staged file. That name has an
 * extension this plugin does not accept and an id no catalogue names, so every
 * read here ignores it.
 * @module dsh-plugin-ui-background-image/user-backgrounds
 */

import { randomUUID } from 'node:crypto'
import { mkdir, open, readdir, rename, rm, writeFile, type FileHandle } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { BackgroundImageSummary } from './background-api.ts'
import { backgroundFileSlug, detectBackgroundFileExtension, isMissingEntry } from './background-files.ts'
import { acceptedBackgroundFileExtension, BACKGROUND_FILE_EXTENSIONS, backgroundFileExtension } from './background-formats.ts'
import { isStoredBackgroundId } from './background-settings.ts'

/** Directory name appended to the harness home when no path is configured. */
export const USER_BACKGROUND_DIR_NAME = 'backgrounds'

/**
 * Hex digits of randomness in a stored id.
 *
 * The readable part comes from the uploaded file's name, so two images of the
 * same name produce the same prefix; the random part is what keeps the second
 * one from overwriting the first. Sixty-four bits is far past the point where a
 * directory of hand-uploaded images could collide by accident.
 */
const STORED_ID_RANDOM_LENGTH = 16

/** Trailing random part of an id this directory minted. */
const MINTED_ID_SUFFIX = new RegExp(`-[0-9a-f]{${STORED_ID_RANDOM_LENGTH}}$`)

/**
 * Reports a directory whose contents this plugin could not read, so a failure
 * inside the harness home is never silent.
 */
export interface BackgroundFileLogger {
  /**
   * Record a directory operation that failed.
   * @param message - one line naming the directory and the reason.
   */
  warn(message: string): void
}

/**
 * One stored image as a reader gets it: the bytes, and the fact a conditional
 * request compares against.
 */
export interface StoredImage {
  /** Complete file contents. */
  bytes: Buffer
  /** When the bytes were last written, which is the validator a browser reuses. */
  modifiedAt: Date
}

/**
 * An upload whose bytes are not an image container this plugin accepts.
 *
 * Its own type rather than a `TypeError`, because the route decides between a
 * refused body (400) and a Host failure (500) by what went wrong: a `TypeError`
 * from anywhere else in a write is a fault of this plugin, not of the upload.
 */
export class UnsupportedImageError extends Error {
  /**
   * @param message - reason naming the containers this plugin accepts.
   */
  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedImageError'
  }
}

/**
 * Test whether an id carries this directory's minted shape, which is what makes
 * its bytes immutable: every write takes a fresh random suffix, so no two files
 * share one and a minted id never names different bytes.
 * @param id - stored image id.
 * @returns whether the id names a file this directory wrote.
 */
export function isMintedBackgroundId(id: string): boolean {
  const extension = acceptedBackgroundFileExtension(id)
  if (extension === undefined) return false
  return MINTED_ID_SUFFIX.test(id.slice(0, id.length - extension.length))
}

/**
 * Read the name a stored id presents: the readable part of the file name with
 * the random part removed, or the file's own stem for a hand-copied file.
 * @param id - stored image id.
 * @returns the name to show the user.
 */
export function storedImageName(id: string): string {
  const extension = backgroundFileExtension(id) ?? ''
  const stem = id.slice(0, id.length - extension.length)
  return stem.replace(MINTED_ID_SUFFIX, '') || stem
}

/**
 * The user image directory and the operations the settings page performs on it.
 *
 * An absent directory reads as an empty catalogue: a user who never uploaded
 * anything is an ordinary state, not a failure. Every other fault — a directory
 * that cannot be listed, a file that cannot be read or removed — reaches the
 * caller, which turns it into a response that says the Host failed rather than
 * that the file is gone.
 */
export class UserBackgroundDirectory {
  private readonly directory: string
  private readonly logger: BackgroundFileLogger

  /**
   * @param directory - absolute directory holding the user's images.
   * @param logger - sink for the one warning a directory-level failure produces.
   */
  constructor(directory: string, logger: BackgroundFileLogger) {
    this.directory = directory
    this.logger = logger
  }

  /**
   * Read the directory this instance owns.
   * @returns the absolute directory path.
   */
  get path(): string {
    return this.directory
  }

  /**
   * Create the directory when it does not exist yet.
   * @returns the absolute directory path.
   */
  async ensure(): Promise<string> {
    await mkdir(this.directory, { recursive: true })
    return this.directory
  }

  /**
   * Read every image the directory holds, including files that were never
   * uploaded through this plugin. Only a file whose name passes the stored-id
   * gate is offered, so a hand-copied file with an unusable name cannot become
   * a choice the settings would then refuse.
   * @returns summaries sorted by name.
   */
  async list(): Promise<readonly BackgroundImageSummary[]> {
    const ids = await this.ids()
    return ids
      .map(id => ({ id, name: storedImageName(id) }))
      .sort((left, right) => left.name.localeCompare(right.name))
  }

  /**
   * Store one uploaded file under a name this directory chooses.
   *
   * The container is identified from the bytes and the readable part of the
   * name from the uploaded file's own name, so nothing the client sends decides
   * what lands on disk beyond a slug this plugin builds itself.
   * @param bytes - complete upload body.
   * @param name - file name the browser reported for the upload.
   * @returns the stored entry.
   * @throws {UnsupportedImageError} when the bytes are not an image container this plugin accepts.
   */
  async save(bytes: Buffer, name: string): Promise<BackgroundImageSummary> {
    const extension = detectBackgroundFileExtension(bytes)
    if (extension === undefined) {
      throw new UnsupportedImageError(`uploaded bytes are not one of ${BACKGROUND_FILE_EXTENSIONS.join(', ')}`)
    }
    const readable = backgroundFileSlug(name)
    const id = `${readable}-${randomUUID().replaceAll('-', '').slice(0, STORED_ID_RANDOM_LENGTH)}${extension}`
    await this.ensure()
    const target = join(this.directory, id)
    // Write beside the target and rename: a reader never observes a partial
    // file, and a crash mid-write leaves no half-registered entry.
    const staging = `${target}.staging`
    await writeFile(staging, bytes)
    try {
      await rename(staging, target)
    } catch (error) {
      await rm(staging, { force: true })
      throw error
    }
    return { id, name: readable }
  }

  /**
   * Read one stored image.
   *
   * The bytes and the modification time come from one open handle, so the
   * validator a caller sends a browser describes exactly the bytes it serves: a
   * file replaced between the two reads cannot pair old bytes with a new date.
   * @param id - stored image id.
   * @returns the image, or undefined when the id is unknown or names no file
   * this directory holds.
   * @throws when the file is there and could not be read, so the caller reports
   * a Host failure rather than an image the user never deleted.
   */
  async read(id: string): Promise<StoredImage | undefined> {
    if (!isStoredBackgroundId(id)) return undefined
    let handle: FileHandle
    try {
      handle = await open(join(this.directory, id), 'r')
    } catch (error) {
      // An image deleted between the catalogue read and this request is absent,
      // not an error; a file that is there and could not be read is neither.
      if (isMissingEntry(error)) return undefined
      throw error
    }
    try {
      return await this.readOpenImage(handle)
    } finally {
      await handle.close()
    }
  }

  /**
   * Delete one stored image.
   * @param id - stored image id.
   * @returns whether a file was removed; false when there was nothing to remove.
   * @throws when the file is there but could not be removed, which is not the
   * same answer as a file that is already gone.
   */
  async remove(id: string): Promise<boolean> {
    if (!isStoredBackgroundId(id)) return false
    try {
      await rm(join(this.directory, id))
    } catch (error) {
      // A file that is already gone is the outcome the caller asked for. A
      // directory in its place, or a file the Host may not unlink, is not.
      if (isMissingEntry(error)) return false
      throw error
    }
    return true
  }

  /**
   * Read one open stored image.
   *
   * The date is read before the bytes, so a file replaced between the two reads
   * cannot pair the older bytes with the newer date a browser would then keep.
   * @param handle - open handle to one stored image.
   * @returns the image.
   */
  private async readOpenImage(handle: FileHandle): Promise<StoredImage> {
    const info = await handle.stat()
    return { bytes: await handle.readFile(), modifiedAt: info.mtime }
  }

  /** List candidate file names, sorted for a stable catalogue order. */
  private async ids(): Promise<readonly string[]> {
    let entries
    try {
      entries = await readdir(this.directory, { withFileTypes: true })
    } catch (error) {
      // A user who never uploaded anything has no directory yet; that is an
      // empty catalogue, not a failure. A directory that exists and could not
      // be read is a failure, and silently reporting it as empty would hide it.
      if (!isMissingEntry(error)) {
        this.logger.warn(`ui-background-image: could not read the image directory ${this.directory}: ${String(error)}`)
      }
      return []
    }
    return entries
      .filter(entry => entry.isFile() && isStoredBackgroundId(basename(entry.name)))
      .map(entry => entry.name)
      .sort((left, right) => left.localeCompare(right))
  }
}
