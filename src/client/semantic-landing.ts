/** Local disclosure only. History paging and scroll ownership stay with ChatView. */
import type { PianoItem } from './navigation-model.ts'
import type { createNativeNavigation } from './native-navigation.ts'

type Owner = ReturnType<typeof createNativeNavigation>

export function createSemanticLanding(flow: HTMLElement, owner: Owner) {
  let generation = 0
  let abort: AbortController | undefined
  let anchors = new Map<string, HTMLElement>()
  const refresh = (): void => {
    anchors = new Map()
    for (const element of flow.querySelectorAll<HTMLElement>('[data-chat-anchor-key]')) {
      const key = element.dataset.chatAnchorKey
      if (key !== undefined) anchors.set(key, element)
    }
  }
  const rawRow = (key: string): HTMLElement | null => {
    const row = anchors.get(key)
    return row?.isConnected ? row : null
  }
  const allowedHidden = (row: HTMLElement): boolean => {
    for (let element: HTMLElement | null = row; element !== null; element = element.parentElement) {
      if (element.hasAttribute('hidden') && (element.getAttribute('hidden') !== 'until-found'
        || !flow.contains(element) || element.dataset.turnProcessHidden !== 'true')) return false
      if (element === flow) break
    }
    return flow.closest('[hidden]') === null
  }
  const cancel = (): void => { generation++; abort?.abort(); abort = undefined }
  const frame = (signal: AbortSignal): Promise<boolean> => new Promise(resolve => {
    if (signal.aborted) { resolve(false); return }
    let done = false
    let raf = 0
    let timer = 0
    const finish = (value: boolean): void => {
      if (done) return
      done = true
      window.cancelAnimationFrame(raf); window.clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      resolve(value)
    }
    const onAbort = (): void => { finish(false) }
    signal.addEventListener('abort', onAbort, { once: true })
    raf = window.requestAnimationFrame(() => { finish(true) })
    timer = window.setTimeout(() => { finish(false) }, 1500)
  })
  return {
    refresh,
    cancel,
    canReveal(key: string): boolean {
      const row = rawRow(key)
      return row !== null && allowedHidden(row)
    },
    async navigate(item: PianoItem): Promise<boolean | undefined> {
      cancel()
      const ticket = generation
      if (item.kind !== 'question' && item.kind !== 'answer') return owner.navigate(item.turn, item.anchorKey)
      if (item.anchorKey === null) return owner.navigate(item.turn, null)
      // A new local target supersedes an old history jump before disclosure.
      owner.cancel()
      const controller = new AbortController()
      abort = controller
      const valid = (): boolean => generation === ticket && !controller.signal.aborted && flow.isConnected
      try {
        refresh()
        let row = rawRow(item.anchorKey)
        if (row === null || !allowedHidden(row)) return false
        // Ask the exact native process wrapper to reveal itself via the same
        // hook used by browser Find. Never force-remove its hidden attribute.
        for (let attempt = 0; attempt < 8; attempt++) {
          if (!valid()) return undefined
          const hidden = row.closest<HTMLElement>('[hidden]')
          if (hidden === null) break
          if (hidden.getAttribute('hidden') !== 'until-found' || hidden.dataset.turnProcessHidden !== 'true') return false
          hidden.dispatchEvent(new Event('beforematch'))
          if (!await frame(controller.signal)) return valid() ? false : undefined
          refresh(); row = rawRow(item.anchorKey)
          if (row === null) return false
        }
        if (!valid()) return undefined
        if (row.closest('[hidden]') !== null) return false
        const callId = item.anchorKey.startsWith('call:') ? item.anchorKey.slice(5) : ''
        if (callId === '' || row.dataset.chatCallId !== callId) return false
        const card = [...row.querySelectorAll<HTMLElement>('[data-tool="ask_user_question"]')]
          .find(element => element.closest('[data-chat-call-id]') === row)
        if (card === undefined) return false
        const headers = [...card.querySelectorAll<HTMLElement>('[data-disclosure-row][data-expandable="true"][role="button"][aria-expanded]')]
          .filter(element => element.closest('[data-tool]') === card)
        if (headers.length !== 1) return false
        if (headers[0].getAttribute('aria-expanded') === 'false') {
          // A disclosure toggle only; no answer, approval, submit or retry action.
          headers[0].click()
          if (!await frame(controller.signal)) return valid() ? false : undefined
        }
        if (!valid()) return undefined
        refresh(); row = rawRow(item.anchorKey)
        if (row === null || row.closest('[hidden]') !== null) return false
        const currentHeader = row.querySelector<HTMLElement>('[data-tool="ask_user_question"] [data-disclosure-row][aria-expanded="true"]')
        if (currentHeader === null) return false
        return owner.navigate(item.turn, item.anchorKey)
      } catch {
        return valid() ? false : undefined
      } finally {
        if (abort === controller) abort = undefined
      }
    },
  }
}
