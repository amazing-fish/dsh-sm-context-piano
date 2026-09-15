/** One visible Piano over the official full-history navigation owner. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { observeChatNodes } from './chat-source.ts'
import { buildNavigationNodes } from './keys.ts'
import { buildPianoItems, mergeNavigationTurns } from './navigation-model.ts'
import type { PianoItem } from './navigation-model.ts'
import { createNativeNavigation } from './native-navigation.ts'
import type { SmContextPianoKey } from './locales.ts'
import { DEFAULT_SETTINGS, DEFAULT_SETTINGS_SOURCE, railHeight } from '../core/config.ts'
import type { PianoSettingsSource } from '../core/config.ts'

export function visibleWindow(total: number, center: number, size = DEFAULT_SETTINGS.maxVisible): { start: number; end: number } {
  if (total <= 0 || size <= 0) return { start: 0, end: 0 }
  const count = Math.min(total, size)
  const start = Math.max(0, Math.min(total - count, center - Math.floor(count / 2)))
  return { start, end: start + count }
}
export function stackPositions(count: number, height = railHeight(DEFAULT_SETTINGS), pitch = DEFAULT_SETTINGS.keyGap, markHeight = DEFAULT_SETTINGS.keyHeight): number[] {
  if (count <= 0) return []
  const top = (height - ((count - 1) * pitch + markHeight)) / 2 + markHeight / 2
  return Array.from({ length: count }, (_, index) => top + index * pitch)
}
let instanceCount = 0

/** Attach to the visible ChatView, never to a background/hidden conversation. */
export function attachKeyStrip(ctx: ClientContext, t: Translate<SmContextPianoKey>, settings: PianoSettingsSource = DEFAULT_SETTINGS_SOURCE): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined' || document.body === null) return () => {}
  let flow: HTMLElement | undefined
  let stop: (() => void) | undefined
  let disposed = false
  const reconcile = (): void => {
    if (disposed) return
    const next = settings.getSnapshot().enabled
      ? [...document.querySelectorAll<HTMLElement>('[data-chat-flow]')].find(el => el.closest('[hidden]') === null)
      : undefined
    if (next === flow) return
    stop?.()
    stop = undefined
    flow = next
    if (next !== undefined) {
      try { stop = mount(ctx, next, t, settings) }
      catch { console.warn('[dsh-sm-context-piano] navigator unavailable; native navigation retained') }
    }
  }
  const observer = new MutationObserver(reconcile)
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] })
  const unsubscribe = settings.subscribe(reconcile)
  reconcile()
  return () => { disposed = true; observer.disconnect(); unsubscribe(); stop?.() }
}

function mount(ctx: ClientContext, flow: HTMLElement, t: Translate<SmContextPianoKey>, settings: PianoSettingsSource): () => void {
  const local = flow.parentElement
  const scrollport = flow.closest<HTMLElement>('[data-conversation-scroll]') ?? local
  const root = scrollport?.parentElement
  if (local === null || scrollport == null || root == null) return () => {}
  const nativeT = ctx.locale.bind('chat')
  const owner = createNativeNavigation(flow, {
    navigation: () => nativeT('chat.turnNavigation.label'),
    jump: (turn, unloaded) => nativeT(unloaded ? 'chat.turnNavigation.jumpLoad' : 'chat.turnNavigation.jump', { turn }),
  })
  const prefix = `smcp-${++instanceCount}-`
  const strip = document.createElement('div')
  strip.className = 'smcp-strip smcp-unified'
  strip.tabIndex = 0
  strip.setAttribute('role', 'navigation')
  strip.setAttribute('aria-label', t('nav.aria'))
  strip.hidden = true
  const tooltip = document.createElement('div')
  tooltip.className = 'smcp-tooltip'
  tooltip.id = `${prefix}preview`
  tooltip.setAttribute('role', 'tooltip')
  const title = document.createElement('div')
  title.className = 'smcp-tooltip-title'
  const body = document.createElement('div')
  body.className = 'smcp-tooltip-body'
  tooltip.append(title, body)
  const status = document.createElement('div')
  status.className = 'smcp-navigation-status'
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')
  strip.append(status)
  const style = document.createElement('style')
  style.textContent = '.smcp-unified[hidden]{display:none!important}.smcp-unified .smcp-bar[aria-busy="true"]{opacity:.4}.smcp-unified .smcp-bar[data-unloaded="true"]{background:transparent;border:1px solid currentColor;box-sizing:border-box}.smcp-navigation-status{position:absolute;left:0;top:100%;width:220px;font-size:12px;line-height:1.4;padding-top:12px;color:var(--dsw-alias-label-secondary,#73757a)}'
  const originalPosition = root.style.position
  const forcedPosition = window.getComputedStyle(root).position === 'static'
  if (forcedPosition) root.style.position = 'relative'
  root.append(strip, tooltip, style)

  let alive = true
  let frame = 0
  let binding: SessionBinding | undefined
  let sourceStop: (() => void) | undefined
  let retry: ReturnType<typeof setTimeout> | undefined
  let retries = 0
  let nodes: readonly ChatConversationViewNode[] = []
  let items: PianoItem[] = []
  let active: string | null = null
  let selected: string | null = null
  let browseStart: string | null = null
  let windowStart = 0
  let pointerInside = false
  let requestedTurn: number | null = null
  let failedTurn: number | null = null
  let nativeReady = false
  let warned = false
  let top = 0
  let left = 0
  const buttons = new Map<string, HTMLButtonElement>()
  const debug = { mounted: true, bars: 0, total: 0, windowStart: 0, sessionId: undefined as string | undefined, hiddenReason: null as string | null, mode: 'native-fallback' }
  const debugHost = globalThis as unknown as { __smcpDebug?: typeof debug }
  debugHost.__smcpDebug = debug

  const copy = (kind: 'turn' | 'loading' | 'failed', turn: number): string => {
    const language = settings.getSnapshot().language
    if (language === 'en') return kind === 'turn' ? `Turn ${turn}` : kind === 'loading'
      ? `Loading turn ${turn}…` : `Turn ${turn} was not loaded. Select it to retry.`
    if (language === 'zh-TW') return kind === 'turn' ? `第 ${turn} 輪` : kind === 'loading'
      ? `正在載入第 ${turn} 輪…` : `第 ${turn} 輪未載入，點擊重試。`
    return kind === 'turn' ? `第 ${turn} 轮` : kind === 'loading'
      ? `正在加载第 ${turn} 轮…` : `第 ${turn} 轮未加载，点击重试。`
  }
  const closePreview = (): void => {
    tooltip.classList.remove('smcp-tooltip-visible')
    strip.removeAttribute('aria-describedby')
  }
  const fallback = (reason: string): void => {
    owner.release()
    strip.hidden = true
    closePreview()
    debug.mode = 'native-fallback'
    debug.hiddenReason = reason
  }
  const schedule = (): void => {
    if (!alive || frame !== 0) return
    frame = window.requestAnimationFrame(() => {
      frame = 0
      if (!alive) return
      try { render() }
      catch {
        fallback('contract')
        if (!warned) { warned = true; console.warn('[dsh-sm-context-piano] navigator contract changed; native UI restored') }
      }
    })
  }
  const readingKey = (): string | null => {
    const line = scrollport.getBoundingClientRect().top + Math.min(120, scrollport.clientHeight * .18)
    let key: string | null = null
    // Only loaded rendered anchors participate; the full-history outline is
    // never subjected to DOM geometry scans.
    for (const item of items) {
      if (item.anchorKey === null) continue
      const row = owner.rowFor(item.anchorKey)
      if (row === null) continue
      if (key === null || row.getBoundingClientRect().top <= line) key = item.key
    }
    return key
  }
  const render = (): void => {
    const snapshot = binding === undefined ? undefined : ctx.uiConversation.binding(binding).target('chat').getSnapshot()
    const loaded = snapshot?.navigation.items() ?? []
    const outline = binding?.session.projections.faceOf('turnOutline').getSnapshot()
    const turns = mergeNavigationTurns(loaded, outline)
    const segments = buildNavigationNodes(nodes).filter(segment => owner.rowFor(segment.anchorKey) !== null)
    items = buildPianoItems(turns, segments, turn => copy('turn', turn))
    debug.total = items.length
    nativeReady = owner.reconcile(turns)
    const rootRect = root.getBoundingClientRect()
    const flowLeft = flow.getBoundingClientRect().left - rootRect.left
    const width = root.clientWidth || rootRect.width
    left = Math.max(16, flowLeft - 108)
    if (!nativeReady || items.length === 0 || width < 520 || left + 70 > flowLeft) {
      fallback(!nativeReady ? 'contract' : items.length === 0 ? 'empty' : width < 520 ? 'narrow' : 'overlap')
      return
    }
    const config = settings.getSnapshot()
    const available = Math.max(0, scrollport.clientHeight - (scrollport.querySelector<HTMLElement>('[data-composer-seat]')?.offsetHeight ?? 0))
    const height = Math.min(railHeight(config), Math.max(config.keyHeight, available - 48))
    const capacity = Math.min(config.maxVisible, Math.max(1, Math.floor((height - config.keyHeight) / config.keyGap) + 1))
    const busy = owner.busy()
    const loadedBusy = binding?.session.getSnapshot().loadingOlder ?? false
    if (requestedTurn !== null && busy === null && !loadedBusy) {
      const destination = turns.find(turn => turn.turn === requestedTurn)
      failedTurn = destination?.anchor.kind === 'unloaded' ? requestedTurn : null
      requestedTurn = null
    }
    active = readingKey() ?? `turn:${owner.active() ?? turns.at(-1)?.turn}`
    if (selected !== null && !items.some(item => item.key === selected)) selected = null
    const center = Math.max(0, items.findIndex(item => item.key === active))
    const manual = browseStart === null ? -1 : items.findIndex(item => item.key === browseStart)
    windowStart = manual < 0 ? visibleWindow(items.length, center, capacity).start
      : Math.max(0, Math.min(items.length - capacity, manual))
    const visible = items.slice(windowStart, windowStart + capacity)
    top = Math.max(8, (scrollport.getBoundingClientRect().top - rootRect.top) + (available - height) / 2)
    strip.style.top = `${top}px`
    strip.style.transform = 'none'
    strip.style.left = `${left}px`
    strip.style.height = `${height}px`
    const positions = stackPositions(visible.length, height, config.keyGap, config.keyHeight)
    const retained = new Set(visible.map(item => item.key))
    for (const [key, button] of buttons) if (!retained.has(key)) { button.remove(); buttons.delete(key) }
    const focusIndex = visible.findIndex(item => item.key === selected)
    visible.forEach((item, index) => {
      let button = buttons.get(item.key)
      if (button === undefined) {
        button = document.createElement('button')
        button.type = 'button'
        button.tabIndex = -1
        button.className = 'smcp-bar'
        button.dataset.key = item.key
        button.id = prefix + encodeURIComponent(item.key)
        buttons.set(item.key, button)
        strip.append(button)
      }
      button.dataset.turn = String(item.turn)
      button.dataset.unloaded = String(item.anchorKey === null)
      button.setAttribute('aria-label', `${copy('turn', item.turn)}: ${item.title}`)
      button.setAttribute('aria-current', String(item.key === active))
      button.setAttribute('aria-busy', String(item.turn === busy))
      button.classList.toggle('smcp-bar-current', item.key === active)
      button.classList.toggle('smcp-bar-hover', item.key === selected)
      button.style.top = `${positions[index] - config.keyHeight / 2}px`
      button.style.height = `${config.keyHeight}px`
      const base = item.key === active ? 24 : 10
      const wave = focusIndex < 0 ? 0 : Math.exp(-((index - focusIndex) ** 2) / (2 * 1.35 ** 2))
      button.style.width = `${base + (48 - base) * wave}px`
    })
    const focused = visible.find(item => item.key === selected)
    if (focused !== undefined) {
      title.textContent = focused.title
      body.textContent = focused.preview
      tooltip.style.left = `${Math.max(8, Math.min(left + 64, width - (tooltip.offsetWidth || 400) - 8))}px`
      tooltip.style.top = `${Math.max(8, Math.min(top + positions[focusIndex] - 48, root.clientHeight - (tooltip.offsetHeight || 150) - 8))}px`
      tooltip.classList.add('smcp-tooltip-visible')
      strip.setAttribute('aria-activedescendant', buttons.get(focused.key)!.id)
      strip.setAttribute('aria-describedby', tooltip.id)
    } else {
      closePreview()
      strip.removeAttribute('aria-activedescendant')
    }
    status.textContent = busy !== null ? copy('loading', busy) : failedTurn !== null ? copy('failed', failedTurn) : ''
    strip.hidden = false
    owner.claim()
    debug.mode = 'piano'
    debug.hiddenReason = null
    debug.bars = visible.length
    debug.windowStart = windowStart
  }
  const bind = (): void => {
    const id = ctx.sessions.list.getSnapshot().current
    const next = id === undefined ? undefined : ctx.sessions.binding(id)
    if (next === binding && sourceStop !== undefined) return
    sourceStop?.()
    sourceStop = undefined
    owner.release()
    fallback('binding')
    binding = next
    nodes = []
    selected = active = browseStart = null
    requestedTurn = failedTurn = null
    debug.sessionId = id === undefined ? undefined : String(id)
    if (retry !== undefined) clearTimeout(retry)
    retry = undefined
    if (next === undefined) {
      items = []
      for (const button of buttons.values()) button.remove()
      buttons.clear()
      if (id !== undefined && retries++ < 20) retry = setTimeout(() => { retry = undefined; bind() }, 300)
      schedule()
      return
    }
    retries = 0
    const target = ctx.uiConversation.binding(next).target('chat')
    const stops: (() => void)[] = []
    try {
      stops.push(observeChatNodes(target, value => { if (alive && binding === next) { nodes = value; schedule() } }))
      stops.push(next.session.projections.faceOf('turnOutline').subscribe(schedule))
      stops.push(next.session.subscribe(schedule))
      sourceStop = () => { for (const dispose of stops.reverse()) dispose() }
    } catch (error) {
      for (const dispose of stops.reverse()) dispose()
      throw error
    }
    schedule()
  }
  const activate = (item: PianoItem | undefined): void => {
    if (item === undefined || !nativeReady) return
    failedTurn = null
    requestedTurn = item.anchorKey === null ? item.turn : null
    if (!owner.navigate(item.turn, item.anchorKey)) { requestedTurn = null; fallback('contract'); return }
    selected = item.key
    active = item.key
    browseStart = null
    strip.focus({ preventScroll: true })
    schedule()
  }
  const nearest = (clientY: number): PianoItem | undefined => {
    const config = settings.getSnapshot()
    const visible = items.slice(windowStart, windowStart + buttons.size)
    const positions = stackPositions(visible.length, Number.parseFloat(strip.style.height), config.keyGap, config.keyHeight)
    let best = 0
    const y = clientY - strip.getBoundingClientRect().top
    for (let i = 1; i < positions.length; i++) if (Math.abs(positions[i] - y) < Math.abs(positions[best] - y)) best = i
    return visible[best]
  }
  const pointerMove = (event: PointerEvent): void => {
    pointerInside = true
    browseStart ??= items[windowStart]?.key ?? null
    selected = nearest(event.clientY)?.key ?? null
    schedule()
  }
  const pointerLeave = (): void => { pointerInside = false; selected = null; browseStart = null; schedule() }
  const click = (event: MouseEvent): void => {
    const key = (event.target as HTMLElement).closest<HTMLElement>('[data-key]')?.dataset.key
    activate(key === undefined ? nearest(event.clientY) : items.find(item => item.key === key))
  }
  const wheel = (event: WheelEvent): void => {
    if (event.deltaY === 0 || items.length === 0) return
    event.preventDefault()
    const index = Math.max(0, Math.min(items.length - Math.max(1, buttons.size), windowStart + Math.sign(event.deltaY) * 3))
    browseStart = items[index]?.key ?? null
    selected = null
    schedule()
  }
  const cancel = (): void => { owner.cancel(); requestedTurn = failedTurn = null; schedule() }
  const keydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') { event.preventDefault(); cancel(); selected = null; browseStart = null; return }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault(); activate(items.find(item => item.key === (selected ?? active)) ?? items[windowStart]); return
    }
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) return
    event.preventDefault()
    const index = Math.max(0, items.findIndex(item => item.key === (selected ?? active)))
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : Math.max(0, Math.min(items.length - 1, index + (event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : event.key === 'PageUp' ? -buttons.size : buttons.size)))
    selected = items[next]?.key ?? null
    browseStart = items[visibleWindow(items.length, next, Math.max(1, buttons.size)).start]?.key ?? null
    schedule()
  }
  const readerKey = (event: KeyboardEvent): void => {
    if (['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', ' '].includes(event.key)) cancel()
  }
  const onScroll = (): void => { if (!pointerInside && document.activeElement !== strip) browseStart = null; schedule() }
  const dom = new MutationObserver(schedule)
  dom.observe(local, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'aria-label', 'aria-current', 'aria-busy'] })
  const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
  resize?.observe(root); resize?.observe(flow); resize?.observe(scrollport)
  strip.addEventListener('pointermove', pointerMove)
  strip.addEventListener('pointerleave', pointerLeave)
  strip.addEventListener('click', click)
  strip.addEventListener('wheel', wheel, { passive: false })
  strip.addEventListener('keydown', keydown)
  scrollport.addEventListener('scroll', onScroll, { passive: true })
  scrollport.addEventListener('wheel', cancel, { passive: true })
  scrollport.addEventListener('touchstart', cancel, { passive: true })
  scrollport.addEventListener('keydown', readerKey)
  const listStop = ctx.sessions.list.subscribe(() => { retries = 0; bind() })
  const settingsStop = settings.subscribe(schedule)
  const dispose = (): void => {
    if (!alive) return
    alive = false
    // Only cancel against the same current session, never a newly selected view.
    if (binding?.session.sessionId === ctx.sessions.list.getSnapshot().current) owner.cancel()
    owner.release()
    sourceStop?.(); listStop(); settingsStop(); dom.disconnect(); resize?.disconnect()
    if (retry !== undefined) clearTimeout(retry)
    if (frame !== 0) window.cancelAnimationFrame(frame)
    scrollport.removeEventListener('scroll', onScroll)
    scrollport.removeEventListener('wheel', cancel)
    scrollport.removeEventListener('touchstart', cancel)
    scrollport.removeEventListener('keydown', readerKey)
    strip.remove(); tooltip.remove(); style.remove()
    if (forcedPosition && root.style.position === 'relative') root.style.position = originalPosition
    if (debugHost.__smcpDebug === debug) delete debugHost.__smcpDebug
  }
  try { bind() } catch (error) { dispose(); throw error }
  return dispose
}
