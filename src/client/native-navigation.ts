/**
 * Version-bounded DOM adapter for DSH 0.1.5-rc.2's real TurnNavigator.
 * This is NOT an official plugin API. Validate every accessible button
 * before takeover; fail open to the native UI on contract drift.
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
    let high = orderedRows.length - 1
    let chosen: HTMLElement | null = null
    // DOM rows are transcript-ordered. Binary search limits the gap fallback
    // to O(log N) rect reads instead of rescanning every message.
    while (low <= high) {
      const middle = (low + high) >>> 1
      const row = orderedRows[middle]
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
  const api = {
    rowFor, anchorAtOrBefore, release, busy,
    /** One row scan per publication, never one scan per mark. */
    reconcile(next: readonly NavigationTurn[]): boolean {
      refreshRows()
      turns = next
      // Do not mistake an unmatched/ambiguous native landmark for the genuine
      // absence that the official single-Turn renderer normally produces.
      const surfaces = [...local?.querySelectorAll<HTMLElement>('nav,[role="navigation"]') ?? []]
        .filter(element => !flow.contains(element))
      const candidates = surfaces.filter(element => element.getAttribute('aria-label') === labels.navigation())
      const candidate = surfaces.length === 1 && candidates.length === 1 ? candidates[0] : null
      const nextButtons = new Map<number, HTMLButtonElement>()
      if (candidate !== null) {
        const all = [...candidate.querySelectorAll<HTMLButtonElement>('button')]
        const byLabel = new Map<string, HTMLButtonElement[]>()
        for (const button of all) {
          const label = button.getAttribute('aria-label') ?? ''
          const entries = byLabel.get(label) ?? []
          entries.push(button); byLabel.set(label, entries)
        }
        for (const turn of turns) {
          const matches = byLabel.get(labels.jump(turn.turn, turn.anchor.kind === 'unloaded')) ?? []
          if (matches.length !== 1 || matches[0].disabled) { release(); nav = null; buttons.clear(); return false }
          nextButtons.set(turn.turn, matches[0])
        }
        if (all.length !== turns.length) { release(); nav = null; buttons.clear(); return false }
      } else if (surfaces.length !== 0 || turns.length > 1 || turns.some(turn => turn.anchor.kind === 'unloaded')) {
        release(); nav = null; buttons.clear(); return false
      }
      if (candidate !== nav) release()
      nav = candidate
      buttons = nextButtons
      issuedUnloaded = false
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
    navigate(turn: number, anchorKey: string | null): boolean {
      if (scrollport === null || !flow.isConnected) return false
      refreshRows()
      const button = buttons.get(turn)
      const row = anchorKey === null ? null : rowFor(anchorKey)
      if (button?.isConnected) {
        if (saved === undefined) return false
        issuedUnloaded = anchorKey === null
        button.click()
      } else if (turns.length !== 1 || row === null) return false
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
      if (saved === undefined || scrollport === null || (!issuedUnloaded && busy() === null)) return
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
