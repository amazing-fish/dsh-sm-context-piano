/** Shared settings vocabulary for host registration and browser rendering. */

export interface PianoSettings {
  language: PianoLanguage
  enabled: boolean
  keyHeight: number
  keyGap: number
  maxVisible: number
}

/**
 * Settings entry id under the DSH 0.1.7 settings contract. Kept aligned with
 * the former settings namespace so existing stored values migrate as-is.
 */
export const SETTINGS_ENTRY_ID = 'sm-context-piano'
export const PIANO_LANGUAGE_IDS = ['zh', 'en', 'zh-TW'] as const
export type PianoLanguage = typeof PIANO_LANGUAGE_IDS[number]
export const DEFAULT_SETTINGS: PianoSettings = {
  language: 'zh',
  enabled: true,
  keyHeight: 2,
  keyGap: 12,
  maxVisible: 20,
}

export const SETTINGS_LIMITS = {
  keyHeight: { min: 1, max: 4 },
  keyGap: { min: 6, max: 18 },
  maxVisible: { min: 5, max: 30 },
} as const

const integer = (value: unknown, fallback: number, min: number, max: number): number => {
  if (typeof value !== 'number' || !Number.isInteger(value)) return fallback
  return Math.max(min, Math.min(max, value))
}

export function isPianoLanguage(value: unknown): value is PianoLanguage {
  return typeof value === 'string' && PIANO_LANGUAGE_IDS.includes(value as PianoLanguage)
}

export function decodeSettings(value: unknown): PianoSettings | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const source = value as Partial<PianoSettings>
  return {
    language: isPianoLanguage(source.language) ? source.language : DEFAULT_SETTINGS.language,
    enabled: typeof source.enabled === 'boolean' ? source.enabled : DEFAULT_SETTINGS.enabled,
    keyHeight: integer(source.keyHeight, DEFAULT_SETTINGS.keyHeight, SETTINGS_LIMITS.keyHeight.min, SETTINGS_LIMITS.keyHeight.max),
    keyGap: integer(source.keyGap, DEFAULT_SETTINGS.keyGap, SETTINGS_LIMITS.keyGap.min, SETTINGS_LIMITS.keyGap.max),
    maxVisible: integer(source.maxVisible, DEFAULT_SETTINGS.maxVisible, SETTINGS_LIMITS.maxVisible.min, SETTINGS_LIMITS.maxVisible.max),
  }
}

export function validateSettings(value: PianoSettings): void {
  const decoded = decodeSettings(value)
  if (
    decoded === undefined
    || decoded.language !== value.language
    || decoded.enabled !== value.enabled
    || decoded.keyHeight !== value.keyHeight
    || decoded.keyGap !== value.keyGap
    || decoded.maxVisible !== value.maxVisible
  ) {
    throw new Error('invalid sm-context-piano settings')
  }
}

export function railHeight(settings: PianoSettings): number {
  return (settings.maxVisible - 1) * settings.keyGap + settings.keyHeight
}

export interface PianoSettingsSource {
  getSnapshot(): PianoSettings
  subscribe(listener: () => void): () => void
}

/**
 * Scope surface consumed by the settings page. Replaces the `SettingsScope`
 * type that the removed `settingsScope` service used to provide; under the
 * 0.1.7 contract it is backed by `remote.settings` (see remote-settings.ts).
 */
export interface PianoSettingsSnapshot {
  status: 'loading' | 'ready' | 'unavailable'
  writable: boolean
  revision: number
  value: PianoSettings
}

export interface PianoSettingsScope {
  getSnapshot(): PianoSettingsSnapshot
  subscribe(listener: () => void): () => void
  set<K extends keyof PianoSettings & string>(field: K, value: PianoSettings[K]): Promise<void>
  unset<K extends keyof PianoSettings & string>(field: K): Promise<void>
  reset(): Promise<void>
}

export const DEFAULT_SETTINGS_SOURCE: PianoSettingsSource = {
  getSnapshot: () => DEFAULT_SETTINGS,
  subscribe: () => () => {},
}
