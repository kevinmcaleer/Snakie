import { useEffect, useRef, useState } from 'react'
import { RobotView } from './RobotView'
import { dirname } from './robot-mesh'
import { blankUrdf } from './robot-assembly'
import { useWorkspace, announceSaved } from '../store/workspace'
import { useWorkspaceLayout } from '../store/layout'
import { readRobotModel } from '../../../shared/krf'
import demoArm from '../assets/demo-arm.urdf?raw'
import { FolderOpenIcon } from './ui-icons'
import './RobotDockPanel.css'

/**
 * ROBOT DOCK PANEL (#320) — the mini 3-D Robot view that sits above the
 * instrument dock in the **Robot** workspace. It finds the project's URDF via
 * the KRF `robot.yml` (`robot.urdf`, resolved against the workspace folder) and
 * falls back to the bundled demo arm so the panel is never empty. Isometric,
 * compact chrome. An **expand** button opens the project's `.urdf` full-screen
 * as the Pose tool (#312).
 */
export function RobotDockPanel({ embedded = false }: { embedded?: boolean } = {}): JSX.Element {
  const { currentFolder, openFile, openBuffer, openFolderPath } = useWorkspace()
  const { setFocus } = useWorkspaceLayout()
  const [urdf, setUrdf] = useState<string>(demoArm)
  // The URDF's folder, so RobotView resolves the robot's meshes (#319). Empty
  // for the bundled demo arm (all primitives — no meshes to resolve).
  const [base, setBase] = useState<string>('')
  // The project URDF's path, so the expand button can open it full-screen.
  const [urdfPath, setUrdfPath] = useState<string | null>(null)
  // Bumped after we create/link a robot, to re-resolve the project URDF.
  const [reloadNonce, setReloadNonce] = useState(0)

  // Show a transient message in the status bar so linking/creating a robot — which
  // is otherwise invisible — is clear to the user. Auto-clears after a few seconds
  // (the shared `snakie:status` seam is sticky, so the caller schedules the clear).
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const notify = (text: string): void => {
    window.dispatchEvent(new CustomEvent('snakie:status', { detail: { text, priority: 4 } }))
    if (statusTimer.current) clearTimeout(statusTimer.current)
    statusTimer.current = setTimeout(
      () => window.dispatchEvent(new CustomEvent('snakie:status', { detail: { text: '' } })),
      4000
    )
  }
  useEffect(
    () => () => {
      if (statusTimer.current != null) clearTimeout(statusTimer.current)
    },
    []
  )

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const robot = await window.api.robot.load(currentFolder ?? undefined)
        const rel = readRobotModel(robot)?.urdf
        if (rel && currentFolder) {
          const path = `${currentFolder.replace(/[/\\]$/, '')}/${rel.replace(/^[/\\]/, '')}`
          const content = await window.api.fs.readFile(path)
          if (live && content.trim()) {
            setUrdf(content)
            setBase(dirname(path))
            setUrdfPath(path)
            return
          }
        }
      } catch {
        // No project URDF (or unreadable) — fall through to the demo arm.
      }
      if (live) {
        setUrdf(demoArm)
        setBase('')
        setUrdfPath(null)
      }
    })()
    return () => {
      live = false
    }
  }, [currentFolder, reloadNonce])

  // Pop the robot out full-screen (the Pose tool + assembly): a saved project
  // URDF opens as its file; the bundled demo arm opens as a buffer. Stay in Robot
  // mode and enter transient FOCUS — hides the board, instruments + console so
  // the URDF fills the editor, restored when you switch modes or reopen a panel.
  const popOut = (): void => {
    if (urdfPath) void openFile('local', urdfPath)
    else openBuffer('demo-arm.urdf', urdf)
    setFocus(true)
  }

  const nameOf = (p: string): string => p.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? p
  // Forward slashes, no trailing slash, and a lower-cased Windows drive letter (the
  // file dialog can return `C:\…` while the remembered folder is `c:\…`, which would
  // otherwise defeat the prefix test and silently skip linking).
  const normSlash = (p: string): string =>
    p.replace(/\\/g, '/').replace(/\/$/, '').replace(/^([a-zA-Z]):/, (_m, d) => `${d.toLowerCase()}:`)
  // The path of `p` relative to project folder `dir`, or null when it's outside it.
  const relInside = (p: string, dir: string): string | null => {
    const np = normSlash(p)
    const nd = normSlash(dir)
    return np !== nd && np.startsWith(nd + '/') ? np.slice(nd.length + 1) : null
  }

  // Link a URDF (path RELATIVE to the project folder) as THE project robot in
  // robot.yml — preserving any existing wiring/poses — then refresh the tree + dock.
  const linkRobot = async (dir: string, rel: string): Promise<void> => {
    const def = await window.api.robot.load(dir)
    def.robot = { ...(def.robot ?? {}), version: 1, urdf: rel }
    await window.api.robot.save(dir, def)
    announceSaved('local', `${dir}/robot.yml`, '') // refresh the Files list (#491)
    setReloadNonce((n) => n + 1) // re-resolve so the dock tracks the linked robot
  }

  // Open an existing robot model (.urdf) full-screen AND, when it lives inside the
  // open project folder, LINK it as the project robot (robot.yml `urdf`). Picking a
  // file outside the project just opens it (there's no folder to link it into).
  const openRobot = async (): Promise<void> => {
    const path = await window.api.fs.openFileDialog({
      filters: [
        { name: 'Robot model', extensions: ['urdf', 'xacro'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (!path) return
    const name = nameOf(path)
    const dir = currentFolder ? currentFolder.replace(/[/\\]$/, '') : null
    // Resolve the picked file to a path RELATIVE to the project folder:
    //  - desktop: an absolute path inside the folder → strip the prefix (relInside)
    //  - web: `openFileDialog` returns just a FILENAME (a loose File System Access
    //    pick, with no folder relationship). If a file of that name exists in the
    //    open project, link it project-relative — that's the robot the user means.
    let rel = dir ? relInside(path, dir) : null
    if (!rel && dir && !/[/\\]/.test(path)) {
      try {
        await window.api.fs.readFile(`${dir}/${path}`) // a project file with this name?
        rel = path
      } catch {
        rel = null // not in the project — treat as an outside pick below
      }
    }
    // Compare against the RESOLVED link so "already linked" is correct on both
    // platforms (urdfPath is `<folder>/<rel>`).
    const wouldBe = dir && rel ? normSlash(`${dir}/${rel}`) : null
    const already = !!urdfPath && wouldBe != null && wouldBe === normSlash(urdfPath)
    if (already) {
      notify(`"${name}" is already this project's robot`)
    } else if (dir && rel) {
      // Confirm only when this REPLACES a different linked robot.
      const ok =
        !urdfPath ||
        window.confirm(
          `Link "${name}" as this project's robot?\n\n` +
            `This replaces the current robot (${nameOf(urdfPath)}). The old file stays on disk.`
        )
      if (ok) {
        try {
          await linkRobot(dir, rel)
          notify(`Linked "${name}" — now this project's robot`)
        } catch {
          notify(`Opened "${name}" — couldn't link it to the project`)
        }
      } else {
        notify(`Opened "${name}" (not linked)`)
      }
    } else {
      // Outside the open project folder (or no folder) → can't link, just view it.
      notify(`Opened "${name}" — it's outside the project, so it wasn't linked`)
    }
    // Open in the editor (this mounts the full Robot View) WITHOUT entering focus
    // mode, so the mini 3-D dock stays on screen and updates to the linked robot.
    // Use "⤢ Pop out" for the full-screen pose tool.
    await openFile('local', path)
  }

  // Create a new blank robot as a REAL FILE in the selected project folder, and
  // LINK it in robot.yml (`robot.urdf`) so it's the one project robot — reopening
  // always uses this file, and STL import + poses persist alongside it. With no
  // folder open we ask for one first (a robot needs a home on disk).
  const newRobot = async (): Promise<void> => {
    // A project robot is already linked → confirm before replacing the link.
    if (
      urdfPath &&
      !window.confirm(
        `This project already has a robot linked (${nameOf(urdfPath)}).\n\n` +
          `Create a new blank robot and make it the project robot instead? The current ` +
          `robot file stays on disk — reopen it any time with "Open…".`
      )
    ) {
      return
    }
    let folder = currentFolder
    if (!folder) {
      folder = await window.api.fs.openFolderDialog()
      if (!folder) return // cancelled — nowhere to store the robot
      openFolderPath(folder)
    }
    const dir = folder.replace(/[/\\]$/, '')
    let name = 'robot.urdf'
    for (let n = 2; n < 1000; n++) {
      try {
        await window.api.fs.readFile(`${dir}/${name}`)
        name = `robot-${n}.urdf` // taken → try the next
      } catch {
        break // free
      }
    }
    const path = `${dir}/${name}`
    const content = blankUrdf('my_robot')
    try {
      await window.api.fs.writeFile(path, content)
      // Refresh the local file tree so the new .urdf + robot.yml appear (#491).
      announceSaved('local', path, content)
      try {
        await linkRobot(dir, name) // preserve any wiring; this IS the robot now
        notify(`Created "${name}" — now this project's robot`)
      } catch {
        notify(`Created "${name}" (couldn't link it to the project)`)
      }
      // Open in the editor (mounts the full Robot View) WITHOUT focus mode, so the
      // mini 3-D dock stays visible and updates. Use "⤢ Pop out" for full-screen.
      await openFile('local', path)
    } catch {
      notify('Couldn’t create the new robot file')
    }
  }

  // No project robot yet (the demo arm is a stand-in) → nudge toward "New robot".
  const hasProjectRobot = urdfPath !== null

  return (
    <div className="robotdock">
      <RobotView urdfContent={urdf} basePath={base} compact />
      {/* Embedded in the MiniViewer (#595): the card's own expand ⤢ is the single
          "go bigger" control, so hide this row to avoid duplicate affordances. */}
      {!embedded && <div className="robotdock__actions">
        <button
          type="button"
          className={`robotdock__btn${hasProjectRobot ? '' : ' robotdock__btn--cta'}`}
          title="Create a new blank robot (.urdf) and open it in the pose tool"
          onClick={() => void newRobot()}
        >
          ＋ New robot
        </button>
        <button
          type="button"
          className="robotdock__btn"
          title="Open an existing robot (.urdf) full-screen"
          onClick={() => void openRobot()}
        >
          <FolderOpenIcon size={13} /> Open…
        </button>
        <button
          type="button"
          className="robotdock__btn"
          title="Pop out full-screen (pose tool + assembly)"
          onClick={popOut}
        >
          ⤢ Pop out
        </button>
      </div>}
    </div>
  )
}

export default RobotDockPanel
