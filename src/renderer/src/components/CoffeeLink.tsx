import { useEffect, useState } from 'react'
import { useLocalStorage } from '../hooks/useLocalStorage'
import './CoffeeLink.css'

/**
 * BUY ME A COFFEE (issue #126)
 * ============================
 *
 * A SUBTLE, always-present `☕` link in the status bar that opens the author's
 * Buy Me a Coffee page in the browser. On the user's FIRST launch only, a small
 * encouraging nudge pops up next to it after a couple of seconds — shown once
 * ever (persisted in localStorage), dismissible, and auto-hiding so it never
 * nags. After that it's just the quiet coffee cup.
 */

const COFFEE_URL = 'https://buymeacoffee.com/kevinmcaleer'
const NUDGE_KEY = 'snakie.coffee.nudged'
/** Delay before the first-launch nudge appears (issue #126: "after a couple of seconds"). */
const NUDGE_DELAY_MS = 2500
/** Auto-hide the nudge after this long if the user doesn't interact (the link stays). */
const NUDGE_LINGER_MS = 14000

export function CoffeeLink(): JSX.Element {
  const [nudged, setNudged] = useLocalStorage<boolean>(NUDGE_KEY, false)
  const [showNudge, setShowNudge] = useState(false)

  const openCoffee = (): void => {
    void window.api.openExternal(COFFEE_URL)
  }

  // First launch only: reveal the nudge after a beat, and mark it shown so it
  // never reappears on a later launch (encouraging, not nagging).
  useEffect(() => {
    if (nudged) return
    const id = window.setTimeout(() => {
      setShowNudge(true)
      setNudged(true)
    }, NUDGE_DELAY_MS)
    return () => window.clearTimeout(id)
  }, [nudged, setNudged])

  // Let the nudge linger briefly, then fade out on its own.
  useEffect(() => {
    if (!showNudge) return
    const id = window.setTimeout(() => setShowNudge(false), NUDGE_LINGER_MS)
    return () => window.clearTimeout(id)
  }, [showNudge])

  return (
    <div className="coffee">
      {showNudge && (
        <div className="coffee__nudge" role="dialog" aria-label="Support Snakie">
          <span className="coffee__nudge-text">Enjoying Snakie?</span>
          <button type="button" className="coffee__nudge-cta" onClick={openCoffee}>
            ☕ Buy me a coffee
          </button>
          <button
            type="button"
            className="coffee__nudge-close"
            onClick={() => setShowNudge(false)}
            aria-label="Dismiss"
            title="Dismiss"
          >
            ✕
          </button>
        </div>
      )}
      <button
        type="button"
        className="statusbar__item coffee__link"
        onClick={openCoffee}
        title="Buy me a coffee — support Snakie's development"
        aria-label="Buy me a coffee — support Snakie's development"
      >
        <span aria-hidden="true">☕</span>
      </button>
    </div>
  )
}
