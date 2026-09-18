/**
 * Browser-side state of the background row: the persisted selection, the image
 * catalogue, the palette mode the previews must render in, and the canvas the
 * selection projects onto.
 *
 * One runtime owns every mutation. It is the only caller of the Host routes and
 * the only writer of the projected canvas, so the row and its dialogs cannot
 * disagree about what is selected, stored, or showing.
 *
 * Every asynchronous continuation checks {@link disposed} before it touches
 * state, so a runtime the plugin has released neither writes the document nor
 * notifies a listener that outlived it.
 * @module dsh-plugin-ui-background-image/client/background-runtime
 */

import { fileSizeText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-settings/types'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { BackgroundImageSummary } from '../background-api.ts'
import { surfaceValue } from '../background-canvas.ts'
import { judgeRemoteImageUrl, type RemotePolicy } from '../background-remote.ts'
import { DEFAULT_BACKGROUND_OPACITY, surfaceAlphaPercent } from '../background-opacity.ts'
import { DEFAULT_BACKGROUND_PRESET_ID } from '../background-presets.ts'
import {
  isBackgroundSelectionAvailable,
  resolveBackgroundProjection,
  UNREAD_BACKGROUND_CATALOGUES,
  type BackgroundCatalogues,
} from '../background-selection.ts'
import {
  BACKGROUND_ID_FIELD,
  BACKGROUND_OPACITY_FIELD,
  BACKGROUND_SOURCE_FIELD,
  BACKGROUND_URL_FIELD,
  DEFAULT_BACKGROUND_SETTINGS,
  DEFAULT_BACKGROUND_SOURCE,
  type BackgroundSettings,
  type BackgroundSource,
} from '../background-settings.ts'
import {
  approveRemoteImage,
  deleteBackgroundImage,
  EMPTY_BACKGROUND_CATALOG,
  fetchBackgroundCatalog,
  BackgroundRequestError,
  uploadBackgroundImage,
  type BackgroundCatalog,
} from './background-catalog.ts'
import { BackgroundPresenter, type ThemeTokenWriter } from './background-presenter.ts'

/** Colour scheme the palette is currently in; previews render in it. */
export type BackgroundColorScheme = 'light' | 'dark'

/** Catalogue read state of the row. */
export type BackgroundCatalogStatus = 'loading' | 'ready' | 'failed'

/**
 * Outcome of the last write, as a code the row localizes. Codes rather than
 * text, because copy belongs to the locale dictionary.
 */
export type BackgroundNotice =
  | ''
  | 'uploaded'
  | 'removed'
  | 'reset'
  | 'remoteAdded'
  | 'uploadFailed'
  | 'removeFailed'
  | 'settingsFailed'
  | 'tooLarge'
  | 'remoteRefused'
  | 'remoteFailed'

/**
 * Whether one outcome reports a failure rather than a completed action. A new
 * code joins {@link BackgroundNotice} and this classification together.
 * @param notice - outcome code.
 * @returns whether the outcome is a failure.
 */
export function isBackgroundNoticeFailure(notice: BackgroundNotice): boolean {
  return notice === 'uploadFailed' || notice === 'removeFailed'
    || notice === 'settingsFailed' || notice === 'tooLarge'
    || notice === 'remoteRefused' || notice === 'remoteFailed'
}

/** Immutable view of everything the settings row renders. */
export interface BackgroundRowSnapshot {
  /** Monotonic sequence; a consumer drops a snapshot that is not newer. */
  seq: number
  /** Persisted selection, as the settings document holds it. */
  selection: BackgroundSettings
  /**
   * Opacity the interface is showing: the selection's own value, or the one a
   * drag is previewing until it is committed.
   */
  opacity: number
  /**
   * Colour the surfaces carry at {@link opacity} in the active mode.
   *
   * This is the value the presenter installs, carried to the interface so a
   * preview can composite a candidate background under it. Reading the token
   * itself would not do: the token is the harness's own opaque colour until a
   * background is installed, which is the state a preview exists for.
   */
  surfaceTint: string
  /** Palette mode the preset previews must render in. */
  colorScheme: BackgroundColorScheme
  /** Catalogue read state. */
  catalog: BackgroundCatalogStatus
  /** Reason the catalogue read failed; empty unless `catalog` is `failed`. */
  catalogError: string
  /** Absolute directory holding uploaded images; null before the first read and when withheld. */
  directory: string | null
  /** Images the Host's directory holds. */
  images: readonly BackgroundImageSummary[]
  /** Whether the selection still names a background that exists. */
  available: boolean
  /** Whether a catalogue write is in flight. */
  busy: boolean
  /** Outcome of the last write. */
  notice: BackgroundNotice
  /** Detail behind a failed write, verbatim from the Host; empty otherwise. */
  noticeDetail: string
}

/**
 * Render one caught value as the detail line of a notice.
 * @param error - value a request or a write rejected with.
 * @returns the error's message, or the value read as text.
 */
function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Path operations selecting one background. Both fields move in one write: a
 * lone `source` would be validated against the previous `id`, so a legal switch
 * away from a preset would be refused mid-transition.
 * @param settings - selection to persist.
 * @returns the operations for one validated write.
 */
function selectOps(
  settings: Pick<BackgroundSettings, 'source' | 'id' | 'url'>,
): readonly SettingsPathOpView[] {
  return [
    { op: 'set', path: [BACKGROUND_SOURCE_FIELD], value: settings.source },
    { op: 'set', path: [BACKGROUND_ID_FIELD], value: settings.id },
    { op: 'set', path: [BACKGROUND_URL_FIELD], value: settings.url },
  ]
}

/**
 * Path operations carrying one committed opacity.
 * @param opacity - whole percent to persist.
 * @returns the operations for one validated write.
 */
function opacityOps(opacity: number): readonly SettingsPathOpView[] {
  return [{ op: 'set', path: [BACKGROUND_OPACITY_FIELD], value: opacity }]
}

/**
 * Path operations clearing the selection, revealing the composition default.
 * @returns the operations for one validated write.
 */
function clearOps(): readonly SettingsPathOpView[] {
  return [
    ...clearSelectionOps(),
    { op: 'unset', path: [BACKGROUND_OPACITY_FIELD] },
  ]
}

/**
 * Path operations clearing which background is chosen, leaving the strength the
 * user set for whatever they choose next.
 * @returns the operations for one validated write.
 */
function clearSelectionOps(): readonly SettingsPathOpView[] {
  return [
    { op: 'unset', path: [BACKGROUND_SOURCE_FIELD] },
    { op: 'unset', path: [BACKGROUND_ID_FIELD] },
    { op: 'unset', path: [BACKGROUND_URL_FIELD] },
  ]
}

/** Sort uploaded images the way the catalogue reads, so both orders agree. */
function byName(left: BackgroundImageSummary, right: BackgroundImageSummary): number {
  return left.name.localeCompare(right.name)
}

/** Map a failed catalogue request to the code the row reports. */
function failureCode(error: unknown, fallback: BackgroundNotice): BackgroundNotice {
  if (error instanceof BackgroundRequestError && error.status === 413) return 'tooLarge'
  return fallback
}

/** Background row state and the operations the settings page performs on it. */
export class BackgroundRuntime {
  private readonly host: SettingsScope<BackgroundSettings>
  private readonly presenter: BackgroundPresenter
  private readonly listeners = new Set<() => void>()
  private readonly abort = new AbortController()

  private catalog: BackgroundCatalog = EMPTY_BACKGROUND_CATALOG
  private catalogStatus: BackgroundCatalogStatus = 'loading'
  private catalogError = ''
  private settings: BackgroundSettings = DEFAULT_BACKGROUND_SETTINGS
  private preview: number | undefined
  private colorScheme: BackgroundColorScheme = 'light'
  private available = true
  private busy = false
  private notice: BackgroundNotice = ''
  private noticeDetail = ''
  private frame: number | undefined
  private seq = 0
  private disposed = false
  private snapshot: BackgroundRowSnapshot

  /**
   * @param host - durable settings scope owned by the same plugin; the runtime
   * never binds its own, so one namespace has one writer.
   * @param theme - client theme service; it owns the token write.
   */
  constructor(host: SettingsScope<BackgroundSettings>, theme: ThemeTokenWriter) {
    this.host = host
    this.presenter = new BackgroundPresenter(theme)
    this.snapshot = this.buildSnapshot()
  }

  /**
   * Install the canvas rule, adopt the settings document, then read the
   * catalogue.
   * @returns the subscription disposer, owned by the caller's effect.
   */
  start(): () => void {
    this.presenter.start()
    const unsubscribe = this.host.subscribe(() => { this.adopt() })
    this.adopt()
    this.reloadCatalog()
    return unsubscribe
  }

  /**
   * Read the current view.
   * @returns the snapshot; the same reference until the next change.
   */
  getSnapshot(): BackgroundRowSnapshot {
    return this.snapshot
  }

  /**
   * Subscribe to view changes.
   * @param listener - called after each published snapshot.
   * @returns the unsubscribe function.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Adopt the palette mode the previews must render in.
   * @param colorScheme - mode the active theme resolved to.
   */
  setColorScheme(colorScheme: BackgroundColorScheme): void {
    if (this.colorScheme === colorScheme) return
    this.colorScheme = colorScheme
    this.publish()
  }

  /**
   * Select one background from one catalogue.
   * @param source - catalogue the id indexes.
   * @param id - preset id or stored image id.
   */
  select(source: BackgroundSource, id: string): void {
    this.settings = { ...this.settings, source, id, url: '' }
    this.setNotice('', '')
    this.project()
    this.publish()
    this.write(selectOps({ source, id, url: '' }), 'settingsFailed')
  }

  /**
   * Select one remote image, once the Host has approved the URL.
   *
   * The URL is judged twice before anything is stored: this half refuses text
   * that could never be a background (a scheme other than `https`, an address
   * instead of a hostname, a URL carrying credentials), and the Host answers for
   * what text cannot — the deployment's allowlist and whether the name resolves
   * to public addresses only. Only an approved URL is written to the document.
   * @param url - URL text the user supplied.
   */
  selectRemote(url: string): void {
    const verdict = judgeRemoteImageUrl(url, this.remotePolicy())
    if (verdict.kind === 'refused') {
      this.setNotice('remoteRefused', verdict.reason)
      this.publish()
      return
    }
    this.busy = true
    this.setNotice('', '')
    this.publish()
    void approveRemoteImage(verdict.url, this.abort.signal)
      .then((approved) => {
        if (this.disposed) return
        this.busy = false
        this.settings = { ...this.settings, source: 'remote', id: '', url: approved.url }
        this.setNotice('remoteAdded', approved.host)
        this.project()
        this.publish()
        this.write(selectOps({ source: 'remote', id: '', url: approved.url }), 'remoteFailed')
      })
      .catch((error: unknown) => {
        if (this.disposed) return
        this.busy = false
        // The Host answers a refusal with the reason code, which is what the row
        // localizes; anything else is a failure of the request itself.
        const code = error instanceof BackgroundRequestError ? error.code : undefined
        if (code === undefined) this.setNotice(failureCode(error, 'remoteFailed'), errorDetail(error))
        else this.setNotice('remoteRefused', code)
        this.publish()
      })
  }

  /**
   * Show an opacity the user is dragging toward, without persisting it.
   *
   * The readout and the previews follow on this call; the document write is
   * coalesced to the next animation frame, so a drag costs one projection per
   * frame however many pointer events it produces, and the settings document is
   * not written until {@link commit}.
   * @param opacity - whole percent the slider is at.
   */
  previewOpacity(opacity: number): void {
    this.preview = opacity
    this.publish()
    if (this.frame !== undefined) return
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined
      this.project()
    })
  }

  /**
   * Persist the opacity the user settled on, writing once for the whole drag.
   * @param opacity - whole percent to persist.
   */
  commit(opacity: number): void {
    this.cancelFrame()
    this.preview = undefined
    if (opacity !== this.settings.opacity) {
      this.settings = { ...this.settings, opacity }
      this.setNotice('', '')
      this.project()
      this.publish()
      this.write(opacityOps(opacity), 'settingsFailed')
      return
    }
    // Nothing moved: put the document back on the settled value, which the last
    // previewed frame may have left mid-drag.
    this.project()
    this.publish()
  }

  /**
   * Clear the user's choice, revealing the profile's composition default.
   */
  reset(): void {
    this.cancelFrame()
    this.preview = undefined
    this.settings = {
      source: DEFAULT_BACKGROUND_SOURCE,
      id: DEFAULT_BACKGROUND_PRESET_ID,
      opacity: DEFAULT_BACKGROUND_OPACITY,
      url: '',
    }
    this.setNotice('reset', '')
    this.project()
    this.publish()
    this.write(clearOps(), 'settingsFailed')
  }

  /** Read the catalogue again, e.g. after an image was copied in by hand. */
  reloadCatalog(): void {
    this.catalogStatus = 'loading'
    this.publish()
    void fetchBackgroundCatalog(this.abort.signal)
      .then((catalog) => {
        if (this.disposed) return
        this.catalog = catalog
        this.catalogStatus = 'ready'
        this.catalogError = ''
        this.project()
        this.publish()
      })
      .catch((error: unknown) => {
        if (this.disposed) return
        this.catalogStatus = 'failed'
        this.catalogError = errorDetail(error)
        // The projected canvas is left alone: it came from the Host's
        // first-paint row, which had this catalogue, and falling back here
        // would replace a correct background with a guess.
        this.publish()
      })
  }

  /**
   * Store one image file and select it. A file past the Host's limit is refused
   * before it is read, with the limit named so the user knows what to bring.
   * @param file - file the user chose or dropped.
   */
  upload(file: File): void {
    const limit = this.catalog.maxUploadBytes
    if (file.size > limit) {
      this.setNotice('tooLarge', fileSizeText(limit))
      this.publish()
      return
    }
    this.busy = true
    this.setNotice('', '')
    this.publish()
    void file.arrayBuffer()
      .then(async (bytes) => uploadBackgroundImage(bytes, file.name, this.abort.signal))
      .then((summary) => {
        if (this.disposed) return
        this.busy = false
        // Fold the stored entry into the catalogue before selecting it, so the
        // new image resolves on this publish instead of after a second read.
        this.catalog = {
          ...this.catalog,
          images: [...this.catalog.images, summary].sort(byName),
        }
        this.catalogStatus = 'ready'
        this.settings = { ...this.settings, source: 'upload', id: summary.id, url: '' }
        this.setNotice('uploaded', summary.name)
        this.project()
        this.publish()
        this.write(selectOps({ source: 'upload', id: summary.id, url: '' }), 'uploadFailed')
        // The fold above serves this image immediately; this read makes the
        // catalogue agree with the directory for everything else, a file copied
        // in by hand included. One directory read per upload, on a user action
        // rather than on every page load.
        this.reloadCatalog()
      })
      .catch((error: unknown) => {
        if (this.disposed) return
        this.busy = false
        this.setNotice(failureCode(error, 'uploadFailed'), errorDetail(error))
        this.publish()
      })
  }

  /**
   * Delete one stored image. Deleting the image in use clears the selection, so
   * no document is left pointing at a file that is gone.
   * @param id - stored image id.
   */
  remove(id: string): void {
    this.busy = true
    this.setNotice('', '')
    this.publish()
    void deleteBackgroundImage(id, this.abort.signal)
      .then(() => {
        if (this.disposed) return
        this.busy = false
        this.catalog = {
          ...this.catalog,
          images: this.catalog.images.filter(entry => entry.id !== id),
        }
        if (this.settings.source === 'upload' && this.settings.id === id) {
          this.settings = {
            source: DEFAULT_BACKGROUND_SOURCE,
            id: DEFAULT_BACKGROUND_PRESET_ID,
            opacity: this.settings.opacity,
            url: '',
          }
          this.setNotice('removed', '')
          // The image is what went away, not the strength the user chose for a
          // background: clearing only the selection leaves that preference for
          // whatever they pick next.
          this.write(clearSelectionOps(), 'removeFailed')
        } else {
          this.setNotice('removed', '')
        }
        this.project()
        this.publish()
      })
      .catch((error: unknown) => {
        if (this.disposed) return
        this.busy = false
        this.setNotice(failureCode(error, 'removeFailed'), errorDetail(error))
        this.publish()
      })
  }

  /** Release the request controller, the pending frame, and the projected canvas. */
  dispose(): void {
    this.disposed = true
    this.cancelFrame()
    this.abort.abort()
    this.listeners.clear()
    this.presenter.dispose()
  }

  /** Adopt the resolved settings document value and re-project. */
  private adopt(): void {
    const value = this.host.getSnapshot().value
    // Until the Host resolves this namespace the runtime has no selection to
    // project, and the canvas it must leave standing is the one the served page
    // painted from the same document. Retracting that write would clear the
    // background the user chose for as long as the document takes to arrive, so
    // the runtime moves only once it has a value to move to.
    if (value === undefined) return
    const changed = value.source !== this.settings.source
      || value.id !== this.settings.id
      || value.opacity !== this.settings.opacity
    this.settings = value
    // Every settings write republishes each namespace, so a change resolving to
    // the published selection needs no re-projection: re-installing the theme
    // layer would rewrite the document for an unchanged background. The first
    // adoption still projects, so a runtime always publishes an opening
    // snapshot.
    if (!changed && this.seq > 0) return
    this.project()
    this.publish()
  }

  /**
   * Resolve the selection, report whether it still names a fetchable
   * background, and install the canvas.
   *
   * The catalogue is reported unread until a successful read, so an `upload`
   * selection keeps the canvas the Host already painted rather than flashing
   * the default while the catalogue is in flight.
   */
  /**
   * Policy this deployment applies to remote URLs.
   *
   * The mode arrives with the catalogue, so the page judges a URL exactly the
   * way the Host will; until that first read answers, the strict default is
   * what this page applies, which refuses more rather than less.
   * @returns the policy the local judgement uses.
   */
  private remotePolicy(): RemotePolicy {
    return { access: this.catalog.remoteImageAccess, hostAllowlist: [] }
  }

  private project(): void {
    // A disposed runtime still answers a stale control that has not unmounted;
    // writing the document then would outlive the plugin that owns it.
    if (this.disposed) return
    const catalogues: BackgroundCatalogues = this.catalogStatus === 'ready'
      ? { images: new Set(this.catalog.images.map(entry => entry.id)) }
      : UNREAD_BACKGROUND_CATALOGUES
    this.available = isBackgroundSelectionAvailable(this.settings, catalogues, this.remotePolicy())
    const projection = resolveBackgroundProjection(this.settings, catalogues, this.remotePolicy())
    // An unresolved selection keeps the canvas the Host installed, which had
    // this catalogue; resolving it to the default here would replace a correct
    // background with a guess while the read is still in flight.
    if (projection.kind === 'unresolved') return
    this.presenter.install(projection.kind === 'values' ? projection.values : undefined, this.preview ?? this.settings.opacity)
  }

  /** Drop the coalesced preview projection, if one is waiting for a frame. */
  private cancelFrame(): void {
    if (this.frame === undefined) return
    cancelAnimationFrame(this.frame)
    this.frame = undefined
  }

  /**
   * Queue one settings write, reporting a refusal rather than dropping it.
   * @param ops - path operations applied as one validated write.
   * @param code - outcome to report when the document refuses the write; the
   * caller names the action, because a refused selection is not a failed upload
   * and saying so would send the user looking at the wrong thing.
   */
  private write(ops: readonly SettingsPathOpView[], code: BackgroundNotice): void {
    void this.host.mutate(ops).catch((error: unknown) => {
      if (this.disposed) return
      this.setNotice(code, errorDetail(error))
      this.publish()
    })
  }

  /**
   * Set the reported outcome.
   * @param notice - outcome code.
   * @param detail - detail behind a failure, or the affected image name.
   */
  private setNotice(notice: BackgroundNotice, detail: string): void {
    this.notice = notice
    this.noticeDetail = detail
  }

  /** Freeze the current state into a new snapshot and notify subscribers. */
  private publish(): void {
    this.seq += 1
    this.snapshot = this.buildSnapshot()
    for (const listener of this.listeners) listener()
  }

  /** @returns a snapshot of the current field values. */
  private buildSnapshot(): BackgroundRowSnapshot {
    return {
      seq: this.seq,
      selection: this.settings,
      opacity: this.preview ?? this.settings.opacity,
      surfaceTint: surfaceValue(surfaceAlphaPercent(this.preview ?? this.settings.opacity))[this.colorScheme],
      colorScheme: this.colorScheme,
      catalog: this.catalogStatus,
      catalogError: this.catalogError,
      directory: this.catalog.directory,
      images: this.catalog.images,
      available: this.available,
      busy: this.busy,
      notice: this.notice,
      noticeDetail: this.noticeDetail,
    }
  }
}
