/**
 * Image containers this plugin accepts. Kept apart from the Host's file reading
 * so the browser half can offer the same list in its file picker, and so the
 * served media type is looked up from one record.
 * @module dsh-plugin-ui-background-image/background-formats
 */

/** Extensions accepted for upload and for reading the user image directory. */
export const BACKGROUND_FILE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'] as const

/** One of {@link BACKGROUND_FILE_EXTENSIONS}. */
export type BackgroundFileExtension = typeof BACKGROUND_FILE_EXTENSIONS[number]

/**
 * Media type served per accepted extension.
 *
 * Two names share the JPEG type because both spellings name the same container;
 * a stored file always carries the canonical `.jpg`, so only a hand-copied file
 * can arrive as `.jpeg`.
 */
export const BACKGROUND_CONTENT_TYPES: Readonly<Record<BackgroundFileExtension, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
}

/**
 * Read the lower-case extension of a file name.
 * @param name - file name or path.
 * @returns the extension including its dot, or undefined when the name has none.
 */
export function backgroundFileExtension(name: string): string | undefined {
  const index = name.lastIndexOf('.')
  return index <= 0 ? undefined : name.slice(index).toLowerCase()
}

/**
 * Read the accepted extension of a file name.
 * @param name - file name or path.
 * @returns the extension including its dot, or undefined when the name carries
 * one this plugin does not accept.
 */
export function acceptedBackgroundFileExtension(name: string): BackgroundFileExtension | undefined {
  const extension = backgroundFileExtension(name)
  return BACKGROUND_FILE_EXTENSIONS.find(accepted => accepted === extension)
}

/**
 * Test a file name for carrying an extension this plugin accepts.
 * @param name - file name or path.
 * @returns whether the extension is one of {@link BACKGROUND_FILE_EXTENSIONS}.
 */
export function isBackgroundFileName(name: string): boolean {
  return acceptedBackgroundFileExtension(name) !== undefined
}
