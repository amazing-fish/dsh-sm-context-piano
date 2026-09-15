/** Read-only ask_user_question projection. Never invokes a responder or tool. */
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { KeyDescriptor } from './keys.ts'
const MAX_JSON_LENGTH = 262_144
const object = (value: unknown): Record<string, unknown> | null => typeof value === 'object' && value !== null && !Array.isArray(value)
  ? value as Record<string, unknown> : null
const text = (value: unknown): string => typeof value === 'string' ? value : ''
const bounded = (value: string, limit: number): string => value.length <= limit ? value : `${value.slice(0, limit).trimEnd()}…`
function parse(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string' || value.length > MAX_JSON_LENGTH) return null
  try { return object(JSON.parse(value)) } catch { return null }
}

/** A repeated id is ambiguous: omit it instead of pairing somebody else's answer. */
function uniqueById(values: readonly unknown[]): Map<string, Record<string, unknown>> {
  const result = new Map<string, Record<string, unknown>>()
  const duplicates = new Set<string>()
  for (const value of values) {
    const entry = object(value)
    const id = text(entry?.id)
    if (entry === null || id === '' || duplicates.has(id)) continue
    if (result.has(id)) { result.delete(id); duplicates.add(id) } else result.set(id, entry)
  }
  return result
}
function resultObject(call: Record<string, unknown>): Record<string, unknown> | null {
  if (call.kind !== 'tool-result' || call.isError !== false || !Array.isArray(call.content)) return null
  let raw = ''
  for (const value of call.content) {
    const block = object(value)
    if (block?.type !== 'text' || typeof block.text !== 'string') continue
    if (raw.length + block.text.length > MAX_JSON_LENGTH) return null
    raw += block.text
  }
  return parse(raw)
}

export function questionKeys(node: ChatConversationViewNode, turn: number | null): KeyDescriptor[] {
  if (turn === null) return []
  const root = object(object(node.data)?.root)
  if (root === null) return []
  const output: KeyDescriptor[] = []
  const visited = new Set<object>()
  const calls = new Set<string>()
  const stack = [root]
  while (stack.length > 0 && visited.size < 4096) {
    const call = stack.pop()!
    if (visited.has(call)) continue
    visited.add(call)
    if (Array.isArray(call.subCalls)) {
      for (let i = call.subCalls.length - 1; i >= 0; i--) {
        const child = object(call.subCalls[i]); if (child !== null) stack.push(child)
      }
    }
    const head = call.kind === 'tool-result' ? object(call.call) : call
    const callId = text(call.callId)
    if (head?.name !== 'ask_user_question' || callId === '' || calls.has(callId)) continue
    calls.add(callId)
    const args = parse(head.argsRaw)
    if (!Array.isArray(args?.questions)) continue
    const questions = uniqueById(args.questions)
    const result = resultObject(call)
    const answers = uniqueById(Array.isArray(result?.answers) ? result.answers : [])
    const settled = call.kind === 'tool-result'
    for (const [id, question] of questions) {
      const prompt = text(question.question).trim()
      if (prompt === '') continue
      const candidate = answers.get(id)
      const selected = candidate?.selected
      const valid = candidate !== undefined && Array.isArray(selected)
        && selected.every(value => typeof value === 'string')
        && (candidate.custom === undefined || typeof candidate.custom === 'string')
      const custom = valid ? text(candidate.custom).trim() : ''
      // Single-select custom overrides selected; multi-select custom supplements it.
      const answerText = valid ? (custom !== '' && question.multi_select !== true
        ? custom : [...selected as string[], ...(custom !== '' ? [custom] : [])].join('\n')) : ''
      const interactionState = !settled ? 'pending' : call.isError === true ? 'error'
        : valid ? 'answered' : 'unanswered'
      const base = `question:${encodeURIComponent(callId)}:${encodeURIComponent(id)}`
      const options = Array.isArray(question.options) ? question.options.flatMap(value => {
        const label = text(object(value)?.label); return label !== '' ? [label] : []
      }).join(' / ') : ''
      output.push({
        key: base, anchorKey: `call:${callId}`, turn, role: 'assistant', kind: 'question', interactionState,
        title: bounded(prompt, 140), preview: bounded(prompt + (options !== '' ? `\n${options}` : ''), 520),
      })
      if (valid && settled && call.isError === false) output.push({
        key: `${base}:answer`, anchorKey: `call:${callId}`, turn, role: 'user', kind: 'answer', interactionState: 'answered',
        // An empty recorded selection is a skipped answer, not a pending request.
        title: bounded(answerText || prompt, 140), preview: bounded(`${prompt}\n${answerText}`, 520),
      })
    }
  }
  return output
}
