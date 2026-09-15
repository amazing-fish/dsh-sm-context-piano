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
 * Keep one subscription per materialized key. The target publishes structure;
 * keyed sources can publish streaming content without replacing that structure.
 * No session log, pagination, or second persisted transcript is involved.
 */
export function observeChatNodes(
  source: PianoChatSource,
  publish: (nodes: readonly ChatConversationViewNode[]) => void,
  schedule: (callback: () => void) => void = queueMicrotask,
): () => void {
  let alive = true
  let queued = false
  let unsubscribeTarget: () => void = () => {}
  const subscriptions = new Map<string, { source: ChatNodeSource; dispose: () => void }>()

  const dispose = (): void => {
    if (!alive) return
    alive = false
    unsubscribeTarget()
    for (const entry of subscriptions.values()) entry.dispose()
    subscriptions.clear()
  }

  const requestPublish = (): void => {
    if (!alive || queued) return
    queued = true
    schedule(() => {
      queued = false
      if (alive) reconcile()
    })
  }

  const reconcile = (): void => {
    const snapshot = source.getSnapshot()
    const order = snapshot?.order ?? []
    const remaining = new Set(order)
    for (const [key, entry] of subscriptions) {
      if (!remaining.has(key)) {
        entry.dispose()
        subscriptions.delete(key)
      }
    }
    const nodes: ChatConversationViewNode[] = []
    if (snapshot !== undefined) {
      for (const key of order) {
        const nodeSource = snapshot.nodes.source(key)
        const previous = subscriptions.get(key)
        if (previous?.source !== nodeSource) {
          previous?.dispose()
          subscriptions.delete(key)
          subscriptions.set(key, { source: nodeSource, dispose: nodeSource.subscribe(requestPublish) })
        }
        const node = snapshot.nodes.get(key)
        if (node !== undefined) nodes.push(node)
      }
    }
    publish(nodes)
  }

  try {
    unsubscribeTarget = source.subscribe(requestPublish)
    reconcile()
  } catch (error) {
    dispose()
    throw error
  }
  return dispose
}
