/** Original ChatView + ChatNodeSeat + disclosure/card, with synthetic Session transport. */
import React, { useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { ChatView } from '../.semantic-fixture/vendor/ChatView.tsx'
import { DisclosureRow } from '../.semantic-fixture/vendor/DisclosureRow.tsx'
import { AskQuestionCard } from '../.semantic-fixture/vendor/AskQuestionCard.tsx'
import { attachKeyStrip } from '../src/client/strip.ts'
import { installStyles } from '../src/client/styles.ts'
const observable = (initial: any) => {
  let value = initial
  const listeners = new Set<() => void>()
  return { getSnapshot: () => value, subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }, set(next: any) { value = next; for (const fn of [...listeners]) fn() } }
}
const identity = (x: any) => x
const selector = (store: any, select = identity) => select(useSyncExternalStore(store.subscribe, store.getSnapshot))
const view = observable({ turnProcesses: [] as any[] })
const state = observable({ openState: 'open', openError: null, hasMore: false, loadingOlder: false, running: false, queue: [], pendingSubmissions: [] })
const chat = observable(null)
const outline = observable([])
const selection = observable({ current: 's1', byId: { s1: { cwd: '/fixture' } } })
const settings = observable({ language: 'en', enabled: true, keyHeight: 3, keyGap: 16, maxVisible: 30 })
let compact = true
let pending = false
let submissionCalls = 0
let mounted = 0
const nodes = new Map<string, any>()
const sources = new Map<string, any>()
const specs = new Map<string, any>()
const turn = (n: number) => ({ turn: n, data: new Map() })
const node = (key: string, kind: string, n: number, seq: number, data: any) => ({ key, kind, target: 'chat', visibility: 'visible', anchorSeq: seq, location: { kind: 'step', turn: turn(n), step: { step: data.step ?? 0 } }, data })
const assistant = (key: string, n: number, step: number, text: string) => {
  const blocks = [{ kind: 'text', text }]
  return node(key, 'assistant-step', n, n * 100 + step * 10, { status: 'settled', turn: n, step, blocks, finalNode: { kind: 'assistant', seq: n * 100 + step * 10 + 1, messageId: key, turn: n, step, blocks } })
}
const questions = [{ id: 'route', question: 'Which route should we take?', options: [{ label: 'A' }, { label: 'B' }], multi_select: false }, { id: 'checks', question: 'Which checks should run?', multi_select: true }]
const answers = [{ id: 'checks', selected: ['Unit', 'Browser'], custom: 'Windows' }, { id: 'route', selected: ['B'] }]
function rebuild() {
  nodes.clear(); specs.clear()
  const order: string[] = []
  const navigation: any[] = []
  const add = (value: any) => { nodes.set(value.key, value); order.push(value.key) }
  for (let n = 1; n <= 2; n++) {
    const final = assistant(`f${n}`, n, 2, `FINAL_${n}: This is the completed result, not the process note.`)
    const closed = n === 1 || !pending
    add(node(`u${n}`, 'user', n, n * 100, { content: [{ type: 'text', text: `Input ${n}: solve this task` }] }))
    add(assistant(`p${n}`, n, 1, `PROCESS_${n}: working through the task`))
    if (n === 2) {
      const root = pending ? { callId: 'qa', name: 'ask_user_question', argsRaw: JSON.stringify({ questions }), subCalls: [] }
        : { kind: 'tool-result', callId: 'qa', call: { name: 'ask_user_question', argsRaw: JSON.stringify({ questions }) }, isError: false, content: [{ type: 'text', text: JSON.stringify({ answers }) }], subCalls: [] }
      add(node('tool2', 'tool-call', n, 215, { root }))
    }
    const spec = { turn: n, controlAnchorSeq: n * 100 + 18, processStartSeq: n * 100 + 10, answerAnchorSeq: closed ? n * 100 + 20 : null, answerStep: closed ? 2 : null, inlineReasoning: false, messageCount: 1, toolCallCount: n === 2 ? 1 : 0, subagentCount: 0 }
    add(node(`control${n}`, 'turn-process', n, n * 100 + 18, spec))
    if (closed) { add(final); add(node(`tail${n}`, 'turn-tail', n, n * 100 + 30, { turn: n, seq: n * 100 + 30, time: 0, closing: final.data })) }
    for (const [key, value] of nodes) if (value.location.turn.turn === n) specs.set(key, { turn: n, spec, turnClosed: closed, hasExternalProcess: true, compactAnswer: false })
    navigation.push({ turn: n, anchorKey: `u${n}`, prompt: `Input ${n}`, response: closed ? `FINAL_${n}` : '' })
  }
  const store = {
    get: (key: string) => nodes.get(key),
    source: (key: string) => {
      // Each key has an independently disposable subscription even though the
      // synthetic fixture publishes through one bus. Removing a key must not
      // delete the target subscription that happens to use the same callback.
      if (!sources.has(key)) sources.set(key, { getSnapshot: () => nodes.get(key), subscribe: (fn: () => void) => chat.subscribe(() => fn()) })
      return sources.get(key)
    },
  }
  chat.set({ order, nodes: store, navigation: { items: () => navigation }, timeline: { turnOrder: [], turns: new Map() } })
  outline.set(navigation.map(item => ({ ...item, seq: item.turn * 100 })))
}
function Tool({ root }: any) {
  const [open, setOpen] = useState(false)
  const card = root.kind === 'tool-result' ? {
    kind: 'answered', skippedLabel: 'Skipped', questions: questions.map(q => {
      const answer = answers.find(a => a.id === q.id)
      const lines = !q.multi_select && answer?.custom ? [answer.custom]
        : [...(answer?.selected ?? []), ...(answer?.custom ? [answer.custom] : [])]
      return { id: q.id, question: q.question, answers: lines }
    }),
  } : { kind: 'unanswered', verdict: 'Awaiting your answer', questions }
  return <div data-chat-anchor-key="call:qa" data-chat-call-id="qa">
    <div data-tool="ask_user_question">
      <DisclosureRow title="Interactive question" icon={<span>?</span>} open={open} expandable expandOnRowClick onToggle={() => setOpen(!open)}>
        <AskQuestionCard card={card as any} />
        <button onClick={() => submissionCalls++}>Submission sentinel: never click</button>
      </DisclosureRow>
    </div>
  </div>
}
function Message({ node: value, turnProcess }: any) {
  if (value.kind === 'turn-tail') return null
  if (value.kind === 'turn-process') return <button onClick={() => turnProcess?.setOpen(!turnProcess.open)}>Show native process</button>
  if (value.kind === 'tool-call') return <Tool root={value.data.root} />
  const user = value.kind === 'user'
  return <article style={{ padding: 20, minHeight: user ? 75 : 155, border: '1px solid #ccc', borderRadius: 10 }}>
    <b>{user ? 'User' : 'AI'}</b><p>{user ? value.data.content[0].text : value.data.blocks.map((block: any) => block.kind === 'text' ? block.text : '').join('\n')}</p>
  </article>
}
const t = (key: string, args?: any) => key === 'chat.turnNavigation.label' ? 'Turn navigation' : key === 'chat.turnNavigation.jump' ? `Jump to turn ${args.turn}` : key === 'chat.turnNavigation.jumpLoad' ? `Load and jump to turn ${args.turn}` : key
rebuild()
const session = { ...state, sessionId: 's1', projections: { faceOf: () => outline } }
const binding = { session }
const app = createRoot(document.getElementById('chat')!)
const props: any = {
  sessionId: 's1', useChat: (s: any) => selector(chat, s), useSession: (s: any) => selector(state, s), useSessions: (s: any) => selector(selection, s),
  useProjection: () => selector(outline), useChatNode: (key: string, s = identity) => selector(chat.getSnapshot().nodes.source(key), s),
  useChatNodeProcess: (key: string) => { selector(chat); return specs.get(key) }, useStore: (s: any) => selector(view, s),
  actions: { setTurnProcessOpen(n: number, answerStep: number, open: boolean) { view.set({ turnProcesses: [...view.getSnapshot().turnProcesses.filter((entry: any) => entry.turn !== n), ...(open ? [{ turn: n, answerStep }] : [])] }) } },
  renderSlot: (_: string, owner: any) => <Message key={owner.node.key} {...owner} />,
  openFile: async () => {}, openSkill: () => {}, loadOlder: () => {}, loadThrough: () => { throw new Error('No history request expected') }, loadImage: () => '', openView: () => {},
  chatScroll: { read: () => null, save: () => {} }, forkAt: () => {}, fileMentions: () => undefined, useTranscriptView: (s: any) => s(compact ? 'compact' : 'normal'), t,
}
const render = () => app.render(<ChatView key={mounted} {...props} />)
render(); installStyles()
const ctx: any = { locale: { bind: () => t }, sessions: { list: selection, binding: () => binding }, uiConversation: { binding: () => ({ target: () => chat }) } }
const dispose = attachKeyStrip(ctx, (() => 'Piano navigation') as any, settings)
;(window as any).semanticFixture = {
  summary: () => ({ submissionCalls, processOpen: view.getSnapshot().turnProcesses }),
  waiting() { pending = true; state.set({ ...state.getSnapshot(), running: true }); rebuild() },
  answer() { pending = false; state.set({ ...state.getSnapshot(), running: false }); rebuild() },
  normal() { compact = false; mounted++; render() },
  disable() { settings.set({ ...settings.getSnapshot(), enabled: false }) },
  disappear() { selection.set({ current: undefined, byId: {} }); app.unmount() },
  stop: dispose,
}
