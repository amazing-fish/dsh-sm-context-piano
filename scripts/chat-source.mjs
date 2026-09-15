/** Contract tests: no DOM, host process, model credentials, or network needed. */
import assert from 'node:assert/strict'
import { observeChatNodes } from '../src/client/chat-source.ts'

function observable(value) {
  const listeners = new Set()
  return {
    getSnapshot: () => value,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
    emit(next = value) { value = next; for (const listener of [...listeners]) listener() },
    get count() { return listeners.size },
  }
}

function fixture(initialKeys = ['user:1', 'assistant:1']) {
  const map = new Map(initialKeys.map(key => [key, { key, kind: key.startsWith('user') ? 'user' : 'assistant', data: {} }]))
  const sources = new Map()
  const nodes = {
    get: key => map.get(key),
    source: key => {
      if (!sources.has(key)) sources.set(key, observable(map.get(key)))
      return sources.get(key)
    },
  }
  const target = observable({ order: [...initialKeys], nodes })
  const tasks = []
  const publications = []
  const stop = observeChatNodes(target, values => publications.push(values.map(node => ({ ...node }))), fn => tasks.push(fn))
  return {
    target, nodes, map, sources, tasks, publications, stop,
    flush() { while (tasks.length) tasks.shift()() },
  }
}

let passed = 0
function test(name, run) {
  run()
  passed += 1
  console.log(`ok ${passed} - ${name}`)
}

test('reads the Chat target without requiring session.snapshot.chat', () => {
  const f = fixture()
  assert.deepEqual(f.publications[0].map(node => node.key), ['user:1', 'assistant:1'])
  assert.equal(f.target.count, 1)
  assert.equal(f.sources.get('assistant:1').count, 1)
  f.stop()
})

test('publishes keyed-only streaming changes with stable target identity', () => {
  const f = fixture()
  const snapshot = f.target.getSnapshot()
  f.map.set('assistant:1', { key: 'assistant:1', kind: 'assistant', data: { text: 'new content' } })
  f.sources.get('assistant:1').emit()
  f.flush()
  assert.equal(f.target.getSnapshot(), snapshot)
  assert.equal(f.publications.at(-1)[1].data.text, 'new content')
  f.stop()
})

test('coalesces multiple node and target notifications', () => {
  const f = fixture()
  for (let index = 0; index < 10; index += 1) f.sources.get('assistant:1').emit()
  f.target.emit()
  assert.equal(f.tasks.length, 1)
  f.flush()
  assert.equal(f.publications.length, 2)
  f.stop()
})

test('prepending history preserves existing subscriptions and order', () => {
  const f = fixture()
  const stableSource = f.sources.get('user:1')
  f.map.set('user:0', { key: 'user:0', kind: 'user', data: {} })
  f.target.emit({ order: ['user:0', 'user:1', 'assistant:1'], nodes: f.nodes })
  f.flush()
  assert.deepEqual(f.publications.at(-1).map(node => node.key), ['user:0', 'user:1', 'assistant:1'])
  assert.equal(f.sources.get('user:1'), stableSource)
  assert.equal(stableSource.count, 1)
  f.stop()
})

test('removing nodes releases their keyed subscriptions', () => {
  const f = fixture()
  const removed = f.sources.get('assistant:1')
  f.target.emit({ order: ['user:1'], nodes: f.nodes })
  f.flush()
  assert.equal(removed.count, 0)
  assert.equal(f.publications.at(-1).length, 1)
  f.stop()
})

test('replacing the keyed store detaches the old sources even for identical keys', () => {
  const f = fixture()
  const old = f.sources.get('assistant:1')
  const replacements = new Map([...f.map].map(([key, node]) => [key, observable(node)]))
  f.target.emit({ order: ['user:1', 'assistant:1'], nodes: {
    get: key => f.map.get(key), source: key => replacements.get(key),
  } })
  f.flush()
  assert.equal(old.count, 0)
  assert.equal(replacements.get('assistant:1').count, 1)
  f.stop()
  assert.equal(replacements.get('assistant:1').count, 0)
})

test('an absent target clears keys and unsubscribes previous nodes', () => {
  const f = fixture()
  // emit(undefined) would use the fixture helper default, so explicitly expose absence.
  f.target.getSnapshot = () => undefined
  f.target.emit()
  f.flush()
  assert.deepEqual(f.publications.at(-1), [])
  for (const source of f.sources.values()) assert.equal(source.count, 0)
  f.stop()
})

test('cleanup is idempotent and suppresses already queued stale-session work', () => {
  const f = fixture()
  f.sources.get('assistant:1').emit()
  f.stop()
  f.stop()
  f.flush()
  assert.equal(f.publications.length, 1)
  assert.equal(f.target.count, 0)
  for (const source of f.sources.values()) assert.equal(source.count, 0)
})

test('failed initial projection cleans up target and keyed subscriptions', () => {
  const node = observable({ key: 'user:1', kind: 'user', data: {} })
  const target = observable({ order: ['user:1'], nodes: {
    source: () => node, get: () => node.getSnapshot(),
  } })
  assert.throws(() => observeChatNodes(target, () => { throw new Error('render failed') }), /render failed/)
  assert.equal(target.count, 0)
  assert.equal(node.count, 0)
})

console.log(`${passed} Chat source contract tests passed`)
