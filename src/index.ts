/**
 * Host settings registration for the browser-only conversation navigator.
 * Ported to the DSH 0.1.7 settings contract (2026-09-27): plugins no longer
 * call `settings.register(namespace, schema)`; they export a Config schema
 * (volatile defaults) that the profile settings document picks up by the
 * bundle entry id, and a custom settings page opts out of the auto form.
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-settings'
import { DEFAULT_SETTINGS } from './core/config.ts'

/** Keep this entry id aligned with the former settings namespace for DSH migration. */
const SETTINGS_ENTRY_ID = 'sm-context-piano'

export const Config = z.object({
  language: z.union([z.const('zh'), z.const('en'), z.const('zh-TW')]).default(DEFAULT_SETTINGS.language).volatile(),
  enabled: z.boolean().default(DEFAULT_SETTINGS.enabled).volatile(),
  keyHeight: z.number().default(DEFAULT_SETTINGS.keyHeight).volatile(),
  keyGap: z.number().default(DEFAULT_SETTINGS.keyGap).volatile(),
  maxVisible: z.number().default(DEFAULT_SETTINGS.maxVisible).volatile(),
})

export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.effect(
      () => settingsCtx.settings.configure({ auto: false }, ctx.fiber),
      `sm-context-piano:${SETTINGS_ENTRY_ID}: custom settings page`,
    )
  })
}
