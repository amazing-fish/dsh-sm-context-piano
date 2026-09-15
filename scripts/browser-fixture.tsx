/** Real official ChatView and rail, synthetic Session transport and message leaves. */
import React, { useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { ChatView } from '../.browser-fixture/vendor/ChatView.tsx'
import { attachKeyStrip } from '../src/client/strip.ts'
import { installStyles } from '../src/client/styles.ts'

function observable(initial: any) {
  let value = initial
  const listeners = new Set<() => void>()
  return { getSnapshot: () => value, subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } },
    set(next: any) { value = next; for (const fn of [...listeners]) fn() }, emit() { for (const fn of [...listeners]) fn() } }
}
let head = 16
let version = 0
let failed = false
let id = 's1'
let saved: any = null
let resolvers: (() => void)[] = []
const calls: number[] = []
const nodeMap = new Map<string, any>()
const nodeSources = new Map<string, any>()
const nodes = {
  get: (key: string) => nodeMap.get(key),
  source: (key: string) => {
    if (!nodeSources.has(key)) nodeSources.set(key, { getSnapshot: () => nodeMap.get(key), subscribe: (fn: any) => chat.subscribe(fn) })
    return nodeSources.get(key)
  },
}
const chat = observable(null)
const lifecycle = observable({ openState: 'open', openError: null, hasMore: true, loadingOlder: false, running: false, queue: [], pendingSubmissions: [] })
const outline = observable(Array.from({ length: 20 }, (_, i) => ({ turn: i + 1, seq: (i + 1) * 100, prompt: `Question ${i + 1}`, response: `Answer ${i + 1}` })))
const selection = observable({ current: id, byId: { s1: { cwd: '/fixture' }, s2: { cwd: '/fixture' } } })
const settings = observable({ language: 'en', enabled: true, keyHeight: 2, keyGap: 12, maxVisible: 8 })
function rebuild() {
  nodeMap.clear()
  const order: string[] = []
  const navigation: any[] = []
  for (let turn = head; turn <= 20; turn++) {
    navigation.push({ turn, anchorKey: `u${turn}`, prompt: `Question ${turn}`, response: `Answer ${turn}` })
    for (const role of ['u', 'a']) {
      const key = `${role}${turn}`
      order.push(key)
      nodeMap.set(key, { key, kind: role === 'u' ? 'user' : 'assistant-step', target: 'chat', visibility: 'visible', anchorSeq: turn * 100 + (role === 'a' ? 1 : 0), location: { turn },
        data: role === 'u' ? { content: [{ type: 'text', text: `Question ${turn}` }], turn } : { status: 'settled', time: turn, turn, step: 0, blocks: [{ kind: 'text', text: `Answer ${turn}: verified full-history navigation.` }] } })
    }
  }
  chat.set({ order, nodes, navigation: { items: () => navigation }, timeline: { turnOrder: [], turns: new Map() } })
}
rebuild()
const loadThrough = (seq: number): Promise<void> => {
  calls.push(seq)
  if (failed) return Promise.resolve()
  lifecycle.set({ ...lifecycle.getSnapshot(), loadingOlder: true })
  return new Promise(resolve => { resolvers.push(resolve) })
}
const session = { ...lifecycle, sessionId: id, projections: { faceOf: () => outline }, loadThrough }
let binding = { session }
const t = (key: string, args?: any) => key === 'chat.turnNavigation.label' ? 'Turn navigation'
  : key === 'chat.turnNavigation.jump' ? `Jump to turn ${args.turn}`
    : key === 'chat.turnNavigation.jumpLoad' ? `Load and jump to turn ${args.turn}`
      : key === 'chat.turnNavigation.turn' ? `Turn ${args.turn}` : key
const selector = (source: any, select: any) => select(useSyncExternalStore(source.subscribe, source.getSnapshot))
const props: any = {
  sessionId: id,
  useChat: (select: any) => selector(chat, select), useSession: (select: any) => selector(lifecycle, select),
  useSessions: (select: any) => selector(selection, select), useProjection: () => selector(outline, (x: any) => x),
  useChatNode: (key: string, select: any) => selector(nodes.source(key), select), useChatNodeProcess: () => undefined,
  useStore: (select: any) => select({}), actions: {}, renderSlot: () => null,
  openFile: async () => {}, openSkill: () => {}, loadOlder: () => {}, loadThrough,
  loadImage: () => '', openView: () => {}, chatScroll: { read: () => saved, save: (value: any) => { saved = value } },
  forkAt: () => {}, fileMentions: () => undefined, useTranscriptView: (select: any) => select('normal'), t,
}
const root = createRoot(document.getElementById('chat')!)
const render = () => root.render(<ChatView key={`${id}:${version}`} {...props} sessionId={id} />)
render()
installStyles()
const ctx: any = {
  locale: { bind: () => t }, sessions: { list: selection, binding: () => binding },
  uiConversation: { binding: () => ({ target: () => chat }) },
}
const dispose = attachKeyStrip(ctx, (() => 'Piano conversation navigation') as any, settings)
;(window as any).fixture = {
  calls, state: () => ({ head, saved, loading: lifecycle.getSnapshot().loadingOlder }),
  settle() {
    head = Math.min(head, ...calls.map(seq => Math.floor(seq / 100)))
    rebuild(); lifecycle.set({ ...lifecycle.getSnapshot(), loadingOlder: false, hasMore: head > 1 })
    const pending = resolvers; resolvers = []; for (const resolve of pending) resolve()
  },
  fail() {
    failed = true; lifecycle.set({ ...lifecycle.getSnapshot(), loadingOlder: false })
    const pending = resolvers; resolvers = []; for (const resolve of pending) resolve()
  },
  enable(value: boolean) { settings.set({ ...settings.getSnapshot(), enabled: value }) },
  remount() { version++; render() },
  switchSession() {
    id = 's2'; binding = { session: { ...session, sessionId: id } }; saved = null
    selection.set({ ...selection.getSnapshot(), current: id }); render()
  },
  stop: dispose,
}
