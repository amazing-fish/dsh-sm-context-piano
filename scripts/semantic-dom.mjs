import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { createSemanticLanding } from '../src/client/semantic-landing.ts'
import { attachKeyStrip } from '../src/client/strip.ts'
const dom = new JSDOM('<!doctype html><body><div data-chat-flow><div data-chat-anchor-key="tool1" data-turn-process-hidden="true" hidden="until-found"><div data-chat-anchor-key="call:c1" data-chat-call-id="c1"><div data-tool="ask_user_question"><div data-disclosure-row data-expandable="true" role="button" aria-expanded="false">Question</div></div></div></div><div data-chat-anchor-key="final1"></div></div></body>', { pretendToBeVisual: true })
Object.assign(globalThis, { window: dom.window, document: dom.window.document, Event: dom.window.Event })
const flow = document.querySelector('[data-chat-flow]')
const hidden = flow.firstElementChild
const header = flow.querySelector('[data-disclosure-row]')
let reveal = 0, toggles = 0, clicks = []
hidden.addEventListener('beforematch', () => { reveal++; hidden.removeAttribute('hidden') })
header.addEventListener('click', () => { toggles++; header.setAttribute('aria-expanded', 'true') })
const owner = { cancel() {}, navigate(turn, anchorKey) { clicks.push({ turn, anchorKey }); return true } }
const landing = createSemanticLanding(flow, owner)
const question = { key: 'q', turn: 1, role: 'assistant', kind: 'question', title: 'Q', preview: '', anchorKey: 'call:c1' }
landing.refresh(); assert.equal(landing.canReveal('call:c1'), true)
assert.equal(await landing.navigate(question), true)
assert.equal(reveal, 1); assert.equal(toggles, 1); assert.deepEqual(clicks, [{ turn: 1, anchorKey: 'call:c1' }])
assert.equal(await landing.navigate({ ...question, kind: 'answer', role: 'user' }), true)
assert.equal(toggles, 1, 'revisiting an open card never closes it')
hidden.setAttribute('hidden', 'true'); landing.refresh()
assert.equal(landing.canReveal('call:c1'), false); assert.equal(await landing.navigate(question), false)
hidden.setAttribute('hidden', 'until-found')
const obsolete = landing.navigate(question); landing.cancel(); assert.equal(await obsolete, undefined)
const count = clicks.length
hidden.setAttribute('hidden', 'until-found')
const old = landing.navigate(question)
assert.equal(await landing.navigate({ ...question, kind: 'final', anchorKey: 'final1' }), true)
assert.equal(await old, undefined)
assert.equal(clicks.length, count + 1); assert.equal(clicks.at(-1).anchorKey, 'final1')
assert.equal(await landing.navigate({ ...question, anchorKey: 'missing' }), false)
landing.cancel(); dom.window.close()
console.log('semantic DOM: reveal, disclosure, repeat visit, privacy, cancellation, supersession and missing-anchor checks passed')

// Exercise the real strip and native owner together, with aria-busy deliberately
// left stale until the next publication. One reader event must not click twice.
const pointerDom = new JSDOM('<!doctype html><body><main><div data-conversation-scroll><section><nav aria-label="Turns"><button aria-label="Load 1"></button><button aria-label="Jump 2"></button></nav><div data-chat-flow><article data-chat-anchor-key="u2"></article></div></section></div></main></body>', { pretendToBeVisual: true })
Object.assign(globalThis, { window: pointerDom.window, document: pointerDom.window.document, Event: pointerDom.window.Event, MutationObserver: pointerDom.window.MutationObserver })
const root = document.querySelector('main'), scroll = document.querySelector('[data-conversation-scroll]'), chatFlow = document.querySelector('[data-chat-flow]')
Object.defineProperties(root, { clientWidth: { value: 1280 }, clientHeight: { value: 900 } })
Object.defineProperty(scroll, 'clientHeight', { value: 800 })
root.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1280, height: 900 })
scroll.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1280, height: 800 })
chatFlow.getBoundingClientRect = () => ({ left: 300, top: 0, width: 760, height: 1000 })
const loadedNode = { key: 'u2', kind: 'user', location: { turn: { turn: 2 } }, data: { content: [{ type: 'text', text: 'Input' }] } }
const observable = value => ({ getSnapshot: () => value, subscribe: () => () => {} })
const nodeSource = observable(loadedNode)
const target = observable({ order: ['u2'], nodes: { get: () => loadedNode, source: () => nodeSource }, navigation: { items: () => [{ turn: 2, anchorKey: 'u2', prompt: 'Input', response: '' }] } })
const outline = observable([{ turn: 1, seq: 100, prompt: 'Old', response: 'Old result' }, { turn: 2, seq: 200, prompt: 'Input', response: '' }])
const session = { ...observable({ loadingOlder: false }), sessionId: 's', projections: { faceOf: () => outline } }
const binding = { session }
const ctx = {
  locale: { bind: () => (key, args) => key === 'chat.turnNavigation.label' ? 'Turns' : `${key.endsWith('jumpLoad') ? 'Load' : 'Jump'} ${args.turn}` },
  sessions: { list: observable({ current: 's' }), binding: () => binding },
  uiConversation: { binding: () => ({ target: () => target }) },
}
const stop = attachKeyStrip(ctx, () => 'Piano')
await new Promise(resolve => setTimeout(resolve, 50))
assert.equal(document.querySelector('.smcp-unified').hidden, false)
const nativeButtons = document.querySelectorAll('nav button')
let nativeCancellations = 0
nativeButtons[0].addEventListener('click', () => { nativeButtons[0].setAttribute('aria-busy', 'true') })
nativeButtons[1].addEventListener('click', () => { nativeCancellations++ })
document.querySelector('.smcp-bar[data-turn="1"]').click()
assert.equal(nativeButtons[0].getAttribute('aria-busy'), 'true')
scroll.dispatchEvent(new pointerDom.window.Event('pointerdown', { bubbles: true }))
assert.equal(nativeCancellations, 1, 'exactly one native cancellation per pointerdown')
scroll.dispatchEvent(new pointerDom.window.Event('touchstart', { bubbles: true }))
assert.equal(nativeCancellations, 1, 'compatibility touch event only cancels local disclosure')
nativeButtons[0].removeAttribute('aria-busy')
stop(); pointerDom.window.close()
console.log('semantic pointer integration: one native cancellation per gesture passed')
