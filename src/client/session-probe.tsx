/**
 * Session-scoped probe feeding the navigator's current-session source.
 * Ported from the upstream 1.2.6 line (2026-09-27): the 0.1.7 sessions
 * service no longer exposes a selected-session pointer ("navigation belongs
 * to view owners"), so the active Session identity is observed through the
 * conversation header slot instead — only the open conversation's header
 * renders, so the last mounted probe owns the current selection.
 */

import { useLayoutEffect } from 'react'
import type { ReactNode } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

export interface PianoSelectedSessionSource {
  getSnapshot(): SessionId | undefined
  subscribe(listener: () => void): () => void
}

export interface PianoSelectedSessionHandle {
  source: PianoSelectedSessionSource
  activate(sessionId: SessionId): () => void
}

export function createSelectedSessionSource(): PianoSelectedSessionHandle {
  const listeners = new Set<() => void>()
  let active: { token: symbol, sessionId: SessionId } | undefined
  let current: SessionId | undefined
  const publish = (next: SessionId | undefined): void => {
    if (next === current) return
    current = next
    for (const listener of listeners) listener()
  }
  return {
    source: {
      getSnapshot: () => current,
      subscribe(listener) {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
    },
    activate(sessionId) {
      const token = Symbol()
      active = { token, sessionId }
      publish(sessionId)
      return () => {
        if (active?.token !== token) return
        active = undefined
        publish(undefined)
      }
    },
  }
}

interface SessionProbeInjected {
  activate: PianoSelectedSessionHandle['activate']
}

type SessionProbeProps =
  PropsRuntime<'conversation.session.header.actions'>
  & InjectFace<SessionProbeInjected>

/** Report the active Session through DSH's session-scoped slot lifecycle. */
export function SessionProbe(props: SessionProbeProps): ReactNode {
  const { sessionId, activate } = props
  useLayoutEffect(() => activate(sessionId), [activate, sessionId])
  return null
}
