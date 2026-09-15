import assert from 'node:assert/strict'
import { mergeNavigationTurns, buildPianoItems } from '../src/client/navigation-model.ts'
const outline = [{ turn: 1, seq: 100, prompt: 'first', response: 'answer' }, { turn: 2, seq: 200, prompt: 'second', response: '' }]
const loaded = [{ turn: 2, anchorKey: 'u2', prompt: '', response: 'live' }]
const merged = mergeNavigationTurns(loaded, outline)
assert.deepEqual(merged.map(t => t.turn), [1, 2])
assert.equal(merged[0].anchor.kind, 'unloaded')
assert.equal(merged[1].anchor.kind, 'loaded')
assert.equal(merged[1].prompt, 'second')
assert.equal(merged[1].response, 'live')
assert.deepEqual(mergeNavigationTurns([], undefined), [])
assert.equal(mergeNavigationTurns([], [null, { turn: -1, seq: 0 }, { turn: 1, seq: NaN }, { turn: 1, seq: -0 }]).length, 0)
const before = buildPianoItems(merged, [], n => `Turn ${n}`)
assert.equal(before[0].key, 'turn:1')
assert.equal(before[0].anchorKey, null)
const segments = [
  { key: 'u1', anchorKey: 'u1', role: 'user', turn: 1, title: 'first', preview: 'first' },
  { key: 'a1::output:0', anchorKey: 'a1', role: 'assistant', turn: 1, title: 'answer', preview: 'answer' },
]
assert.equal(buildPianoItems(merged, segments, String).length, 2, 'unloaded Turns do not invent segments')
const after = buildPianoItems(mergeNavigationTurns([{ turn: 1, anchorKey: 'u1', prompt: 'first', response: 'answer' }], outline), segments, String)
assert.equal(after[0].key, before[0].key)
assert.equal(after[1].key, 'segment:a1::output:0')
assert.equal(after[2].anchorKey, null)
assert.deepEqual(mergeNavigationTurns([], outline.slice(1)).map(t => t.turn), [2], 'whole replacement removes stale Turns')
console.log('full-history model contracts passed')
