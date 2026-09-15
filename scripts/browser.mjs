/** Chromium integration against pinned, unmodified official navigation owners. */
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import path from 'node:path'
const tools = createRequire(path.resolve('.browser-tools/package.json'))
const { build } = tools('esbuild')
const { chromium } = tools('playwright')
const pinned = 'c291e7961a515f6d7af9304e7fd1d257929aef26'
const staging = path.resolve('.browser-fixture')
await mkdir(`${staging}/vendor`, { recursive: true })
await mkdir('test-results', { recursive: true })
const files = ['ChatView.tsx', 'ChatView.module.css', 'TurnNavigator.tsx', 'TurnNavigator.module.css', 'turn-rail-items.ts']
const hashes = {}
for (const file of files) {
  const response = await fetch(`https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/${pinned}/packages/client/ui-chat/src/client/chat/${file}`)
  if (!response.ok) throw new Error(`Official source ${file}: HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  const blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
  if (file === 'ChatView.tsx') assert.equal(blob, '1bb0dcdf63921e55dcd2767dc3e67bf4633fe9be')
  hashes[file] = blob
  await writeFile(`${staging}/vendor/${file}`, bytes)
}
await writeFile(`${staging}/brand.ts`, 'export const SessionSeq = (value: number) => value\n')
await writeFile('test-results/official-source.json', JSON.stringify({ pinned, blobs: hashes, note: 'Source files unmodified; presentation leaves and Session transport stubbed.' }, null, 2))
await build({
  entryPoints: ['scripts/browser-fixture.tsx'], bundle: true, platform: 'browser', format: 'iife',
  jsx: 'automatic', outfile: `${staging}/fixture.js`, loader: { '.css': 'local-css', '.png': 'dataurl' },
  define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [{ name: 'presentation-leaves-only', setup(b) {
    b.onResolve({ filter: /^(\.\/ChatNodeSeat\.tsx|\.\/MessageItem\.tsx|\.\/message-chrome\.ts|@deepseek-ai\/dsh-client-ui-primitives)$/ }, () => ({ path: path.resolve('scripts/browser-leaves.tsx') }))
    b.onResolve({ filter: /^@deepseek-ai\/dsh-session\/types$/ }, () => ({ path: `${staging}/brand.ts` }))
  } }],
})
const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css"><style>
body{margin:0;font:14px Arial;background:#f3f4f6}main{position:relative;margin:24px;background:white;border:1px solid #ddd}
[data-conversation-scroll]{height:680px;overflow-y:auto;--dsh-chat-content-width:760px;--dsh-composer-side-clearance:0px;--dsh-conversation-viewport-height:680px;--dsh-composer-height:0px;--dsw-alias-label-primary:#202124;--dsw-alias-border-l4:#aaa}
</style></head><body><main><div data-conversation-scroll tabindex="0"><div id="chat"></div></div></main><script src="/fixture.js"></script></body></html>`
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); return }
    if (!['/fixture.js', '/fixture.css'].includes(req.url)) { res.writeHead(404); res.end(); return }
    res.setHeader('Content-Type', req.url.endsWith('css') ? 'text/css' : 'application/javascript')
    res.end(await readFile(staging + req.url))
  } catch { res.writeHead(500); res.end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${server.address().port}/`
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
await context.tracing.start({ screenshots: true, snapshots: true })
const page = await context.newPage()
const errors = []
page.on('pageerror', e => errors.push(e.message))
let passed = 0
const rail = () => page.locator('.smcp-unified')
const start = async () => {
  errors.length = 0
  await page.goto(url)
  await page.waitForFunction(() => window.__smcpDebug?.mode === 'piano', { timeout: 10000 })
}
const selectTurn = async turn => {
  await rail().focus(); await rail().press('Home')
  for (let i = 1; i < turn; i++) await rail().press('ArrowDown')
  await rail().press('Enter')
}
const rowTop = key => page.locator(`[data-chat-anchor-key="${key}"]`).evaluate(el => el.getBoundingClientRect().top - el.closest('[data-conversation-scroll]').getBoundingClientRect().top)
const idle = () => page.waitForFunction(() => !document.querySelector('nav[aria-label="Turn navigation"] [aria-busy="true"]'))
async function test(name, run) {
  await start(); await run(); assert.deepEqual(errors, [], 'no browser errors')
  passed++; console.log(`ok ${passed} - ${name}`)
}
try {
  await test('one visible landmark and complete-history keyboard access', async () => {
    const visible = await page.locator('nav,[role="navigation"]').evaluateAll(els => els.filter(el => getComputedStyle(el).display !== 'none' && el.getAttribute('aria-hidden') !== 'true').length)
    assert.equal(visible, 1)
    await rail().focus(); await rail().press('Home')
    assert.equal(await page.locator('.smcp-bar[data-key="turn:1"]').getAttribute('data-unloaded'), 'true')
    assert.ok(await page.locator('.smcp-bar').count() <= 8)
  })
  await test('unloaded jump uses original ChatView paging, landing and restoration', async () => {
    await selectTurn(2)
    await page.waitForFunction(() => window.fixture.calls.length > 0)
    assert.deepEqual(await page.evaluate(() => window.fixture.calls), [200])
    await page.evaluate(() => window.fixture.settle()); await idle()
    await page.waitForFunction(() => document.querySelector('[data-chat-anchor-key="u2"]') !== null)
    await page.waitForTimeout(650)
    assert.ok(Math.abs(await rowTop('u2') - 24) < 3)
    assert.ok((await page.evaluate(() => window.fixture.state())).saved)
    await page.screenshot({ path: 'test-results/single-piano-history.png', fullPage: true })
  })
  await test('latest target wins when multiple history jumps finish together', async () => {
    await selectTurn(2); await selectTurn(3)
    await page.evaluate(() => window.fixture.settle()); await idle(); await page.waitForTimeout(650)
    assert.ok(Math.abs(await rowTop('u3') - 24) < 3)
  })
  await test('reader cancellation prevents a late page pulling back to its old target', async () => {
    await selectTurn(2)
    await page.mouse.move(650, 400); await page.mouse.wheel(0, -220)
    await page.waitForTimeout(650)
    const saved = (await page.evaluate(() => window.fixture.state())).saved
    assert.ok(saved)
    const before = await rowTop(saved.anchorKey)
    await page.evaluate(() => window.fixture.settle()); await idle(); await page.waitForTimeout(650)
    assert.ok(Math.abs(await rowTop(saved.anchorKey) - before) < 3)
    assert.ok(Math.abs(await rowTop('u2') - 24) > 100)
  })
  await test('Escape cancels pending landing and preserves native fallback on disable', async () => {
    await selectTurn(2); await rail().press('Escape')
    await page.evaluate(() => window.fixture.enable(false))
    await page.waitForSelector('.smcp-unified', { state: 'detached' })
    assert.equal(await page.locator('nav[aria-label="Turn navigation"]').getAttribute('aria-hidden'), null)
    await page.evaluate(() => window.fixture.settle()); await idle(); await page.waitForTimeout(650)
    assert.ok(Math.abs(await rowTop('u2') - 24) > 100)
  })
  await test('a failed native load reports retry instead of a successful false landing', async () => {
    await selectTurn(2); await page.evaluate(() => window.fixture.fail()); await idle()
    await page.waitForFunction(() => document.querySelector('.smcp-navigation-status')?.textContent.includes('not loaded'))
    const previous = await page.evaluate(() => window.fixture.calls.length)
    await selectTurn(2); await idle()
    assert.ok(await page.evaluate(() => window.fixture.calls.length) > previous)
  })
  await test('exact loaded segment survives a real ChatView unmount/remount', async () => {
    await selectTurn(2); await page.evaluate(() => window.fixture.settle()); await idle()
    await rail().focus(); await rail().press('Home')
    // Turn 2 is the first loaded Turn, while Turn 1 remains an outline entry.
    await rail().press('ArrowDown'); await rail().press('ArrowDown'); await rail().press('Enter')
    await page.waitForTimeout(650)
    assert.ok(Math.abs(await rowTop('a2') - 24) < 3)
    await page.evaluate(() => window.fixture.remount()); await page.waitForTimeout(800)
    assert.ok(Math.abs(await rowTop('a2') - 24) < 3)
  })
  await test('locale/DOM contract drift fails open to the native rail', async () => {
    await page.locator('nav[aria-label="Turn navigation"] button').first().evaluate(el => el.setAttribute('aria-label', 'unsupported contract'))
    await page.waitForFunction(() => window.__smcpDebug?.mode === 'native-fallback')
    assert.equal(await rail().getAttribute('hidden'), '')
    assert.equal(await page.locator('nav[aria-label="Turn navigation"]').getAttribute('aria-hidden'), null)
  })
  await test('session switch makes old pending jump callbacks harmless', async () => {
    await selectTurn(2); await page.evaluate(() => window.fixture.switchSession())
    await page.waitForFunction(() => window.__smcpDebug?.sessionId === 's2')
    await page.evaluate(() => window.fixture.settle()); await page.waitForTimeout(800)
    assert.ok(Math.abs(await rowTop('u2') - 24) > 100)
  })
  console.log(`${passed} original-ChatView Chromium checks passed`)
  await writeFile('test-results/browser-summary.json', JSON.stringify({ passed, pinned, errors }, null, 2))
} catch (error) {
  await page.screenshot({ path: 'test-results/failure.png', fullPage: true })
  await writeFile('test-results/failure.txt', `${error.stack}\nBrowser errors: ${JSON.stringify(errors)}\n${await page.content()}`)
  throw error
} finally {
  await context.tracing.stop({ path: 'test-results/trace.zip' })
  await browser.close()
  await new Promise(resolve => server.close(resolve))
}
