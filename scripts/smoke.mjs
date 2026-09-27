/** Built-bundle smoke checks. Run after `pnpm build`. */

import { createRequire } from 'node:module'
import assert from 'node:assert/strict'

const requireHere = createRequire(import.meta.url)
let passed = 0
const check = async (name, fn) => {
  try {
    await fn()
    passed += 1
    console.log(`  ok  ${name}`)
  } catch (error) {
    console.error(`FAIL  ${name}`)
    console.error(error)
    process.exitCode = 1
  }
}

console.log('== host half ==')
const manifest = requireHere('../package.json')
check('host core packages are peer-only', () => {
  for (const name of ['@deepseek-ai/dsh-settings', '@deepseek-ai/schemastery']) {
    assert.equal(manifest.dependencies?.[name], undefined)
    assert.ok(manifest.peerDependencies?.[name])
    assert.ok(manifest.devDependencies?.[name])
  }
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-settings'], '^0.1.7-rc.1')
})

check('pins the current DSH baseline and orders the public client owners', () => {
  for (const [name, version] of Object.entries(manifest.devDependencies)) {
    if (name.startsWith('@deepseek-ai/dsh-')) assert.equal(version, '0.1.7-rc.2', name)
  }
  for (const name of ['@deepseek-ai/dsh-api-session-controller', '@deepseek-ai/dsh-client-ui-chat', '@deepseek-ai/dsh-client-ui-slots']) {
    assert.ok(manifest.dsh.client.inject.includes(name))
    assert.equal(manifest.devDependencies[name], '0.1.7-rc.2')
  }
  assert.equal(manifest.devDependencies['@deepseek-ai/dsh-client-runtime'], undefined)
  assert.equal(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-runtime'), false)
})

check('every injected client dependency resolves as a package', () => {
  // Under the 0.1.7 loader, `dsh.client.inject` edges are informational
  // ordering only: `<name>/client` and the bare package name resolve to the
  // same exports row, so a `./client` subpath export is no longer required.
  for (const name of manifest.dsh.client.inject) {
    const dependency = requireHere(`${name}/package.json`)
    assert.ok(dependency.name === name)
    assert.ok(dependency.exports?.['.'] || dependency.main)
  }
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-slots'))
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-renderer'))
})

const host = await import('../lib/index.js')
check('host exports the Config schema and opts out of the auto settings form', () => {
  const configureCalls = []
  assert.equal(typeof host.Config, 'function')
  const fields = Object.keys(host.Config?.dict ?? {})
  for (const field of ['language', 'enabled', 'keyHeight', 'keyGap', 'maxVisible']) {
    assert.ok(fields.includes(field), `Config must declare ${field}`)
  }
  host.apply({
    fiber: {},
    inject: (services, callback) => {
      assert.deepEqual(services, ['settings'])
      callback({
        effect: (fn) => { fn(); return () => {} },
        settings: {
          configure: (options, fiber) => { configureCalls.push([options, fiber]) },
        },
      })
    },
  })
  assert.deepEqual(configureCalls, [[{ auto: false }, {}]])
})

console.log('== client half ==')
globalThis.window = {
  __ModuleLoader__: { load: handoff => { globalThis.__handoff = handoff } },
  addEventListener: () => {},
  removeEventListener: () => {},
}
globalThis.document = {
  getElementById: () => null,
  createElement: () => ({ textContent: '', id: '' }),
  head: { appendChild: () => {} },
}

await import('../lib/client.js')
check('client bundle registers its handoff', () => {
  assert.equal(globalThis.__handoff.id, '@hjj345345/dsh-sm-context-piano')
  assert.equal(typeof globalThis.__handoff.factory, 'function')
})

const exports = globalThis.__handoff.factory(spec => {
  if (spec === 'react') return requireHere('react')
  if (spec === 'react/jsx-runtime') return requireHere('react/jsx-runtime')
  throw new Error(`unexpected require: ${spec}`)
})

check('client exposes the DSH plugin contract', () => {
  assert.deepEqual(exports.inject, ['sessions', 'uiConversation', 'locale', 'slots', 'remote', 'remote.settings'])
  assert.equal(typeof exports.apply, 'function')
})

check('client apply registers locale, probe slot, settings section, and disposable effects', () => {
  const registrations = []
  const slotsByName = new Map()
  const sections = []
  const probes = []
  const remoteEvents = []
  let describeCalls = 0
  let effects = 0
  const stored = { language: 'zh', enabled: true, keyHeight: 2, keyGap: 12, maxVisible: 20 }
  const remote = {
    settings: {
      describe: async () => {
        describeCalls += 1
        return { ok: true, value: { namespaces: [{ ns: 'sm-context-piano', revision: 1, value: stored }], writable: true } }
      },
      mutate: async () => ({ ok: true, value: { ns: 'sm-context-piano', revision: 2, value: stored } }),
    },
    $on: (event, listener) => {
      remoteEvents.push(event)
      return () => {}
    },
  }
  exports.apply({
    effect: fn => { effects += 1; fn(); return () => {} },
    locale: {
      register: (namespace, dictionaries) => registrations.push([namespace, dictionaries]),
      bind: () => key => key,
    },
    remote,
    slots: {
      inject: (name, callback) => {
        slotsByName.set(name, callback)
        callback()
      },
      register: (options, component) => {
        if (options.name === 'settings.section') sections.push([options, component])
        else probes.push([options, component])
        return () => {}
      },
    },
  })
  assert.equal(registrations[0][0], 'sm-context-piano')
  assert.ok(slotsByName.has('conversation.session.header.actions'))
  assert.ok(slotsByName.has('settings.section'))
  assert.equal(probes.length, 1)
  assert.equal(probes[0][0].id, 'sm-context-piano-session-probe')
  assert.equal(sections.length, 1)
  assert.equal(sections[0][0].id, 'sm-context-piano')
  assert.equal(sections[0][0].order, 21)
  assert.equal(sections[0][0].label(), 'settings.nav')
  const scope = sections[0][0].inject().scope
  assert.equal(scope.getSnapshot().value.language, 'zh')
  assert.equal(typeof scope.set, 'function')
  assert.equal(typeof scope.unset, 'function')
  assert.equal(typeof sections[0][1], 'function')
  assert.equal(typeof probes[0][1], 'function')
  assert.deepEqual(remoteEvents, ['settings/document-updated'])
  assert.ok(describeCalls >= 1, 'settings refresh starts during apply')
  assert.ok(effects >= 4, 'locale, styles, settings-dispose, and strip effects registered')
})

check('remote settings stay fail-closed while loading or after a failed describe', async () => {
  let mode = 'fail'
  const persisted = { language: 'en', enabled: false, keyHeight: 3, keyGap: 16, maxVisible: 8 }
  const updateListeners = []
  let settingsSection = null
  const remote = {
    settings: {
      describe: async () => {
        if (mode === 'fail') throw new Error('settings describe failed')
        if (mode === 'empty') return { ok: true, value: { namespaces: [], writable: true } }
        return { ok: true, value: { namespaces: [{ ns: 'sm-context-piano', revision: 3, value: persisted }], writable: true } }
      },
      mutate: async () => ({ ok: true, value: { ns: 'sm-context-piano', revision: 4, value: persisted } }),
    },
    $on: (event, listener) => {
      if (event === 'settings/document-updated') updateListeners.push(listener)
      return () => {}
    },
  }
  exports.apply({
    effect: fn => { fn(); return () => {} },
    locale: { register: () => () => {}, bind: () => () => key => key },
    remote,
    slots: {
      inject: (name, callback) => { if (name === 'settings.section') callback() },
      register: options => { if (options.name === 'settings.section') settingsSection = options },
    },
  })
  const scope = settingsSection.inject().scope
  assert.equal(scope.getSnapshot().status, 'loading')
  assert.equal(scope.getSnapshot().value.enabled, false, 'loading must not expose the enabled default')
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(scope.getSnapshot().status, 'unavailable')
  assert.equal(scope.getSnapshot().value.enabled, false, 'a failed initial describe must stay fail-closed')
  mode = 'empty'
  for (const listener of updateListeners) listener('sm-context-piano')
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(scope.getSnapshot().status, 'unavailable')
  assert.equal(scope.getSnapshot().value.enabled, true, 'a successful describe without an entry is a fresh install and keeps the enabled default')
  mode = 'persisted'
  for (const listener of updateListeners) listener('sm-context-piano')
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(scope.getSnapshot().status, 'ready')
  assert.equal(scope.getSnapshot().value.enabled, false)
  assert.equal(scope.getSnapshot().value.language, 'en')
  assert.equal(scope.getSnapshot().value.maxVisible, 8)
})

console.log(`\n${passed} smoke checks passed${process.exitCode === 1 ? ' (some failed)' : ''}`)
