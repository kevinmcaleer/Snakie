/**
 * Entry point for the floating Board View window (`board.html`).
 *
 * It is a SECOND renderer entry (see `electron.vite.config.ts`), mounting a
 * minimal app that:
 *   - applies the editor theme (from `localStorage` then live from each
 *     streamed payload) as `data-theme` on `<html>` so it matches the app,
 *   - subscribes to the streamed active-file snapshot (`window.api.board.onSource`),
 *   - loads any user-authored board definitions once
 *     (`window.api.board.listUserBoards`),
 *   - renders the node-graph {@link BoardGraph} fed by the streamed
 *     `{ source, fileName, isPython, theme }` (the generic {@link BoardView}
 *     drawer is kept for the Board Creator's preview).
 *
 * The Board Viewer also HOSTS the **Parts Library** + **Wiring** (#129/#130/#139/
 * #140): the parts library is only used by the board-viewer UX (parts get placed
 * on the board), so it lives here. {@link BoardGraph} carries the view-type tabs
 * (Node graph / Life-like / Schematic) and a right-side library dock; placing a
 * part appends it to `robot.yml` and authoring one opens the Part Editor overlay.
 *
 * No scrim/modal chrome — it fills the OS window; the title bar is the draggable
 * region (handled inside BoardView via `asWindow`).
 */

// Install the preload-bridge fallback BEFORE anything renders (mirrors main.tsx).
import './lib/preloadFallback'
import { useCallback, useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { BoardGraph } from './components/BoardGraph'
import { OPEN_PART_EDITOR_EVENT, PARTS_CHANGED_EVENT, type OpenPartEditorDetail } from './components/PartsPanel'
import { PartEditor } from './components/PartEditor'
import { preloadPartImages } from './components/part-image-preload'
import { blankRobot, type RobotDefinition } from '../../shared/robot'
import { addPartsToProject, offerLibraryInstall } from './components/project-parts'
import { movableJointNames, jointDisplayLimits } from './components/robot-assembly'
import type {
  BoardSourcePayload,
  PartDefinition,
  PartLibrary,
  PartLibraryWithParts
} from '../../preload/index.d'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/ibm-plex-mono/600.css'
import './index.css'

/** Theme key shared with the editor window's `useTheme`. */
const THEME_KEY = 'snakie.theme.v2'
/** Breadboard-background key shared with the main window's settings store. */
const BREADBOARD_BG_KEY = 'snakie.board.breadboardBg'

function applyTheme(theme: string): void {
  document.documentElement.setAttribute('data-theme', theme)
}

/** Set the breadboard background variant as a document attribute so WiringCanvas.css
 *  can repaint the canvas mat (`dark` default / `blueprint`). */
function applyBreadboardBg(bg: string | undefined): void {
  // Keep in step with BoardPane's copy — the pop-out window applies this itself,
  // so a new mat added in one place silently falls back to dark in the other.
  const mat = bg === 'blueprint' || bg === 'white' ? bg : 'dark'
  document.documentElement.setAttribute('data-breadboard-bg', mat)
}

function BoardWindowApp(): JSX.Element {
  const [payload, setPayload] = useState<BoardSourcePayload>({
    source: '',
    fileName: undefined,
    isPython: false,
    theme: 'skeuomorph'
  })
  // The live board VIEW (BoardGraph — which hosts the Life-like/Schematic wiring
  // views + the library dock). `editing` overlays the Part Editor on top of it —
  // boards are now authored in the Part Editor (a Microcontroller-family part), so
  // the old Board Creator is gone.
  const [editing, setEditing] = useState<{
    libraryId: string
    part: PartDefinition | null
    libraries: PartLibrary[]
    existingParts: PartDefinition[]
    /** True for a pre-seeded NEW part (e.g. "+ board") so the collision guard arms. */
    isNew?: boolean
  } | null>(null)
  // The project's robot.yml (parts + wiring) + the installed libraries used to
  // resolve placed parts' pins on the wiring canvas.
  const [robot, setRobot] = useState<RobotDefinition>(() => blankRobot())
  const [libraries, setLibraries] = useState<PartLibraryWithParts[]>([])
  const folder = payload.folder

  // Apply the persisted theme + breadboard background immediately so the first
  // paint matches the app (before the streamed payload arrives).
  useEffect(() => {
    let initial = 'skeuomorph'
    try {
      const raw = window.localStorage.getItem(THEME_KEY)
      if (raw) initial = JSON.parse(raw) as string
    } catch {
      // Ignore — fall back to the default.
    }
    applyTheme(initial)
    setPayload((p) => ({ ...p, theme: initial }))
    let bg = 'blueprint'
    try {
      const raw = window.localStorage.getItem(BREADBOARD_BG_KEY)
      if (raw) bg = JSON.parse(raw) as string
    } catch {
      // Ignore — default blueprint.
    }
    applyBreadboardBg(bg)
  }, [])

  // Subscribe to the streamed active-file snapshot; apply its theme live.
  useEffect(() => {
    const off = window.api.board.onSource((p) => {
      setPayload(p)
      if (p.theme) applyTheme(p.theme)
      applyBreadboardBg(p.breadboardBg)
    })
    return off
  }, [])

  // Pull the latest snapshot on mount (covers the open-time push race).
  useEffect(() => {
    window.api.board
      .requestSource()
      .then((p) => {
        if (p) {
          setPayload(p)
          if (p.theme) applyTheme(p.theme)
          applyBreadboardBg(p.breadboardBg)
        }
      })
      .catch(() => undefined)
  }, [])

  // The Parts panel asks (via a window event) to open the Part Editor for a
  // new/existing part. Fetch the libraries here so the editor gets the target
  // library list + the existing parts (for id-collision checks).
  useEffect(() => {
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent<OpenPartEditorDetail>).detail
      if (!detail) return
      window.api.parts
        .listLibraries()
        .then((libs) => {
          const lib = libs.find((l) => l.id === detail.libraryId)
          setEditing({
            libraryId: detail.libraryId,
            part: detail.part,
            libraries: libs,
            existingParts: lib?.parts ?? []
          })
        })
        .catch(() =>
          setEditing({ libraryId: detail.libraryId, part: detail.part, libraries: [], existingParts: [] })
        )
    }
    window.addEventListener(OPEN_PART_EDITOR_EVENT, handler)
    return () => window.removeEventListener(OPEN_PART_EDITOR_EVENT, handler)
  }, [])

  // Installed libraries (for the wiring canvas + add-to-project); refresh on save.
  useEffect(() => {
    const load = (): void => {
      window.api.parts
        .listLibraries()
        .then((l) => {
          preloadPartImages(l) // decode photos before the canvas paints
          setLibraries(l)
        })
        .catch(() => setLibraries([]))
    }
    load()
    window.addEventListener(PARTS_CHANGED_EVENT, load)
    return () => window.removeEventListener(PARTS_CHANGED_EVENT, load)
  }, [])

  // Bumped on every save; an in-flight load is discarded if a save happened
  // since it started, so a slow disk read can't clobber newer edits.
  const saveSeqRef = useRef(0)

  // Load the project's robot.yml when the folder becomes known / changes — and
  // re-load when ANOTHER window saves it (robot:didChange), e.g. the I²C-detect
  // scanner adding a matched part to the project (#214).
  const [robotNonce, setRobotNonce] = useState(0)
  useEffect(() => window.api.robot.onChanged(() => setRobotNonce((n) => n + 1)), [])
  // A placement bridge rewrote the .urdf (#716) — re-read so the servo "drives
  // joint" picker sees links/joints added from another window too.
  useEffect(() => window.api.robot.onUrdfChanged(() => setRobotNonce((n) => n + 1)), [])
  useEffect(() => {
    let live = true
    const startSeq = saveSeqRef.current
    const fresh = (): boolean => live && saveSeqRef.current === startSeq
    window.api.robot
      .load(folder)
      .then((d) => {
        if (fresh()) setRobot(d)
      })
      .catch(() => {
        if (fresh()) setRobot(blankRobot())
      })
    return () => {
      live = false
    }
  }, [folder, robotNonce])

  const saveRobot = useCallback(
    (next: RobotDefinition): void => {
      saveSeqRef.current += 1
      setRobot(next)
      void window.api.robot.save(folder, next).catch(() => undefined)
    },
    [folder]
  )

  // The URDF's joint names — read the linked `.urdf` so a servo's inspector can
  // offer a "drives joint" picker (#). Empty when there's no URDF / no folder yet.
  const [joints, setJoints] = useState<string[]>([])
  // Each joint's real travel (deg / mm) — seeds a new binding's joint range so the
  // 3-D model doesn't clamp (a flat 0…180 default did).
  const [jointLimits, setJointLimits] = useState<Record<string, { min: number; max: number }>>({})
  const urdfPath = robot.robot?.urdf
  useEffect(() => {
    if (!folder || !urdfPath) {
      setJoints([])
      setJointLimits({})
      return
    }
    let live = true
    window.api.fs
      .readFile(`${folder}/${urdfPath}`)
      .then((content) => {
        if (!live) return
        setJoints(movableJointNames(content))
        setJointLimits(jointDisplayLimits(content))
      })
      .catch(() => {
        if (live) {
          setJoints([])
          setJointLimits({})
        }
      })
    return () => {
      live = false
    }
  }, [folder, urdfPath, robotNonce])

  // Append a library part to the project — the shared sequence (#716) both board
  // hosts use: unique ids ('board' reserved), robot.yml saved synchronously,
  // every part given its Build body (mesh or footprint box). The urdfLink
  // record-back happens in MAIN (robot:patchPartLinks) against the file's
  // current state, so this window holds no late-firing whole-document save.
  const addToProject = useCallback(
    (libraryId: string, part: PartDefinition, pos?: { x: number; y: number }): void => {
      addPartsToProject({ robot, folder, libraries, saveRobot }, [{ libraryId, part, pos }])
      offerLibraryInstall(part)
    },
    [robot, saveRobot, folder, libraries]
  )

  // Esc backs out one level at a time (so a stray Esc / a focused input's Esc
  // never slams the window shut): part editor → Board Creator → close window.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) return
      if (editing) setEditing(null)
      else window.api.board.close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing])

  // Author a NEW board: open the Part Editor on a starter Microcontroller part in
  // the user's library (boards are just Microcontroller-family parts now).
  return (
    <>
      <BoardGraph
        source={payload.source}
        fileName={payload.fileName}
        isPython={payload.isPython}
        asWindow
        robot={robot}
        onChangeRobot={saveRobot}
        joints={joints}
        jointLimits={jointLimits}
        libraries={libraries}
        onAddToProject={addToProject}
      />
      {editing && (
        <PartEditor
          libraryId={editing.libraryId}
          initial={editing.part}
          isNew={editing.isNew}
          existingParts={editing.existingParts}
          libraries={editing.libraries}
          onSaved={() => window.dispatchEvent(new Event(PARTS_CHANGED_EVENT))}
          onClose={() => {
            setEditing(null)
            window.dispatchEvent(new Event(PARTS_CHANGED_EVENT))
          }}
        />
      )}
    </>
  )
}

const render = (): void =>
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<BoardWindowApp />)

// In the WEB build this window is a browser popup (no preload): install the web
// backends (parts / fs / robot) + the BroadcastChannel relay to the main window
// BEFORE rendering, mirroring main.tsx. A failure still renders the bare viewer.
if (import.meta.env.VITE_SNAKIE_WEB) {
  import('./web/install-web-api')
    .then((m) => {
      m.installWebApi('board')
      render()
    })
    .catch((err) => {
      console.error('[Snakie] web backend install failed', err)
      render()
    })
} else {
  render()
}
