/** Modern Chat node identity and visibility regression tests. */
import assert from 'node:assert/strict'
import { buildNavigationNodes } from '../src/client/keys.ts'

const assistant = (key, turn, text, extra = {}) => ({
  key, kind: 'assistant-step', visibility: 'visible',
  location: { kind: 'step', turn, step: 0 },
  data: { blocks: [{ kind: 'text', text }] }, ...extra,
})
let passed = 0
const test = (name, run) => { run(); passed += 1; console.log(`ok ${passed} - ${name}`) }

test('location Turn is canonical and survives history prepend', () => {
  const a = assistant('a', 5, 'answer', { data: { turn: 99, blocks: [{ kind: 'text', text: 'answer' }] } })
  const before = buildNavigationNodes([a])
  const after = buildNavigationNodes([assistant('older', 4, 'older'), a])
  assert.equal(before[0].turn, 5)
  assert.equal(after[1].key, before[0].key)
})

test('adjacent outputs from different Turns are not merged', () => {
  assert.equal(buildNavigationNodes([assistant('a', 1, 'first'), assistant('b', 2, 'second')]).length, 2)
})

test('adjacent outputs with no known Turn are not speculatively merged', () => {
  assert.equal(buildNavigationNodes([
    assistant('a', undefined, 'first'), assistant('b', undefined, 'second'),
  ]).length, 2)
})

test('adjacent visible outputs in the same Turn still merge', () => {
  const keys = buildNavigationNodes([assistant('a', 1, 'first'), assistant('b', 1, 'second')])
  assert.equal(keys.length, 1)
  assert.match(keys[0].preview, /first[\s\S]*second/)
})

test('hidden assistant content is excluded and breaks continuity', () => {
  const keys = buildNavigationNodes([
    assistant('a', 1, 'first'), assistant('hidden', 1, 'not visible', { visibility: 'hidden' }),
    assistant('b', 1, 'second'),
  ])
  assert.equal(keys.length, 2)
  assert.ok(keys.every(key => !key.preview.includes('not visible')))
})

test('reasoning and tools split visible output without leaking into preview', () => {
  const keys = buildNavigationNodes([assistant('a', 1, '', { data: { blocks: [
    { kind: 'text', text: 'first' }, { kind: 'reasoning', text: 'private reasoning' },
    { kind: 'tool-call', text: 'private tool data' }, { kind: 'text', text: 'second' },
  ] } })])
  assert.deepEqual(keys.map(key => key.key), ['a::output:0', 'a::output:1'])
  assert.ok(keys.every(key => !key.preview.includes('private')))
})

test('image-only user messages remain navigable', () => {
  const keys = buildNavigationNodes([{ key: 'u', kind: 'user', visibility: 'visible', location: { turn: 1 }, data: {
    content: [{ type: 'image' }],
  } }])
  assert.equal(keys[0].preview, '[image]')
})

test('empty or malformed payload does not create a phantom key', () => {
  assert.deepEqual(buildNavigationNodes([{ key: 'u', kind: 'user', data: null }]), [])
})

test('preview and title remain bounded', () => {
  const [key] = buildNavigationNodes([assistant('a', 1, 'a'.repeat(10000))])
  assert.ok(key.preview.length <= 521)
  assert.ok(key.title.length <= 141)
})
console.log(`${passed} navigation contract tests passed`)
