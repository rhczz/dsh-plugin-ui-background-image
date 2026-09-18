/**
 * The user image directory's own behaviour: what a write leaves behind, what a
 * listing offers, and which names it refuses to hear about.
 * @module dsh-plugin-ui-background-image/tests/user-backgrounds
 */

import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isMintedBackgroundId,
  storedImageName,
  UnsupportedImageError,
  USER_BACKGROUND_DIR_NAME,
  UserBackgroundDirectory,
} from '../src/user-backgrounds.ts'

/**
 * Whether the mocked filesystem refuses the rename a save finishes with, the
 * way a directory on another volume would. A rename is the one step a staged
 * write can fail at with the bytes already on disk, so the rollback it owes has
 * to be driven rather than inferred.
 */
const fsMock = vi.hoisted(() => ({ failRename: false }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rename: async (...args: Parameters<typeof actual.rename>) => {
      if (fsMock.failRename) throw Object.assign(new Error('EXDEV: cross-device link'), { code: 'EXDEV' })
      return actual.rename(...args)
    },
  }
})

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

/**
 * Create a temporary directory to serve as the user image directory.
 * @returns its absolute path.
 */
async function createDirectory(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-background-'))
  directories.push(dir)
  return dir
}

/**
 * Build bytes that identify as one accepted container, padded past the tag.
 * @param container - container to build.
 * @returns the bytes.
 */
function imageBytes(container: 'png' | 'jpg' | 'gif' | 'webp' | 'avif'): Buffer {
  switch (container) {
    case 'png':
      return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)])
    case 'jpg':
      return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(13)])
    case 'gif':
      return Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.alloc(10)])
    case 'webp':
      return Buffer.concat([
        Buffer.from('RIFF', 'latin1'), Buffer.alloc(4), Buffer.from('WEBP', 'latin1'), Buffer.alloc(4),
      ])
    case 'avif':
      return Buffer.concat([Buffer.alloc(4), Buffer.from('ftypavif', 'latin1'), Buffer.alloc(4)])
  }
}

/**
 * Build a directory handle with a recording logger.
 * @param directory - absolute directory the handle owns.
 * @returns the handle and the logger it reports through.
 */
function makeDirectory(directory: string): { images: UserBackgroundDirectory, warn: ReturnType<typeof vi.fn> } {
  const warn = vi.fn()
  return { images: new UserBackgroundDirectory(directory, { warn }), warn }
}

describe('storedImageName', () => {
  it('drops the random part, leaving the name the user recognises', () => {
    expect(storedImageName('sunset-a1b2c3d4e5f6a7b8.png')).toBe('sunset')
  })

  it('shows a name that carries no extension as it stands', () => {
    expect(storedImageName('sunset')).toBe('sunset')
  })

  it('keeps the stem of a hand-copied file, which carries no random part', () => {
    expect(storedImageName('sunset-photo.jpeg')).toBe('sunset-photo')
  })

  it('keeps a stem that is nothing but a random-looking part', () => {
    expect(storedImageName('-a1b2c3d4e5f6a7b8.png')).toBe('-a1b2c3d4e5f6a7b8')
  })
})

describe('isMintedBackgroundId', () => {
  it('recognises the shape a write mints, and no name a user copied in', () => {
    expect(isMintedBackgroundId('sunset-a1b2c3d4e5f6a7b8.png')).toBe(true)
    expect(isMintedBackgroundId('sunset.png')).toBe(false)
    expect(isMintedBackgroundId('sunset-a1b2c3d4.png')).toBe(false)
    expect(isMintedBackgroundId('sunset-a1b2c3d4e5f6a7b8')).toBe(false)
  })
})

describe('save', () => {
  it('stores an accepted container under a name it mints itself', async () => {
    const directory = await createDirectory()
    const { images } = makeDirectory(directory)
    const summary = await images.save(imageBytes('png'), 'Sunset Photo.png')
    expect(summary.name).toBe('sunset-photo')
    expect(summary.id).toMatch(/^sunset-photo-[0-9a-f]{16}\.png$/)
    // The file is on disk under exactly the id the selection will persist.
    expect(await readFile(join(directory, summary.id))).toEqual(imageBytes('png'))
  })

  it('creates the directory it owns', async () => {
    const parent = await createDirectory()
    const { images } = makeDirectory(join(parent, USER_BACKGROUND_DIR_NAME))
    await images.save(imageBytes('jpg'), 'a.jpg')
    expect(await readdir(join(parent, USER_BACKGROUND_DIR_NAME))).toHaveLength(1)
  })

  it('refuses bytes that are not an image container this build accepts', async () => {
    const { images } = makeDirectory(await createDirectory())
    await expect(images.save(Buffer.from('<svg/>'), 'x.svg')).rejects
      .toThrow(/not one of \.png/)
  })

  it('refuses those bytes with a type of its own, not a bare TypeError', async () => {
    // The route tells a refused upload from a failed write by this type alone.
    const { images } = makeDirectory(await createDirectory())
    await expect(images.save(Buffer.from('<svg/>'), 'x.svg')).rejects.toThrow(UnsupportedImageError)
  })

  it('lets two uploads of the same name coexist', async () => {
    const directory = await createDirectory()
    const { images } = makeDirectory(directory)
    const first = await images.save(imageBytes('png'), 'sunset.png')
    const second = await images.save(imageBytes('png'), 'sunset.png')
    expect(first.id).not.toBe(second.id)
    expect((await images.list()).map(entry => entry.id).sort()).toEqual([first.id, second.id].sort())
  })

  it('leaves no staged file behind when the rename fails', async () => {
    const directory = await createDirectory()
    const { images } = makeDirectory(directory)
    fsMock.failRename = true
    try {
      await expect(images.save(imageBytes('png'), 'sunset.png')).rejects.toThrow('EXDEV')
    } finally {
      fsMock.failRename = false
    }
    // A half-written upload is not offered, and the bytes it staged are gone.
    expect(await readdir(directory)).toEqual([])
    expect(await images.list()).toEqual([])
  })

  it('leaves no staged file behind', async () => {
    const directory = await createDirectory()
    const { images } = makeDirectory(directory)
    await images.save(imageBytes('webp'), 'sunset.webp')
    expect((await readdir(directory)).some(name => name.endsWith('.staging'))).toBe(false)
  })
})

describe('list', () => {
  it('offers files a user copied in by hand as well as uploaded ones', async () => {
    const directory = await createDirectory()
    const { images } = makeDirectory(directory)
    await images.save(imageBytes('png'), 'uploaded.png')
    await writeFile(join(directory, 'hand-copied.jpeg'), imageBytes('jpg'))
    expect((await images.list()).map(entry => entry.name)).toEqual(['hand-copied', 'uploaded'])
  })

  it('reads an absent directory as an empty catalogue', async () => {
    const directory = join(await createDirectory(), 'never-created')
    const { images, warn } = makeDirectory(directory)
    expect(await images.list()).toEqual([])
    expect(warn).not.toHaveBeenCalled()
  })

  it('reports a directory that exists and could not be read', async () => {
    const parent = await createDirectory()
    const notADirectory = join(parent, 'a-file.png')
    await writeFile(notADirectory, imageBytes('png'))
    const { images, warn } = makeDirectory(notADirectory)
    expect(await images.list()).toEqual([])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not read the image directory'))
  })

  it('leaves out names it could not serve', async () => {
    const directory = await createDirectory()
    const { images } = makeDirectory(directory)
    await writeFile(join(directory, 'vector.svg'), '<svg/>')
    await writeFile(join(directory, 'no-extension'), imageBytes('png'))
    await writeFile(join(directory, 'quote".png'), imageBytes('png'))
    await writeFile(join(directory, 'half-written.png.staging'), imageBytes('png'))
    await mkdir(join(directory, 'a-directory.png'))
    await symlink(join(directory, 'nowhere.png'), join(directory, 'linked.png'))
    expect(await images.list()).toEqual([])
  })
})

describe('read', () => {
  it('serves the bytes of a stored image and the date they were written', async () => {
    const directory = await createDirectory()
    const { images } = makeDirectory(directory)
    const summary = await images.save(imageBytes('avif'), 'sunset.avif')
    const stored = await images.read(summary.id)
    expect(stored?.bytes).toEqual(imageBytes('avif'))
    // The date is the validator a browser revalidates with, so it has to come
    // from the same read as the bytes.
    expect(stored?.modifiedAt).toBeInstanceOf(Date)
    expect(Number.isNaN(stored?.modifiedAt.getTime())).toBe(false)
  })

  it('reports an unknown or unusable id as absent rather than failing', async () => {
    const { images } = makeDirectory(await createDirectory())
    expect(await images.read('missing.png')).toBeUndefined()
    expect(await images.read('../secrets.png')).toBeUndefined()
  })

  it('reports a name it cannot open, rather than calling it absent', async () => {
    // A symbolic link that points at itself cannot be opened at all, which is a
    // fault of the directory rather than a file that is gone.
    const directory = await createDirectory()
    const { images } = makeDirectory(directory)
    await symlink('loop.png', join(directory, 'loop.png'))
    await expect(images.read('loop.png')).rejects.toThrow(/ELOOP/)
  })

  it('reports a file it is there but cannot read, rather than calling it absent', async () => {
    // A directory in an image's place is there and unreadable: the page must
    // hear that the Host failed, not that the user's background is gone.
    const directory = await createDirectory()
    const { images } = makeDirectory(directory)
    await mkdir(join(directory, 'blocked.png'), { recursive: true })
    await expect(images.read('blocked.png')).rejects.toThrow(/EISDIR/)
  })
})

describe('remove', () => {
  it('deletes a stored image', async () => {
    const directory = await createDirectory()
    const { images } = makeDirectory(directory)
    const summary = await images.save(imageBytes('gif'), 'sunset.gif')
    expect(await images.remove(summary.id)).toBe(true)
    expect(await images.list()).toEqual([])
  })

  it('reports a file that is already gone as nothing to remove', async () => {
    const { images } = makeDirectory(await createDirectory())
    expect(await images.remove('missing.png')).toBe(false)
    expect(await images.remove('../secrets.png')).toBe(false)
  })

  it('reports a file it could not unlink rather than calling it gone', async () => {
    const parent = await createDirectory()
    const directory = join(parent, 'images')
    await mkdir(join(directory, 'sunset.png'), { recursive: true })
    const { images } = makeDirectory(directory)
    // A directory in a file's place is not an absence: the caller has to hear
    // that the Host could not remove what it was asked to.
    await expect(images.remove('sunset.png')).rejects.toThrow()
  })
})

describe('ensure', () => {
  it('returns the path it created', async () => {
    const parent = await createDirectory()
    const directory = join(parent, 'images')
    const { images } = makeDirectory(directory)
    expect(await images.ensure()).toBe(directory)
    expect(images.path).toBe(directory)
  })
})
