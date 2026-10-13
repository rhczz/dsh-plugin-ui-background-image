/**
 * Browser half of the background image plugin. It binds the form the Host
 * projects for the plugin's Config, owns the runtime that projects the chosen
 * background onto the document canvas, and registers the Background image row in
 * the General settings section, directly under the Font row.
 *
 * The volatile Config field is registered by the Host half; this half consumes
 * the served form, so a deployment that loads the plugin before any browser
 * connects still paints the chosen background for the first frame.
 * @module dsh-plugin-ui-background-image/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ctx.theme Context merge (the token-override layer this
// plugin installs is written by the theme service, never by this plugin).
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the ctx.configForms Context merge. Cross-plugin collaboration goes
// through the service, never a value import (client bundle purity gate).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  BACKGROUND_CONFIG_FIELD,
  BACKGROUND_SETTINGS_NAMESPACE,
  type BackgroundSettings,
} from '../background-settings.ts'
import { BackgroundImageRow, type BackgroundImageRowInjected } from './BackgroundImageRow.tsx'
import { BackgroundRuntime } from './background-runtime.ts'
import { BACKGROUND_LOCALE_NAMESPACE, en, zh } from './locales.ts'
import { createBackgroundRowStore } from './settings-store.ts'

export type { BackgroundImageRowComponentProps, BackgroundImageRowInjected } from './BackgroundImageRow.tsx'
export type { BackgroundRowState } from './settings-store.ts'

/**
 * Required services: the slots/locale pair the row registers through,
 * `configForms`, whose served form is how this plugin reads and writes its
 * volatile Config field, and `theme`, whose token-override layer and mode are
 * how the chosen background reaches the document. `remote` carries the shared
 * settings document the served form derives from; the form's invalidation
 * subscriptions live with its provider, so binding a form adds no wire read.
 */
export const inject = ['slots', 'locale', 'remote', 'configForms', 'theme']

/**
 * Client plugin body: own the background runtime and register the Background
 * image preference row into the General section's item slot.
 * @param ctx - client cordis context.
 */
export function apply(ctx: ClientContext): void {
  // The form of this plugin's own profile entry: its volatile projection is
  // exactly the `defaultBackground` field, so the runtime reads and writes the
  // selection there. `BACKGROUND_SETTINGS_NAMESPACE` is the entry id this
  // package's bundle patch composes; a deployment that renames the row spells
  // the same literal in its patch.
  const form = ctx.configForms.get<BackgroundConfigSection>(BACKGROUND_SETTINGS_NAMESPACE)

  ctx.effect(
    () => ctx.locale.register(BACKGROUND_LOCALE_NAMESPACE, { zh, en }),
    'ui-background-image: settings row dictionaries',
  )

  const store = createBackgroundRowStore()
  let bound: BoundActions<typeof store> | undefined
  const runtime = new BackgroundRuntime(form, ctx.theme)
  // The row and its tiles draw the shipped gradients, which carry one value per
  // palette mode, so the mode the theme resolved to is part of what they render.
  runtime.setColorScheme(ctx.theme.getTheme().active.colorScheme)
  ctx.on('theme/change', (snapshot) => { runtime.setColorScheme(snapshot.active.colorScheme) })
  const stopHost = runtime.start()
  const sync = (): void => { bound?.sync(runtime.getSnapshot()) }
  const stopSync = runtime.subscribe(sync)
  ctx.effect(() => () => {
    stopSync()
    stopHost()
    runtime.dispose()
  }, 'ui-background-image: background runtime')

  const injected = (actions: BoundActions<typeof store>): BackgroundImageRowInjected => {
    bound = actions
    // Re-sync from the live snapshot so no change is lost between registration
    // and first render; the store's sequence guard drops stale duplicates.
    sync()
    return {
      select: (source, id) => { runtime.select(source, id) },
      reset: () => { runtime.reset() },
      previewOpacity: (opacity) => { runtime.previewOpacity(opacity) },
      commitOpacity: (opacity) => { runtime.commit(opacity) },
      reload: () => { runtime.reloadCatalog() },
      upload: (file) => { runtime.upload(file) },
      selectRemote: (url) => { runtime.selectRemote(url) },
      remove: (id) => { runtime.remove(id) },
    }
  }
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'background-image',
    // Directly under the font row (11.5, owned by ui-font-family) and above the
    // transcript-view row (12, owned by ui-chat): the interface's appearance,
    // then the background it is drawn on.
    order: 11.6,
    store,
    locale: BACKGROUND_LOCALE_NAMESPACE,
    inject: injected,
  }, BackgroundImageRow))
}

/** What the Host's volatile Config projection serves for this plugin's entry. */
export interface BackgroundConfigSection {
  /** Persisted background; absent until a user choice or a composition default. */
  [BACKGROUND_CONFIG_FIELD]?: BackgroundSettings
}
