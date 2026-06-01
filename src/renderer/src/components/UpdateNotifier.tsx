import { useEffect, useState } from 'react'
import type { UpdateStatus } from '../../../preload/index.d'
import './UpdateNotifier.css'

/**
 * Non-intrusive in-app update notifier (issue #17).
 *
 * Subscribes to `window.api.updates.onStatus` and renders a small dismissible
 * banner describing the update lifecycle: available -> downloading -> ready.
 * When an update is downloaded it offers a Restart button that calls
 * `updates.quitAndInstall()`.
 *
 * Nothing renders until a status arrives, so in development / unpackaged runs
 * (where the main process never pushes a status) the banner stays hidden.
 */
export function UpdateNotifier(): JSX.Element | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const unsubscribe = window.api.updates.onStatus((next) => {
      // A fresh, more advanced status re-shows a previously dismissed banner.
      setDismissed(false)
      setStatus(next)
    })
    return unsubscribe
  }, [])

  if (!status || dismissed) return null

  // Errors are surfaced quietly; an update failing to check/download should not
  // shout at the user, so we keep it as a low-key, dismissible note.
  let message: string
  let action: JSX.Element | null = null

  switch (status.state) {
    case 'available':
      message = status.version
        ? `Update available (v${status.version}) — downloading…`
        : 'Update available — downloading…'
      break
    case 'downloading':
      message =
        typeof status.percent === 'number'
          ? `Downloading update… ${status.percent}%`
          : 'Downloading update…'
      break
    case 'downloaded':
      message = status.version
        ? `Update ready (v${status.version}) — restart to update`
        : 'Update ready — restart to update'
      action = (
        <button
          type="button"
          className="update-notifier__action"
          onClick={() => {
            void window.api.updates.quitAndInstall()
          }}
        >
          Restart
        </button>
      )
      break
    case 'error':
      message = `Update error: ${status.message ?? 'unknown error'}`
      break
    default:
      return null
  }

  return (
    <div
      className={`update-notifier update-notifier--${status.state}`}
      role="status"
      aria-live="polite"
    >
      <span className="update-notifier__message">{message}</span>
      {action}
      <button
        type="button"
        className="update-notifier__dismiss"
        aria-label="Dismiss update notification"
        onClick={() => setDismissed(true)}
      >
        ✕
      </button>
    </div>
  )
}
