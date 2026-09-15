/** Semantic keys against original ChatView, ChatNodeSeat and question disclosure components. */
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import path from 'node:path'
const tools = createRequire(path.resolve('.browser-tools/package.json'))
const local = createRequire(path.resolve('package.json'))
const { build } = tools('esbuild'), { chromium } = tools('playwright')
const pinned = 'c291e7961a515f6d7af9304e7fd1d257929aef26'
const dir = path.resolve('.semantic-fixture')
await mkdir(`${dir}/vendor`, { recursive: true }); await mkdir(`${dir}/contract`, { recursive: true }); await mkdir('test-results', { recursive: true })
const sources = {
  ...Object.fromEntries(['ChatView.tsx', 'ChatView.module.css', 'ChatNodeSeat.tsx', 'searchable-hidden.ts', 'TurnNavigator.tsx', 'TurnNavigator.module.css', 'turn-rail-items.ts'].map(name => [`vendor/${name}`, `packages/client/ui-chat/src/client/chat/${name}`])),
  'contract/turn-process.ts': 'packages/client/ui-chat/src/client/contract/turn-process.ts',
  'stores.ts': 'packages/client/ui-chat/src/client/stores.ts',
  'vendor/DisclosureRow.tsx': 'packages/client/ui-primitives/src/DisclosureRow.tsx',
  'vendor/DisclosureRow.module.css': 'packages/client/ui-primitives/src/DisclosureRow.module.css',
  'vendor/AskQuestionCard.tsx': 'packages/client/ui-tool/src/client/tool/components/AskQuestionCard.tsx',
  'vendor/AskQuestionCard.module.css': 'packages/client/ui-tool/src/client/tool/components/AskQuestionCard.module.css',
}
const known = { 'vendor/ChatNodeSeat.tsx': '40e08dbaf72bdf166a409b9c6a1f8b4fdee3b53d', 'vendor/searchable-hidden.ts': '5a0f47c82ed527479c84bea1c36dbcbe51a31506', 'vendor/DisclosureRow.tsx': 'f04ad8986a36bc2845446f3aeb211f6fecaf281c' }
const hashes = {}
await Promise.all(Object.entries(sources).map(async ([file, source]) => {
  const response = await fetch(`https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/${pinned}/${source}`)
  if (!response.ok) throw new Error(`Official source ${source}: ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  const hash = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
  if (known[file]) assert.equal(hash, known[file], file)
  hashes[file] = hash; await writeFile(`${dir}/${file}`, bytes)
}))
await writeFile(`${dir}/helpers.ts`, 'export const SessionSeq = (value: number) => value; export default function clsx(...values: unknown[]): string { return values.flatMap(value => typeof value === "string" ? [value] : value && typeof value === "object" ? Object.entries(value).filter(([, yes]) => yes).map(([key]) => key) : []).join(" ") }')
await build({
  entryPoints: ['scripts/semantic-browser-fixture.tsx'], outfile: `${dir}/fixture.js`, bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic',
  nodePaths: [path.resolve('.browser-tools/node_modules')],
  loader: { '.css': 'local-css' }, define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [{ name: 'non-business-leaves', setup(b) {
    b.onResolve({ filter: /^(\.\/MessageItem\.tsx|\.\/message-chrome\.ts|\.\/icons\/index\.tsx|@deepseek-ai\/dsh-client-ui-primitives)$/ }, () => ({ path: path.resolve('scripts/semantic-browser-leaves.tsx') }))
    b.onResolve({ filter: /^(clsx|@deepseek-ai\/dsh-session\/types)$/ }, () => ({ path: `${dir}/helpers.ts` }))
    b.onResolve({ filter: /^(zustand(?:\/.*)?|immer)$/ }, args => ({ path: tools.resolve(args.path) }))
    b.onResolve({ filter: /^react(?:\/.*)?$/ }, args => ({ path: local.resolve(args.path) }))
  } }],
})
const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css"><style>
body{margin:0;font:14px Arial;background:#f3f4f6;color:#202124}main{position:relative;margin:24px;background:white;border:1px solid #ddd}
body[data-ds-dark-theme]{background:#15151b;color:#eee}body[data-ds-dark-theme] main{background:#24242b}
[data-conversation-scroll]{height:680px;overflow-y:auto;--dsh-chat-content-width:760px;--dsh-composer-side-clearance:0px;--dsh-conversation-viewport-height:680px;--dsh-composer-height:0px;--dsw-alias-border-l4:#aaa}
</style></head><body><main><div data-conversation-scroll tabindex="0"><div id="chat"></div></div></main><script src="/fixture.js"></script></body></html>`
const server = createServer(async (req, res) => {
  if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end(html); return }
  if (!['/fixture.js', '/fixture.css'].includes(req.url)) { res.writeHead(404); res.end(); return }
  res.setHeader('Content-Type', req.url.endsWith('css') ? 'text/css' : 'application/javascript'); res.end(await readFile(dir + req.url))
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
await context.tracing.start({ screenshots: true, snapshots: true })
const page = await context.newPage()
let errors = [], passed = 0
const darkContrast = []
page.on('pageerror', error => errors.push(error.message))
const key = (kind, turn = 2) => page.locator(`.smcp-bar[data-kind="${kind}"][data-turn="${turn}"]`)
const start = async () => { errors = []; await page.goto(`http://127.0.0.1:${server.address().port}/`); await page.waitForFunction(() => window.__smcpDebug?.mode === 'piano') }
const activate = async locator => {
  const box = await locator.boundingBox(); assert.ok(box); await page.mouse.click(box.x + 1, box.y + box.height / 2)
}
const colour = locator => locator.evaluate(el => getComputedStyle(el).backgroundColor)
const rowTop = selector => page.locator(selector).evaluate(el => el.getBoundingClientRect().top - el.closest('[data-conversation-scroll]').getBoundingClientRect().top)
async function test(name, run) { await start(); await run(); assert.deepEqual(errors, []); passed++; console.log(`ok ${passed} - ${name}`) }
try {
  await test('real nested locations retain user inputs and one final key per closed Turn', async () => {
    assert.equal(await key('input', 1).count(), 1); assert.equal(await key('input').count(), 1)
    assert.equal(await key('final', 1).count(), 1); assert.equal(await key('final').count(), 1)
    assert.ok((await key('final').getAttribute('aria-label')).includes('Final result'))
  })
  await test('Normal mode keeps the final message separate from adjacent process prose', async () => {
    await page.evaluate(() => window.semanticFixture.normal())
    await page.waitForFunction(() => document.querySelectorAll('.smcp-bar[data-kind="output"]').length === 2)
    await activate(key('final', 1)); await page.waitForTimeout(100)
    assert.ok(Math.abs(await rowTop('[data-chat-anchor-key="f1"]') - 24) < 3)
    assert.ok(!(await key('final', 1).getAttribute('aria-label')).includes('PROCESS_1'))
  })
  await test('Compact mode exposes question/answer keys even while native process is folded', async () => {
    assert.equal(await page.locator('[data-chat-anchor-key="tool2"]').getAttribute('hidden'), 'until-found')
    assert.equal(await key('question').count(), 2); assert.equal(await key('answer').count(), 2)
    await activate(key('answer').first())
    await page.waitForFunction(() => !document.querySelector('[data-chat-anchor-key="tool2"]').hasAttribute('hidden'))
    await page.waitForSelector('[data-chat-call-id="qa"] [data-disclosure-row][aria-expanded="true"]')
    assert.equal(await page.locator('[data-tool="ask_user_question"] dl').isVisible(), true)
    assert.equal((await page.evaluate(() => window.semanticFixture.summary())).submissionCalls, 0)
    assert.ok(await rowTop('[data-chat-anchor-key="call:qa"]') < 650)
  })
  await test('pending questions gain recorded user-answer keys and final output on completion', async () => {
    await page.evaluate(() => window.semanticFixture.waiting())
    await page.waitForFunction(() => document.querySelectorAll('.smcp-bar[data-kind="answer"]').length === 0)
    assert.equal(await key('final').count(), 0)
    assert.ok((await key('question').first().getAttribute('aria-label')).includes('Awaiting your answer'))
    await key('question').first().evaluate(el => { window.savedQuestionKey = el })
    await page.evaluate(() => window.semanticFixture.answer())
    await page.waitForFunction(() => document.querySelectorAll('.smcp-bar[data-kind="answer"]').length === 2)
    assert.equal(await key('question').first().evaluate(el => el === window.savedQuestionKey), true)
    assert.equal(await key('final').count(), 1)
  })
  await test('roles retain light/dark colours and dark preview fallback remains legible', async () => {
    const user = key('input').first(), ai = key('final').first()
    assert.notEqual(await colour(user), await colour(ai))
    await activate(user); const selectedUser = await colour(user)
    await activate(ai); assert.notEqual(selectedUser, await colour(ai))
    await page.screenshot({ path: 'test-results/semantic-keys-light.png', fullPage: true })
    await page.evaluate(() => document.body.setAttribute('data-ds-dark-theme', 'true'))
    const darkUser = await colour(user), darkAI = await colour(ai)
    assert.notEqual(darkUser, darkAI); assert.notEqual(darkUser, selectedUser)
    const contrast = await page.locator('.smcp-tooltip').evaluate(el => {
      const rgb = value => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)
      const luminance = values => values.map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
        .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0)
      const background = luminance(rgb(getComputedStyle(el).backgroundColor))
      return ['.smcp-key-label', '.smcp-tooltip-title', '.smcp-tooltip-body'].map(selector => {
        const foreground = luminance(rgb(getComputedStyle(el.querySelector(selector)).color))
        return { selector, ratio: (Math.max(background, foreground) + .05) / (Math.min(background, foreground) + .05) }
      })
    })
    for (const value of contrast) assert.ok(value.ratio >= 4.5, `${value.selector}: contrast ${value.ratio}`)
    darkContrast.push(...contrast)
    await page.screenshot({ path: 'test-results/semantic-keys-dark.png', fullPage: true })
  })
  await test('question answer preview preserves custom multi-select content and roles', async () => {
    const answer = key('answer').last(), box = await answer.boundingBox(); assert.ok(box)
    await page.mouse.move(box.x + 1, box.y + box.height / 2)
    await page.waitForFunction(() => document.querySelector('.smcp-tooltip')?.textContent.includes('Windows'))
    assert.equal(await answer.getAttribute('data-role'), 'user'); assert.ok((await answer.getAttribute('aria-label')).includes('User · Answer'))
  })
  await test('disabling during disclosure cancels pending local landing without submission', async () => {
    await key('question').first().evaluate(el => { el.click(); window.semanticFixture.disable() })
    await page.waitForSelector('.smcp-unified', { state: 'detached' }); await page.waitForTimeout(100)
    assert.equal(await page.locator('nav[aria-label="Turn navigation"]').getAttribute('aria-hidden'), null)
    assert.equal((await page.evaluate(() => window.semanticFixture.summary())).submissionCalls, 0)
  })
  await test('session disappearance invalidates an in-flight question reveal', async () => {
    await key('question').first().evaluate(el => { el.click(); window.semanticFixture.disappear() })
    await page.waitForSelector('.smcp-unified', { state: 'detached' }); await page.waitForTimeout(100)
    assert.equal((await page.evaluate(() => window.semanticFixture.summary())).submissionCalls, 0)
  })
  await writeFile('test-results/semantic-browser-summary.json', JSON.stringify({ passed, pinned, hashes, errors, darkContrast, note: 'Original ChatView, ChatNodeSeat, searchable-hidden, stores, DisclosureRow and AskQuestionCard; synthetic transport/messages and icon/classname helpers.' }, null, 2))
  console.log(`${passed} semantic Chromium checks passed`)
} catch (error) {
  await page.screenshot({ path: 'test-results/semantic-failure.png', fullPage: true })
  await writeFile('test-results/semantic-failure.txt', `${error.stack}\n${JSON.stringify(errors)}\n${await page.content()}`)
  throw error
} finally {
  await context.tracing.stop({ path: 'test-results/semantic-trace.zip' }); await browser.close(); await new Promise(resolve => server.close(resolve))
}
