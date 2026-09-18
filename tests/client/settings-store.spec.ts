/**
 * The row store: what it opens with, and which snapshots it takes.
 * @module dsh-plugin-ui-background-image/tests/client/settings-store
 */

import { describe, expect, it } from 'vitest'
import { surfaceValue } from '../../src/background-canvas.ts'
import { DEFAULT_BACKGROUND_OPACITY, surfaceAlphaPercent } from '../../src/background-opacity.ts'
import { createBackgroundRowStore, type BackgroundRowState } from '../../src/client/settings-store.ts'
import type { BackgroundRowSnapshot } from '../../src/client/background-runtime.ts'

/**
 * Build a snapshot with everything a case does not care about fixed.
 * @param seq - runtime sequence the snapshot carries.
 * @param overrides - fields this case exercises.
 * @returns the snapshot.
 */
function snapshot(seq: number, overrides: Partial<BackgroundRowSnapshot> = {}): BackgroundRowSnapshot {
  return {
    seq,
    selection: { source: 'preset', id: 'none', opacity: DEFAULT_BACKGROUND_OPACITY, url: '' },
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
    ...overrides,
  }
}

describe('the row store', () => {
  it('opens on the runtime\u2019s opening sequence, so the first snapshot is a change', () => {
    const state: BackgroundRowState = createBackgroundRowStore().create().getSnapshot()
    expect(state.seq).toBe(-1)
    expect(state.selection).toMatchObject({ source: 'preset', id: 'none' })
    expect(state.images).toEqual([])
  })

  it('takes the snapshot the runtime publishes', () => {
    const instance = createBackgroundRowStore().create()
    instance.actions.sync(snapshot(0, { notice: 'uploaded', images: [{ id: 'a.png', name: 'a' }] }))
    expect(instance.getSnapshot()).toMatchObject({ seq: 0, notice: 'uploaded' })
  })

  it('takes a newer snapshot even when it resolves to the same selection', () => {
    const instance = createBackgroundRowStore().create()
    instance.actions.sync(snapshot(0))
    instance.actions.sync(snapshot(1, { notice: 'reset' }))
    expect(instance.getSnapshot()).toMatchObject({ seq: 1, notice: 'reset' })
  })

  it('drops a snapshot older than the one it holds', () => {
    // The row asks for its actions on its first render, which republishes the
    // snapshot standing at that moment; without the guard that republication
    // would undo whatever the runtime published in between.
    const instance = createBackgroundRowStore().create()
    instance.actions.sync(snapshot(4, { notice: 'removed' }))
    instance.actions.sync(snapshot(3, { notice: '' }))
    expect(instance.getSnapshot()).toMatchObject({ seq: 4, notice: 'removed' })
  })

  it('drops a republication of the snapshot it already holds', () => {
    const instance = createBackgroundRowStore().create()
    instance.actions.sync(snapshot(2))
    instance.actions.sync(snapshot(2))
    expect(instance.getSnapshot().seq).toBe(2)
  })

  it('replaces the state in place, so a subscriber sees the fields it reads', () => {
    const instance = createBackgroundRowStore().create()
    const seen: string[] = []
    const stop = instance.subscribe(() => { seen.push(instance.getSnapshot().notice) })
    instance.actions.sync(snapshot(0, { notice: 'uploaded' }))
    stop()
    instance.actions.sync(snapshot(1, { notice: 'removed' }))
    expect(seen).toEqual(['uploaded'])
  })
})
