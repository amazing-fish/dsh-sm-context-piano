/**
 * Browser half: settings, locale, and the Piano rail. Chat comes from the
 * public uiConversation target; no official Navigator seat is replaced.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { SETTINGS_NAMESPACE, decodeSettings } from '../core/config.ts'
import type { PianoSettings } from '../core/config.ts'
import { NS, dictionaries } from './locales.ts'
import { PianoSettingsPage, createPianoSettingsSource } from './settings-page.tsx'
import { installStyles } from './styles.ts'
import { attachKeyStrip } from './strip.ts'

/** Services supplied by the explicitly ordered client packages. */
export const inject = ['sessions', 'uiConversation', 'locale', 'slots', 'settingsScope', 'remote']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, dictionaries), 'dsh-sm-context-piano: dictionaries')
  ctx.effect(() => installStyles(), 'dsh-sm-context-piano: styles')
  const t = ctx.locale.bind(NS)
  const scope = ctx.settingsScope.bind<PianoSettings>({ namespace: SETTINGS_NAMESPACE, decode: decodeSettings })
  const settings = createPianoSettingsSource(scope)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'sm-context-piano',
    order: 21,
    label: () => t('settings.nav'),
    inject: () => ({ scope }),
  }, PianoSettingsPage))
  ctx.effect(() => attachKeyStrip(ctx, t, settings), 'dsh-sm-context-piano: navigator strip')
}
