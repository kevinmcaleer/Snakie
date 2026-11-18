import { useCallback, useEffect, useState } from 'react'
import './GitPublishDialog.css'
import './SendToKevsrobotsDialog.css'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { githubWebUrl, type KrProject, type KrSent, type KrStatus } from '../../../shared/kevsrobots-account'

/**
 * SEND TO KEVSROBOTS (#1310, kevsrobots.com#582)
 * ==============================================
 *
 * From the wiring canvas: send the wiring diagram (with its parts) and the
 * project's GitHub link to one of your kevsrobots projects. Sending again
 * updates the same wiring there; nothing is copied twice.
 *
 * This is the ONLY place Snakie asks you to sign in, and it is optional: close
 * the dialog and Snakie carries on exactly as before. Code is never sent;
 * kevsrobots links to it on GitHub instead.
 *
 * Shares the Publish to GitHub dialog's styles (`gh-pub__*`), so the two
 * hand-offs look alike in both skins.
 */

const LAST_PROJECT_KEY = 'snakie.kevsrobots.lastProject'
const NEW_PROJECT_URL = 'https://www.kevsrobots.com/projects/hub'

interface SendToKevsrobotsDialogProps {
  /** The RobotDefinition on the canvas. */
  robot: unknown
  /** The wiring picture as an SVG string, or null when it couldn't be drawn. */
  svg: string | null
  onClose: () => void
}

type Phase = 'loading' | 'signed-out' | 'ready' | 'sent'

function readLastProject(): number | null {
  try {
    const n = Number(localStorage.getItem(LAST_PROJECT_KEY))
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

export function SendToKevsrobotsDialog({ robot, svg, onClose }: SendToKevsrobotsDialogProps): JSX.Element {
  const api = window.api.kevsrobots
  const [phase, setPhase] = useState<Phase>('loading')
  const [status, setStatus] = useState<KrStatus>({ signedIn: false })
  const [projects, setProjects] = useState<KrProject[]>([])
  const [projectId, setProjectId] = useState<number | null>(readLastProject())
  const [repoUrl, setRepoUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<KrSent | null>(null)
  const dialogRef = useFocusTrap<HTMLDivElement>(true)

  const loadProjects = useCallback(async (): Promise<void> => {
    const res = await api.listProjects()
    if (!res.ok) {
      if (res.signedOut) setPhase('signed-out')
      setError(res.error)
      return
    }
    setProjects(res.value)
    setProjectId((current) =>
      res.value.some((p) => p.id === current) ? current : (res.value[0]?.id ?? null)
    )
    setPhase('ready')
  }, [api])

  useEffect(() => {
    let alive = true
    void (async () => {
      // The GitHub link comes from the folder's git remote, when there is one (desktop).
      const remote = await window.api.git?.originUrl?.().catch(() => null)
      if (alive) setRepoUrl((current) => current || githubWebUrl(remote) || '')
      const s = await api.status()
      if (!alive) return
      setStatus(s)
      if (s.signedIn) await loadProjects()
      else setPhase('signed-out')
    })()
    return () => {
      alive = false
    }
  }, [api, loadProjects])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const signIn = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const res = await api.signIn()
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setStatus(res.value)
    setPhase('loading')
    await loadProjects()
  }

  const signOut = async (): Promise<void> => {
    setBusy(true)
    await api.signOut()
    setBusy(false)
    setStatus({ signedIn: false })
    setProjects([])
    setError(null)
    setPhase('signed-out')
  }

  const repo = repoUrl.trim()
  const repoOk = !repo || githubWebUrl(repo) !== null

  const send = async (): Promise<void> => {
    if (projectId == null || !repoOk) return
    setBusy(true)
    setError(null)
    const res = await api.sendWiring({
      projectId,
      robot,
      svg: svg ?? undefined,
      repoUrl: repo ? (githubWebUrl(repo) ?? undefined) : undefined
    })
    setBusy(false)
    if (!res.ok) {
      if (res.signedOut) setPhase('signed-out')
      setError(res.error)
      return
    }
    try {
      localStorage.setItem(LAST_PROJECT_KEY, String(projectId))
    } catch {
      // storage blocked: just don't remember
    }
    setSent(res.value)
    setPhase('sent')
  }

  const who = status.user ? status.user.name || status.user.username : null

  return (
    <div className="gh-pub__overlay" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div
        ref={dialogRef}
        className="gh-pub"
        role="dialog"
        aria-modal="true"
        aria-labelledby="kr-send-title"
      >
        <h2 className="gh-pub__title" id="kr-send-title">
          Send to kevsrobots
        </h2>

        {phase === 'loading' && <p className="gh-pub__note">Checking your kevsrobots account…</p>}

        {phase === 'signed-out' && (
          <>
            <p className="gh-pub__note">
              Put this wiring diagram and its parts list in one of your kevsrobots projects. Sign in with your
              kevsrobots account to choose the project.
            </p>
            <p className="gh-pub__help">
              Signing in is only for sending. Snakie never sends your code: your project links to it on GitHub.
            </p>
            {error && <p className="gh-pub__error" role="alert">{error}</p>}
            <div className="gh-pub__actions">
              <button type="button" className="gh-pub__btn" onClick={onClose} disabled={busy}>
                Not now
              </button>
              <button type="button" className="gh-pub__btn gh-pub__btn--primary" onClick={() => void signIn()} disabled={busy}>
                {busy ? 'Waiting for kevsrobots…' : 'Sign in with kevsrobots'}
              </button>
            </div>
          </>
        )}

        {phase === 'ready' && (
          <>
            <p className="gh-pub__note">
              {who ? (
                <>
                  Signed in as <strong>{who}</strong>.{' '}
                </>
              ) : null}
              <button type="button" className="kr-send__link" onClick={() => void signOut()} disabled={busy}>
                Sign out
              </button>
            </p>

            {projects.length === 0 ? (
              <p className="gh-pub__warn">
                You don&apos;t have a kevsrobots project yet.{' '}
                <button type="button" className="kr-send__link" onClick={() => void window.api.openExternal(NEW_PROJECT_URL)}>
                  Start one on kevsrobots.com
                </button>
                , then come back and send.
              </p>
            ) : (
              <>
                <label className="gh-pub__label" htmlFor="kr-send-project">
                  Project
                </label>
                <select
                  id="kr-send-project"
                  className="gh-pub__input"
                  value={projectId ?? ''}
                  disabled={busy}
                  onChange={(e) => setProjectId(Number(e.target.value))}
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
                <p className="gh-pub__help">
                  The wiring replaces what that project has, so sending again updates it. Visitors see it once you
                  publish the project on kevsrobots.com.
                </p>

                <label className="gh-pub__label" htmlFor="kr-send-repo">
                  Code on GitHub <span className="gh-pub__optional">(optional)</span>
                </label>
                <input
                  id="kr-send-repo"
                  className="gh-pub__input"
                  type="url"
                  value={repoUrl}
                  disabled={busy}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="https://github.com/you/robot"
                  aria-invalid={!repoOk}
                  aria-describedby="kr-send-repo-help"
                  onChange={(e) => setRepoUrl(e.target.value)}
                />
                <p className="gh-pub__help" id="kr-send-repo-help">
                  {repoOk ? (
                    'The project links to your code here. The code itself is never sent.'
                  ) : (
                    <span className="gh-pub__invalid">Use a GitHub address, like https://github.com/you/robot.</span>
                  )}
                </p>
              </>
            )}

            {!svg && (
              <p className="gh-pub__help">The picture of the wiring couldn&apos;t be drawn, so only the wiring itself is sent.</p>
            )}
            {error && <p className="gh-pub__error" role="alert">{error}</p>}
            <div className="gh-pub__actions">
              <button type="button" className="gh-pub__btn" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button
                type="button"
                className="gh-pub__btn gh-pub__btn--primary"
                onClick={() => void send()}
                disabled={busy || projectId == null || !repoOk}
              >
                {busy ? 'Sending…' : 'Send'}
              </button>
            </div>
          </>
        )}

        {phase === 'sent' && sent && (
          <>
            <p className="gh-pub__note" role="status">
              Sent to <strong>{sent.title}</strong>.{' '}
              {sent.addedWiringSection
                ? 'A Wiring section with the diagram was added to the project.'
                : 'The project’s wiring is updated.'}{' '}
              Publish the project on kevsrobots.com when you&apos;re ready for visitors to see it.
            </p>
            <div className="gh-pub__actions">
              <button type="button" className="gh-pub__btn" onClick={onClose}>
                Done
              </button>
              {sent.url && (
                <button
                  type="button"
                  className="gh-pub__btn gh-pub__btn--primary"
                  onClick={() => void window.api.openExternal(sent.url as string)}
                >
                  Open project
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
