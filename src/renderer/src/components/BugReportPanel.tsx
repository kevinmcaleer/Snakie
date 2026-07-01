import { useCallback, useEffect, useState, type JSX } from 'react'
import { compositeShots } from './screenshot-composite'
import { useConsole } from '../store/console'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
import './BugReportPanel.css'

/**
 * IN-APP BUG REPORTING (issue #206) — a NON-MODAL left-sidebar panel.
 *
 * As a docked left view (like Files / Source Control) the editor, shell and
 * console stay fully interactive — so you can paste console/REPL output or code
 * straight into the description while the form is open.
 *
 * The report auto-includes environment DIAGNOSTICS (Snakie version, platform, OS
 * version, connected board, date/time) so we don't have to ask, and — only if the
 * user opts in — the recent CONSOLE output (previewable in a dialog first, since
 * it may contain sensitive data). The optional screenshot captures every open
 * Snakie window (main + Board View + undocked instruments), composited into one
 * image; never the OS desktop.
 *
 * A REQUIRED confirmation checkbox makes clear it's the user's responsibility to
 * ensure nothing shared contains personal/sensitive information.
 *
 * Sent to kevsrobots.com's feedback API from the main process, tagged `_SNAKIE_`.
 */

const DESC_PLACEHOLDER =
  'What were you trying to do, and what actually happened? Paste any console/REPL output or code here.'
const MIN_TITLE = 3
const MIN_DESC = 10
/** Cap the console tail we attach (the recent output is the useful part). */
const CONSOLE_MAX = 10_000

interface Status {
  kind: 'error' | 'ok'
  text: string
}

interface Diag {
  platform: string
  arch: string
  osVersion: string
  electron: string
  snakieVersion: string
}

/** The board the user has selected (persisted by the mini board view / #52). */
function selectedBoardId(): string {
  try {
    return window.localStorage.getItem('snakie.board.id') || '(default)'
  } catch {
    return '(unknown)'
  }
}

export function BugReportPanel(): JSX.Element {
  const consoleStore = useConsole()
  const device = useDeviceStatus()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [email, setEmail] = useState('')
  const [shot, setShot] = useState<string | null>(null)
  const [shotCount, setShotCount] = useState(0)
  const [shotOpen, setShotOpen] = useState(false)
  const [includeConsole, setIncludeConsole] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [diag, setDiag] = useState<Diag | null>(null)
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status | null>(null)

  // Read the environment diagnostics once, to show what will be attached.
  useEffect(() => {
    let alive = true
    void window.api
      .diagnostics()
      .then((d) => {
        if (alive) setDiag(d)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  const capture = useCallback(async (): Promise<void> => {
    try {
      // Captures every open Snakie window (main + Board View + undocked
      // instrument windows), composited into one image — never the OS desktop
      // or other apps.
      const shots = await window.api.captureScreenshot()
      const composite = await compositeShots(shots)
      if (composite) {
        setShot(composite)
        setShotCount(shots.length)
      }
    } catch {
      // screenshots are optional — ignore capture failures
    }
  }, [])

  const connLabel =
    device.state === 'connected'
      ? `connected${device.path ? ` (${device.path})` : ''}`
      : device.state
  const consoleText = (): string => consoleStore.getAll().slice(-CONSOLE_MAX).trim()

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

    // Build the report body: the user's text + environment diagnostics + (only
    // when opted in) the recent console output. The main process prefixes
    // `_SNAKIE_` and sends it as the feedback `message`.
    const diagLines = [
      diag
        ? `Snakie ${diag.snakieVersion} · ${diag.platform} ${diag.arch} · OS ${diag.osVersion || 'unknown'} · Electron ${diag.electron}`
        : '',
      `Board: ${selectedBoardId()} · Device: ${connLabel}`,
      `Reported: ${new Date().toString()}`
    ].filter(Boolean)
    let body = `${description.trim()}\n\n--- Diagnostics ---\n${diagLines.join('\n')}`
    if (includeConsole) {
      const text = consoleStore.getAll().slice(-CONSOLE_MAX).trim()
      if (text) body += `\n\n--- Console output (included with the reporter's consent) ---\n${text}`
    }

    const res = await window.api.feedback.submitBugReport({
      title: title.trim(),
      description: body,
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
      setShotCount(0)
      setShotOpen(false)
      setIncludeConsole(false)
      setAgreed(false)
    } else {
      setStatus({ kind: 'error', text: res.error ?? 'Something went wrong sending your report.' })
    }
  }, [
    busy,
    detailed,
    agreed,
    title,
    description,
    email,
    shot,
    includeConsole,
    diag,
    connLabel,
    consoleStore
  ])

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
            <button
              type="button"
              className="bugpanel__thumb-btn"
              title="Click to enlarge and check the screenshot for anything sensitive"
              onClick={() => setShotOpen(true)}
            >
              <img
                className="bugpanel__thumb"
                src={shot}
                alt="Thumbnail of the attached screenshot — click to enlarge and review"
              />
            </button>
            <div className="bugpanel__preview-meta">
              <span className="bugpanel__preview-ok">
                ✓ {shotCount} Snakie window{shotCount === 1 ? '' : 's'} captured
              </span>
              <span className="bugpanel__preview-actions">
                <button type="button" className="bugpanel__linkbtn" onClick={() => setShotOpen(true)}>
                  Enlarge
                </button>
                <button type="button" className="bugpanel__linkbtn" onClick={() => void capture()}>
                  Retake
                </button>
                <button
                  type="button"
                  className="bugpanel__linkbtn"
                  onClick={() => {
                    setShot(null)
                    setShotCount(0)
                    setShotOpen(false)
                  }}
                >
                  Remove
                </button>
              </span>
            </div>
            <span className="bugpanel__hint">Click the image to check it full-size before sending.</span>
          </div>
        ) : (
          <>
            <button type="button" className="btn btn--ghost" onClick={() => void capture()}>
              Attach a screenshot
            </button>
            <span className="bugpanel__hint">
              Captures the Snakie windows — the main window, the Board View and any undocked
              instrument windows — never your whole screen or other apps.
            </span>
          </>
        )}
      </div>

      {/* Environment diagnostics attached automatically (no personal data). */}
      <div className="bugpanel__diag">
        <span className="bugpanel__diag-title">Automatically attached</span>
        <span className="bugpanel__diag-body">
          {diag
            ? `Snakie ${diag.snakieVersion} · ${diag.platform} ${diag.osVersion || diag.arch} · board ${selectedBoardId()} · ${connLabel} · date & time`
            : 'Snakie version, platform/OS, connected board, and date & time'}
        </span>
      </div>

      {/* Optional console output — previewable first (it may contain sensitive data). */}
      <div className="bugpanel__console">
        <label className="bugpanel__check">
          <input
            type="checkbox"
            checked={includeConsole}
            onChange={(e) => setIncludeConsole(e.target.checked)}
          />
          <span>Include recent console output</span>
        </label>
        <button type="button" className="bugpanel__linkbtn" onClick={() => setPreviewOpen(true)}>
          Preview
        </button>
      </div>

      {/* Required confirmation: the report leaves the app, so the user must
          acknowledge responsibility for not including personal information. */}
      <label className="bugpanel__disclaimer">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        <span>
          I have reviewed the screenshot, console output and any pasted text or code and confirm they
          contain <strong>no personal or sensitive information</strong>. What I share is my
          responsibility.
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

      {shotOpen && shot && (
        <div
          className="bugpanel__dialog-backdrop"
          role="presentation"
          onClick={() => setShotOpen(false)}
        >
          <div
            className="bugpanel__dialog bugpanel__dialog--image"
            role="dialog"
            aria-label="Screenshot preview"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bugpanel__dialog-head">
              <span>Screenshot — check it has nothing sensitive</span>
              <button
                type="button"
                className="bugpanel__dialog-close"
                aria-label="Close preview"
                onClick={() => setShotOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="bugpanel__dialog-imgwrap">
              <img src={shot} alt="Full screenshot that will be attached to the report" />
            </div>
            <div className="bugpanel__dialog-foot">
              <button type="button" className="btn btn--ghost" onClick={() => setShotOpen(false)}>
                Looks fine
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => {
                  setShot(null)
                  setShotCount(0)
                  setShotOpen(false)
                }}
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {previewOpen && (
        <div
          className="bugpanel__dialog-backdrop"
          role="presentation"
          onClick={() => setPreviewOpen(false)}
        >
          <div
            className="bugpanel__dialog"
            role="dialog"
            aria-label="Console output preview"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bugpanel__dialog-head">
              <span>Console output preview</span>
              <button
                type="button"
                className="bugpanel__dialog-close"
                aria-label="Close preview"
                onClick={() => setPreviewOpen(false)}
              >
                ×
              </button>
            </div>
            <pre className="bugpanel__dialog-body">{consoleText() || '(the console is empty)'}</pre>
            <div className="bugpanel__dialog-foot">
              <button type="button" className="btn btn--ghost" onClick={() => setPreviewOpen(false)}>
                Close
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => {
                  setIncludeConsole(true)
                  setPreviewOpen(false)
                }}
              >
                Include this
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
