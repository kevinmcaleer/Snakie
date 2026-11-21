import { useCallback, useEffect, useState, type JSX } from 'react'
import './GitPublishDialog.css'
import './SendToKevsrobotsDialog.css'
import './ShareProjectDialog.css'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useWorkspaceLayout } from '../store/layout'
import { announceAccountChange } from './SuiteBar'
import { IS_WEB } from '../lib/env'
import { joinPath } from '../lib/demo-project'
import { displayPath, type ProjectSummary } from '../lib/project-model'
import { hasShareCapture, shareCapture, waitForShareCapture, type ShareCaptureKind } from '../lib/share-captures'
import { dataUrlBytes, modelFiles, pageTitle, rememberProject, rememberedProject } from '../lib/share-project'
import { bettercadNewRobotUrl } from '../../../shared/links'
import { githubWebUrl, type KrFile, type KrProject, type KrStatus } from '../../../shared/kevsrobots-account'

/**
 * SHARE PROJECT — one sheet for everywhere a project can go.
 * =============================================================================
 *
 * Opened from the project menu's "Share project…". Three rows:
 *
 * - **kevsrobots**: a project page with the wiring, the parts, the robot model
 *   Build shows (URDF + STL meshes) and a cover picture of it. With no page yet
 *   the sheet makes one (a private draft). Sending again updates the same page.
 * - **BetterCAD**: keep designing the robot's parts; its URDF export comes back
 *   to Build.
 * - **GitHub**: where the code lives. kevsrobots never stores code; the page
 *   links to the repo.
 *
 * Nothing here is greyed out: a missing piece (no folder, no GitHub repo, not
 * signed in) says what to do next instead.
 */

const NEW = 'new'

interface ShareProjectDialogProps {
  /** The open project folder; null when nothing is saved to a folder yet. */
  folder: string | null
  summary: ProjectSummary | null
  onClose: () => void
  /** "Save as project…", for work not in a folder yet. */
  onSaveAsProject: () => void
}

type Phase = 'loading' | 'signed-out' | 'ready' | 'sending' | 'sent'

interface Result {
  title: string
  url: string | null
  editorUrl: string | null
  made: boolean
  lines: string[]
}

const fsx = (): { showInFolder?: (p: string) => Promise<void> } =>
  IS_WEB ? {} : (window.api.fs as unknown as { showInFolder?: (p: string) => Promise<void> })

export function ShareProjectDialog({ folder, summary, onClose, onSaveAsProject }: ShareProjectDialogProps): JSX.Element {
  const api = window.api.kevsrobots
  const { active, switchWorkspace, setActivityView } = useWorkspaceLayout()
  const dialogRef = useFocusTrap<HTMLDivElement>(true)
  const dir = folder?.replace(/[/\\]+$/, '') ?? null
  const name = summary?.name ?? 'My robot'

  const [phase, setPhase] = useState<Phase>('loading')
  const [status, setStatus] = useState<KrStatus>({ signedIn: false })
  const [projects, setProjects] = useState<KrProject[]>([])
  const [target, setTarget] = useState<string>(NEW)
  const [remote, setRemote] = useState<string | null>(null)
  const [repoUrl, setRepoUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState('')
  const [result, setResult] = useState<Result | null>(null)

  const loadProjects = useCallback(async (): Promise<void> => {
    const res = await api.listProjects()
    if (!res.ok) {
      setPhase(res.signedOut ? 'signed-out' : 'ready')
      setError(res.error)
      return
    }
    setProjects(res.value)
    const known = rememberedProject(dir)
    setTarget(known && res.value.some((p) => p.id === known) ? String(known) : NEW)
    setPhase('ready')
  }, [api, dir])

  useEffect(() => {
    let alive = true
    void (async () => {
      const origin = githubWebUrl(await window.api.git?.originUrl?.().catch(() => null))
      if (!alive) return
      setRemote(origin)
      setRepoUrl((current) => current || origin || '')
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
      if (e.key === 'Escape' && phase !== 'sending') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, onClose])

  const signIn = async (): Promise<void> => {
    setError(null)
    setPhase('loading')
    const res = await api.signIn()
    if (!res.ok) {
      setError(res.error)
      setPhase('signed-out')
      return
    }
    setStatus(res.value)
    announceAccountChange()
    await loadProjects()
  }

  const signOut = async (): Promise<void> => {
    await api.signOut()
    setStatus({ signedIn: false })
    announceAccountChange()
    setProjects([])
    setError(null)
    setPhase('signed-out')
  }

  /** A picture another workspace draws: shown for a moment if it isn't open. */
  const capture = async (kind: ShareCaptureKind, moved: { yes: boolean }): Promise<string | null> => {
    if (!hasShareCapture(kind)) {
      moved.yes = true
      switchWorkspace(kind === 'wiring' ? 'board' : 'robot')
      if (!(await waitForShareCapture(kind))) return null
    }
    let got = await shareCapture(kind)
    // Build loads its model a moment after it appears.
    for (let i = 0; !got && kind === 'cover' && i < 4; i++) {
      await new Promise((r) => setTimeout(r, 600))
      got = await shareCapture(kind)
    }
    return got
  }

  const repo = repoUrl.trim()
  const repoOk = !repo || githubWebUrl(repo) !== null
  const parts = summary?.parts ?? 0
  const model = summary?.model ?? null

  const send = async (): Promise<void> => {
    setError(null)
    if (!dir) {
      setError('Save this work as a project first, so the page and Snakie stay linked.')
      return
    }
    if (!repoOk) {
      setError('The code link must be a GitHub address, like https://github.com/you/robot.')
      return
    }
    const link = repo ? (githubWebUrl(repo) ?? undefined) : undefined
    const startedOn = active
    const moved = { yes: false }
    setPhase('sending')
    const lines: string[] = []
    try {
      // 1. The page: the chosen one, or a new private draft.
      let projectId: number
      let title: string
      let made = false
      let editorUrl: string | null = null
      if (target === NEW) {
        setStep('Making the project page…')
        if (!api.createProject) throw new Error('Update Snakie to make a new kevsrobots project from here.')
        const res = await api.createProject({ title: pageTitle(name), repoUrl: link })
        if (!res.ok) {
          if (res.signedOut) setPhase('signed-out')
          throw new Error(res.error)
        }
        projectId = res.value.id
        title = res.value.title
        editorUrl = res.value.editorUrl
        made = true
        setProjects((ps) => [res.value, ...ps])
        setTarget(String(projectId))
        rememberProject(dir, projectId)
      } else {
        projectId = Number(target)
        title = projects.find((p) => p.id === projectId)?.title ?? name
      }
      let url: string | null = null

      // 2. Wiring and parts.
      const robot = await window.api.robot.load(dir).catch(() => null)
      if (robot && ((robot.parts?.length ?? 0) > 0 || (robot.connections?.length ?? 0) > 0)) {
        setStep('Drawing the wiring…')
        const svg = await capture('wiring', moved)
        setStep('Sending the wiring and parts…')
        const res = await api.sendWiring({ projectId, robot, svg: svg ?? undefined, repoUrl: link })
        if (!res.ok) throw new Error(res.error)
        url = res.value.url
        lines.push(svg ? 'Wiring diagram and parts list' : 'Wiring and parts list (the picture couldn’t be drawn)')
      }

      // 3. The robot model and its cover.
      if (model) {
        setStep('Reading the robot model…')
        const urdfPath = joinPath(dir, model)
        const urdf = await window.api.fs.readFile(urdfPath)
        const plan = modelFiles(dir, model, urdf)
        const files: KrFile[] = []
        const missing: string[] = []
        for (const f of plan.files) {
          try {
            files.push({ name: f.name, bytes: await window.api.fs.readFileBytes(f.path) })
          } catch {
            missing.push(f.name)
          }
        }
        setStep('Taking a cover picture of the robot…')
        const cover = dataUrlBytes(await capture('cover', moved))
        setStep('Sending the robot model…')
        if (!api.sendRobot) throw new Error('Update Snakie to send the robot model from here.')
        const res = await api.sendRobot({
          projectId,
          files,
          cover: cover ? { name: 'cover.png', bytes: cover } : undefined
        })
        if (!res.ok) throw new Error(res.error)
        url = res.value.url ?? url
        editorUrl = res.value.editorUrl
        const meshes = res.value.files.length - 1
        lines.push(`Robot model: ${model.split('/').pop()}${meshes > 0 ? ` and ${meshes} mesh${meshes === 1 ? '' : 'es'}` : ''}`)
        if (res.value.cover) lines.push('A cover picture of the robot')
        if (missing.length) lines.push(`Not found, so not sent: ${missing.join(', ')}`)
        if (plan.skipped.length) lines.push(`Left out (only STL meshes are sent): ${plan.skipped.length}`)
      }
      if (!lines.length && link) lines.push('The link to your code on GitHub')

      rememberProject(dir, projectId)
      setResult({ title, url, editorUrl: editorUrl ?? `https://www.kevsrobots.com/projects/editor.html?id=${projectId}`, made, lines })
      setPhase('sent')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase((p) => (p === 'signed-out' ? p : 'ready'))
    } finally {
      setStep('')
      // Back to where Share was opened, if a picture needed another workspace.
      if (moved.yes) switchWorkspace(startedOn)
    }
  }

  const publishCode = (): void => {
    onClose()
    switchWorkspace('code')
    setActivityView('source-control')
  }

  const openBetterCad = (): void => {
    void window.api.openExternal(bettercadNewRobotUrl())
  }

  const showPrintFiles = (): void => {
    if (!dir) return
    const show = fsx().showInFolder
    const stl = joinPath(dir, 'stl')
    if (show) void show(stl).catch(() => undefined)
    else {
      onClose()
      switchWorkspace('code')
    }
  }

  const who = status.user ? status.user.name || status.user.username : null
  const busy = phase === 'sending'
  const goes = [
    { label: 'Wiring', on: parts > 0 },
    { label: 'Parts list', on: parts > 0 },
    { label: 'Robot model', on: !!model },
    { label: 'Cover picture', on: !!model },
    { label: 'GitHub link', on: !!repo }
  ]

  return (
    <div
      className="gh-pub__overlay"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div ref={dialogRef} className="gh-pub share" role="dialog" aria-modal="true" aria-labelledby="share-title">
        <h2 className="gh-pub__title" id="share-title">
          Share {name}
        </h2>
        <p className="gh-pub__help">Pick where it goes. Your code always stays on GitHub.</p>

        {!dir && (
          <div className="share__row share__row--warn">
            <p className="gh-pub__note">
              This work isn&apos;t saved to a project folder yet. Save it first, so you can share it and keep it.
            </p>
            <button
              type="button"
              className="gh-pub__btn gh-pub__btn--primary"
              onClick={() => {
                onClose()
                onSaveAsProject()
              }}
            >
              Save as project…
            </button>
          </div>
        )}

        {/* ---- kevsrobots ---------------------------------------------- */}
        <section className="share__row" aria-labelledby="share-kr">
          <span className="share__badge share__badge--kr" aria-hidden="true">
            kr
          </span>
          <div className="share__body">
            <h3 className="share__name" id="share-kr">
              Project page on kevsrobots
            </h3>
            <ul className="share__pills" aria-label="What gets sent">
              {goes.map((g) => (
                <li key={g.label} className={g.on ? undefined : 'share__pill--off'} title={g.on ? undefined : 'Nothing to send yet'}>
                  {g.label}
                </li>
              ))}
            </ul>

            {phase === 'loading' && <p className="gh-pub__help">Checking your kevsrobots account…</p>}

            {phase === 'signed-out' && (
              <>
                <p className="gh-pub__help">
                  Sign in with your kevsrobots account to make or update the page. Signing in is only for sharing.
                </p>
                <div className="share__actions">
                  <button type="button" className="gh-pub__btn gh-pub__btn--primary" onClick={() => void signIn()}>
                    Sign in with kevsrobots
                  </button>
                </div>
              </>
            )}

            {(phase === 'ready' || phase === 'sending') && (
              <>
                <p className="gh-pub__help">
                  {who ? (
                    <>
                      Signed in as <strong>{who}</strong>.{' '}
                    </>
                  ) : null}
                  <button type="button" className="kr-send__link" onClick={() => void signOut()} disabled={busy}>
                    Sign out
                  </button>
                </p>
                <label className="gh-pub__label" htmlFor="share-target">
                  Page
                </label>
                <select
                  id="share-target"
                  className="gh-pub__input"
                  value={target}
                  disabled={busy}
                  onChange={(e) => setTarget(e.target.value)}
                >
                  <option value={NEW}>New page called “{pageTitle(name)}”</option>
                  {projects.map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      Update “{p.title}”
                    </option>
                  ))}
                </select>
                <p className="gh-pub__help">
                  {target === NEW
                    ? 'It starts as a private draft. Write it up and publish it on kevsrobots.com when you’re ready.'
                    : 'Sending again replaces the wiring, model and cover there, so nothing is copied twice.'}
                </p>
                <label className="gh-pub__label" htmlFor="share-repo">
                  Code on GitHub <span className="gh-pub__optional">(optional)</span>
                </label>
                <input
                  id="share-repo"
                  className="gh-pub__input"
                  type="url"
                  value={repoUrl}
                  disabled={busy}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="https://github.com/you/robot"
                  aria-invalid={!repoOk}
                  onChange={(e) => setRepoUrl(e.target.value)}
                />
                {!repoOk && (
                  <p className="gh-pub__help">
                    <span className="gh-pub__invalid">Use a GitHub address, like https://github.com/you/robot.</span>
                  </p>
                )}
                {busy && (
                  <p className="gh-pub__note gh-pub__note--busy" role="status">
                    {step || 'Sending…'}
                  </p>
                )}
                <div className="share__actions">
                  <button type="button" className="gh-pub__btn gh-pub__btn--primary" onClick={() => void send()} disabled={busy}>
                    {busy ? 'Sending…' : target === NEW ? 'Make the page' : 'Send'}
                  </button>
                </div>
              </>
            )}

            {phase === 'sent' && result && (
              <div role="status" className="share__done">
                <p className="gh-pub__note">
                  {result.made ? 'Made ' : 'Updated '}
                  <strong>{result.title}</strong> on kevsrobots with:
                </p>
                <ul className="share__list">
                  {result.lines.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
                <p className="gh-pub__help">Visitors see it once you publish the page on kevsrobots.com.</p>
                <div className="share__actions">
                  {result.editorUrl && (
                    <button
                      type="button"
                      className="gh-pub__btn gh-pub__btn--primary"
                      onClick={() => void window.api.openExternal(result.editorUrl as string)}
                    >
                      Write it up ↗
                    </button>
                  )}
                  {result.url && (
                    <button type="button" className="gh-pub__btn" onClick={() => void window.api.openExternal(result.url as string)}>
                      Open the page ↗
                    </button>
                  )}
                  <button type="button" className="gh-pub__btn" onClick={() => setPhase('ready')}>
                    Send again
                  </button>
                </div>
              </div>
            )}

            {error && (
              <p className="gh-pub__error" role="alert">
                {error}
              </p>
            )}
          </div>
        </section>

        {/* ---- BetterCAD ----------------------------------------------- */}
        <section className="share__row" aria-labelledby="share-bc">
          <span className="share__badge share__badge--bc" aria-hidden="true">
            BC
          </span>
          <div className="share__body">
            <h3 className="share__name" id="share-bc">
              Keep designing in BetterCAD
            </h3>
            <p className="gh-pub__help">
              {summary?.print.length
                ? `Open your ${summary.print.length} STL file${summary.print.length === 1 ? '' : 's'} from the stl folder in BetterCAD. `
                : 'Design the robot’s parts in BetterCAD. '}
              Export a URDF into this project&apos;s urdf folder and Build picks it up.
            </p>
            <div className="share__actions">
              <button type="button" className="gh-pub__btn" onClick={openBetterCad}>
                Open BetterCAD ↗
              </button>
              {dir && fsx().showInFolder && (
                <button type="button" className="gh-pub__btn" onClick={showPrintFiles}>
                  Show STL files
                </button>
              )}
            </div>
          </div>
        </section>

        {/* ---- GitHub -------------------------------------------------- */}
        <section className="share__row" aria-labelledby="share-gh">
          <span className="share__badge share__badge--gh" aria-hidden="true">
            GH
          </span>
          <div className="share__body">
            <h3 className="share__name" id="share-gh">
              Code on GitHub
            </h3>
            {remote ? (
              <>
                <p className="gh-pub__help">
                  On GitHub at <span className="share__mono">{remote.replace(/^https:\/\/github\.com\//, '')}</span>. The
                  kevsrobots page links here for the code.
                </p>
                <div className="share__actions">
                  <button type="button" className="gh-pub__btn" onClick={() => void window.api.openExternal(remote)}>
                    Open on GitHub ↗
                  </button>
                </div>
              </>
            ) : IS_WEB ? (
              <>
                <p className="gh-pub__help">
                  Put your code in a GitHub repository, then paste its link in the kevsrobots box above.
                </p>
                <div className="share__actions">
                  <button
                    type="button"
                    className="gh-pub__btn"
                    onClick={() => void window.api.openExternal('https://github.com/new')}
                  >
                    New GitHub repository ↗
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="gh-pub__help share__todo">
                  {dir
                    ? `Not on GitHub yet. Publish ${displayPath(dir)} so the page can link to your code.`
                    : 'Save the project first, then publish it to GitHub.'}
                </p>
                <div className="share__actions">
                  <button type="button" className="gh-pub__btn" onClick={publishCode}>
                    Publish to GitHub…
                  </button>
                </div>
              </>
            )}
          </div>
        </section>

        <div className="gh-pub__actions">
          <button type="button" className="gh-pub__btn" onClick={onClose} disabled={busy}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
