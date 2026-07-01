import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type JSX,
  type ReactNode
} from 'react'
import { useFocusTrap } from '../hooks/useFocusTrap'
import './BugReportModal.css'

/**
 * IN-APP BUG REPORTING (issue #206).
 *
 * The Report Bug icon on the activity bar opens this modal. The user gives the
 * bug a title + description (and optionally an email + a screenshot), and it's
 * POSTed to kevsrobots.com's feedback API from the main process, tagged
 * `_SNAKIE_`. Modelled on {@link ./PromptModal} (context + `useFocusTrap` +
 * backdrop + Escape-to-close).
 *
 * The "Attach a screenshot" button hides the modal for one frame before
 * capturing, so the shot shows the app the user is reporting on — not this form.
 */

type OpenBugReport = () => void
const BugReportContext = createContext<OpenBugReport | null>(null)

const DESC_PLACEHOLDER = 'What were you trying to do, and what actually happened?'
const MIN_TITLE = 3
const MIN_DESC = 10

interface Status {
  kind: 'error' | 'ok'
  text: string
}

export function BugReportProvider({ children }: { children: ReactNode }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [email, setEmail] = useState('')
  const [shot, setShot] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [status, setStatus] = useState<Status | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const dialogRef = useFocusTrap<HTMLDivElement>(open)

  const openBugReport = useCallback<OpenBugReport>(() => {
    setTitle('')
    setDescription('')
    setEmail('')
    setShot(null)
    setStatus(null)
    setBusy(false)
    setCapturing(false)
    setOpen(true)
  }, [])

  useEffect(() => {
    if (open) titleRef.current?.focus()
  }, [open])

  const close = useCallback((): void => {
    if (!busy) setOpen(false)
  }, [busy])

  // Hide the modal for a couple of frames, capture the app behind it, then show
  // the preview — so the screenshot is of the app, not this dialog.
  const capture = useCallback(async (): Promise<void> => {
    setCapturing(true)
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    try {
      const url = await window.api.captureScreenshot()
      if (url) setShot(url)
    } catch {
      // ignore — screenshots are optional
    } finally {
      setCapturing(false)
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
      window.setTimeout(() => setOpen(false), 1200)
    } else {
      setStatus({ kind: 'error', text: res.error ?? 'Something went wrong sending your report.' })
    }
  }, [busy, title, description, email, shot])

  return (
    <BugReportContext.Provider value={openBugReport}>
      {children}
      {open && (
        <div
          className="bugreport-overlay"
          style={capturing ? { display: 'none' } : undefined}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) close()
          }}
        >
          <div
            className="bugreport-modal"
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Report a bug"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                close()
              }
            }}
          >
            <h2 className="bugreport-modal__title">Report a bug</h2>

            <label className="bugreport-modal__field">
              <span className="bugreport-modal__label">Title</span>
              <input
                ref={titleRef}
                type="text"
                className="bugreport-modal__input"
                value={title}
                maxLength={120}
                placeholder="A short summary of the problem"
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>

            <label className="bugreport-modal__field">
              <span className="bugreport-modal__label">What happened?</span>
              <textarea
                className="bugreport-modal__textarea"
                value={description}
                rows={5}
                maxLength={1800}
                placeholder={DESC_PLACEHOLDER}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>

            <label className="bugreport-modal__field">
              <span className="bugreport-modal__label">
                Email <em>(optional)</em>
              </span>
              <input
                type="email"
                className="bugreport-modal__input"
                value={email}
                maxLength={320}
                placeholder="Email (optional, if you'd like a reply)"
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>

            <div className="bugreport-modal__shot">
              {shot ? (
                <div className="bugreport-modal__preview">
                  <img src={shot} alt="Attached screenshot" />
                  <button
                    type="button"
                    className="bugreport-modal__remove"
                    aria-label="Remove screenshot"
                    onClick={() => setShot(null)}
                  >
                    ×
                  </button>
                </div>
              ) : (
                <button type="button" className="btn btn--ghost" onClick={capture}>
                  Attach a screenshot
                </button>
              )}
            </div>

            {status && (
              <p
                className={`bugreport-modal__status bugreport-modal__status--${status.kind}`}
                role="status"
              >
                {status.text}
              </p>
            )}

            <div className="bugreport-modal__actions">
              <button type="button" className="btn btn--ghost" onClick={close} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="btn btn--primary" onClick={submit} disabled={busy}>
                {busy ? 'Sending…' : 'Send report'}
              </button>
            </div>
          </div>
        </div>
      )}
    </BugReportContext.Provider>
  )
}

/** Open the bug-report modal. Must be used within {@link BugReportProvider}. */
export function useBugReport(): OpenBugReport {
  const ctx = useContext(BugReportContext)
  if (!ctx) throw new Error('useBugReport must be used within a BugReportProvider')
  return ctx
}
