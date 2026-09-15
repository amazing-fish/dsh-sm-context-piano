/** Native bridge regression boundaries, including the Codex ownership findings. */
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { createNativeNavigation } from '../src/client/native-navigation.ts'
let passed = 0
const labels = { navigation: () => 'Turns', jump: (turn, unloaded) => `${unloaded ? 'Load' : 'Jump'} ${turn}` }
const turn = (n, loaded = true) => ({ turn: n, prompt: '', response: '', anchor: loaded ? { kind: 'loaded', key: `u${n}` } : { kind: 'unloaded', seq: n * 100 } })
function fixture() {
  const dom = new JSDOM('<!doctype html><body><div data-conversation-scroll><section><div data-chat-flow></div></section></div></body>')
  const { document } = dom.window
  const flow = document.querySelector('[data-chat-flow]')
  const scroll = document.querySelector('[data-conversation-scroll]')
  const previousEvent = globalThis.Event
  globalThis.Event = dom.window.Event
  const owner = createNativeNavigation(flow, labels)
  const addNav = (items, label = 'Turns') => {
    const nav = document.createElement('nav'); nav.setAttribute('aria-label', label)
    for (const item of items) {
      const button = document.createElement('button')
      button.setAttribute('aria-label', labels.jump(item.turn, item.anchor.kind === 'unloaded'))
      nav.append(button)
      if (item.anchor.kind === 'loaded') {
        const row = document.createElement('div'); row.dataset.chatAnchorKey = item.anchor.key; row.dataset.chatTurn = String(item.turn); flow.append(row)
      }
    }
    flow.before(nav); return nav
  }
  return { dom, document, flow, scroll, owner, addNav, stop() { owner.release(); dom.window.close(); globalThis.Event = previousEvent } }
}
function test(name, run) { const f = fixture(); try { run(f); passed++; console.log(`ok ${passed} - ${name}`) } finally { f.stop() } }

test('genuinely absent native rail permits one fully loaded Turn', f => {
  assert.equal(f.owner.reconcile([turn(1)]), true)
})
test('unmatched single-Turn native landmark does not permit a second navigation', f => {
  const nav = f.addNav([turn(1)], 'new localized label')
  assert.equal(f.owner.reconcile([turn(1)]), false)
  f.owner.claim(); assert.equal(nav.style.display, '')
})
test('ambiguous single-Turn landmarks fail open', f => {
  f.addNav([turn(1)]); f.addNav([turn(1)])
  assert.equal(f.owner.reconcile([turn(1)]), false)
})
test('an unlabeled or role-based native landmark also prevents duplicate UI', f => {
  const nav = f.document.createElement('div'); nav.setAttribute('role', 'navigation'); f.flow.before(nav)
  assert.equal(f.owner.reconcile([turn(1)]), false)
})
test('takeover restores original inline style and accessibility values exactly', f => {
  const nav = f.addNav([turn(1), turn(2)])
  nav.style.setProperty('display', 'grid', 'important'); nav.setAttribute('aria-hidden', 'false')
  assert.equal(f.owner.reconcile([turn(1), turn(2)]), true); f.owner.claim()
  assert.equal(nav.style.display, 'none'); assert.equal(nav.getAttribute('aria-hidden'), 'true')
  f.owner.release(); assert.equal(nav.style.display, 'grid'); assert.equal(nav.style.getPropertyPriority('display'), 'important')
  assert.equal(nav.getAttribute('aria-hidden'), 'false')
})
test('contract drift after takeover restores the native element', f => {
  const nav = f.addNav([turn(1), turn(2)])
  f.owner.reconcile([turn(1), turn(2)]); f.owner.claim(); nav.setAttribute('aria-label', 'changed')
  assert.equal(f.owner.reconcile([turn(1), turn(2)]), false)
  assert.equal(nav.style.display, ''); assert.equal(nav.hasAttribute('aria-hidden'), false)
})
test('Escape-equivalent cancellation before aria-busy commits still supersedes the jump', f => {
  const items = [turn(1, false), turn(2)]
  const nav = f.addNav(items); let pending = null
  nav.children[0].onclick = () => { pending = 1 }; nav.children[1].onclick = () => { pending = null }
  f.owner.reconcile(items); f.owner.claim(); f.scroll.scrollTop = 100
  f.owner.navigate(1, null); assert.equal(pending, 1)
  f.owner.cancel(); assert.equal(pending, null); assert.equal(f.scroll.scrollTop, 100)
})
test('scrollbar pointer intent cancels; editable composer intent does not', f => {
  const items = [turn(1, false), turn(2)]
  const nav = f.addNav(items); let pending = null
  nav.children[0].onclick = () => { pending = 1 }; nav.children[1].onclick = () => { pending = null }
  f.owner.reconcile(items); f.owner.claim(); f.owner.navigate(1, null)
  const input = f.document.createElement('textarea'); f.scroll.append(input)
  input.dispatchEvent(new f.dom.window.Event('pointerdown', { bubbles: true })); assert.equal(pending, 1)
  f.scroll.dispatchEvent(new f.dom.window.Event('pointerdown')); assert.equal(pending, null)
})
test('release removes pointer cancellation hooks from native-only mode', f => {
  const items = [turn(1, false), turn(2)]
  const nav = f.addNav(items); let pending = null
  nav.children[0].onclick = () => { pending = 1 }; nav.children[1].onclick = () => { pending = null }
  f.owner.reconcile(items); f.owner.claim(); f.owner.navigate(1, null); f.owner.release()
  f.scroll.dispatchEvent(new f.dom.window.Event('pointerdown')); assert.equal(pending, 1)
})
test('fallback input callbacks cannot cancel a jump started through restored native UI', f => {
  const items = [turn(1, false), turn(2)]
  const nav = f.addNav(items); let cancelClicks = 0
  nav.children[1].onclick = () => { cancelClicks++ }
  f.owner.reconcile(items); f.owner.claim(); f.owner.release()
  nav.children[0].setAttribute('aria-busy', 'true')
  // The strip's wheel/touch/reading-key handlers all reach this same method.
  f.owner.cancel(); f.owner.cancel(); f.owner.cancel()
  assert.equal(cancelClicks, 0)
  assert.equal(nav.children[0].getAttribute('aria-busy'), 'true')
  assert.equal(f.owner.navigate(1, null), false)
})
test('release and reclaim cannot carry an old unloaded sentinel into ordinary reader input', f => {
  const items = [turn(1, false), turn(2)]
  const nav = f.addNav(items); let cancelClicks = 0
  nav.children[1].onclick = () => { cancelClicks++ }
  f.owner.reconcile(items); f.owner.claim(); f.owner.navigate(1, null)
  f.owner.release(); f.owner.claim()
  f.scroll.dispatchEvent(new f.dom.window.Event('pointerdown'))
  assert.equal(cancelClicks, 0)
})
test('the first reconciled idle native publication retires synchronous unloaded intent', f => {
  const items = [turn(1, false), turn(2)]
  const nav = f.addNav(items); let cancelClicks = 0
  nav.children[1].onclick = () => { cancelClicks++ }
  f.owner.reconcile(items); f.owner.claim(); f.owner.navigate(1, null)
  // A fast failure can settle without a rendered busy frame.
  f.owner.reconcile(items)
  f.scroll.dispatchEvent(new f.dom.window.Event('pointerdown'))
  assert.equal(cancelClicks, 0)
})
test('after publication real native busy remains cancellable until settlement', f => {
  const items = [turn(1, false), turn(2)]
  const nav = f.addNav(items); let cancelClicks = 0
  nav.children[1].onclick = () => { cancelClicks++; nav.children[0].removeAttribute('aria-busy') }
  f.owner.reconcile(items); f.owner.claim(); f.owner.navigate(1, null)
  nav.children[0].setAttribute('aria-busy', 'true'); f.owner.reconcile(items)
  f.owner.cancel(); assert.equal(cancelClicks, 1)
  f.owner.reconcile(items); f.owner.cancel(); assert.equal(cancelClicks, 1)
})
console.log(`${passed} native navigation boundary tests passed`)
