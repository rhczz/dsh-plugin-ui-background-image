/**
 * One settings form double, shared by the specs that drive a live Config field
 * without a Host.
 * @module dsh-plugin-ui-background-image/tests/client/form-stub
 */

import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-settings/types'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import {
  BACKGROUND_CONFIG_FIELD,
  BACKGROUND_ID_FIELD,
  BACKGROUND_OPACITY_FIELD,
  BACKGROUND_SOURCE_FIELD,
  BACKGROUND_URL_FIELD,
  type BackgroundSettings,
} from '../../src/background-settings.ts'
import type { BackgroundConfigSection } from '../../src/client/index.ts'

/**
 * Whether a written value is one background, as the runtime writes it.
 * @param value - JSON value written at the selection field.
 * @returns whether the value carries the four fields a selection has.
 */
function isBackgroundSettings(value: JsonValue): value is JsonValue & BackgroundSettings {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  return typeof value[BACKGROUND_SOURCE_FIELD] === 'string'
    && typeof value[BACKGROUND_ID_FIELD] === 'string'
    && typeof value[BACKGROUND_OPACITY_FIELD] === 'number'
    && typeof value[BACKGROUND_URL_FIELD] === 'string'
}

/**
 * A served form double holding one entry's layer stack over the volatile
 * `defaultBackground` field.
 *
 * `mutate` records the operation batch and republishes the resolved value, so a
 * spec can assert both what was written and what the runtime did with the
 * answer — the same information the real form carries.
 */
export class FakeForm implements ConfigForm<BackgroundConfigSection> {
  /** Every batch handed to {@link mutate}, in call order. */
  readonly batches: (readonly SettingsPathOpView[])[] = []

  private user: BackgroundConfigSection = {}
  private revision = 0
  private accepted = true
  private snapshot: ConfigFormSnapshot<BackgroundConfigSection>
  private readonly listeners = new Set<() => void>()

  /**
   * @param base - background the composition layer supplies; absent layers
   * resolve to no value at all.
   */
  constructor(private base?: BackgroundSettings) {
    this.snapshot = this.build()
  }

  /** @returns the current sync snapshot. */
  getSnapshot(): ConfigFormSnapshot<BackgroundConfigSection> {
    return this.snapshot
  }

  /**
   * Observe snapshot replacements.
   * @param listener - invoked after each change.
   * @returns the disposer.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Apply one operation batch and publish the result.
   * @param ops - ordered field operations, as the runtime writes them.
   * @returns whether the fake Host accepted the batch; it always does.
   */
  async mutate(ops: readonly SettingsPathOpView[]): Promise<boolean> {
    this.batches.push([...ops])
    for (const op of ops) {
      if (op.path[0] !== BACKGROUND_CONFIG_FIELD) continue
      // The runtime is this double's only writer, so a written value is one
      // background; the guard reads it back without a cast.
      if (op.op === 'set' && isBackgroundSettings(op.value)) {
        this.user = { [BACKGROUND_CONFIG_FIELD]: op.value }
      } else {
        this.user = {}
      }
    }
    this.revision += 1
    this.snapshot = this.build()
    for (const listener of this.listeners) listener()
    return true
  }

  /**
   * Write one field, as {@link ConfigForm.set} does.
   * @param field - scalar field inside the entry section.
   * @param value - JSON-shaped value selected by the user.
   * @returns whether the fake Host accepted the write.
   */
  set(field: string, value: unknown): Promise<boolean> {
    return this.mutate([{ op: 'set', path: [field], value: value as JsonValue }])
  }

  /**
   * Clear one field, as {@link ConfigForm.unset} does.
   * @param field - scalar field inside the entry section.
   * @returns whether the fake Host accepted the clear.
   */
  unset(field: string): Promise<boolean> {
    return this.mutate([{ op: 'unset', path: [field] }])
  }

  /** @returns this double as the form the runtime consumes. */
  asForm(): ConfigForm<BackgroundConfigSection> {
    return this
  }

  /** Publish a change made outside {@link mutate}, the way the Host does. */
  notify(): void {
    for (const listener of this.listeners) listener()
  }

  /**
   * Report the entry as not yet accepted, which is what a client sees before
   * the first Host view arrives.
   */
  hideValue(): void {
    this.accepted = false
    this.snapshot = this.build()
    this.notify()
  }

  /** Report the entry as accepted again, with the value it now resolves to. */
  revealValue(): void {
    this.accepted = true
    this.snapshot = this.build()
    this.notify()
  }

  /** Replace the composition layer, the way a re-resolved entry would. */
  setBase(base: BackgroundSettings): void {
    this.base = base
    this.snapshot = this.build()
    this.notify()
  }

  /** @returns the snapshot with the current layers folded together. */
  private build(): ConfigFormSnapshot<BackgroundConfigSection> {
    const user = this.user[BACKGROUND_CONFIG_FIELD]
    const base = this.base
    return {
      status: this.accepted ? 'ready' : 'loading',
      value: !this.accepted
        ? undefined
        : user === undefined
          ? (base === undefined ? undefined : { [BACKGROUND_CONFIG_FIELD]: base })
          : { [BACKGROUND_CONFIG_FIELD]: user },
      base: base === undefined ? undefined : { [BACKGROUND_CONFIG_FIELD]: base },
      user: user === undefined ? undefined : { [BACKGROUND_CONFIG_FIELD]: user },
      revision: this.revision,
      writable: true,
      mode: 'host',
    }
  }
}
