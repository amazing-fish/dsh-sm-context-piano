/** One visible Piano over the official full-history navigation owner. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { observeChatNodes } from './chat-source.ts'
import { buildNavigationNodesWithQuestions, turnOf } from './keys.ts'
import type { KeyDescriptor } from './keys.ts'
import { buildQuestionKeys } from './question-keys.ts'
import { buildPianoItems, buildPianoItemsForTurn, mergeNavigationTurns } from './navigation-model.ts'
import type { NavigationTurn, PianoItem } from './navigation-model.ts'
import { createNativeNavigation } from './native-navigation.ts'
import { createSemanticLanding } from './semantic-landing.ts'
import { SEMANTIC_CSS, semanticLabel, landingFailure } from './semantic-style.ts'
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

const DIRTY_NODES = 1 << 0
const DIRTY_TURNS = 1 << 1
const DIRTY_DOM = 1 << 2
const DIRTY_LAYOUT = 1 << 3
const DIRTY_NATIVE_STATE = 1 << 4
const DIRTY_VIEW = 1 << 5
const DIRTY_KEYED_NODES = 1 << 6
const DIRTY_ALL = DIRTY_NODES | DIRTY_TURNS | DIRTY_DOM | DIRTY_LAYOUT | DIRTY_NATIVE_STATE | DIRTY_VIEW
const STREAM_SEMANTIC_MIN_INTERVAL_MS = 120

/** Attach to the visible ChatView, never to a background/hidden conversation. */
export function attachKeyStrip(ctx: ClientContext, t: Translate<SmContextPianoKey>, settings: PianoSettingsSource = DEFAULT_SETTINGS_SOURCE): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined' || document.body === null) return () => {}
  let flow: HTMLElement | undefined
  let stop: (() => void) | undefined
  let disposed = false
  const reconcile = (): void => {
    if (disposed) return
    const enabled = settings.getSnapshot().enabled
    if (enabled && flow?.isConnected === true && flow.closest('[hidden]') === null) return
    const next = enabled
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
  const landing = createSemanticLanding(flow, owner)
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
  const badge = document.createElement('span')
  badge.className = 'smcp-key-label'
  const title = document.createElement('div')
  title.className = 'smcp-tooltip-title'
  const body = document.createElement('div')
  body.className = 'smcp-tooltip-body'
  tooltip.append(badge, title, body)
  const status = document.createElement('div')
  status.className = 'smcp-navigation-status'
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')
  strip.append(status)
  const style = document.createElement('style')
  style.textContent = '.smcp-unified[hidden]{display:none!important}.smcp-unified .smcp-bar[aria-busy="true"]{opacity:.4}.smcp-unified .smcp-bar[data-unloaded="true"]{background:transparent;border:1px solid currentColor;box-sizing:border-box}.smcp-navigation-status{position:absolute;left:0;top:100%;width:220px;font-size:12px;line-height:1.4;padding-top:12px;color:var(--dsw-alias-label-secondary,#73757a)}' + SEMANTIC_CSS
  const originalPosition = root.style.position
  const forcedPosition = window.getComputedStyle(root).position === 'static'
  if (forcedPosition) root.style.position = 'relative'
  root.append(strip, tooltip, style)

  let alive = true
  let frame = 0
  let dirty = DIRTY_ALL
  let binding: SessionBinding | undefined
  let sourceStop: (() => void) | undefined
  let retry: ReturnType<typeof setTimeout> | undefined
  let streamRefresh: ReturnType<typeof setTimeout> | undefined
  let lastStreamSemanticAt = Number.NEGATIVE_INFINITY
  let retries = 0
  let nodes: readonly ChatConversationViewNode[] = []
  let turns: NavigationTurn[] = []
  let segments: KeyDescriptor[] = []
  let questionKeys: ReadonlyMap<string, KeyDescriptor[]> = new Map()
  let nodeByKey = new Map<string, ChatConversationViewNode>()
  let nodeIndexByKey = new Map<string, number>()
  let turnKeys = new Map<number, string[]>()
  let segmentsByTurn = new Map<number, KeyDescriptor[]>()
  let turnByNumber = new Map<number, NavigationTurn>()
  let turnItemRanges = new Map<number, { start: number; count: number }>()
  const keyedDirtyKeys = new Set<string>()
  let items: PianoItem[] = []
  let itemByKey = new Map<string, PianoItem>()
  let itemIndexByKey = new Map<string, number>()
  let firstItemByAnchor = new Map<string, string>()
  let active: string | null = null
  let selected: string | null = null
  let browseStart: string | null = null
  let windowStart = 0
  let pointerInside = false
  let requestedTurn: number | null = null
  let failedTurn: number | null = null
  let localFailure = false
  let activation = 0
  let nativeReady = false
  let nativeActiveTurn: number | null = null
  let busyTurn: number | null = null
  let warned = false
  let top = 0
  let left = 0
  let flowLeft = 0
  let width = 0
  let height = 0
  let capacity = 1
  let stripViewportTop = 0
  let visibleItems: PianoItem[] = []
  let visiblePositions: number[] = []
  let tooltipKey: string | null = null
  const buttons = new Map<string, HTMLButtonElement>()
  const perf = { renders: 0, nodeRebuilds: 0, keyedSemanticUpdates: 0, itemRebuilds: 0, turnRebuilds: 0, domReconciles: 0, hitTests: 0 }
  const debug = { mounted: true, bars: 0, total: 0, windowStart: 0, sessionId: undefined as string | undefined, hiddenReason: null as string | null, mode: 'native-fallback', perf }
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
    tooltipKey = null
    tooltip.classList.remove('smcp-tooltip-visible')
    strip.removeAttribute('aria-describedby')
  }
  const fallback = (reason: string): void => {
    activation++; landing.cancel()
    owner.release()
    strip.hidden = true
    closePreview()
    debug.mode = 'native-fallback'
    debug.hiddenReason = reason
  }
  const schedule = (flags = DIRTY_VIEW): void => {
    dirty |= flags
    if (!alive || frame !== 0) return
    frame = window.requestAnimationFrame(() => {
      frame = 0
      if (!alive) return
      const pending = dirty
      dirty = 0
      try { render(pending) }
      catch {
        fallback('contract')
        if (!warned) { warned = true; console.warn('[dsh-sm-context-piano] navigator contract changed; native UI restored') }
      }
    })
  }
  const clearStreamRefresh = (): void => {
    if (streamRefresh !== undefined) window.clearTimeout(streamRefresh)
    streamRefresh = undefined
  }
  const scheduleKeyedSemantic = (): void => {
    const now = window.performance.now()
    const wait = STREAM_SEMANTIC_MIN_INTERVAL_MS - (now - lastStreamSemanticAt)
    if (wait <= 0) {
      lastStreamSemanticAt = now
      schedule(DIRTY_NODES | DIRTY_VIEW)
      return
    }
    if (streamRefresh !== undefined) return
    streamRefresh = window.setTimeout(() => {
      streamRefresh = undefined
      if (!alive) return
      lastStreamSemanticAt = window.performance.now()
      schedule(DIRTY_NODES | DIRTY_VIEW)
    }, wait)
  }
  const readingKey = (): string | null => {
    perf.hitTests++
    const line = scrollport.getBoundingClientRect().top + Math.min(120, scrollport.clientHeight * .18)
    const flowRect = flow.getBoundingClientRect()
    const hitTest = document.elementsFromPoint?.bind(document)
    if (typeof hitTest === 'function' && flowRect.width > 0) {
      const xs = [Math.min(flowRect.right - 1, flowRect.left + 18), flowRect.left + flowRect.width / 2]
      const ys = [line, line - 8, line + 8]
      for (const y of ys) for (const x of xs) {
        for (const element of hitTest(x, y)) {
          const row = (element as HTMLElement).closest<HTMLElement>('[data-chat-anchor-key]')
          if (row === null || !flow.contains(row) || row.closest('[hidden]') !== null) continue
          const anchor = row.dataset.chatAnchorKey
          if (anchor === undefined) continue
          const key = firstItemByAnchor.get(anchor)
          if (key !== undefined) return key
        }
      }
    }
    return nativeActiveTurn === null ? null : itemByKey.has(`turn:${nativeActiveTurn}`) ? `turn:${nativeActiveTurn}` : null
  }
  const rebuildItemIndex = (): void => {
    itemByKey = new Map()
    itemIndexByKey = new Map()
    firstItemByAnchor = new Map()
    items.forEach((item, index) => {
      itemByKey.set(item.key, item)
      itemIndexByKey.set(item.key, index)
      if (item.anchorKey !== null && !firstItemByAnchor.has(item.anchorKey)) firstItemByAnchor.set(item.anchorKey, item.key)
    })
  }
  const render = (pending: number): void => {
    perf.renders++
    if ((pending & DIRTY_TURNS) !== 0) {
      const snapshot = binding === undefined ? undefined : ctx.uiConversation.binding(binding).target('chat').getSnapshot()
      const loaded = snapshot?.navigation.items() ?? []
      const outline = binding?.session.projections.faceOf('turnOutline').getSnapshot()
      turns = mergeNavigationTurns(loaded, outline)
      perf.turnRebuilds++
    }
    if ((pending & DIRTY_NODES) !== 0) {
      segments = buildNavigationNodes(nodes)
      perf.nodeRebuilds++
    }
    if ((pending & (DIRTY_DOM | DIRTY_TURNS)) !== 0) {
      nativeReady = owner.reconcile(turns)
      if ((pending & DIRTY_DOM) !== 0) landing.refresh()
      perf.domReconciles++
    }
    if ((pending & (DIRTY_NODES | DIRTY_TURNS | DIRTY_DOM)) !== 0) {
      const availableSegments = segments.filter(segment => owner.rowFor(segment.anchorKey) !== null
        || ((segment.kind === 'question' || segment.kind === 'answer') && landing.canReveal(segment.anchorKey)))
      items = buildPianoItems(turns, availableSegments, turn => copy('turn', turn))
      rebuildItemIndex()
      debug.total = items.length
    }
    if ((pending & (DIRTY_NATIVE_STATE | DIRTY_DOM | DIRTY_TURNS)) !== 0) {
      busyTurn = owner.busy()
      nativeActiveTurn = owner.active()
    }
    if ((pending & DIRTY_LAYOUT) !== 0 || width === 0) {
      const rootRect = root.getBoundingClientRect()
      flowLeft = flow.getBoundingClientRect().left - rootRect.left
      width = root.clientWidth || rootRect.width
      left = Math.max(16, flowLeft - 108)
      const config = settings.getSnapshot()
      const available = Math.max(0, scrollport.clientHeight - (scrollport.querySelector<HTMLElement>('[data-composer-seat]')?.offsetHeight ?? 0))
      height = Math.min(railHeight(config), Math.max(config.keyHeight, available - 48))
      capacity = Math.min(config.maxVisible, Math.max(1, Math.floor((height - config.keyHeight) / config.keyGap) + 1))
      top = Math.max(8, (scrollport.getBoundingClientRect().top - rootRect.top) + (available - height) / 2)
      stripViewportTop = rootRect.top + top
    }
    if (!nativeReady || items.length === 0 || width < 520 || left + 70 > flowLeft) {
      fallback(!nativeReady ? 'contract' : items.length === 0 ? 'empty' : width < 520 ? 'narrow' : 'overlap')
      return
    }
    const config = settings.getSnapshot()
    const loadedBusy = binding?.session.getSnapshot().loadingOlder ?? false
    if (requestedTurn !== null && busyTurn === null && !loadedBusy) {
      const destination = turns.find(turn => turn.turn === requestedTurn)
      failedTurn = destination?.anchor.kind === 'unloaded' ? requestedTurn : null
      requestedTurn = null
    }
    active = readingKey() ?? `turn:${nativeActiveTurn ?? turns.at(-1)?.turn}`
    if (selected !== null && !itemByKey.has(selected)) selected = null
    const centerKey = selected !== null && (document.activeElement === strip || pointerInside || busyTurn !== null) ? selected : active
    const center = Math.max(0, centerKey === null ? 0 : itemIndexByKey.get(centerKey) ?? 0)
    const manual = browseStart === null ? -1 : itemIndexByKey.get(browseStart) ?? -1
    windowStart = manual < 0 ? visibleWindow(items.length, center, capacity).start
      : Math.max(0, Math.min(items.length - capacity, manual))
    visibleItems = items.slice(windowStart, windowStart + capacity)
    strip.style.top = `${top}px`
    strip.style.transform = 'none'
    strip.style.left = `${left}px`
    strip.style.height = `${height}px`
    visiblePositions = stackPositions(visibleItems.length, height, config.keyGap, config.keyHeight)
    const retained = new Set(visibleItems.map(item => item.key))
    for (const [key, button] of buttons) if (!retained.has(key)) { button.remove(); buttons.delete(key) }
    const focusIndex = visibleItems.findIndex(item => item.key === selected)
    visibleItems.forEach((item, index) => {
      let button = buttons.get(item.key)
      if (button === undefined) {
        button = document.createElement('button')
        button.type = 'button'; button.tabIndex = -1; button.className = 'smcp-bar'
        button.dataset.key = item.key
        button.id = prefix + encodeURIComponent(item.key)
        buttons.set(item.key, button); strip.append(button)
      }
      button.dataset.turn = String(item.turn)
      button.dataset.role = item.role
      button.dataset.kind = item.kind ?? 'turn'
      button.dataset.unloaded = String(item.anchorKey === null)
      button.setAttribute('aria-label', `${copy('turn', item.turn)} · ${semanticLabel(item, config.language)}: ${item.title}`)
      button.setAttribute('aria-current', String(item.key === active))
      button.setAttribute('aria-busy', String(item.turn === busyTurn))
      button.classList.toggle('smcp-bar-current', item.key === active)
      button.classList.toggle('smcp-bar-hover', item.key === selected)
      button.style.top = `${visiblePositions[index] - config.keyHeight / 2}px`
      button.style.height = `${config.keyHeight}px`
      const base = item.key === active ? 24 : 10
      const wave = focusIndex < 0 ? 0 : Math.exp(-((index - focusIndex) ** 2) / (2 * 1.35 ** 2))
      button.style.width = `${base + (48 - base) * wave}px`
    })
    const focused = focusIndex < 0 ? undefined : visibleItems[focusIndex]
    if (focused !== undefined) {
      const previewChanged = tooltipKey !== focused.key
      const contentChanged = previewChanged || (pending & (DIRTY_NODES | DIRTY_TURNS)) !== 0
      if (contentChanged) {
        tooltipKey = focused.key
        badge.textContent = semanticLabel(focused, config.language)
        title.textContent = focused.title
        body.textContent = focused.preview
      }
      if (previewChanged || (pending & DIRTY_LAYOUT) !== 0) {
        tooltip.style.left = `${Math.max(8, Math.min(left + 64, width - (tooltip.offsetWidth || 400) - 8))}px`
        tooltip.style.top = `${Math.max(8, Math.min(top + visiblePositions[focusIndex] - 48, root.clientHeight - (tooltip.offsetHeight || 150) - 8))}px`
      }
      tooltip.classList.add('smcp-tooltip-visible')
      strip.setAttribute('aria-activedescendant', buttons.get(focused.key)!.id)
      strip.setAttribute('aria-describedby', tooltip.id)
    } else {
      closePreview(); strip.removeAttribute('aria-activedescendant')
    }
    status.textContent = localFailure ? landingFailure(config.language)
      : busyTurn !== null ? copy('loading', busyTurn) : failedTurn !== null ? copy('failed', failedTurn) : ''
    strip.hidden = false; owner.claim()
    debug.mode = 'piano'; debug.hiddenReason = null; debug.bars = visibleItems.length; debug.windowStart = windowStart
  }
  const bind = (): void => {
    const id = ctx.sessions.list.getSnapshot().current
    const next = id === undefined ? undefined : ctx.sessions.binding(id)
    if (next === binding && sourceStop !== undefined) return
    sourceStop?.(); sourceStop = undefined
    clearStreamRefresh()
    // Retire any native delayed landing while the old binding still owns the
    // real TurnNavigator. Relying on the outgoing ChatView to unmount first is
    // timing-sensitive when sessions switch during an in-flight history load.
    owner.cancel()
    fallback('binding')
    binding = next; nodes = []; selected = active = browseStart = null
    requestedTurn = failedTurn = null; localFailure = false
    debug.sessionId = id === undefined ? undefined : String(id)
    if (retry !== undefined) clearTimeout(retry)
    retry = undefined
    if (next === undefined) {
      turns = []; segments = []; items = []
      itemByKey.clear(); itemIndexByKey.clear(); firstItemByAnchor.clear()
      for (const button of buttons.values()) button.remove()
      buttons.clear()
      if (id !== undefined && retries++ < 20) retry = setTimeout(() => { retry = undefined; bind() }, 300)
      schedule(DIRTY_ALL); return
    }
    retries = 0
    const target = ctx.uiConversation.binding(next).target('chat')
    const stops: (() => void)[] = []
    try {
      stops.push(observeChatNodes(target, (value, change) => {
        if (!alive || binding !== next) return
        nodes = value
        if (change === 'keyed') {
          scheduleKeyedSemantic()
          return
        }
        clearStreamRefresh()
        lastStreamSemanticAt = window.performance.now()
        schedule(DIRTY_NODES | DIRTY_TURNS | DIRTY_DOM | DIRTY_LAYOUT | DIRTY_NATIVE_STATE | DIRTY_VIEW)
      }))
      stops.push(next.session.projections.faceOf('turnOutline').subscribe(() => schedule(DIRTY_TURNS | DIRTY_NATIVE_STATE | DIRTY_VIEW)))
      stops.push(next.session.subscribe(() => schedule(DIRTY_NATIVE_STATE | DIRTY_VIEW)))
      sourceStop = () => { for (const dispose of stops) dispose() }
    } catch (error) {
      for (const dispose of stops.reverse()) dispose()
      throw error
    }
    schedule(DIRTY_ALL)
  }
  const activate = (item: PianoItem | undefined): void => {
    if (item === undefined || !nativeReady || strip.hidden) return
    const ticket = ++activation
    failedTurn = null; localFailure = false
    requestedTurn = item.anchorKey === null ? item.turn : null
    selected = item.key; active = item.key; browseStart = null
    strip.focus({ preventScroll: true })
    void landing.navigate(item).then(ok => {
      if (!alive || ticket !== activation || ok === undefined) return
      if (!ok) { requestedTurn = null; localFailure = true }
      schedule()
    })
    schedule()
  }
  const nearest = (clientY: number): PianoItem | undefined => {
    if (visibleItems.length === 0) return undefined
    let best = 0
    const y = clientY - stripViewportTop
    for (let i = 1; i < visiblePositions.length; i++) {
      if (Math.abs(visiblePositions[i] - y) < Math.abs(visiblePositions[best] - y)) best = i
    }
    return visibleItems[best]
  }
  const pointerMove = (event: PointerEvent): void => {
    const next = nearest(event.clientY)?.key ?? null
    const changed = !pointerInside || next !== selected
    pointerInside = true
    browseStart ??= items[windowStart]?.key ?? null
    if (!changed) return
    selected = next
    schedule(DIRTY_VIEW)
  }
  const pointerLeave = (): void => { pointerInside = false; selected = null; browseStart = null; schedule(DIRTY_VIEW) }
  const click = (event: MouseEvent): void => {
    const key = (event.target as HTMLElement).closest<HTMLElement>('[data-key]')?.dataset.key
    activate(key === undefined ? nearest(event.clientY) : itemByKey.get(key))
  }
  const wheel = (event: WheelEvent): void => {
    if (event.deltaY === 0 || items.length === 0) return
    event.preventDefault()
    const index = Math.max(0, Math.min(items.length - Math.max(1, visibleItems.length), windowStart + Math.sign(event.deltaY) * 3))
    browseStart = items[index]?.key ?? null; selected = null; schedule(DIRTY_VIEW)
  }
  const cancelLocal = (): void => {
    activation++; landing.cancel()
    requestedTurn = failedTurn = null; localFailure = false; schedule(DIRTY_NATIVE_STATE | DIRTY_VIEW)
  }
  const cancel = (): void => { cancelLocal(); owner.cancel() }
  const keydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') { event.preventDefault(); cancel(); selected = null; browseStart = null; return }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault(); activate(itemByKey.get(selected ?? active ?? '') ?? items[windowStart]); return
    }
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) return
    event.preventDefault()
    const index = Math.max(0, itemIndexByKey.get(selected ?? active ?? '') ?? 0)
    const page = Math.max(1, visibleItems.length)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : Math.max(0, Math.min(items.length - 1, index + (event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : event.key === 'PageUp' ? -page : page)))
    selected = items[next]?.key ?? null
    browseStart = items[visibleWindow(items.length, next, page).start]?.key ?? null
    schedule(DIRTY_VIEW)
  }
  const readerKey = (event: KeyboardEvent): void => {
    if ((event.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]') !== null) return
    if (['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', ' '].includes(event.key)) cancel()
  }
  const readerPointer = (event: Event): void => {
    // NativeNavigation already handles pointerdown once, including touch.
    // This listener only retires the short local disclosure transaction.
    if ((event.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]') === null) cancelLocal()
  }
  const onScroll = (): void => {
    if (!pointerInside && document.activeElement !== strip) browseStart = null
    schedule(DIRTY_VIEW)
  }
  const touchesAnchor = (node: Node): boolean => node instanceof Element
    && (node.matches('[data-chat-anchor-key]') || node.querySelector('[data-chat-anchor-key]') !== null)
  const childListChangesNavigation = (record: MutationRecord): boolean => {
    const target = record.target instanceof Element ? record.target : record.target.parentElement
    if (target?.closest('nav,[role="navigation"]') !== null && !flow.contains(target)) return true
    for (const node of record.addedNodes) if (touchesAnchor(node)) return true
    for (const node of record.removedNodes) if (touchesAnchor(node)) return true
    return false
  }
  const dom = new MutationObserver(records => {
    let flags = 0
    for (const record of records) {
      if (record.type === 'childList') {
        if (childListChangesNavigation(record)) flags |= DIRTY_DOM | DIRTY_VIEW
        continue
      }
      if (record.attributeName === 'hidden' || record.attributeName === 'aria-label') flags |= DIRTY_DOM | DIRTY_VIEW
      else if (record.attributeName === 'aria-current' || record.attributeName === 'aria-busy') flags |= DIRTY_NATIVE_STATE | DIRTY_VIEW
    }
    if (flags !== 0) schedule(flags)
  })
  dom.observe(local, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'aria-label', 'aria-current', 'aria-busy'] })
  const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => schedule(DIRTY_LAYOUT | DIRTY_VIEW))
  resize?.observe(root); resize?.observe(flow); resize?.observe(scrollport)
  strip.addEventListener('pointermove', pointerMove); strip.addEventListener('pointerleave', pointerLeave)
  strip.addEventListener('click', click); strip.addEventListener('wheel', wheel, { passive: false }); strip.addEventListener('keydown', keydown)
  scrollport.addEventListener('scroll', onScroll, { passive: true }); scrollport.addEventListener('wheel', cancel, { passive: true })
  scrollport.addEventListener('touchstart', readerPointer, { passive: true }); scrollport.addEventListener('pointerdown', readerPointer, { passive: true })
  scrollport.addEventListener('keydown', readerKey)
  const listStop = ctx.sessions.list.subscribe(() => { retries = 0; bind() })
  const settingsStop = settings.subscribe(() => schedule(DIRTY_NODES | DIRTY_TURNS | DIRTY_LAYOUT | DIRTY_VIEW))
  const dispose = (): void => {
    if (!alive) return
    alive = false; activation++; landing.cancel()
    if (binding?.session.sessionId === ctx.sessions.list.getSnapshot().current) owner.cancel()
    owner.release(); sourceStop?.(); listStop(); settingsStop(); dom.disconnect(); resize?.disconnect()
    if (retry !== undefined) clearTimeout(retry)
    clearStreamRefresh()
    if (frame !== 0) window.cancelAnimationFrame(frame)
    scrollport.removeEventListener('scroll', onScroll); scrollport.removeEventListener('wheel', cancel)
    scrollport.removeEventListener('touchstart', readerPointer); scrollport.removeEventListener('pointerdown', readerPointer)
    scrollport.removeEventListener('keydown', readerKey)
    strip.remove(); tooltip.remove(); style.remove()
    if (forcedPosition && root.style.position === 'relative') root.style.position = originalPosition
    if (debugHost.__smcpDebug === debug) delete debugHost.__smcpDebug
  }
  try { bind() } catch (error) { dispose(); throw error }
  return dispose
}
