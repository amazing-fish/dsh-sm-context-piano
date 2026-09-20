/** Single-rail DOM contracts. Real ChatView scrolling is tested separately in Chromium. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { JSDOM } from 'jsdom'
const require = createRequire(import.meta.url)
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/', pretendToBeVisual: true })
const { window } = dom
const { document } = window
Object.assign(globalThis, { window, document, MutationObserver: window.MutationObserver, Event: window.Event })
const resizeObservers = []
globalThis.ResizeObserver = class {
  constructor(callback) { this.callback = callback; this.targets = new Set(); resizeObservers.push(this) }
  observe(target) { this.targets.add(target) }
  unobserve(target) { this.targets.delete(target) }
  disconnect() { this.targets.clear() }
}
window.matchMedia = () => ({ matches: true })
const frame = async () => { await new Promise(r => setTimeout(r, 80)) }
const triggerResize = async target => {
  for (const observer of resizeObservers) if (observer.targets.has(target)) observer.callback([{ target }], observer)
  await frame()
}
const observable = value => {
  const listeners = new Set()
  return { getSnapshot: () => value, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) },
    set(next) { value = next; for (const listener of [...listeners]) listener() }, emit() { for (const listener of [...listeners]) listener() }, listeners }
}
const root = document.createElement('main')
const scroll = document.createElement('div')
scroll.dataset.conversationScroll = ''
const local = document.createElement('div')
const flow = document.createElement('div')
flow.dataset.chatFlow = ''
const native = document.createElement('nav')
native.setAttribute('aria-label', 'Turn navigation')
const composer = document.createElement('div')
composer.dataset.composerSeat = ''
let composerHeight = 0
Object.defineProperty(composer, 'offsetHeight', { get: () => composerHeight })
local.append(native, flow); scroll.append(local, composer); root.append(scroll); document.body.append(root)
const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height })
Object.defineProperties(root, { clientWidth: { value: 1280, configurable: true }, clientHeight: { value: 900 }, getBoundingClientRect: { value: () => rect(0, 0, 1280, 900) } })
Object.defineProperties(scroll, { clientHeight: { value: 800 }, getBoundingClientRect: { value: () => rect(0, 0, 1280, 800) } })
flow.getBoundingClientRect = () => rect(300, -scroll.scrollTop, 748, 3000)
const loaded = new Set([8, 9, 10])
const map = new Map()
const sources = new Map()
const nodeStore = {
  get: key => map.get(key),
  source: key => { if (!sources.has(key)) sources.set(key, observable(null)); return sources.get(key) },
}
const chat = observable(undefined)
const outline = observable(Array.from({ length: 10 }, (_, i) => ({ turn: i + 1, seq: (i + 1) * 100, prompt: `Question ${i + 1}`, response: `Response ${i + 1}` })))
const sessionState = observable({ loadingOlder: false })
let pending = null
const requests = []
const clicks = []
const nativeButton = turn => [...native.querySelectorAll('button')].find(b => b.dataset.testTurn === String(turn))
function refresh() {
  flow.replaceChildren()
  native.replaceChildren()
  map.clear()
  const order = []
  const navigation = []
  for (let turn = 1; turn <= 10; turn++) {
    const button = document.createElement('button')
    button.dataset.testTurn = String(turn)
    button.setAttribute('aria-label', `${loaded.has(turn) ? 'Jump' : 'Load'} ${turn}`)
    button.setAttribute('aria-busy', String(pending === turn))
    button.onclick = () => {
      clicks.push(turn)
      if (!loaded.has(turn)) {
        pending = turn; requests.push(turn)
        sessionState.set({ loadingOlder: true })
      } else { pending = null; sessionState.set({ loadingOlder: false }) }
      for (const b of native.querySelectorAll('button')) b.setAttribute('aria-busy', String(b.dataset.testTurn === String(pending)))
    }
    native.append(button)
    if (!loaded.has(turn)) continue
    navigation.push({ turn, anchorKey: `u${turn}`, prompt: `Question ${turn}`, response: `Response ${turn}` })
    for (const role of ['u', 'a']) {
      const key = `${role}${turn}`
      const node = { key, kind: role === 'u' ? 'user' : 'assistant-step', target: 'chat', visibility: 'visible', location: { turn }, anchorSeq: turn * 100,
        data: role === 'u' ? { content: [{ type: 'text', text: `Question ${turn}` }] } : { turn, blocks: [{ kind: 'text', text: `Answer ${turn}` }] } }
      map.set(key, node); order.push(key)
      const row = document.createElement('div'); row.dataset.chatAnchorKey = key; row.dataset.chatTurn = String(turn)
      row.getBoundingClientRect = () => rect(300, (turn - 1) * 220 + (role === 'a' ? 100 : 0) - scroll.scrollTop, 748, 90)
      flow.append(row)
    }
  }
  chat.set({ order, nodes: nodeStore, navigation: { items: () => navigation } })
}
refresh()
const session = Object.assign({}, sessionState, { sessionId: 's1', projections: { faceOf: key => { assert.equal(key, 'turnOutline'); return outline } },
  loadThrough() { throw new Error('Piano must delegate to the native button, not start a second pager') } })
let binding = { session }
const selection = observable({ current: 's1' })
const settings = observable({ value: { enabled: true, language: 'zh', keyHeight: 2, keyGap: 12, maxVisible: 20 }, writable: true })
const set = async (key, value) => { settings.set({ ...settings.getSnapshot(), value: { ...settings.getSnapshot().value, [key]: value } }); await frame() }
const disposers = []
const nativeTranslate = (key, args) => key === 'chat.turnNavigation.label' ? 'Turn navigation'
  : key === 'chat.turnNavigation.jumpLoad' ? `Load ${args.turn}` : key === 'chat.turnNavigation.jump' ? `Jump ${args.turn}` : key
const ctx = {
  effect: fn => { const stop = fn(); disposers.push(stop); return stop },
  locale: { register: () => () => {}, bind: ns => ns === 'chat' ? nativeTranslate : key => key },
  sessions: { list: selection, binding: id => id === 's1' ? binding : undefined },
  uiConversation: { binding: b => { assert.equal(b, binding); return { target: key => { assert.equal(key, 'chat'); return chat } } } },
  settingsScope: { bind: () => settings },
  slots: { inject: (_, fn) => fn(), register: () => () => {} },
}
window.__ModuleLoader__ = { load: handoff => { globalThis.handoff = handoff } }
await import('../lib/client.js')
const plugin = globalThis.handoff.factory(spec => require(spec))
plugin.apply(ctx)
await frame()
let passed = 0
async function check(name, run) { await run(); passed++; console.log(`ok ${passed} - ${name}`) }
const piano = () => document.querySelector('.smcp-unified')
const key = id => [...document.querySelectorAll('.smcp-bar')].find(b => b.dataset.key === id)
const press = async k => { piano().dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true })); await frame() }

await check('exactly one visible and accessible rail; native component stays mounted', () => {
  assert.equal(piano().hidden, false)
  assert.equal(native.style.getPropertyValue('display'), 'none')
  assert.equal(native.getAttribute('aria-hidden'), 'true')
  assert.equal(native.querySelectorAll('button').length, 10)
})
await check('scroll hot path skips model rebuilds and DOM reconciliation', async () => {
  const before = { ...globalThis.__smcpDebug.perf }
  for (let index = 0; index < 100; index++) scroll.dispatchEvent(new window.Event('scroll'))
  await frame()
  const after = globalThis.__smcpDebug.perf
  assert.equal(after.nodeRebuilds, before.nodeRebuilds)
  assert.equal(after.turnRebuilds, before.turnRebuilds)
  assert.equal(after.domReconciles, before.domReconciles)
  assert.ok(after.renders - before.renders <= 2)
})

await check('message-body DOM churn does not rebuild navigation indexes', async () => {
  const before = { ...globalThis.__smcpDebug.perf }
  const row = flow.querySelector('[data-chat-anchor-key="a8"]')
  const span = document.createElement('span')
  span.textContent = 'streamed markdown child'
  row.append(span)
  await frame()
  const after = globalThis.__smcpDebug.perf
  assert.equal(after.domReconciles, before.domReconciles)
  assert.equal(after.nodeRebuilds, before.nodeRebuilds)
  span.remove()
  await frame()
  assert.equal(globalThis.__smcpDebug.perf.domReconciles, before.domReconciles)
})

await check('reading-line gaps preserve the preceding semantic segment', async () => {
  scroll.scrollTop = 1540
  scroll.dispatchEvent(new window.Event('scroll'))
  await frame()
  const current = document.querySelector('.smcp-bar[aria-current="true"]')
  assert.equal(current?.dataset.key, 'segment:a8::output:0')
  scroll.scrollTop = 0
  scroll.dispatchEvent(new window.Event('scroll'))
  await frame()
})

await check('composer autosize invalidates cached rail layout', async () => {
  const before = Number.parseFloat(piano().style.top)
  composerHeight = 260
  await triggerResize(composer)
  const after = Number.parseFloat(piano().style.top)
  assert.ok(Number.isFinite(before) && Number.isFinite(after))
  assert.ok(after < before - 50, `composer growth should move rail up: ${before} -> ${after}`)
  composerHeight = 0
  await triggerResize(composer)
  assert.ok(Math.abs(Number.parseFloat(piano().style.top) - before) < 1)
})

await check('unloaded Turns appear without creating fake assistant segments', () => {
  assert.equal(globalThis.__smcpDebug.total, 13)
  assert.equal(key('turn:1').dataset.unloaded, 'true')
  assert.equal(key('segment:a1::output:0'), undefined)
})
await check('full-history Home/End keys work independently of maxVisible', async () => {
  await set('maxVisible', 5)
  await press('End')
  assert.ok(globalThis.__smcpDebug.windowStart > 0)
  assert.ok(document.querySelectorAll('.smcp-bar').length <= 5)
  await press('Home')
  assert.ok(key('turn:1'))
})
await check('unloaded activation delegates once and shows native busy state', async () => {
  await press('Enter')
  assert.deepEqual(requests, [1])
  assert.equal(key('turn:1').getAttribute('aria-busy'), 'true')
  assert.match(document.querySelector('[role="status"]').textContent, /正在加载第 1 轮/)
})
await check('new target supersedes old intent without a second plugin pager', async () => {
  await press('ArrowDown'); await press('Enter')
  assert.equal(pending, 2)
  assert.deepEqual(requests, [1, 2])
})
await check('Escape delegates cancellation and preserves current reader position', async () => {
  const top = scroll.scrollTop
  await press('Escape')
  assert.equal(pending, null)
  assert.equal(scroll.scrollTop, top)
})
await check('materialization preserves the stable Turn entry and adds genuine segments', async () => {
  await press('Home'); await press('Enter')
  const previous = key('turn:1')
  loaded.add(1); pending = null; refresh(); sessionState.set({ loadingOlder: false })
  await frame()
  await press('Home')
  assert.equal(key('turn:1'), previous)
  assert.equal(key('turn:1').dataset.unloaded, 'false')
  assert.ok(key('segment:a1::output:0'))
})
await check('failed load remains selectable and reports retry, not false success', async () => {
  await press('Home'); await press('ArrowDown'); await press('ArrowDown'); await press('Enter')
  assert.equal(pending, 2)
  pending = null; refresh(); sessionState.set({ loadingOlder: false }); await frame()
  assert.match(document.querySelector('[role="status"]').textContent, /第 2 轮未加载/)
  await press('Home'); await press('ArrowDown'); await press('ArrowDown'); await press('Enter')
  assert.equal(pending, 2)
  await press('Escape')
})
await check('rail wheel reveals older/later entries without scrolling the transcript', async () => {
  await press('Home')
  const top = scroll.scrollTop
  piano().dispatchEvent(new window.WheelEvent('wheel', { deltaY: 300, bubbles: true, cancelable: true }))
  await frame()
  assert.ok(globalThis.__smcpDebug.windowStart > 0)
  assert.equal(scroll.scrollTop, top)
})
await check('reader wheel cancels a pending native landing', async () => {
  await press('Home'); await press('ArrowDown'); await press('ArrowDown'); await press('Enter')
  assert.equal(pending, 2)
  scroll.dispatchEvent(new window.WheelEvent('wheel', { deltaY: 100 })); await frame()
  assert.equal(pending, null)
})
await check('keyed-only streaming refreshes visible text without a full semantic rebuild', async () => {
  await press('Home'); await press('ArrowDown')
  const before = { ...globalThis.__smcpDebug.perf }
  map.get('a1').data.blocks[0].text = 'fresh stream'
  sources.get('a1').emit(); await frame(); await new Promise(resolve => setTimeout(resolve, 140)); await frame()
  const after = globalThis.__smcpDebug.perf
  assert.equal(after.nodeRebuilds, before.nodeRebuilds)
  assert.ok(after.keyedSemanticUpdates > before.keyedSemanticUpdates)
  assert.equal(after.itemRebuilds, before.itemRebuilds)
  assert.match(document.querySelector('.smcp-tooltip').textContent, /fresh stream/)
})
await check('continuous keyed streaming stays turn-local and throttled', async () => {
  const before = { ...globalThis.__smcpDebug.perf }
  for (let index = 0; index < 12; index++) {
    map.get('a1').data.blocks[0].text = `stream burst ${index}`
    sources.get('a1').emit()
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  await new Promise(resolve => setTimeout(resolve, 180))
  await frame()
  const after = globalThis.__smcpDebug.perf
  assert.equal(after.nodeRebuilds, before.nodeRebuilds, 'token burst must not rebuild full transcript semantics')
  assert.equal(after.itemRebuilds, before.itemRebuilds, 'stable one-turn shape must not rebuild global items')
  const keyed = after.keyedSemanticUpdates - before.keyedSemanticUpdates
  assert.ok(keyed >= 1 && keyed <= 3, `expected 1..3 turn-local semantic updates for burst, got ${keyed}`)
  assert.match(document.querySelector('.smcp-tooltip').textContent, /stream burst 11/)
})

await check('contract drift restores official UI and hides Piano, never both', async () => {
  nativeButton(3).setAttribute('aria-label', 'changed-contract'); await frame()
  assert.equal(piano().hidden, true)
  assert.equal(native.style.display, '')
  assert.equal(native.hasAttribute('aria-hidden'), false)
  refresh(); await frame()
  assert.equal(piano().hidden, false)
})
await check('narrow-container fallback restores native ownership', async () => {
  Object.defineProperty(root, 'clientWidth', { value: 500, configurable: true })
  chat.emit(); await frame()
  assert.equal(piano().hidden, true)
  assert.equal(native.style.display, '')
  Object.defineProperty(root, 'clientWidth', { value: 1280, configurable: true })
  chat.emit(); await frame()
})
await check('disable restores native visibility and releases all subscriptions', async () => {
  await set('enabled', false)
  assert.equal(piano(), null)
  assert.equal(native.style.display, '')
  assert.equal(chat.listeners.size, 0)
  assert.equal(outline.listeners.size, 0)
  for (const source of sources.values()) assert.equal(source.listeners.size, 0)
  await set('enabled', true)
})
await check('same-ID binding replacement rebinds exactly once', async () => {
  binding = { session }; selection.emit(); await frame()
  assert.equal(chat.listeners.size, 1)
  assert.equal(outline.listeners.size, 1)
})
await check('session disappearance cannot publish stale content', async () => {
  selection.set({ current: undefined }); chat.emit(); await frame()
  assert.equal(piano().hidden, true)
  assert.equal(native.style.display, '')
  assert.equal(chat.listeners.size, 0)
})
await check('dispose removes Piano and preserves native navigation', () => {
  for (const dispose of disposers.reverse()) if (typeof dispose === 'function') dispose()
  assert.equal(piano(), null)
  assert.equal(document.querySelector('.smcp-tooltip'), null)
  assert.equal(native.isConnected, true)
  assert.equal(native.style.display, '')
})
console.log(`${passed} single-navigation integration checks passed`)
dom.window.close()
