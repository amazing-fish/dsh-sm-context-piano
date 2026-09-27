/**
 * Browser half: settings, locale, and the Piano rail. Chat comes from the
 * public uiConversation target; no official Navigator seat is replaced.
 * Ported to the DSH 0.1.7 settings contract (2026-09-27): the client-side
 * `settingsScope` service and the sessions list's selected-session pointer
 * were removed, so settings flow through the remote settings API
 * (remote-settings.ts) and the active Session identity is observed through
 * the conversation header slot (session-probe.tsx).
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { PianoSettingsRemote } from './remote-settings.ts'
import { createPianoRemoteSettings } from './remote-settings.ts'
import { NS, dictionaries } from './locales.ts'
import { SessionProbe, createSelectedSessionSource } from './session-probe.tsx'
import { PianoSettingsPage } from './settings-page.tsx'
import { installStyles } from './styles.ts'
import { attachKeyStrip } from './strip.ts'

/** Services supplied by the explicitly ordered client packages. */
export const inject = ['sessions', 'uiConversation', 'locale', 'slots', 'remote', 'remote.settings']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, dictionaries), 'dsh-sm-context-piano: dictionaries')
  ctx.effect(() => installStyles(), 'dsh-sm-context-piano: styles')
  const t = ctx.locale.bind(NS)
  const selected = createSelectedSessionSource()
  const settings = createPianoRemoteSettings(ctx.remote as unknown as PianoSettingsRemote)
  ctx.effect(() => () => settings.dispose(), 'dsh-sm-context-piano: settings remote')
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'sm-context-piano-session-probe',
    inject: () => ({ activate: selected.activate }),
  }, SessionProbe))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'sm-context-piano',
    order: 21,
    label: () => t('settings.nav'),
    inject: () => ({ scope: settings.scope }),
  }, PianoSettingsPage))
  ctx.effect(() => attachKeyStrip(ctx, t, selected.source, settings.source), 'dsh-sm-context-piano: navigator strip')
}
