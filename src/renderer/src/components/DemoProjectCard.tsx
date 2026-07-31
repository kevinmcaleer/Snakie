import { useCallback, useState, type JSX } from 'react'
import { useWorkspace } from '../store/workspace'
import { useWorkspaceLayout } from '../store/layout'
import {
  DEMO_ENTRY_FILE,
  DEMO_FOLDER,
  demoInstallPlan,
  joinPath
} from '../lib/demo-project'
import { reporter } from '../lib/report-error'

/**
 * "Open the demo project" — the entry point to the servo arm (#483).
 * =============================================================================
 *
 * The gallery's other tiles teach a topic; this one hands over a WORKING robot:
 * the same machine wired in Electronics, modelled in Build and driven by
 * `sweep.py` in Code. That is the only way a new user discovers the three
 * workspaces are the same project — the 3-D demo alone taught the opposite,
 * because Electronics had nothing to show.
 *
 * It installs into a folder the user picks rather than anywhere of our choosing,
 * and refuses to write over an existing `servo-arm` folder. A demo that silently
 * ate someone's work would be a poor introduction.
 */
export function DemoProjectCard(): JSX.Element {
  const { openFolderPath, openFile } = useWorkspace()
  const { switchWorkspace } = useWorkspaceLayout()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const open = useCallback(async (): Promise<void> => {
    setError(null)
    const parent = await window.api.fs.openFolderDialog().catch(() => null)
    if (!parent) return // cancelled
    setBusy(true)
    try {
      const dir = joinPath(parent, DEMO_FOLDER)
      // Refuse rather than merge: a half-overwritten project is worse than a
      // clear "pick somewhere else", and we cannot tell their robot.yml from ours.
      const existing = await window.api.fs.readDir(dir).catch(() => null)
      if (existing && existing.length > 0) {
        setError(`"${DEMO_FOLDER}" already exists there and isn't empty — choose another folder.`)
        return
      }
      await window.api.fs.mkdir(dir)
      for (const f of demoInstallPlan(parent)) {
        await window.api.fs.writeFile(f.path, f.content)
      }
      openFolderPath(dir)
      await openFile('local', joinPath(dir, DEMO_ENTRY_FILE))
      // Land in Electronics: the wiring is the part that was missing, and seeing
      // it next to the arm is the whole point of the demo.
      switchWorkspace('board')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(`Couldn't create the demo project: ${msg}`)
      reporter('demo project install')(err)
    } finally {
      setBusy(false)
    }
  }, [openFolderPath, openFile, switchWorkspace])

  return (
    <section className="tp__section">
      <h2 className="tp__section-title">Start with a working robot</h2>
      <div className="tp__demo">
        <span className="tp__demo-emoji" aria-hidden="true">
          🦾
        </span>
        <div className="tp__demo-text">
          <h3 className="tp__demo-title">Servo Arm — the demo project</h3>
          <p className="tp__demo-desc">
            A two-joint arm, wired up and ready to run. The same robot in all three
            workspaces: the circuit in <strong>Electronics</strong>, the model in{' '}
            <strong>Build</strong>, and <code>{DEMO_ENTRY_FILE}</code> in <strong>Code</strong>.
          </p>
          {error && <p className="tp__demo-error">{error}</p>}
        </div>
        <button type="button" className="tp__demo-btn" onClick={() => void open()} disabled={busy}>
          {busy ? 'Creating…' : 'Open demo project'}
        </button>
      </div>
    </section>
  )
}
