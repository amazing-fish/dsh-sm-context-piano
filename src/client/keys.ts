/** User inputs, visible assistant runs, final answers and human question exchanges. */
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { questionKeys } from './question-keys.ts'

export type KeyKind = 'input' | 'output' | 'final' | 'question' | 'answer'
export interface KeyDescriptor {
  key: string
  anchorKey: string
  role: 'user' | 'assistant'
  title: string
  preview: string
  turn: number | null
  /** Product meaning is separate from the speaker and transient UI state. */
  kind?: KeyKind
  interactionState?: 'pending' | 'answered' | 'unanswered' | 'error'
}

const PREVIEW_LIMIT = 520
const TITLE_LIMIT = 140
const USER_KINDS = new Set(['user', 'steering'])
const ASSISTANT_KINDS = new Set(['assistant', 'assistant-step'])
const record = (value: unknown): Record<string, unknown> => typeof value === 'object' && value !== null
  ? value as Record<string, unknown> : {}
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

function truncate(text: string, limit: number): string {
  const normalized = text.replace(/\r\n?/g, '\n').trim()
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit).trimEnd()}…`
}
function titleOf(text: string): string {
  const first = text.split('\n').find(line => line.trim() !== '') ?? '…'
  return truncate(first.replace(/^\s*(?:#{1,6}|>|[-*+] |\d+[.)]\s*)\s*/, ''), TITLE_LIMIT)
}
function contentText(blocks: readonly unknown[]): string {
  return blocks.flatMap(value => {
    const block = record(value)
    return block.type === 'text' && typeof block.text === 'string' ? [block.text]
      : block.type === 'image' ? ['[image]'] : block.type === 'file' ? ['[file]'] : []
  }).join('\n')
}

/** Modern locations hold a TurnLocation object, not a numeric turn. */
export function turnOf(node: ChatConversationViewNode): number | null {
  const location = record(node.location)
  const located = typeof location.turn === 'object' ? record(location.turn).turn : location.turn
  if (integer(located)) return located
  // Compatibility with older plain payload fixtures; never use order/index.
  const turn = record(node.data).turn
  return integer(turn) ? turn : null
}
interface OutputRuns { runs: string[]; startsWithText: boolean; endsWithText: boolean }
function outputRuns(data: Record<string, unknown>): OutputRuns {
  if (!Array.isArray(data.blocks)) {
    const text = Array.isArray(data.content) ? contentText(data.content).trim() : ''
    return { runs: text ? [text] : [], startsWithText: text !== '', endsWithText: text !== '' }
  }
  const runs: string[] = []
  let current: string[] = []
  const flush = (): void => {
    const text = current.join('\n').trim()
    if (text !== '') runs.push(text)
    current = []
  }
  for (const value of data.blocks) {
    const block = record(value)
    if (block.kind === 'text' && typeof block.text === 'string' && block.text.trim() !== '') current.push(block.text)
    else if (block.kind === 'image') current.push('[image]')
    else flush()
  }
  flush()
  return {
    runs,
    startsWithText: record(data.blocks[0]).kind === 'text',
    endsWithText: record(data.blocks.at(-1)).kind === 'text',
  }
}
function descriptor(node: ChatConversationViewNode, role: 'user' | 'assistant', text: string, kind: KeyKind, suffix = ''): KeyDescriptor {
  const preview = truncate(text, PREVIEW_LIMIT)
  return { key: `${node.key}${suffix}`, anchorKey: node.key, role, title: titleOf(preview), preview, turn: turnOf(node), kind }
}

/**
 * The durable Turn tail names the actual closing assistant. A settled model
 * step or the last visible row alone does NOT establish a final Turn answer.
 * Missing/truncated/failed evidence must never promote process prose to final.
 */
function finalKeys(nodes: readonly ChatConversationViewNode[]): Set<string> {
  const closing = new Map<number, Record<string, unknown>>()
  const failed = new Set<number>()
  for (const node of nodes) {
    const turn = turnOf(node)
    if (turn === null) continue
    if (node.kind === 'turn-error' || node.kind === 'turn-max-tokens') failed.add(turn)
    if (node.kind !== 'turn-tail') continue
    const tail = record(record(node.data).closing)
    const durable = record(tail.finalNode)
    if (tail.status === 'settled' && integer(tail.step) && durable.interrupted !== true
      && durable.kind === 'assistant' && integer(durable.seq)) closing.set(turn, tail)
  }
  const candidates = new Map<number, ChatConversationViewNode[]>()
  for (const node of nodes) {
    const turn = turnOf(node)
    if (turn === null || failed.has(turn) || !ASSISTANT_KINDS.has(node.kind) || node.visibility === 'hidden') continue
    const tail = closing.get(turn)
    if (tail === undefined) continue
    const data = record(node.data)
    const durable = node.kind === 'assistant' ? data : record(data.finalNode)
    const expected = record(tail.finalNode)
    if (data.status === 'running' || data.status === 'interrupted' || durable.interrupted === true) continue
    if (data.step !== tail.step || durable.seq !== expected.seq) continue
    if (typeof expected.messageId === 'string' && durable.messageId !== expected.messageId) continue
    if (outputRuns(data).runs.length === 0) continue
    const list = candidates.get(turn) ?? []
    list.push(node); candidates.set(turn, list)
  }
  // Ambiguous duplicate material is not a basis for guessing which row is final.
  return new Set([...candidates.values()].filter(list => list.length === 1).map(list => list[0].key))
}

export function buildNavigationNodes(nodes: readonly ChatConversationViewNode[]): KeyDescriptor[] {
  const finals = finalKeys(nodes)
  const result: KeyDescriptor[] = []
  let continuable: KeyDescriptor | null = null
  for (const node of nodes) {
    if (node.visibility === 'hidden') { continuable = null; continue }
    const data = record(node.data)
    if (USER_KINDS.has(node.kind)) {
      continuable = null
      const text = Array.isArray(data.content) ? contentText(data.content).trim() : ''
      if (text !== '') result.push(descriptor(node, 'user', text, 'input'))
      continue
    }
    if (node.kind === 'tool-call') {
      continuable = null
      result.push(...questionKeys(node, turnOf(node)))
      continue
    }
    if (!ASSISTANT_KINDS.has(node.kind)) { continuable = null; continue }
    const output = outputRuns(data)
    if (output.runs.length === 0) { continuable = null; continue }
    if (finals.has(node.key)) {
      // Exactly one independent key for the complete final message. Reuse its
      // first output identity when streaming becomes durable; never merge it
      // into the previous step or duplicate it alongside ordinary output keys.
      result.push(descriptor(node, 'assistant', output.runs.join('\n\n'), 'final', '::output:0'))
      continuable = null
      continue
    }
    for (let index = 0; index < output.runs.length; index++) {
      const turn = turnOf(node)
      const target: KeyDescriptor | null = index === 0 && output.startsWithText
        && continuable !== null && turn !== null && continuable.turn === turn ? continuable : null
      if (target !== null) target.preview = truncate(`${target.preview}\n\n${output.runs[index]}`, PREVIEW_LIMIT)
      else {
        const next = descriptor(node, 'assistant', output.runs[index], 'output', `::output:${index}`)
        result.push(next); continuable = next
      }
      if (index < output.runs.length - 1) continuable = null
    }
    if (!output.endsWithText) continuable = null
  }
  return result
}
