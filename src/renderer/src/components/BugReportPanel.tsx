import { useCallback, useState, type JSX } from 'react'
import './BugReportPanel.css'

/**
 * IN-APP BUG REPORTING (issue #206) — a NON-MODAL left-sidebar panel.
 *
 * As a docked left view (like Files / Source Control) the editor, shell and
 * console stay fully interactive — so you can paste console/REPL output or code
 * straight into the description while the form is open.
 *
 * The optional screenshot is captured with `webContents.capturePage()`, so it is
 * ONLY the Snakie window — never the whole desktop or other apps. A thumbnail of
 * the captured image is shown so the user can see (and remove) what will be sent.
 *
 * Because the report (screenshot + pasted text/code) is sent to an external
 * service, a REQUIRED confirmation checkbox makes clear it's the user's
 * responsibility to ensure it contains no personal/sensitive information; Send is
 * disabled until it's ticked.
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
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status | null>(null)

  const capture = useCallback(async (): Promise<void> => {
    try {
      // Captures the Snakie window's web contents only — not the OS desktop.
      const url = await window.api.captureScreenshot()
      if (url) setShot(url)
    } catch {
      // screenshots are optional — ignore capture failures
    }
  }, [])

  const detailed = title.trim().length >= MIN_TITLE && description.trim().length >= MIN_DESC
  const canSend = agreed && detailed && !busy

  const submit = useCallback(async (): Promise<void> => {
    if (busy) return
    if (!detailed) {
      setStatus({ kind: 'error', text: 'Add a title and a bit more detail (at least a sentence).' })
      return
    }
    if (!agreed) {
      setStatus({
        kind: 'error',
        text: 'Please tick the confirmation that the report has no personal information.'
      })
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
      setAgreed(false)
    } else {
      setStatus({ kind: 'error', text: res.error ?? 'Something went wrong sending your report.' })
    }
  }, [busy, detailed, agreed, title, description, email, shot])

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

      <div className="bugpanel__field">
        <span className="bugpanel__label">
          Screenshot <em>(optional)</em>
        </span>
        {shot ? (
          <div className="bugpanel__preview">
            <img
              className="bugpanel__thumb"
              src={shot}
              alt="Thumbnail of the attached screenshot of the Snakie window"
            />
            <div className="bugpanel__preview-meta">
              <span className="bugpanel__preview-ok">✓ Snakie window captured</span>
              <span className="bugpanel__preview-actions">
                <button type="button" className="bugpanel__linkbtn" onClick={() => void capture()}>
                  Retake
                </button>
                <button type="button" className="bugpanel__linkbtn" onClick={() => setShot(null)}>
                  Remove
                </button>
              </span>
            </div>
          </div>
        ) : (
          <>
            <button type="button" className="btn btn--ghost" onClick={() => void capture()}>
              Attach a screenshot
            </button>
            <span className="bugpanel__hint">
              Captures the Snakie window only — never your whole screen or other apps.
            </span>
          </>
        )}
      </div>

      {/* Required confirmation: the report leaves the app, so the user must
          acknowledge responsibility for not including personal information. */}
      <label className="bugpanel__disclaimer">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
        />
        <span>
          I have reviewed the screenshot and any pasted text or code and confirm they contain{' '}
          <strong>no personal or sensitive information</strong>. What I share is my responsibility.
        </span>
      </label>

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
          disabled={!canSend}
          title={!agreed ? 'Tick the confirmation to send' : undefined}
        >
          {busy ? 'Sending…' : 'Send report'}
        </button>
      </div>
    </div>
  )
}
