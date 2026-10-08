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
test('takeover hides with visibility (keeps the virtualizer box) and restores exactly', f => {
  const nav = f.addNav([turn(1), turn(2)])
  nav.style.setProperty('visibility', 'visible', 'important'); nav.setAttribute('aria-hidden', 'false')
  assert.equal(f.owner.reconcile([turn(1), turn(2)]), true); f.owner.claim()
  // display:none would collapse the official virtualizer's ResizeObserver
  // border box to 0x0 and unmount every turn button; visibility keeps it.
  assert.equal(nav.style.visibility, 'hidden'); assert.equal(nav.getAttribute('aria-hidden'), 'true')
  f.owner.release(); assert.equal(nav.style.visibility, 'visible'); assert.equal(nav.style.getPropertyPriority('visibility'), 'important')
  assert.equal(nav.getAttribute('aria-hidden'), 'false')
})
test('contract drift after takeover restores the native element', f => {
  const nav = f.addNav([turn(1), turn(2)])
  f.owner.reconcile([turn(1), turn(2)]); f.owner.claim(); nav.setAttribute('aria-label', 'changed')
  assert.equal(f.owner.reconcile([turn(1), turn(2)]), false)
  assert.equal(nav.style.visibility, ''); assert.equal(nav.hasAttribute('aria-hidden'), false)
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
test('a partially rendered window whose every button drifted fails open, never holds', f => {
  // 5 turns, only 2 buttons rendered (virtualized window) — both drifted.
  const items = [turn(1), turn(2), turn(3), turn(4), turn(5)]
  const nav = f.addNav([turn(9), turn(9)], 'Turns')
  assert.equal(f.owner.reconcile(items), false)
  assert.equal(nav.style.visibility, ''); assert.equal(nav.hasAttribute('aria-hidden'), false)
  assert.match(f.owner.lastReject, /button-match:none:skipped5/)
})
test('a fully collapsed window holds the takeover, refills, and degrades to fail open past the deadline', f => {
  const items = [turn(1), turn(2), turn(3)]
  const nav = f.addNav(items)
  f.owner.reconcile(items); f.owner.claim()
  assert.equal(nav.style.visibility, 'hidden')
  // Virtualizer collapse: every button unmounts at once, surface stays alive.
  for (const button of [...nav.querySelectorAll('button')]) button.remove()
  assert.equal(f.owner.reconcile(items), true, 'empty window holds the takeover')
  assert.equal(f.owner.lastReject, null)
  assert.match(f.owner.lastSkip, /empty-window:1/)
  assert.equal(nav.style.visibility, 'hidden', 'no release during the hold')
  // Refill within the deadline: full mapping resumes.
  for (const item of items) {
    const button = f.document.createElement('button')
    button.setAttribute('aria-label', labels.jump(item.turn, false))
    nav.append(button)
  }
  assert.equal(f.owner.reconcile(items), true)
  assert.equal(f.owner.lastSkip, null); assert.equal(f.owner.lastReject, null)
  assert.equal(nav.style.visibility, 'hidden')
  // Collapse again and ride the wall-clock deadline to fail open.
  for (const button of [...nav.querySelectorAll('button')]) button.remove()
  const started = performance.now()
  const realNow = performance.now.bind(performance)
  let virtualNow = started
  const now = performance.now
  performance.now = () => virtualNow
  try {
    assert.equal(f.owner.reconcile(items), true, 'second collapse still holds at first')
    virtualNow = realNow() + 1600
    assert.equal(f.owner.reconcile(items), false, 'past the deadline the takeover fails open')
    assert.equal(nav.style.visibility, ''); assert.equal(nav.hasAttribute('aria-hidden'), false)
    assert.match(f.owner.lastReject, /button-match:none:skipped3/)
  } finally { performance.now = now }
})
console.log(`${passed} native navigation boundary tests passed`)
