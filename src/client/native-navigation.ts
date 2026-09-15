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
  let issuedUnloaded = false
  const refreshRows = (): void => {
    rows = new Map()
    for (const row of flow.querySelectorAll<HTMLElement>('[data-chat-anchor-key]')) {
      if (row.dataset.chatAnchorKey !== undefined && row.closest('[hidden]') === null) rows.set(row.dataset.chatAnchorKey, row)
    }
  }
  const release = (): void => {
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
  return {
    rowFor, release, busy,
    /** One row scan per publication, never one scan per mark. */
    reconcile(next: readonly NavigationTurn[]): boolean {
      refreshRows()
      turns = next
      const candidates = [...local?.querySelectorAll<HTMLElement>('nav[aria-label]') ?? []]
        .filter(element => element.getAttribute('aria-label') === labels.navigation())
      const candidate = candidates.length === 1 ? candidates[0] : null
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
      } else if (turns.length > 1 || turns.some(turn => turn.anchor.kind === 'unloaded')) {
        release(); nav = null; buttons.clear(); return false
      }
      if (candidate !== nav) release()
      nav = candidate
      buttons = nextButtons
      return true
    },
    claim(): void {
      if (nav === null || saved?.nav === nav) return
      saved = { nav, display: nav.style.getPropertyValue('display'), priority: nav.style.getPropertyPriority('display'), aria: nav.getAttribute('aria-hidden') }
      // Keep the original React owner callable while exposing only Piano.
      nav.style.setProperty('display', 'none', 'important')
      nav.setAttribute('aria-hidden', 'true')
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
        issuedUnloaded = anchorKey === null
        // This is the real handler; it owns loadThrough and all pending jumps.
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
      // issuedUnloaded also covers Escape before React commits aria-busy.
      if (scrollport === null || (!issuedUnloaded && busy() === null)) return
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
}
