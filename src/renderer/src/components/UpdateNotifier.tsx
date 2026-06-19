import { useEffect, useState } from 'react'
import type { UpdateStatus } from '../../../preload/index.d'
import { friendlyUpdateError, RELEASES_URL } from './updateButton'
import './UpdateNotifier.css'

/**
 * Non-intrusive in-app update notifier (issue #17).
 *
 * Subscribes to `window.api.updates.onStatus` and renders a small dismissible
 * banner describing the update lifecycle: available -> downloading -> ready.
 * Because downloads are opt-in (issue #74: `autoDownload = false`), the
 * `available` banner offers a Download button (`updates.download()`); once
 * downloaded it offers a Restart button (`updates.quitAndInstall()`).
 *
 * The status-bar version slot is the primary, persistent update control; this
 * banner is a one-time, dismissible toast that mirrors the same actions so the
 * user is notified the moment an update becomes available, not only when it has
 * finished downloading.
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
  // The full raw error, shown on hover so the friendly summary stays compact
  // but the underlying detail is still recoverable (issue #90).
  let messageTitle: string | undefined

  switch (status.state) {
    case 'available':
      message = status.version
        ? `Update available (v${status.version})`
        : 'Update available'
      action = (
        <button
          type="button"
          className="update-notifier__action"
          onClick={() => {
            void window.api.updates.download()
          }}
        >
          Download
        </button>
      )
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
      // Present a clear, friendly summary instead of the raw Squirrel/
      // electron-updater string (issue #90); the full text is on hover via
      // `title`. The primary recovery is a manual download from GitHub Releases,
      // since an unsigned build can't self-install.
      message = friendlyUpdateError(status.message)
      messageTitle = status.message
      action = (
        <button
          type="button"
          className="update-notifier__action"
          onClick={() => {
            void window.api.openExternal(RELEASES_URL)
          }}
        >
          Download manually
        </button>
      )
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
      <span className="update-notifier__message" title={messageTitle}>
        {message}
      </span>
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
