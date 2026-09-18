/**
 * Background row slot store: a mirror of the background runtime snapshot. The
 * plugin's apply-world runtime is the only writer; the row and its dialogs read
 * through `props.useStore`.
 * @module dsh-plugin-ui-background-image/client/settings-store
 */

import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import { DEFAULT_BACKGROUND_OPACITY, surfaceAlphaPercent } from '../background-opacity.ts'
import { DEFAULT_BACKGROUND_PRESET_ID } from '../background-presets.ts'
import { surfaceValue } from '../background-canvas.ts'
import { DEFAULT_BACKGROUND_SOURCE } from '../background-settings.ts'
import type { BackgroundRowSnapshot } from './background-runtime.ts'

/**
 * Store state: the runtime snapshot itself, so a snapshot field cannot exist
 * without the row seeing it. `seq` starts at -1 in {@link createBackgroundRowStore}
 * so the runtime's opening snapshot (sequence 0) lands as the first change.
 */
export type BackgroundRowState = BackgroundRowSnapshot

/** Declared action shape giving the exported factory a stable return type. */
type BackgroundRowActions = {
  sync: (draft: BackgroundRowState, snapshot: BackgroundRowSnapshot) => void
}

/**
 * Declare the background row state and write surface.
 * @returns the store handle.
 */
export function createBackgroundRowStore(): EngineStoreHandle<BackgroundRowState, BackgroundRowActions> {
  return defineStore({
    init: (): BackgroundRowState => ({
      seq: -1,
      selection: {
        source: DEFAULT_BACKGROUND_SOURCE,
        id: DEFAULT_BACKGROUND_PRESET_ID,
        opacity: DEFAULT_BACKGROUND_OPACITY,
        url: '',
      },
      opacity: DEFAULT_BACKGROUND_OPACITY,
      surfaceTint: surfaceValue(surfaceAlphaPercent(DEFAULT_BACKGROUND_OPACITY)).light,
      colorScheme: 'light',
      catalog: 'loading',
      catalogError: '',
      directory: null,
      images: [],
      available: true,
      busy: false,
      notice: '',
      noticeDetail: '',
    }),
    actions: {
      sync: (d, snapshot: BackgroundRowSnapshot) => {
        if (snapshot.seq <= d.seq) return
        Object.assign(d, snapshot)
      },
    },
  })
}
