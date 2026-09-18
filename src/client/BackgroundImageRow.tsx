/**
 * Background image preference row registered into the General section item
 * slot: title, description, and a selector that opens the picker.
 *
 * The selector previews the chosen background on itself — the shipped presets
 * as their own gradient, an uploaded image by name — so the row states the
 * current background without fetching a multi-megabyte file into a 20px swatch.
 * Choosing is frequent and visual and belongs in the picker; uploading and
 * deleting are rare and have their own dialog.
 * @module dsh-plugin-ui-background-image/client/BackgroundImageRow
 */

import { useState } from 'react'
import { clsx } from 'clsx'
import {
  IconChevronDownOutline14,
  IconPersonalizationOutline16,
  IconRefreshOutline14,
  IconWarningOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  backgroundPresetValue,
  DEFAULT_BACKGROUND_PRESET_ID,
  isBackgroundPresetId,
  type BackgroundPresetId,
} from '../background-presets.ts'
import { isInlineImageUrl, remoteHostLabel } from '../background-remote.ts'
import type { BackgroundSettings, BackgroundSource } from '../background-settings.ts'
import { BackgroundManagerDialog } from './BackgroundManagerDialog.tsx'
import { BackgroundPickerDialog } from './BackgroundPickerDialog.tsx'
import { BACKGROUND_LOCALE_NAMESPACE, type BackgroundKey } from './locales.ts'
import { isBackgroundNoticeFailure, type BackgroundNotice } from './background-runtime.ts'
import type { BackgroundImageSummary } from '../background-api.ts'
import type { createBackgroundRowStore } from './settings-store.ts'
import css from './BackgroundImageRow.module.css'

/**
 * Locale key of one preset's label.
 * @param id - preset id.
 * @returns the copy key naming that preset.
 */
function presetKey(id: BackgroundPresetId): `preset.${BackgroundPresetId}` {
  return `preset.${id}`
}

/**
 * Locale key of one write outcome.
 * @param code - outcome code reported by the runtime.
 * @returns the copy key naming that outcome.
 */
function noticeKey(code: Exclude<BackgroundNotice, ''>): `notice.${Exclude<BackgroundNotice, ''>}` {
  return `notice.${code}`
}

/**
 * Append a detail to a line of copy.
 * @param detail - detail to append, or empty when there is none.
 * @returns the separator and detail, or nothing when the detail is empty.
 */
function detailSuffix(detail: string): string {
  return detail === '' ? '' : ` · ${detail}`
}

/**
 * Name the selected background for the trigger.
 * @param t - row translator.
 * @param source - catalogue the selection came from.
 * @param id - selected id within that catalogue.
 * @param images - uploaded catalogue, consulted for a stored image's name.
 * @returns the label; a stored image absent from a loaded catalogue reports an
 * unknown name rather than an id the user never chose, and a preset this build
 * dropped reports the default one.
 */
function selectionLabel(
  t: TranslateNS<typeof BACKGROUND_LOCALE_NAMESPACE>,
  selection: BackgroundSettings,
  images: readonly BackgroundImageSummary[],
): string {
  if (selection.source === 'upload') {
    return images.find(entry => entry.id === selection.id)?.name ?? t('background.unknownName')
  }
  if (selection.source === 'remote') {
    // The host is what names a remote image: the rest of the URL is the same
    // picture for every user, and a full URL does not fit the row. An inline
    // image names no host at all.
    return isInlineImageUrl(selection.url)
      ? t('remote.inline')
      : remoteHostLabel(selection.url) || t('background.unknownName')
  }
  return isBackgroundPresetId(selection.id)
    ? t(presetKey(selection.id))
    : t(presetKey(DEFAULT_BACKGROUND_PRESET_ID))
}

/** Locale key explaining each reason the Host or the local policy refused a URL. */
const REMOTE_REASON_KEYS: Record<string, BackgroundKey> = {
  scheme: 'remote.reason.scheme',
  credentials: 'remote.reason.credentials',
  length: 'remote.reason.length',
  literal: 'remote.reason.literal',
  reserved: 'remote.reason.reserved',
  host: 'remote.reason.host',
  private: 'remote.reason.private',
  unresolved: 'remote.reason.unresolved',
}

/**
 * Explain one remote refusal.
 *
 * The runtime reports a code rather than text, so the copy stays locale-owned; a
 * code this build does not know is shown as it arrived, which keeps a newer Host
 * readable in an older page.
 * @param t - row translator.
 * @param code - refusal code the runtime reported.
 * @returns the copy to show.
 */
function remoteReason(t: TranslateNS<typeof BACKGROUND_LOCALE_NAMESPACE>, code: string): string {
  const key = REMOTE_REASON_KEYS[code]
  return key === undefined ? code : t(key)
}

/** Injected business face: the selection write and the catalogue operations. */
export interface BackgroundImageRowInjected {
  /** Select one background from one catalogue. */
  select: (source: BackgroundSource, id: string) => void
  /** Restore the profile's default background. */
  reset: () => void
  /** Show an opacity the user is dragging toward, without persisting it. */
  previewOpacity: (opacity: number) => void
  /** Persist the opacity the movement settled on. */
  commitOpacity: (opacity: number) => void
  /** Read the catalogue again, after an image was copied in by hand. */
  reload: () => void
  /** Store one image file and select it. */
  upload: (file: File) => void
  /** Select one remote image URL, which the Host judges before it is stored. */
  selectRemote: (url: string) => void
  /** Delete one stored image. */
  remove: (id: string) => void
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type BackgroundImageRowComponentProps =
  PropsRuntime<'settings.general.item'> & PropsStore<ReturnType<typeof createBackgroundRowStore>>
  & PropsLocale<typeof BACKGROUND_LOCALE_NAMESPACE> & BackgroundImageRowInjected

/**
 * Render the background image row.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export function BackgroundImageRow({
  t, select, reset, previewOpacity, commitOpacity, reload, upload, selectRemote, remove, useStore,
}: BackgroundImageRowComponentProps) {
  const selection = useStore(s => s.selection)
  const opacity = useStore(s => s.opacity)
  const surfaceTint = useStore(s => s.surfaceTint)
  const colorScheme = useStore(s => s.colorScheme)
  const images = useStore(s => s.images)
  const catalog = useStore(s => s.catalog)
  const catalogError = useStore(s => s.catalogError)
  const directory = useStore(s => s.directory)
  const available = useStore(s => s.available)
  const busy = useStore(s => s.busy)
  const notice = useStore(s => s.notice)
  const noticeDetail = useStore(s => s.noticeDetail)

  const [picking, setPicking] = useState(false)
  const [managing, setManaging] = useState(false)

  const label = selectionLabel(t, selection, images)
  // A refusal names a reason code; every other notice detail is already text.
  const detail = notice === 'remoteRefused' ? remoteReason(t, noticeDetail) : noticeDetail
  const preset = selection.source === 'preset' && isBackgroundPresetId(selection.id) ? selection.id : undefined
  const presetValue = preset === undefined ? undefined : backgroundPresetValue(preset)[colorScheme]
  const failed = isBackgroundNoticeFailure(notice)

  // Closing the picker settles whatever the slider is showing: a drag that ended
  // on the scrim rather than on the control still leaves the interface and the
  // document agreeing on one opacity.
  const closePicker = (): void => {
    commitOpacity(opacity)
    setPicking(false)
  }

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('background.title')}</div>
        <div className={css.desc}>{t('background.description')}</div>
        {!available && (
          <div className={css.missing}>
            <IconWarningOutline16 className={css.missingIcon} />
            {t('background.missing')}
          </div>
        )}
        {notice !== '' && (
          <div className={failed ? css.noticeFailed : css.notice}>
            {t(noticeKey(notice))}
            {detailSuffix(detail)}
          </div>
        )}
        {catalog === 'failed' && (
          <div className={css.noticeFailed}>
            {t('notice.loadFailed')}
            {detailSuffix(catalogError)}
            <button type="button" className={css.retry} onClick={reload}>
              <IconRefreshOutline14 />
              {t('action.retry')}
            </button>
          </div>
        )}
      </div>

      <button
        type="button"
        className={css.selector}
        aria-label={t('background.trigger')}
        aria-haspopup="dialog"
        aria-expanded={picking}
        onClick={() => { setPicking(true) }}
      >
        {preset === undefined
          ? <IconPersonalizationOutline16 className={css.swatchIcon} />
          : (
            <span
              className={clsx(css.swatch, presetValue === '' && css.swatchPlain)}
              style={presetValue === '' ? undefined : { backgroundImage: presetValue }}
            />
          )}
        <span className={css.selectorLabel}>{label}</span>
        <IconChevronDownOutline14 className={css.chevron} />
      </button>

      <BackgroundPickerDialog
        open={picking}
        t={t}
        selection={selection}
        opacity={opacity}
        surfaceTint={surfaceTint}
        colorScheme={colorScheme}
        images={images}
        remoteUrl={selection.source === 'remote' ? selection.url : ''}
        remoteFailure={notice === 'remoteRefused' ? detail : ''}
        remoteBusy={busy}
        onSelect={select}
        onSelectRemote={selectRemote}
        onPreviewOpacity={previewOpacity}
        onCommitOpacity={commitOpacity}
        onReset={reset}
        onManage={() => { closePicker(); setManaging(true) }}
        onClose={closePicker}
      />

      <BackgroundManagerDialog
        open={managing}
        t={t}
        directory={directory}
        images={images}
        busy={busy}
        onUpload={upload}
        onRemove={remove}
        // Only one dialog is open at a time, so the manager takes over from the
        // picker and hands it back: an image is usually uploaded in order to
        // choose it, and closing the manager onto the settings page would make
        // the user reopen the picker to finish what they started.
        onClose={() => { setManaging(false); setPicking(true) }}
      />
    </div>
  )
}
