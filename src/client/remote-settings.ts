/**
 * Remote-backed settings source for the DSH 0.1.7 settings contract.
 * Ported from the upstream 1.2.6 line (2026-09-27): the client-side
 * `settingsScope` service was removed in 0.1.7, so the settings page now
 * reads its entry through `remote.settings.describe()` and writes through
 * `remote.settings.mutate()` instead.
 */

import { DEFAULT_SETTINGS, SETTINGS_ENTRY_ID, decodeSettings } from '../core/config.ts'
import type { PianoSettings, PianoSettingsScope, PianoSettingsSource } from '../core/config.ts'

/** Structural slice of the remote API this module consumes. */
export interface PianoSettingsRemote {
  settings: {
    describe(): Promise<PianoSettingsDescribeResponse>
    mutate(ns: string, ops: PianoSettingsWriteOp[], revision: number): Promise<PianoSettingsMutateResponse>
  }
  $on(event: 'settings/document-updated', listener: (ns: string) => void): () => void
}

interface PianoSettingsEntryView {
  ns?: string
  revision?: number
  value?: unknown
}

interface PianoSettingsDescribeResponse {
  ok: boolean
  value: {
    namespaces: PianoSettingsEntryView[]
    writable: boolean
  }
}

interface PianoSettingsMutateResponse {
  ok: boolean
  value: PianoSettingsEntryView
}

interface PianoSettingsWriteOp {
  op: 'set' | 'unset'
  path: [keyof PianoSettings & string]
  value?: unknown
}

type PianoSettingsSnapshot = ReturnType<PianoSettingsScope['getSnapshot']>

export interface PianoRemoteSettings {
  scope: PianoSettingsScope
  source: PianoSettingsSource
  dispose(): void
}

/**
 * Keep one remote settings controller per plugin instance. Reads refresh on
 * `settings/document-updated` for this entry only; writes are serialized
 * through a queue and revalidate the entry revision on failure.
 */
export function createPianoRemoteSettings(remote: PianoSettingsRemote): PianoRemoteSettings {
  let entry: PianoSettingsEntryView | undefined
  let described = false
  /**
   * Fail-closed value for states where the persisted preference is unknown
   * (loading, or unavailable before the first successful describe): the rail
   * must not claim the native navigator until the stored `enabled` value is
   * known, so a disabled installation is never re-enabled by default.
   */
  const unknownSettings = (): PianoSettings => ({ ...DEFAULT_SETTINGS, enabled: false })
  let snapshot: PianoSettingsSnapshot = {
    status: 'loading',
    writable: false,
    revision: 0,
    value: unknownSettings(),
  }
  let disposed = false
  let readGeneration = 0
  let writeQueue: Promise<void> = Promise.resolve()
  const listeners = new Set<() => void>()

  const publish = (status: PianoSettingsSnapshot['status'], writable: boolean): void => {
    if (disposed) return
    snapshot = {
      status,
      writable,
      revision: entry?.revision ?? 0,
      value: entry === undefined ? (described ? DEFAULT_SETTINGS : unknownSettings()) : decodeSettings(entry.value) ?? DEFAULT_SETTINGS,
    }
    for (const listener of listeners) listener()
  }

  const refresh = async (): Promise<void> => {
    const generation = ++readGeneration
    try {
      const response = await remote.settings.describe()
      if (disposed || generation !== readGeneration) return
      if (!response.ok) throw new Error('settings describe failed')
      const result = response.value
      entry = result.namespaces.find((candidate) => candidate.ns === SETTINGS_ENTRY_ID)
      described = true
      // A writable document without this entry cannot be written yet: DSH 0.1.7
      // `describe()` only lists active entries exporting a Config, and
      // `mutate()` throws "No configurable plugin entry" for any other id.
      // The entry appears (with `settings/document-updated`) once the host
      // half activates, so keep controls disabled until then.
      publish(entry === undefined ? 'unavailable' : 'ready', entry !== undefined && result.writable)
    } catch {
      if (disposed || generation !== readGeneration) return
      publish('unavailable', false)
    }
  }

  const write = (ops: PianoSettingsWriteOp[]): Promise<void> => {
    const operation = writeQueue.then(async () => {
      if (disposed) throw new Error('settings controller disposed')
      if (entry === undefined || !snapshot.writable) await refresh()
      if (entry === undefined || !snapshot.writable) throw new Error('settings unavailable')
      const revision = entry.revision ?? 0
      try {
        const response = await remote.settings.mutate(SETTINGS_ENTRY_ID, ops, revision)
        if (!response.ok) throw new Error('settings mutation failed')
        entry = response.value
        publish('ready', snapshot.writable)
      } catch (error) {
        await refresh()
        throw error
      }
    })
    writeQueue = operation.catch(() => {})
    return operation
  }

  const scope: PianoSettingsScope = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    set: (field, value) => write([{ op: 'set', path: [field], value }]),
    unset: (field) => write([{ op: 'unset', path: [field] }]),
    reset: () => write((['language', 'enabled', 'keyHeight', 'keyGap', 'maxVisible'] as const).map((field) => ({
      op: 'unset' as const,
      path: [field] as [keyof PianoSettings & string],
    }))),
  }

  const source: PianoSettingsSource = {
    getSnapshot: () => snapshot.value,
    subscribe: scope.subscribe,
  }

  const stopListening = remote.$on('settings/document-updated', (ns) => {
    if (ns === SETTINGS_ENTRY_ID) void refresh()
  })
  void refresh()

  return {
    scope,
    source,
    dispose: () => {
      disposed = true
      readGeneration += 1
      stopListening()
      listeners.clear()
    },
  }
}
