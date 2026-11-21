import { useCallback, useEffect, useState } from 'react'

/** How long after start-up the notes load, so they never compete with first paint or the board connecting. */
export const WHATS_NEW_DELAY_MS = 2500

/** Raise this on `window` to open the What's new list from anywhere (Help panel, Help menu). */
export const WHATS_NEW_EVENT = 'snakie:open-whats-new'

/** Opens the What's new list. */
export function openWhatsNew(): void {
  window.dispatchEvent(new CustomEvent(WHATS_NEW_EVENT))
}

const check = (): Promise<typeof import('./check')> => import('./check')

/**
 * What's new after an update. A while after start-up it loads the release notes
 * (their own chunk) and, when some are newer than the last you saw, offers the
 * card. Opening the list or dismissing the card marks them seen, so the card
 * shows once per update. The list itself can be opened again at any time.
 */
export function useWhatsNew(delay = WHATS_NEW_DELAY_MS): {
  fresh: string[]
  card: boolean
  open: boolean
  show: () => void
  dismiss: () => void
  close: () => void
} {
  const [fresh, setFresh] = useState<string[]>([])
  const [card, setCard] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let gone = false
    const t = window.setTimeout(() => {
      check().then(
        (m) => {
          const ids = m.freshNotes()
          if (!gone && ids.length) {
            setFresh(ids)
            setCard(true)
          }
        },
        () => undefined
      )
    }, delay)
    return () => {
      gone = true
      window.clearTimeout(t)
    }
  }, [delay])

  const dismiss = useCallback(() => {
    setCard(false)
    check().then(
      (m) => m.markAllSeen(),
      () => undefined
    )
  }, [])
  const show = useCallback(() => {
    dismiss()
    setOpen(true)
  }, [dismiss])
  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    window.addEventListener(WHATS_NEW_EVENT, show)
    return () => window.removeEventListener(WHATS_NEW_EVENT, show)
  }, [show])

  return { fresh, card, open, show, dismiss, close }
}
