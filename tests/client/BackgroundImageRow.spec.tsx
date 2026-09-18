// @vitest-environment jsdom
/**
 * The Background image row and its two dialogs: what the row states, what the
 * picker offers, and what the management dialog does with a file.
 * @module dsh-plugin-ui-background-image/tests/client/BackgroundImageRow
 */

import { useSyncExternalStore } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BackgroundImageRow, type BackgroundImageRowComponentProps } from '../../src/client/BackgroundImageRow.tsx'
import { zh } from '../../src/client/locales.ts'
import { createBackgroundRowStore, type BackgroundRowState } from '../../src/client/settings-store.ts'
import { backgroundPresetValue } from '../../src/background-presets.ts'
import { surfaceValue } from '../../src/background-canvas.ts'
import { surfaceAlphaPercent } from '../../src/background-opacity.ts'
import { DEFAULT_BACKGROUND_OPACITY } from '../../src/background-opacity.ts'
import type { BackgroundRowSnapshot } from '../../src/client/background-runtime.ts'

type RowInstance = ReturnType<ReturnType<typeof createBackgroundRowStore>['create']>

/** One stored image the catalogue cases list. */
const STORED = { id: 'sunset-a1b2c3d4e5f6a7b8.png', name: 'sunset' }

afterEach(cleanup)

/** Copy the row renders, taken from the shipped dictionary. */
const t = ((key: string, params?: Record<string, unknown>) => {
  const template = (zh as Record<string, string>)[key] ?? key
  // Interpolate like the locale service, so a spec sees the text a user sees.
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}) as BackgroundImageRowComponentProps['t']

/**
 * Bind a real store instance to the `useStore` seat the row is handed.
 * @param instance - live store instance from the declared factory.
 * @returns the selector hook the slot renderer would supply.
 */
function bindStore(instance: RowInstance): BackgroundImageRowComponentProps['useStore'] {
  const hook = <T,>(selector: (state: BackgroundRowState) => T): T =>
    useSyncExternalStore(listener => instance.subscribe(listener), () => selector(instance.getSnapshot()))
  return hook
}

/**
 * Build a runtime snapshot with everything a case does not care about fixed.
 * @param overrides - fields this case exercises.
 * @returns the snapshot.
 */
function snapshot(overrides: Partial<BackgroundRowSnapshot> = {}): BackgroundRowSnapshot {
  return {
    seq: 1,
    selection: { source: 'preset', id: 'none', opacity: DEFAULT_BACKGROUND_OPACITY, url: '' },
    opacity: DEFAULT_BACKGROUND_OPACITY,
    surfaceTint: surfaceValue(surfaceAlphaPercent(DEFAULT_BACKGROUND_OPACITY)).light,
    colorScheme: 'light',
    catalog: 'ready',
    catalogError: '',
    directory: '/home/example/.dsh/backgrounds',
    images: [],
    available: true,
    busy: false,
    notice: '',
    noticeDetail: '',
    ...overrides,
  }
}

/** The injected face a case asserts against. */
function face() {
  return {
    select: vi.fn(),
    reset: vi.fn(),
    previewOpacity: vi.fn(),
    commitOpacity: vi.fn(),
    reload: vi.fn(),
    upload: vi.fn(),
    selectRemote: vi.fn(),
    remove: vi.fn(),
  }
}

/**
 * Mount the row over a driven store.
 * @param overrides - snapshot fields this case exercises.
 * @returns the rendered store instance and the injected callbacks.
 */
function mount(overrides: Partial<BackgroundRowSnapshot> = {}) {
  const instance = createBackgroundRowStore().create()
  instance.actions.sync(snapshot(overrides))
  const injected = face()
  // The runtime is the store's writer: previewing or settling an opacity
  // republishes the snapshot, exactly as the real one does, so the controlled
  // slider is driven the way the interface drives it.
  injected.previewOpacity.mockImplementation((opacity: number) => {
    instance.actions.sync(snapshot({ ...overrides, opacity, seq: 2 }))
  })
  injected.commitOpacity.mockImplementation((opacity: number) => {
    instance.actions.sync(snapshot({ ...overrides, opacity, seq: 3 }))
  })
  const props = {
    t,
    useStore: bindStore(instance),
    ...injected,
    // The row reads none of the global runtime seats; the four shares it does
    // read are supplied here in full.
  } as unknown as BackgroundImageRowComponentProps
  const view = render(<BackgroundImageRow {...props} />)
  return { instance, injected, view }
}

/**
 * Open the picker from the row's trigger.
 * @returns nothing; the dialog is queried from the document afterwards.
 */
function openPicker(): void {
  fireEvent.click(screen.getByRole('button', { name: zh['background.trigger'] }))
}

/** @returns the tile button carrying one label. */
function tile(label: string): HTMLElement {
  return screen.getByRole('button', { name: label })
}

/**
 * Click one control a query matches more than once.
 *
 * A dialog carries the same label on its head's close control and on the action
 * in its footer, so the position is the point of the case and a missing element
 * has to fail as a missing element.
 * @param label - accessible name to look for.
 * @param index - position to click; negative counts from the end.
 */
function clickButton(label: string, index: number): void {
  const buttons = screen.getAllByRole('button', { name: label })
  const button = buttons.at(index)
  if (button === undefined) throw new Error(`no button named ${label} at index ${index} of ${buttons.length}`)
  fireEvent.click(button)
}

/** @returns the opacity control. */
function slider(): HTMLElement {
  return screen.getByRole('slider', { name: zh['opacity.label'] })
}

describe('the row', () => {
  it('states what the preference is for', () => {
    mount()
    expect(screen.getByText(zh['background.title'])).toBeDefined()
    expect(screen.getByText(zh['background.description'])).toBeDefined()
  })

  it('names a chosen preset on the trigger', () => {
    mount({ selection: { source: 'preset', id: 'dusk', opacity: 65, url: '' } })
    expect(screen.getByRole('button', { name: zh['background.trigger'] }).textContent).toContain(zh['preset.dusk'])
  })

  it('draws the chosen preset on the trigger, so the row previews the choice', () => {
    const { view } = mount({ selection: { source: 'preset', id: 'dusk', opacity: 65, url: '' } })
    const swatch = view.container.querySelector('span[style]')
    expect(swatch?.getAttribute('style')).toContain(backgroundPresetValue('dusk').light.slice(0, 24))
  })

  it('draws the dark value of the chosen preset while the dark palette is active', () => {
    const { view } = mount({ selection: { source: 'preset', id: 'dusk', opacity: 65, url: '' }, colorScheme: 'dark' })
    const swatch = view.container.querySelector('span[style]')
    expect(swatch?.getAttribute('style')).toContain(backgroundPresetValue('dusk').dark.slice(0, 24))
  })

  it('names a stored image the catalogue holds', () => {
    mount({ selection: { source: 'upload', id: STORED.id, opacity: 65, url: '' }, images: [STORED] })
    expect(screen.getByRole('button', { name: zh['background.trigger'] }).textContent).toContain(STORED.name)
  })

  it('names a stored image the catalogue has not read yet', () => {
    mount({ selection: { source: 'upload', id: STORED.id, opacity: 65, url: '' }, catalog: 'loading' })
    expect(screen.getByRole('button', { name: zh['background.trigger'] }).textContent)
      .toContain(zh['background.unknownName'])
  })

  it('falls back to the harness background for a preset this build does not ship', () => {
    // The selection crosses a settings document this build does not own, so an
    // id no longer shipped is a value that can arrive; the row still has to
    // name what the user is looking at.
    mount({ selection: { source: 'preset', id: 'comic', opacity: 65, url: '' } })
    expect(screen.getByRole('button', { name: zh['background.trigger'] }).textContent).toContain(zh['preset.none'])
  })

  it('reports a completed action that carried no name', () => {
    mount({ notice: 'reset' })
    expect(screen.getByText(zh['notice.reset'])).toBeDefined()
  })

  it('warns when the selection names a background that is gone', () => {
    mount({ selection: { source: 'upload', id: STORED.id, opacity: 65, url: '' }, available: false })
    expect(screen.getByText(zh['background.missing'])).toBeDefined()
  })

  it('reports a completed action', () => {
    mount({ notice: 'uploaded', noticeDetail: 'sunset' })
    expect(screen.getByText(`${zh['notice.uploaded']} · sunset`)).toBeDefined()
  })

  it('reports a refusal with the reason the Host gave', () => {
    mount({ notice: 'uploadFailed', noticeDetail: 'not an image' })
    expect(screen.getByText(`${zh['notice.uploadFailed']} · not an image`)).toBeDefined()
  })

  it('reports a catalogue it could not read without a reason to add', () => {
    mount({ catalog: 'failed' })
    expect(screen.getByText(zh['notice.loadFailed'])).toBeDefined()
  })

  it('reports a catalogue it could not read, and reads it again on request', () => {
    const { injected } = mount({ catalog: 'failed', catalogError: 'the Host went away' })
    expect(screen.getByText(`${zh['notice.loadFailed']} · the Host went away`)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: zh['action.retry'] }))
    expect(injected.reload).toHaveBeenCalledTimes(1)
  })
})

describe('the picker', () => {
  it('offers every shipped preset and the harness background', () => {
    mount()
    openPicker()
    expect(screen.getByRole('dialog', { name: zh['picker.title'] })).toBeDefined()
    for (const label of [zh['preset.none'], zh['preset.mist'], zh['preset.dusk'], zh['preset.ember'], zh['preset.verdant']]) {
      expect(tile(label)).toBeDefined()
    }
  })

  it('says so when nothing has been uploaded yet', () => {
    mount()
    openPicker()
    expect(screen.getByText(zh['uploaded.empty'])).toBeDefined()
  })

  it('lists the stored images as tiles that preview their own file', () => {
    const { view } = mount({ images: [STORED], catalog: 'ready' })
    openPicker()
    const image = view.baseElement.querySelector('img')
    expect(image?.getAttribute('src')).toContain(STORED.id)
    // Off-screen tiles are not fetched on the dialog's first paint.
    expect(image?.getAttribute('loading')).toBe('lazy')
  })

  it('composites the surface over every preset, so a tile previews the interface', () => {
    const tint = surfaceValue(surfaceAlphaPercent(DEFAULT_BACKGROUND_OPACITY)).light
    const { view } = mount()
    openPicker()
    const tints = [...view.baseElement.querySelectorAll('button[aria-pressed] span span')]
      .filter(element => element.getAttribute('style') !== null)
    // Four presets paint a canvas; the harness's own background paints none, so
    // its tile carries nothing to composite over.
    expect(tints).toHaveLength(4)
    for (const element of tints) {
      expect(element.getAttribute('style')).toContain(tint)
    }
  })

  it('marks the current selection', () => {
    mount({ selection: { source: 'preset', id: 'mist', opacity: 65, url: '' } })
    openPicker()
    expect(tile(zh['preset.mist']).getAttribute('aria-pressed')).toBe('true')
    expect(tile(zh['preset.dusk']).getAttribute('aria-pressed')).toBe('false')
  })

  it('selects a preset and closes', () => {
    const { injected } = mount()
    openPicker()
    fireEvent.click(tile(zh['preset.mist']))
    expect(injected.select).toHaveBeenCalledWith('preset', 'mist')
    expect(screen.queryByRole('dialog', { name: zh['picker.title'] })).toBeNull()
  })

  it('selects a stored image', () => {
    const { injected } = mount({ images: [STORED] })
    openPicker()
    fireEvent.click(tile(STORED.name))
    expect(injected.select).toHaveBeenCalledWith('upload', STORED.id)
  })

  it('restores the default background', () => {
    const { injected } = mount()
    openPicker()
    fireEvent.click(screen.getByRole('button', { name: zh['action.reset'] }))
    expect(injected.reset).toHaveBeenCalledTimes(1)
  })

  it('closes without changing anything', () => {
    const { injected } = mount()
    openPicker()
    clickButton(zh['action.close'], -1)
    expect(screen.queryByRole('dialog', { name: zh['picker.title'] })).toBeNull()
    expect(injected.select).not.toHaveBeenCalled()
  })
})

describe('the opacity control', () => {
  it('reads out the value the interface is showing', () => {
    mount({ opacity: 40 })
    openPicker()
    expect(screen.getByText('40%')).toBeDefined()
    expect(slider().getAttribute('aria-valuetext')).toBe('40%')
    expect(slider().getAttribute('min')).toBe('0')
    expect(slider().getAttribute('max')).toBe('100')
  })

  it('previews every movement without persisting it', () => {
    const { injected } = mount()
    openPicker()
    fireEvent.input(slider(), { target: { value: '30' } })
    expect(injected.previewOpacity).toHaveBeenCalledWith(30)
    expect(injected.commitOpacity).not.toHaveBeenCalled()
  })

  it('persists what a drag settled on', () => {
    const { injected } = mount()
    openPicker()
    fireEvent.input(slider(), { target: { value: '30' } })
    fireEvent.pointerUp(slider())
    expect(injected.commitOpacity).toHaveBeenCalledWith(30)
  })

  it('persists what the keyboard settled on', () => {
    const { injected } = mount()
    openPicker()
    fireEvent.input(slider(), { target: { value: '45' } })
    fireEvent.keyUp(slider())
    expect(injected.commitOpacity).toHaveBeenCalledWith(45)
  })

  it('persists what a click on the track settled on', () => {
    const { injected } = mount()
    openPicker()
    fireEvent.input(slider(), { target: { value: '55' } })
    fireEvent.blur(slider())
    expect(injected.commitOpacity).toHaveBeenCalledWith(55)
  })

  it('settles a preview the dialog closed on', () => {
    // A drag that ended on the scrim rather than on the control still leaves the
    // interface and the document agreeing on one opacity.
    const { injected } = mount({ opacity: 20 })
    openPicker()
    fireEvent.input(slider(), { target: { value: '70' } })
    clickButton(zh['action.close'], -1)
    expect(injected.commitOpacity).toHaveBeenCalledWith(70)
  })
})

describe('the management dialog', () => {
  /**
   * Open the manager from the picker's footer.
   * @returns nothing; the dialog is queried from the document afterwards.
   */
  function openManager(): void {
    openPicker()
    fireEvent.click(screen.getByRole('button', { name: zh['action.manage'] }))
  }

  it('names the directory the Host stores images in', () => {
    mount()
    openManager()
    expect(screen.getByRole('dialog', { name: zh['manager.title'] })).toBeDefined()
    expect(screen.getByText('/home/example/.dsh/backgrounds')).toBeDefined()
  })

  it('persists a previewed opacity when it takes over from the picker', () => {
    // Managing is a detour, not a close: the value on screen is the user's
    // choice, and leaving it unwritten would put the interface and the document
    // out of step until the next visit.
    const { injected } = mount()
    openPicker()
    fireEvent.input(slider(), { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: zh['action.manage'] }))
    expect(injected.commitOpacity).toHaveBeenCalledWith(30)
    expect(screen.queryByRole('dialog', { name: zh['picker.title'] })).toBeNull()
    expect(screen.getByRole('dialog', { name: zh['manager.title'] })).toBeDefined()
  })

  it('says where the images are when the Host withheld the path', () => {
    mount({ directory: null })
    openManager()
    expect(screen.getByText(zh['manager.descriptionRemote'])).toBeDefined()
  })

  it('lists the stored images and deletes one after a confirmation', () => {
    const { injected } = mount({ images: [STORED] })
    openManager()
    fireEvent.click(screen.getByRole('button', { name: `${zh['action.remove']} ${STORED.name}` }))
    expect(injected.remove).not.toHaveBeenCalled()
    clickButton(zh['confirm.confirm'], -1)
    expect(injected.remove).toHaveBeenCalledWith(STORED.id)
  })

  it('leaves the image alone when the confirmation is dismissed', () => {
    const { injected } = mount({ images: [STORED] })
    openManager()
    fireEvent.click(screen.getByRole('button', { name: `${zh['action.remove']} ${STORED.name}` }))
    clickButton(zh['confirm.cancel'], -1)
    expect(injected.remove).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: zh['confirm.title'] })).toBeNull()
  })

  it('leaves the image alone when the confirmation is closed from its head', () => {
    const { injected } = mount({ images: [STORED] })
    openManager()
    fireEvent.click(screen.getByRole('button', { name: `${zh['action.remove']} ${STORED.name}` }))
    clickButton(zh['confirm.cancel'], 0)
    expect(injected.remove).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: zh['confirm.title'] })).toBeNull()
  })

  it('says so when nothing has been uploaded', () => {
    mount()
    openManager()
    expect(screen.getByText(zh['uploaded.empty'])).toBeDefined()
  })

  it('uploads a chosen file', () => {
    const { injected, view } = mount()
    openManager()
    const input = view.baseElement.querySelector('input[type=file]')
    const file = new File([new Uint8Array([1, 2, 3])], 'Sunset.png', { type: 'image/png' })
    fireEvent.change(input as HTMLInputElement, { target: { files: [file] } })
    expect(injected.upload).toHaveBeenCalledWith(file)
  })

  it('highlights itself while a file is dragged over it', () => {
    mount()
    openManager()
    const dropzone = screen.getByText(zh['manager.drop']).parentElement
    if (dropzone === null) throw new Error('the drop area is not rendered')
    fireEvent.dragOver(dropzone)
    expect(dropzone.className).toMatch(/dropzoneActive/i)
    fireEvent.dragLeave(dropzone)
    expect(dropzone.className).not.toMatch(/dropzoneActive/i)
  })

  it('opens the file chooser from the browse control', () => {
    const { view } = mount()
    openManager()
    const input = view.baseElement.querySelector('input[type=file]')
    if (input === null) throw new Error('the file input is not rendered')
    const click = vi.spyOn(input as HTMLInputElement, 'click')
    fireEvent.click(screen.getByRole('button', { name: zh['manager.browse'] }))
    expect(click).toHaveBeenCalledTimes(1)
  })

  it('accepts only the containers this plugin can serve, and one file at a time', () => {
    const { view } = mount()
    openManager()
    const input = view.baseElement.querySelector('input[type=file]')
    expect(input?.getAttribute('accept')).toContain('.png')
    expect(input?.hasAttribute('multiple')).toBe(false)
  })

  it('uploads a dropped file', () => {
    const { injected } = mount()
    openManager()
    const file = new File([new Uint8Array([1, 2, 3])], 'Sunset.png', { type: 'image/png' })
    fireEvent.drop(screen.getByText(zh['manager.drop']), { dataTransfer: { files: [file] } })
    expect(injected.upload).toHaveBeenCalledWith(file)
  })

  it('refuses a second file while one is uploading', () => {
    const { injected } = mount({ busy: true })
    openManager()
    const file = new File([new Uint8Array([1, 2, 3])], 'Sunset.png', { type: 'image/png' })
    fireEvent.drop(screen.getByText(zh['manager.uploading']), { dataTransfer: { files: [file] } })
    expect(injected.upload).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: zh['manager.browse'] }).hasAttribute('disabled')).toBe(true)
  })

  it('hands the picker back when it closes, so the new image can be chosen', () => {
    mount()
    openManager()
    clickButton(zh['manager.close'], -1)
    expect(screen.queryByRole('dialog', { name: zh['manager.title'] })).toBeNull()
    expect(screen.getByRole('dialog', { name: zh['picker.title'] })).toBeDefined()
  })
})

describe('a remote background', () => {
  /** The row's selector button, which names the current background. */
  function selector(): HTMLElement {
    return screen.getByRole('button', { name: zh['background.trigger'] })
  }

  it('names the host of the chosen image rather than the whole URL', () => {
    mount({
      selection: { source: 'remote', id: '', opacity: 65, url: 'https://cdn.example.com/deep/path/a.png' },
    })
    expect(selector().textContent).toContain('cdn.example.com')
    expect(selector().textContent).not.toContain('deep/path')
  })

  it('names an inline image as one, in the row and in the picker', () => {
    mount({
      selection: { source: 'remote', id: '', opacity: 65, url: 'data:image/png;base64,AAAA' },
    })
    expect(selector().textContent).toContain(zh['remote.inline'])
    openPicker()
    expect(tile(zh['remote.inline']).getAttribute('aria-pressed')).toBe('true')
  })

  it('falls back to the unnamed-background copy when the stored text is not a URL', () => {
    mount({ selection: { source: 'remote', id: '', opacity: 65, url: 'not a url' } })
    expect(selector().textContent).toContain(zh['background.unknownName'])
  })

  it('shows the refusal with the reason the Host named', () => {
    mount({ notice: 'remoteRefused', noticeDetail: 'private' })
    expect(document.body.textContent).toContain(zh['notice.remoteRefused'])
    expect(document.body.textContent).toContain(zh['remote.reason.private'])
  })

  it('shows a refusal code this build does not know as it arrived', () => {
    mount({ notice: 'remoteRefused', noticeDetail: 'quota' })
    expect(document.body.textContent).toContain('quota')
  })

  it('asks the Host to judge a pasted URL from the picker', () => {
    const { injected } = mount()
    openPicker()
    fireEvent.change(screen.getByLabelText(zh['remote.label']), {
      target: { value: 'https://cdn.example.com/a.png' },
    })
    fireEvent.click(screen.getByRole('button', { name: zh['remote.add'] }))
    expect(injected.selectRemote).toHaveBeenCalledWith('https://cdn.example.com/a.png')
  })

  it('previews a chosen remote image without a referrer, and marks it selected', () => {
    mount({ selection: { source: 'remote', id: '', opacity: 65, url: 'https://cdn.example.com/a.png' } })
    openPicker()
    const image = document.querySelector('img[src="https://cdn.example.com/a.png"]')
    expect(image?.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(tile('cdn.example.com').getAttribute('aria-pressed')).toBe('true')
  })

  it('submits the field on Enter, the way the button does', () => {
    const { injected } = mount()
    openPicker()
    const field = screen.getByLabelText(zh['remote.label'])
    fireEvent.change(field, { target: { value: 'https://cdn.example.com/a.png' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(injected.selectRemote).toHaveBeenCalledWith('https://cdn.example.com/a.png')
    fireEvent.keyDown(field, { key: 'a' })
    expect(injected.selectRemote).toHaveBeenCalledTimes(1)
  })

  it('submits nothing from an empty field', () => {
    const { injected } = mount()
    openPicker()
    fireEvent.keyDown(screen.getByLabelText(zh['remote.label']), { key: 'Enter' })
    expect(injected.selectRemote).not.toHaveBeenCalled()
  })

  it('keeps the field inert until it carries something, and while the Host is judging', () => {
    mount()
    openPicker()
    const button = screen.getByRole('button', { name: zh['remote.add'] }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(zh['remote.label']), { target: { value: '   ' } })
    fireEvent.click(button)
    expect(button.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(zh['remote.label']), { target: { value: 'https://cdn.example.com/a.png' } })
    expect(button.disabled).toBe(false)
  })

  it('shows the refusal inside the open picker', () => {
    mount({ notice: 'remoteRefused', noticeDetail: 'private' })
    openPicker()
    const dialog = screen.getByRole('dialog', { name: zh['picker.title'] })
    expect(dialog.textContent).toContain(zh['remote.reason.private'])
  })
})
