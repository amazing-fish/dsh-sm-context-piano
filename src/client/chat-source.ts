/** Observe the public Chat target, including in-place keyed node updates. */
import type {
  ChatConversationViewNode,
  ChatNodeSource,
  ChatSnapshot,
} from '@deepseek-ai/dsh-client-ui-chat/client'

export interface PianoChatSource {
  getSnapshot(): ChatSnapshot | undefined
  subscribe(listener: () => void): () => void
}

/**
 * Keep one subscription per materialized key.
 *
 * Structural target publications rebuild the ordered projection. Keyed source
 * publications refresh only the affected nodes, instead of walking every key in
 * a long transcript for each streaming token.
 */
export function observeChatNodes(
  source: PianoChatSource,
  publish: (nodes: readonly ChatConversationViewNode[], change?: 'structure' | 'keyed', dirtyKeys?: readonly string[]) => void,
  schedule: (callback: () => void) => void = queueMicrotask,
): () => void {
  let alive = true
  let queued = false
  let structureDirty = false
  const keyedDirty = new Set<string>()
  let unsubscribeTarget: () => void = () => {}
  const subscriptions = new Map<string, { source: ChatNodeSource; dispose: () => void }>()
  let orderedKeys: string[] = []
  let orderedNodes: ChatConversationViewNode[] = []
  let indexByKey = new Map<string, number>()

  const dispose = (): void => {
    if (!alive) return
    alive = false
    unsubscribeTarget()
    for (const entry of subscriptions.values()) entry.dispose()
    subscriptions.clear()
    keyedDirty.clear()
    orderedKeys = []
    orderedNodes = []
    indexByKey.clear()
  }

  const enqueue = (): void => {
    if (!alive || queued) return
    queued = true
    schedule(() => {
      queued = false
      if (!alive) return
      if (structureDirty) {
        structureDirty = false
        keyedDirty.clear()
        reconcileStructure()
      } else if (keyedDirty.size > 0) {
        const keys = [...keyedDirty]
        keyedDirty.clear()
        refreshKeys(keys)
      }
    })
  }

  const requestStructure = (): void => {
    structureDirty = true
    enqueue()
  }

  const requestKey = (key: string): void => {
    keyedDirty.add(key)
    enqueue()
  }

  const bindKey = (snapshot: ChatSnapshot, key: string): void => {
    const nodeSource = snapshot.nodes.source(key)
    const previous = subscriptions.get(key)
    if (previous?.source === nodeSource) return
    previous?.dispose()
    subscriptions.set(key, {
      source: nodeSource,
      dispose: nodeSource.subscribe(() => requestKey(key)),
    })
  }

  const reconcileStructure = (): void => {
    const snapshot = source.getSnapshot()
    const nextOrder = snapshot?.order ?? []
    const remaining = new Set(nextOrder)
    for (const [key, entry] of subscriptions) {
      if (!remaining.has(key)) {
        entry.dispose()
        subscriptions.delete(key)
      }
    }

    const nextKeys: string[] = []
    const nextNodes: ChatConversationViewNode[] = []
    const nextIndex = new Map<string, number>()
    if (snapshot !== undefined) {
      for (const key of nextOrder) {
        bindKey(snapshot, key)
        const node = snapshot.nodes.get(key)
        if (node === undefined) continue
        nextIndex.set(key, nextNodes.length)
        nextKeys.push(key)
        nextNodes.push(node)
      }
    }
    orderedKeys = nextKeys
    orderedNodes = nextNodes
    indexByKey = nextIndex
    publish(orderedNodes, 'structure')
  }

  const refreshKeys = (keys: readonly string[]): void => {
    const snapshot = source.getSnapshot()
    if (snapshot === undefined) {
      reconcileStructure()
      return
    }
    for (const key of keys) {
      const index = indexByKey.get(key)
      if (index === undefined || orderedKeys[index] !== key) {
        reconcileStructure()
        return
      }
      try {
        bindKey(snapshot, key)
        const node = snapshot.nodes.get(key)
        if (node === undefined) {
          reconcileStructure()
          return
        }
        orderedNodes[index] = node
      } catch {
        reconcileStructure()
        return
      }
    }
    publish(orderedNodes, 'keyed', keys)
  }

  try {
    unsubscribeTarget = source.subscribe(requestStructure)
    reconcileStructure()
  } catch (error) {
    dispose()
    throw error
  }
  return dispose
}
