import { useCallback, useState, type JSX } from 'react'
import './BugReportPanel.css'

/**
 * IN-APP BUG REPORTING (issue #206) — a NON-MODAL left-sidebar panel.
 *
 * This was originally a modal, which trapped focus + dimmed the app, so a user
 * couldn't click into the editor or console/REPL to copy the error they were
 * reporting. As a docked left view (like Files / Source Control), the editor,
 * shell and console stay fully interactive — so you can paste console/REPL
 * output or code straight into the description while the form is open.
 *
 * The report is POSTed to kevsrobots.com's feedback API from the main process,
 * tagged `_SNAKIE_` (see src/main/feedback/ipc.ts).
 */

const DESC_PLACEHOLDER =
  'What were you trying to do, and what actually happened? Paste any console/REPL output or code here.'
const MIN_TITLE = 3
const MIN_DESC = 10

interface Status {
  kind: 'error' | 'ok'
  text: string
}

export function BugReportPanel(): JSX.Element {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [email, setEmail] = useState('')
  const [shot, setShot] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status | null>(null)

  const capture = useCallback(async (): Promise<void> => {
    try {
      const url = await window.api.captureScreenshot()
      if (url) setShot(url)
    } catch {
      // screenshots are optional — ignore capture failures
    }
  }, [])

  const submit = useCallback(async (): Promise<void> => {
    if (busy) return
    if (title.trim().length < MIN_TITLE || description.trim().length < MIN_DESC) {
      setStatus({ kind: 'error', text: 'Add a title and a bit more detail (at least a sentence).' })
      return
    }
    setBusy(true)
    setStatus(null)
    const res = await window.api.feedback.submitBugReport({
      title: title.trim(),
      description: description.trim(),
      email: email.trim() || undefined,
      screenshot: shot ?? undefined
    })
    setBusy(false)
    if (res.ok) {
      setStatus({ kind: 'ok', text: 'Thanks! Your bug report was sent.' })
      setTitle('')
      setDescription('')
      setEmail('')
      setShot(null)
    } else {
      setStatus({ kind: 'error', text: res.error ?? 'Something went wrong sending your report.' })
    }
  }, [busy, title, description, email, shot])

  return (
    <div className="bugpanel">
      <p className="bugpanel__intro">
        Found a problem? Describe it below. The editor and console stay open, so you can copy any
        error output straight into your report.
      </p>

      <label className="bugpanel__field">
        <span className="bugpanel__label">Title</span>
        <input
          type="text"
          className="bugpanel__input"
          value={title}
          maxLength={120}
          placeholder="A short summary of the problem"
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>

      <label className="bugpanel__field">
        <span className="bugpanel__label">What happened?</span>
        <textarea
          className="bugpanel__textarea"
          value={description}
          rows={8}
          maxLength={1800}
          placeholder={DESC_PLACEHOLDER}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>

      <label className="bugpanel__field">
        <span className="bugpanel__label">
          Email <em>(optional)</em>
        </span>
        <input
          type="email"
          className="bugpanel__input"
          value={email}
          maxLength={320}
          placeholder="Email (optional, if you'd like a reply)"
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>

      <div className="bugpanel__shot">
        {shot ? (
          <div className="bugpanel__preview">
            <img src={shot} alt="Attached screenshot" />
            <button
              type="button"
              className="bugpanel__remove"
              aria-label="Remove screenshot"
              onClick={() => setShot(null)}
            >
              ×
            </button>
          </div>
        ) : (
          <button type="button" className="btn btn--ghost" onClick={() => void capture()}>
            Attach a screenshot
          </button>
        )}
      </div>

      {status && (
        <p className={`bugpanel__status bugpanel__status--${status.kind}`} role="status">
          {status.text}
        </p>
      )}

      <div className="bugpanel__actions">
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => void submit()}
          disabled={busy}
        >
          {busy ? 'Sending…' : 'Send report'}
        </button>
      </div>
    </div>
  )
}
