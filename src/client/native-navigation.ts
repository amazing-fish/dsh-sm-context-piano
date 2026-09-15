/**
 * Version-bounded DOM adapter for DSH 0.1.5-rc.2's real TurnNavigator.
 * This is NOT an official plugin API. We validate every accessible button
 * before takeover and fail open to the native UI on contract drift.
 * No React internals, source patching, copied ChatView, or private RPCs.
 */
import type { NavigationTurn } from './navigation-model.ts'

export interface NativeLabels {
  navigation(): string
  jump(turn: number, unloaded: boolean): string
}
interface SavedSurface {
  nav: HTMLElement
  display: string
  priority: string
  aria: string | null
}

export function createNativeNavigation(flow: HTMLElement, labels: NativeLabels) {
  const local = flow.parentElement
  const scrollport = flow.closest<HTMLElement>('[data-conversation-scroll]') ?? local
  let nav: HTMLElement | null = null
  let saved: SavedSurface | undefined
  let buttons = new Map<number, HTMLButtonElement>()
  let turns: readonly NavigationTurn[] = []

  const release = (): void => {
    if (saved === undefined) return
    const old = saved
    saved = undefined
    // Restore only the exact element we claimed; never blanket-hide other navs.
    if (old.nav.style.getPropertyValue('display') === 'none'
      && old.nav.style.getPropertyPriority('display') === 'important') {
      if (old.display) old.nav.style.setProperty('display', old.display, old.priority)
      else old.nav.style.removeProperty('display')
    }
    if (old.nav.getAttribute('aria-hidden') === 'true') {
      if (old.aria === null) old.nav.removeAttribute('aria-hidden')
      else old.nav.setAttribute('aria-hidden', old.aria)
    }
  }

  const rowFor = (key: string): HTMLElement | null => {
    for (const row of flow.querySelectorAll<HTMLElement>('[data-chat-anchor-key]')) {
      if (row.dataset.chatAnchorKey === key && row.closest('[hidden]') === null) return row
    }
    return null
  }

  const flushReaderPosition = (): void => {
    // Native ChatView samples actual scroll and flushes on scrollend. This
    // lets an exact segment landing use that same restoration/follow ledger.
    scrollport?.dispatchEvent(new Event('scroll'))
    scrollport?.dispatchEvent(new Event('scrollend'))
  }

  return {
    rowFor,
    release,
    /** Validate both the landmark and the complete, unambiguous Turn/button mapping. */
    reconcile(next: readonly NavigationTurn[]): boolean {
      turns = next
      const candidates = [...local?.querySelectorAll<HTMLElement>('nav[aria-label]') ?? []]
        .filter(element => element.getAttribute('aria-label') === labels.navigation())
      const candidate = candidates.length === 1 ? candidates[0] : null
      const nextButtons = new Map<number, HTMLButtonElement>()
      if (candidate !== null) {
        const all = [...candidate.querySelectorAll<HTMLButtonElement>('button')]
        for (const turn of turns) {
          const matches = all.filter(button => button.getAttribute('aria-label')
            === labels.jump(turn.turn, turn.anchor.kind === 'unloaded'))
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
      saved = {
        nav, display: nav.style.getPropertyValue('display'),
        priority: nav.style.getPropertyPriority('display'), aria: nav.getAttribute('aria-hidden'),
      }
      // Keep the real React owner mounted and callable, but expose exactly
      // one visual/accessible navigation landmark. Unload restores it.
      nav.style.setProperty('display', 'none', 'important')
      nav.setAttribute('aria-hidden', 'true')
    },
    active(): number | null {
      for (const [turn, button] of buttons) if (button.getAttribute('aria-current') === 'true') return turn
      return null
    },
    busy(): number | null {
      for (const [turn, button] of buttons) if (button.getAttribute('aria-busy') === 'true') return turn
      return null
    },
    navigate(turn: number, anchorKey: string | null): boolean {
      if (scrollport === null || !flow.isConnected) return false
      const button = buttons.get(turn)
      const row = anchorKey === null ? null : rowFor(anchorKey)
      if (button?.isConnected) {
        // The native handler owns loadThrough, latest target, paging anchors,
        // bottom following, landing and restoration. Never call loadThrough here.
        button.click()
      } else if (turns.length !== 1 || row === null) return false
      if (row !== null) {
        // Native loaded-Turn activation cancels pending jumps first. Its
        // owner then observes the final segment position through its own handler.
        scrollport.scrollTop += row.getBoundingClientRect().top - scrollport.getBoundingClientRect().top - 24
        flushReaderPosition()
      }
      return true
    },
    /** Cancel landing, not network I/O: a native loaded click supersedes its pending jump. */
    cancel(): void {
      if (scrollport === null || ![...buttons.values()].some(button => button.getAttribute('aria-busy') === 'true')) return
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
        buttons.get(chosen.turn)?.click()
        scrollport.scrollTop = top
        flushReaderPosition()
      }
    },
  }
}
