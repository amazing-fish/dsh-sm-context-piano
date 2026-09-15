import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { createSemanticLanding } from '../src/client/semantic-landing.ts'
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
assert.equal(landing.canReveal('call:c1'), false)
assert.equal(await landing.navigate(question), false)
hidden.setAttribute('hidden', 'until-found')
const obsolete = landing.navigate(question); landing.cancel()
assert.equal(await obsolete, undefined)
const count = clicks.length
hidden.setAttribute('hidden', 'until-found')
const old = landing.navigate(question)
assert.equal(await landing.navigate({ ...question, kind: 'final', anchorKey: 'final1' }), true)
assert.equal(await old, undefined)
assert.equal(clicks.length, count + 1); assert.equal(clicks.at(-1).anchorKey, 'final1')
assert.equal(await landing.navigate({ ...question, anchorKey: 'missing' }), false)
landing.cancel(); dom.window.close()
console.log('semantic DOM: native reveal, safe disclosure, repeat visit, privacy boundary, cancellation, supersession and missing-anchor checks passed')
