/**
 * Version-bounded DOM adapter for DSH's real TurnNavigator (validated on
 * 0.1.5-rc.2 and 0.1.7: the navigator slot moved from the flow's parent to
 * the [data-conversation-scroll] level in 0.1.7, and may render auxiliary
 * buttons alongside turn buttons).
 * This is NOT an official plugin API. Validate every accessible button
 * before takeover; fail open to the native UI on contract drift
 * (rejection reason surfaced on `lastReject` for diagnosis).
 * No React internals, source patching, copied ChatView, or private RPCs.
 */
import type { NavigationTurn } from './navigation-model.ts'
export interface NativeLabels {
  navigation(): string
  jump(turn: number, unloaded: boolean): string
}
interface SavedSurface { nav: HTMLElement; display: string; priority: string; aria: string | null }
export function createNativeNavigation(flow: HTMLElement, labels: NativeLabels) {
  const local = flow.parentElement
  const scrollport = flow.closest<HTMLElement>('[data-conversation-scroll]') ?? local
  let nav: HTMLElement | null = null
  let saved: SavedSurface | undefined
  let buttons = new Map<number, HTMLButtonElement>()
  let turns: readonly NavigationTurn[] = []
  let rows = new Map<string, HTMLElement>()
  let orderedRows: HTMLElement[] = []
  let mappedAnchors = new Set<string>()
  let mappedRows: HTMLElement[] = []
  // Only bridges synchronous input before the next native DOM publication.
  // Once reconciled, the native aria-busy state is the sole pending authority.
  let issuedUnloaded = false
  const readerPointer = (event: Event): void => {
    const target = event.target as HTMLElement | null
    if (target?.closest('input,textarea,select,[contenteditable="true"]') != null) return
    api.cancel()
  }
  const refreshRows = (): void => {
    rows = new Map()
    orderedRows = []
    for (const row of flow.querySelectorAll<HTMLElement>('[data-chat-anchor-key]')) {
      if (row.dataset.chatAnchorKey === undefined || row.closest('[hidden]') !== null) continue
      rows.set(row.dataset.chatAnchorKey, row)
      orderedRows.push(row)
    }
    mappedRows = orderedRows.filter(row => mappedAnchors.has(row.dataset.chatAnchorKey ?? ''))
  }
  const setMappedAnchors = (anchors: Iterable<string>): void => {
    mappedAnchors = new Set(anchors)
    mappedRows = orderedRows.filter(row => mappedAnchors.has(row.dataset.chatAnchorKey ?? ''))
  }
  const release = (): void => {
    issuedUnloaded = false
    scrollport?.removeEventListener('pointerdown', readerPointer)
    if (saved === undefined) return
    const old = saved
    saved = undefined
    if (old.nav.style.getPropertyValue('display') === 'none' && old.nav.style.getPropertyPriority('display') === 'important') {
      if (old.display) old.nav.style.setProperty('display', old.display, old.priority)
      else old.nav.style.removeProperty('display')
    }
    if (old.nav.getAttribute('aria-hidden') === 'true') {
      if (old.aria === null) old.nav.removeAttribute('aria-hidden')
      else old.nav.setAttribute('aria-hidden', old.aria)
    }
  }
  const rowFor = (key: string): HTMLElement | null => {
    const row = rows.get(key)
    return row?.isConnected && row.closest('[hidden]') === null ? row : null
  }
  const anchorAtOrBefore = (clientY: number): string | null => {
    let low = 0
    let high = mappedRows.length - 1
    let chosen: HTMLElement | null = null
    // Only rows represented in the Piano participate, so unkeyed process/control
    // anchors cannot force a fallback to the beginning of the Turn.
    while (low <= high) {
      const middle = (low + high) >>> 1
      const row = mappedRows[middle]
      if (!row.isConnected || row.closest('[hidden]') !== null) {
        refreshRows()
        return anchorAtOrBefore(clientY)
      }
      if (row.getBoundingClientRect().top <= clientY) {
        chosen = row
        low = middle + 1
      } else high = middle - 1
    }
    return chosen?.dataset.chatAnchorKey ?? null
  }
  const flushReaderPosition = (): void => {
    // Feed the original ChatView's scroll/restoration ledger after a precise
    // segment landing. Do not duplicate chatScroll or its follow state.
    scrollport?.dispatchEvent(new Event('scroll'))
    scrollport?.dispatchEvent(new Event('scrollend'))
  }
  const busy = (): number | null => {
    for (const [turn, button] of buttons) if (button.getAttribute('aria-busy') === 'true') return turn
    return null
  }
  /** Whether ANY official button is mid-load, including ones virtualized out
   *  of our partial map (Piano-issued or native-issued jumps alike). The
   *  cancellation gate must not depend on map visibility. */
  const hasNativeBusy = (): boolean => nav !== null && nav.querySelector('button[aria-busy="true"]') !== null
  const api = {
    rowFor, setMappedAnchors, anchorAtOrBefore, release, busy,
    /** Why the most recent reconcile refused takeover; null when it accepted. */
    lastReject: null as string | null,
    /** How many turns the most recent reconcile left unmapped (virtualized-out buttons); null when none. */
    lastSkip: null as string | null,
    /** One row scan per publication, never one scan per mark. */
    reconcile(next: readonly NavigationTurn[]): boolean {
      refreshRows()
      turns = next
      // DSH 0.1.7 mounts the TurnNavigator slot at the [data-conversation-scroll]
      // level (a sticky overlay beside the flow), no longer inside
      // flow.parentElement. Search the scrollport — it still contains the flow,
      // excluded below — so 0.1.5 and 0.1.7 layouts both resolve.
      const scope = scrollport ?? local
      // Do not mistake an unmatched/ambiguous native landmark for the genuine
      // absence that the official single-Turn renderer normally produces.
      const surfaces = [...scope?.querySelectorAll<HTMLElement>('nav,[role="navigation"]') ?? []]
        .filter(element => !flow.contains(element))
      const candidates = surfaces.filter(element => element.getAttribute('aria-label') === labels.navigation())
      const candidate = surfaces.length === 1 && candidates.length === 1 ? candidates[0] : null
      if (surfaces.length !== 1) api.lastReject = `surfaces:${surfaces.length}`
      else if (candidate === null) api.lastReject = 'label-mismatch'
      const nextButtons = new Map<number, HTMLButtonElement>()
      if (candidate !== null) {
        const all = [...candidate.querySelectorAll<HTMLButtonElement>('button')]
        const byLabel = new Map<string, HTMLButtonElement[]>()
        for (const button of all) {
          const label = button.getAttribute('aria-label') ?? ''
          const entries = byLabel.get(label) ?? []
          entries.push(button); byLabel.set(label, entries)
        }
        // 0.1.7's navigator virtualizes its button list: edge turns (typically
        // turn 1) enter and leave the rendered window every frame. A turn
        // whose label is genuinely absent from the surface is a transient
        // rendering-window fact, not a contract break — skip it; the next
        // reconcile re-maps the full set once the window covers it. The kind
        // is our inference too: when the official side has already (not yet)
        // loaded the turn, try the other label variant. But a button that IS
        // rendered, yet disabled without a pending load or ambiguous by
        // label, is an explicit official state and fails open — that is the
        // disabled-state contract asserted by scripts/integration.mjs.
        let skipped = 0
        for (const turn of turns) {
          const primary = byLabel.get(labels.jump(turn.turn, turn.anchor.kind === 'unloaded')) ?? []
          const alternate = byLabel.get(labels.jump(turn.turn, turn.anchor.kind !== 'unloaded')) ?? []
          let button: HTMLButtonElement | null = null
          let absent = true
          let rendered = 0
          for (const list of [primary, alternate]) {
            if (list.length === 0) continue
            absent = false
            rendered += list.length
            if (list.length === 1 && !list[0].disabled) { button = list[0]; break }
          }
          if (button !== null) { nextButtons.set(turn.turn, button); continue }
          if (absent) { skipped++; continue }
          // Rendered but unmappable. A sole mid-load button (disabled while
          // carrying aria-busy) is the transient load state of an unloaded
          // jump — skip until it settles; anything else fails open.
          const sole = rendered === 1 ? (primary[0] ?? alternate[0]) : null
          if (sole !== null && sole.getAttribute('aria-busy') === 'true') { skipped++; continue }
          api.lastReject = `button-match:turn${turn.turn}:${rendered}:${turn.anchor.kind}`
          release(); nav = null; buttons.clear(); return false
        }
        api.lastSkip = skipped === 0 ? null : `skipped:${skipped}`
        if (nextButtons.size === 0) {
          api.lastReject = `button-match:none:skipped${skipped}`
          release(); nav = null; buttons.clear(); return false
        }
        // 0.1.5 asserted all.length === turns.length; 0.1.7's navigator may
        // render auxiliary buttons. Every mapped turn already has exactly one
        // enabled match above, so surplus buttons cannot corrupt the mapping.
      } else if (surfaces.length !== 0 || turns.length > 1 || turns.some(turn => turn.anchor.kind === 'unloaded')) {
        if (api.lastReject === null) api.lastReject = `absent-nav:turns${turns.length}`
        release(); nav = null; buttons.clear(); return false
      }
      if (candidate !== nav) release()
      nav = candidate
      buttons = nextButtons
      issuedUnloaded = false
      api.lastReject = null
      return true
    },
    claim(): void {
      if (nav === null || saved?.nav === nav) return
      saved = { nav, display: nav.style.getPropertyValue('display'), priority: nav.style.getPropertyPriority('display'), aria: nav.getAttribute('aria-hidden') }
      // Keep the original React owner callable while exposing only Piano.
      nav.style.setProperty('display', 'none', 'important')
      nav.setAttribute('aria-hidden', 'true')
      // Scrollbar dragging and selecting transcript text are reader intent
      // too; these need not emit wheel, touchstart or a navigation key.
      scrollport?.addEventListener('pointerdown', readerPointer, { passive: true })
    },
    active(): number | null {
      for (const [turn, button] of buttons) if (button.getAttribute('aria-current') === 'true') return turn
      return null
    },
    /** Whether the official surface currently renders a live button for this turn
     *  (false while virtualization keeps it outside the rendered window). */
    hasButton(turn: number): boolean {
      return buttons.get(turn)?.isConnected === true
    },
    navigate(turn: number, anchorKey: string | null): boolean {
      if (scrollport === null || !flow.isConnected) return false
      refreshRows()
      const button = buttons.get(turn)
      const row = anchorKey === null ? null : rowFor(anchorKey)
      if (button?.isConnected) {
        if (saved === undefined) return false
        issuedUnloaded = anchorKey === null
        button.click()
      } else if (row === null) {
        // No official button (virtualized out) and no rendered row — the
        // unloaded-turn load action cannot run locally. Every turn with a
        // rendered row stays navigable through direct scrolling, including
        // multi-turn sessions whose edge button is momentarily absent.
        return false
      }
      if (row !== null) {
        scrollport.scrollTop += row.getBoundingClientRect().top - scrollport.getBoundingClientRect().top - 24
        flushReaderPosition()
      }
      return true
    },
    /** Cancel landing, not shared network I/O, through the native superseding action. */
    cancel(): void {
      // All input routes (wheel/touch/keyboard/pointer/dispose) share this
      // ownership gate. Native fallback must not be controlled by a hidden Piano.
      // hasNativeBusy() scans the official surface directly, so a pending load
      // stays cancellable even when its button is virtualized out of the map
      // (Piano-issued or native-issued), and settles closed once it completes.
      if (saved === undefined || scrollport === null || (!issuedUnloaded && !hasNativeBusy())) return
      refreshRows()
      const top = scrollport.scrollTop
      const line = scrollport.getBoundingClientRect().top + 24
      let chosen: { turn: number; distance: number } | undefined
      for (const turn of turns) {
        if (turn.anchor.kind !== 'loaded' || !buttons.get(turn.turn)?.isConnected) continue
        const row = rowFor(turn.anchor.key)
        if (row === null) continue
        const distance = Math.abs(row.getBoundingClientRect().top - line)
        if (chosen === undefined || distance < chosen.distance) chosen = { turn: turn.turn, distance }
      }
      if (chosen !== undefined) {
        issuedUnloaded = false
        buttons.get(chosen.turn)?.click()
        scrollport.scrollTop = top
        flushReaderPosition()
      }
    },
  }
  return api
}
