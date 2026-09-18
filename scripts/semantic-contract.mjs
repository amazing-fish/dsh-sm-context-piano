import assert from 'node:assert/strict'
import { buildNavigationNodes, turnOf } from '../src/client/keys.ts'
import { buildPianoItems, mergeNavigationTurns } from '../src/client/navigation-model.ts'
import { semanticLabel } from '../src/client/semantic-style.ts'
const location = turn => ({ kind: 'step', turn: { turn, data: new Map() }, step: { step: 0 } })
const assistant = (key, turn, step, value, extra = {}) => ({
  key, kind: 'assistant-step', target: 'chat', visibility: 'visible', location: location(turn), anchorSeq: step * 10,
  data: { status: 'settled', turn, step, blocks: [{ kind: 'text', text: value }],
    finalNode: { kind: 'assistant', seq: step * 10 + 1, messageId: key, turn, step, blocks: [{ kind: 'text', text: value }] }, ...extra },
})
const tail = node => ({ key: `tail:${node.data.turn}`, kind: 'turn-tail', location: location(node.data.turn), visibility: 'visible', data: { turn: node.data.turn, closing: node.data } })
const user = (key, turn) => ({ key, kind: 'user', visibility: 'visible', location: location(turn), data: { content: [{ type: 'text', text: 'Input' }] } })
const ask = (id = 'call1', questions = [{ id: 'q1', question: 'Which route?', options: [{ label: 'A' }, { label: 'B' }] }], answers) => ({
  key: `tool:${id}`, kind: 'tool-call', visibility: 'visible', location: location(1), data: { root: answers === undefined
    ? { callId: id, name: 'ask_user_question', argsRaw: JSON.stringify({ questions }), subCalls: [] }
    : { kind: 'tool-result', callId: id, call: { name: 'ask_user_question', argsRaw: JSON.stringify({ questions }) }, isError: false,
      content: [{ type: 'text', text: JSON.stringify({ answers }) }], subCalls: [] } },
})
let count = 0
const test = (name, run) => { run(); count++; console.log(`ok ${count} - ${name}`) }
test('uses real nested TurnLocation for user messages without data.turn', () => {
  assert.equal(turnOf(user('u', 7)), 7)
  assert.equal(buildNavigationNodes([user('u', 7)])[0].turn, 7)
})
test('canonical nested location wins over a stale payload turn', () => {
  const node = assistant('a', 7, 1, 'text'); node.data.turn = 99
  assert.equal(turnOf(node), 7)
})
test('final result is independent of adjacent process prose and targets its own row', () => {
  const process = assistant('p', 1, 1, 'Working on it'), final = assistant('f', 1, 2, 'The final result')
  const keys = buildNavigationNodes([user('u', 1), process, final, tail(final)])
  assert.deepEqual(keys.map(key => key.kind), ['input', 'output', 'final'])
  assert.equal(keys[2].anchorKey, 'f'); assert.equal(keys[2].preview, 'The final result')
  assert.equal(keys[1].preview, 'Working on it')
})
test('final reasoning/text runs become one result key, without reasoning leakage', () => {
  const final = assistant('f', 1, 2, 'unused', { blocks: [{ kind: 'reasoning', text: 'SECRET' }, { kind: 'text', text: 'Result A' }, { kind: 'reasoning', text: 'SECRET' }, { kind: 'text', text: 'Result B' }] })
  const keys = buildNavigationNodes([final, tail(final)])
  assert.equal(keys.length, 1); assert.equal(keys[0].kind, 'final')
  assert.match(keys[0].preview, /Result A[\s\S]*Result B/); assert.ok(!keys[0].preview.includes('SECRET'))
})
test('settled intermediate model steps do not imply a finished Turn', () => {
  assert.ok(buildNavigationNodes([assistant('p', 1, 0, 'process')]).every(key => key.kind !== 'final'))
})
test('streaming output promotes in place only once the authoritative tail arrives', () => {
  const running = assistant('f', 1, 2, 'Answer', { status: 'running' }); delete running.data.finalNode
  const before = buildNavigationNodes([running]), final = assistant('f', 1, 2, 'Answer')
  const after = buildNavigationNodes([final, tail(final)])
  assert.equal(before[0].kind, 'output'); assert.equal(after[0].kind, 'final'); assert.equal(after[0].key, before[0].key)
})
test('interrupted, errored, truncated and unknown-tail evidence cannot invent a final key', () => {
  const final = assistant('f', 1, 2, 'Partial', { status: 'interrupted' }); final.data.finalNode.interrupted = true
  assert.ok(buildNavigationNodes([final, tail(final)]).every(key => key.kind !== 'final'))
  const answer = assistant('a', 1, 2, 'text')
  for (const kind of ['turn-error', 'turn-max-tokens']) assert.ok(buildNavigationNodes([answer, tail(answer), { key: kind, kind, location: location(1), data: {} }]).every(key => key.kind !== 'final'))
  assert.ok(buildNavigationNodes([{ ...tail(answer), data: { closing: null } }, answer]).every(key => key.kind !== 'final'))
})
test('message identity mismatch and missing closing message never mark the previous one final', () => {
  const process = assistant('p', 1, 1, 'process'), final = assistant('f', 1, 2, 'final')
  assert.ok(buildNavigationNodes([process, tail(final)]).every(key => key.kind !== 'final'))
  const mismatch = structuredClone(final); mismatch.data.finalNode.messageId = 'wrong'
  assert.ok(buildNavigationNodes([mismatch, tail(final)]).every(key => key.kind !== 'final'))
})
test('one final per closed Turn, stable across history prepend', () => {
  const a = assistant('a', 1, 1, 'one'), b = assistant('b', 2, 1, 'two')
  const keys = buildNavigationNodes([a, tail(a), b, tail(b)])
  assert.equal(keys.filter(k => k.kind === 'final').length, 2)
  assert.equal(keys.at(-1).key, buildNavigationNodes([b, tail(b)])[0].key)
})
test('pending ask creates AI question key but no fabricated user answer', () => {
  const [key] = buildNavigationNodes([ask()])
  assert.equal(key.kind, 'question'); assert.equal(key.role, 'assistant'); assert.equal(key.interactionState, 'pending')
  assert.equal(key.anchorKey, 'call:call1')
})
test('recorded answers pair by question id rather than returned order', () => {
  const keys = buildNavigationNodes([ask('call1', [{ id: 'q1', question: 'First?' }, { id: 'q2', question: 'Second?' }], [{ id: 'q2', selected: ['B'] }, { id: 'q1', selected: ['A'] }])])
  assert.deepEqual(keys.map(k => [k.kind, k.role]), [['question', 'assistant'], ['answer', 'user'], ['question', 'assistant'], ['answer', 'user']])
  assert.equal(keys[1].preview, 'First?\nA'); assert.equal(keys[3].preview, 'Second?\nB')
})
test('single-select custom overrides selections; multi-select custom supplements them', () => {
  const question = { id: 'q', question: 'Pick?' }, answer = { id: 'q', selected: ['A'], custom: 'Custom' }
  assert.equal(buildNavigationNodes([ask('c', [question], [answer])])[1].title, 'Custom')
  assert.equal(buildNavigationNodes([ask('c', [{ ...question, multi_select: true }], [answer])])[1].title, 'A\nCustom')
})
test('question key is stable across answer arrival; duplicate question ids do not cross-pair', () => {
  const before = buildNavigationNodes([ask()]), after = buildNavigationNodes([ask('call1', undefined, [{ id: 'q1', selected: ['A'] }])])
  assert.equal(before[0].key, after[0].key)
  const duplicate = ask('call1', undefined, [{ id: 'q1', selected: ['A'] }, { id: 'q1', selected: ['B'] }])
  assert.deepEqual(buildNavigationNodes([duplicate]).map(k => k.kind), ['question'])
})
test('error, invalid JSON and unrelated tools cannot fabricate accepted answers', () => {
  const error = ask('call1', undefined, [{ id: 'q1', selected: ['A'] }]); error.data.root.isError = true
  assert.deepEqual(buildNavigationNodes([error]).map(k => k.kind), ['question'])
  assert.equal(buildNavigationNodes([error])[0].interactionState, 'error')
  const malformed = ask(); malformed.data.root.argsRaw = '{invalid'; assert.deepEqual(buildNavigationNodes([malformed]), [])
  const other = ask(); other.data.root.name = 'read'; assert.deepEqual(buildNavigationNodes([other]), [])
})
test('empty or whitespace-only selected/custom values remain unanswered with no user key', () => {
  for (const selected of [[], [''], [' ', '\t']]) {
    const keys = buildNavigationNodes([ask('call1', undefined, [{ id: 'wrong', selected: ['B'] }, { id: 'q1', selected, custom: '  ' }])])
    assert.equal(keys.length, 1); assert.equal(keys[0].interactionState, 'unanswered'); assert.equal(keys[0].kind, 'question')
  }
})
test('nested calls use their own stable native anchor and do not cross-call ids', () => {
  const a = ask('outer'), b = ask('inner'); a.data.root.subCalls.push(b.data.root)
  assert.deepEqual(buildNavigationNodes([a]).map(k => k.anchorKey), ['call:outer', 'call:inner'])
})
test('duplicate call ids inside one tree omit both records regardless of traversal order', () => {
  const accepted = ask('same', undefined, [{ id: 'q1', selected: ['A'] }]), pending = ask('same')
  for (const [first, second] of [[accepted, pending], [pending, accepted]]) {
    const node = structuredClone(first); node.data.root.subCalls.push(structuredClone(second.data.root))
    assert.deepEqual(buildNavigationNodes([node]), [])
  }
})
test('duplicate call ids across root nodes cannot produce duplicate or first-wins keys', () => {
  const a = ask('same', [{ id: 'one', question: 'One?' }], [{ id: 'one', selected: ['A'] }])
  const b = ask('same', [{ id: 'two', question: 'Two?' }], [{ id: 'two', selected: ['B'] }]); b.key = 'other-root'
  assert.deepEqual(buildNavigationNodes([a, b]), [])
})
test('hidden node material never appears as final or interactive preview', () => {
  const question = ask(); question.visibility = 'hidden'; assert.deepEqual(buildNavigationNodes([question]), [])
  const final = assistant('f', 1, 2, 'private'); final.visibility = 'hidden'
  assert.deepEqual(buildNavigationNodes([final, tail(final)]), [])
})
test('bounded untrusted JSON and cyclic call trees cannot freeze projection', () => {
  const huge = ask(); huge.data.root.argsRaw = ' '.repeat(262145); assert.deepEqual(buildNavigationNodes([huge]), [])
  const cycle = ask(); cycle.data.root.subCalls.push(cycle.data.root); assert.equal(buildNavigationNodes([cycle]).length, 1)
})
test('semantic role/kind survives the full-history model and is localized', () => {
  const final = assistant('f', 1, 2, 'Final')
  const turns = mergeNavigationTurns([{ turn: 1, anchorKey: 'u', prompt: 'Input', response: 'Final' }], [{ turn: 0, seq: 0 }])
  const items = buildPianoItems(turns, buildNavigationNodes([user('u', 1), final, tail(final)]), String)
  assert.equal(items.at(-1).kind, 'final'); assert.equal(items.at(-1).role, 'assistant')
  assert.match(semanticLabel(items.at(-1), 'zh'), /最终结果/); assert.match(semanticLabel(items.at(-1), 'en'), /Final result/)
  assert.match(semanticLabel(items.at(-1), 'zh-TW'), /最終結果/)
})
console.log(`${count} semantic key contracts passed`)
