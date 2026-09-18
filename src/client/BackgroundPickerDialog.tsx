/**
 * Background picker: the opacity control, then a grid of the backgrounds the
 * user can choose, each tile previewing itself at the opacity in force.
 *
 * A grid of previews rather than a list of names because choosing a background
 * is a visual decision; the settings page behind this dialog is covered by a
 * blurred scrim, so the tiles are where the choice has to be visible.
 * @module dsh-plugin-ui-background-image/client/BackgroundPickerDialog
 */

import { useState } from 'react'
import { clsx } from 'clsx'
import { Button, IconCheckOutline16, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { BackgroundImageSummary } from '../background-api.ts'
import { backgroundImageUrl } from '../background-canvas.ts'
import { BACKGROUND_PRESET_IDS, backgroundPresetValue } from '../background-presets.ts'
import { isInlineImageUrl, remoteHostLabel } from '../background-remote.ts'
import type { BackgroundSettings, BackgroundSource } from '../background-settings.ts'
import { BACKGROUND_LOCALE_NAMESPACE } from './locales.ts'
import { OpacitySlider } from './OpacitySlider.tsx'
import type { BackgroundColorScheme } from './background-runtime.ts'
import css from './BackgroundPickerDialog.module.css'

/** A tile's own preview payload: a gradient, an uploaded file, a remote URL, or the plain surface. */
type TilePreview =
  | { kind: 'preset'; value: string }
  | { kind: 'image'; url: string }
  | { kind: 'remote'; url: string }
  | { kind: 'none' }

/** One selectable background. */
interface BackgroundTile {
  /** React key, unique across the dialog. */
  key: string
  /** Catalogue the option comes from. */
  source: BackgroundSource
  /** Id within that catalogue. */
  id: string
  /** Text shown under the tile. */
  label: string
  /** What the tile draws. */
  preview: TilePreview
}

/** Props of the background picker dialog. */
export interface BackgroundPickerDialogProps {
  /** Whether the dialog is showing. */
  open: boolean
  /** Row translator, passed down from the registering component. */
  t: TranslateNS<typeof BACKGROUND_LOCALE_NAMESPACE>
  /** Current selection. */
  selection: BackgroundSettings
  /** Opacity the interface is showing, which every preview applies. */
  opacity: number
  /** Colour the surfaces carry at that opacity, which every preview composites. */
  surfaceTint: string
  /** Palette mode the preset gradients must render in. */
  colorScheme: BackgroundColorScheme
  /** Images the Host's directory holds. */
  images: readonly BackgroundImageSummary[]
  /** URL of the current selection when it is remote, else empty. */
  remoteUrl: string
  /** Translated reason the last remote URL was refused, else empty. */
  remoteFailure: string
  /** Whether the Host is judging a URL right now. */
  remoteBusy: boolean
  /** Select one background. */
  onSelect: (source: BackgroundSource, id: string) => void
  /** Select one remote image URL. */
  onSelectRemote: (url: string) => void
  /** Show an opacity without persisting it. */
  onPreviewOpacity: (opacity: number) => void
  /** Persist the opacity the movement settled on. */
  onCommitOpacity: (opacity: number) => void
  /** Restore the profile's default background. */
  onReset: () => void
  /** Open the management dialog. */
  onManage: () => void
  /** Close the dialog. */
  onClose: () => void
}

/**
 * Build the preset tiles, the harness's own background first.
 * @param t - row translator.
 * @param colorScheme - palette mode the gradients render in.
 * @returns one tile per shipped preset.
 */
function presetTiles(
  t: TranslateNS<typeof BACKGROUND_LOCALE_NAMESPACE>,
  colorScheme: BackgroundColorScheme,
): BackgroundTile[] {
  return BACKGROUND_PRESET_IDS.map((id) => {
    const value = backgroundPresetValue(id)[colorScheme]
    return {
      key: `preset:${id}`,
      source: 'preset' as const,
      id,
      label: t(`preset.${id}`),
      preview: value === '' ? { kind: 'none' as const } : { kind: 'preset' as const, value },
    }
  })
}

/**
 * Build the tile for each image the Host holds.
 * @param images - stored images.
 * @returns one tile per stored image.
 */
function imageTiles(images: readonly BackgroundImageSummary[]): BackgroundTile[] {
  return images.map(entry => ({
    key: `upload:${entry.id}`,
    source: 'upload' as const,
    id: entry.id,
    label: entry.name,
    // The stored file's own route: the browser caches it immutably, and only
    // the tiles that scroll into view are fetched.
    preview: { kind: 'image' as const, url: backgroundImageUrl(entry.id) },
  }))
}

/**
 * Render one tile.
 * @param props - tile, selection state, and the select callback.
 * @returns the tile element tree.
 */
function Tile({ tile, selected, onSelect, surfaceTint }: {
  tile: BackgroundTile
  selected: boolean
  surfaceTint: string
  onSelect: (tile: BackgroundTile) => void
}) {
  const style = tile.preview.kind === 'preset' ? { backgroundImage: tile.preview.value } : undefined
  return (
    <button
      type="button"
      className={clsx(css.tile, selected && css.tileSelected)}
      aria-pressed={selected}
      onClick={() => { onSelect(tile) }}
    >
      <span className={css.preview} style={style}>
        {(tile.preview.kind === 'image' || tile.preview.kind === 'remote') && (
          <img
            className={css.image}
            src={tile.preview.url}
            alt=""
            loading="lazy"
            decoding="async"
            // A remote image is loaded by this page from a third party, so the
            // request is made without a referrer; a stored file is served by the
            // Host itself.
            referrerPolicy={tile.preview.kind === 'remote' ? 'no-referrer' : undefined}
          />
        )}
        {/* The tint is the value the surfaces carry at this opacity, so a tile
            shows what the interface will look like rather than the background
            on its own. */}
        {tile.preview.kind === 'none' ? null : <span className={css.tint} style={{ background: surfaceTint }} />}
        {selected && <IconCheckOutline16 className={css.check} />}
      </span>
      <span className={css.tileName}>{tile.label}</span>
    </button>
  )
}

/**
 * Render the background picker dialog.
 * @param props - catalogue data and callbacks.
 * @returns the dialog element tree.
 */
export function BackgroundPickerDialog({
  open, t, selection, opacity, surfaceTint, colorScheme, images,
  remoteUrl, remoteFailure, remoteBusy,
  onSelect, onSelectRemote, onPreviewOpacity, onCommitOpacity, onReset, onManage, onClose,
}: BackgroundPickerDialogProps) {
  const [draft, setDraft] = useState('')
  const presets = presetTiles(t, colorScheme)
  const uploaded = imageTiles(images)
  // The chosen remote image is shown beside the field, so a URL the user pasted
  // is visible as what it loads rather than as text alone.
  const remote = remoteUrl === ''
    ? []
    : [{
      key: 'remote',
      source: 'remote' as const,
      id: '',
      label: isInlineImageUrl(remoteUrl)
        ? t('remote.inline')
        : remoteHostLabel(remoteUrl) || t('background.unknownName'),
      preview: { kind: 'remote' as const, url: remoteUrl },
    }]
  const submitRemote = (): void => {
    const candidate = draft.trim()
    if (candidate === '') return
    onSelectRemote(candidate)
  }
  const selected = (tile: BackgroundTile): boolean =>
    tile.source === selection.source && tile.id === selection.id
  const choose = (tile: BackgroundTile): void => {
    onSelect(tile.source, tile.id)
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('picker.title')}
      closeLabel={t('action.close')}
      description={t('picker.description')}
      className={clsx(css.picker)}
      footer={(
        <>
          <Button variant="ghost" className={css.leadAction} onClick={onManage}>{t('action.manage')}</Button>
          <Button variant="outline" onClick={onReset}>{t('action.reset')}</Button>
          <Button variant="primary" onClick={onClose}>{t('action.close')}</Button>
        </>
      )}
    >
      <OpacitySlider
        label={t('opacity.label')}
        readout={t('opacity.value', { value: opacity })}
        hint={t('opacity.hint')}
        value={opacity}
        onPreview={onPreviewOpacity}
        onCommit={onCommitOpacity}
      />

      <div className={css.groups}>
        <div className={css.groupLabel}>{t('group.presets')}</div>
        <div className={css.grid}>
          {presets.map(tile => (
            <Tile key={tile.key} tile={tile} selected={selected(tile)} surfaceTint={surfaceTint} onSelect={choose} />
          ))}
        </div>

        <div className={css.groupLabel}>{t('group.uploaded')}</div>
        {uploaded.length === 0 && <div className={css.note}>{t('uploaded.empty')}</div>}
        <div className={css.grid}>
          {uploaded.map(tile => (
            <Tile key={tile.key} tile={tile} selected={selected(tile)} surfaceTint={surfaceTint} onSelect={choose} />
          ))}
        </div>

        <div className={css.groupLabel}>{t('group.remote')}</div>
        <div className={css.remote}>
          <input
            type="url"
            className={css.remoteInput}
            value={draft}
            placeholder={t('remote.placeholder')}
            aria-label={t('remote.label')}
            onChange={(event) => { setDraft(event.currentTarget.value) }}
            onKeyDown={(event) => { if (event.key === 'Enter') submitRemote() }}
          />
          <Button variant="outline" disabled={remoteBusy || draft.trim() === ''} onClick={submitRemote}>
            {t('remote.add')}
          </Button>
        </div>
        <div className={css.note}>{t('remote.hint')}</div>
        {remoteFailure !== '' && <div className={css.remoteFailure}>{remoteFailure}</div>}
        <div className={css.grid}>
          {remote.map(tile => (
            <Tile key={tile.key} tile={tile} selected={selected(tile)} surfaceTint={surfaceTint} onSelect={choose} />
          ))}
        </div>
      </div>
    </Modal>
  )
}
