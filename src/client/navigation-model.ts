/** Full-session Turn outline enriched by loaded semantic keys. */
import type { TurnNavigationItem } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { KeyDescriptor, KeyKind } from './keys.ts'
export interface NavigationTurn {
  turn: number
  prompt: string
  response: string
  anchor: { kind: 'loaded'; key: string } | { kind: 'unloaded'; seq: number }
}
export interface PianoItem {
  key: string
  turn: number
  title: string
  preview: string
  role: 'turn' | 'user' | 'assistant'
  kind?: KeyKind
  interactionState?: KeyDescriptor['interactionState']
  anchorKey: string | null
}
const validNumber = (value: unknown): value is number => typeof value === 'number'
  && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0)
const preview = (value: unknown): string => typeof value === 'string' ? value.slice(0, 520) : ''
export function mergeNavigationTurns(loaded: readonly TurnNavigationItem[], outline: unknown): NavigationTurn[] {
  const turns = new Map<number, NavigationTurn>()
  if (Array.isArray(outline)) for (const raw of outline) {
    if (raw === null || typeof raw !== 'object') continue
    const entry = raw as Record<string, unknown>
    if (!validNumber(entry.turn) || !validNumber(entry.seq)) continue
    turns.set(entry.turn, { turn: entry.turn, prompt: preview(entry.prompt), response: preview(entry.response), anchor: { kind: 'unloaded', seq: entry.seq } })
  }
  for (const item of loaded) {
    if (!validNumber(item.turn) || typeof item.anchorKey !== 'string' || item.anchorKey === '') continue
    const old = turns.get(item.turn)
    turns.set(item.turn, {
      turn: item.turn, prompt: preview(item.prompt) || old?.prompt || '', response: preview(item.response) || old?.response || '',
      anchor: { kind: 'loaded', key: item.anchorKey },
    })
  }
  return [...turns.values()].sort((a, b) => a.turn - b.turn)
}
export function buildPianoItems(turns: readonly NavigationTurn[], segments: readonly KeyDescriptor[], label: (turn: number) => string): PianoItem[] {
  const grouped = new Map<number, KeyDescriptor[]>()
  for (const segment of segments) {
    if (segment.turn === null) continue
    const list = grouped.get(segment.turn) ?? []
    list.push(segment); grouped.set(segment.turn, list)
  }
  return turns.flatMap<PianoItem>(turn => {
    const children = turn.anchor.kind === 'loaded' ? grouped.get(turn.turn) ?? [] : []
    if (children.length === 0) return [{
      key: `turn:${turn.turn}`, turn: turn.turn, title: turn.prompt || label(turn.turn), preview: turn.response, role: 'turn',
      anchorKey: turn.anchor.kind === 'loaded' ? turn.anchor.key : null,
    }]
    return children.map((segment, index) => ({
      key: index === 0 ? `turn:${turn.turn}` : `segment:${segment.key}`,
      turn: turn.turn, title: segment.title, preview: segment.preview, role: segment.role,
      anchorKey: segment.anchorKey, kind: segment.kind, interactionState: segment.interactionState,
    }))
  })
}
