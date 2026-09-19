import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { BoardGraph } from './BoardGraph'
import { PartEditor } from './PartEditor'
import { OPEN_PART_EDITOR_EVENT, PARTS_CHANGED_EVENT, type OpenPartEditorDetail } from './PartsPanel'
import { preloadPartImages } from './part-image-preload'
import { blankRobot, type RobotDefinition } from '../../../shared/robot'
import { addPartsToProject, offerLibraryInstall } from './project-parts'
import { SyncControl } from './SyncControl'
import { movableJointNames, jointDisplayLimits } from './robot-assembly'
import { canRedo as histCanRedo, canUndo as histCanUndo, historyInit, type History } from './use-history'
import { commitRobot, redoRobot, undoRobot } from './robot-history'
import { useWorkspace } from '../store/workspace'
import { useWorkspaceLayout } from '../store/layout'
import { useEditorSettings } from '../store/settings'
import type {
  PartDefinition,
  PartLibrary,
  PartLibraryWithParts
} from '../../../preload/index.d'

/**
 * BOARD PANE (epic #259 — the Board workspace's tri-split).
 * =============================================================================
 *
 * Hosts the FULL {@link BoardGraph} (node graph · breadboard · schematic, with
 * the parts library dock and wiring) as an embedded panel in the MAIN window —
 * code on the left, the board here on the right, the instrument dock at the far
 * right, so learners see their code, the wiring and the live instruments at the
 * same time.
 *
 * This is the in-window twin of `board-main.tsx` (the floating Board View
 * window): the same data plumbing — user boards, the project's robot.yml
 * (load/save with a save-sequence guard), installed part libraries, the Part
 * Editor overlay — but fed DIRECTLY from the workspace store instead of the
 * cross-window IPC stream, and with no window chrome (`asWindow` off) and no
 * Esc-to-close (Esc only backs out of the Part Editor overlay).
 *
 * The module is loaded lazily from AppShell (React.lazy), so the board
 * subsystem stays out of the main bundle until a Board-pane workspace is used.
 * Both this pane and the floating window can be open at once — they share
 * robot.yml through the `robot:didChange` broadcast, so edits in either stay
 * in sync.
 */
// Module-level caches (survive remounts / workspace switches) so the Electronics
// board view paints the real board + placed parts on the FIRST render instead of
// flashing built-in defaults while the async library / board lists load (#615).
let cachedLibraries: PartLibraryWithParts[] = []

export interface BoardPaneProps {
  /**
   * Draw on THIS mat rather than the one Settings chose (#1168).
   *
   * The PDF export renders a board of its own to photograph, and wants the white
   * print mat whatever the window is set to. Given a mat, the pane scopes
   * `data-breadboard-bg` to its own element instead of the document root — so
   * the window's own canvas, if one is open, is left exactly as it was.
   */
  mat?: 'dark' | 'blueprint' | 'white'
}

export function BoardPane({ mat }: BoardPaneProps = {}): JSX.Element {
  const { openFiles, activeId, currentFolder } = useWorkspace()
  const { pendingBoardSwap, clearBoardSwap } = useWorkspaceLayout()
  const activeFile = openFiles.find((f) => f.id === activeId) ?? null
  const source = activeFile?.content ?? ''
  const fileName = activeFile?.name
  const isPython = !!activeFile && /\.py$/i.test(activeFile.name)
  const folder = currentFolder ?? undefined

  // The breadboard mat variant (dark / blueprint) is a document attribute the
  // WiringCanvas CSS reads; the floating window applies it itself, the main
  // window didn't have it until this pane existed.
  const { breadboardBg } = useEditorSettings()
  useEffect(() => {
    // A pane drawing on a mat of its OWN publishes it on its own element (see
    // the render below) and must not touch the document's — that would restyle
    // the canvas the learner is looking at.
    if (mat) return
    document.documentElement.setAttribute(
      'data-breadboard-bg',
      breadboardBg === 'blueprint' || breadboardBg === 'white' ? breadboardBg : 'dark'
    )
  }, [breadboardBg, mat])

  // User-authored boards are loaded by `useBoards` inside BoardGraph now — one
  // loader, one set of refresh signals, so this pane and the code workspace's
  // mini board view cannot list different boards.

  // Installed part libraries (wiring canvas + add-to-project); refresh on save.
  const [libraries, setLibraries] = useState<PartLibraryWithParts[]>(() => cachedLibraries)
  // Whether the list has come back AT ALL — which is not the same as it having
  // anything in it, and is what "ready" below has to mean (#1168). Until it
  // does, every placed part draws as `part library not installed`: a
  // placeholder box with no pins, and so no wires between them.
  const [librariesLoaded, setLibrariesLoaded] = useState(() => cachedLibraries.length > 0)
  useEffect(() => {
    const load = (): void => {
      window.api.parts.listLibraries()
        .then((l) => {
          cachedLibraries = l
          // Decode the board photos BEFORE the canvas paints, so parts don't show
          // as bare PCB + shapes for a frame first (this pane unmounts on every
          // workspace switch, so that flash happened every time).
          preloadPartImages(l)
          setLibraries(l)
        })
        .catch(() => setLibraries([]))
        .finally(() => setLibrariesLoaded(true))
    }
    load()
    window.addEventListener(PARTS_CHANGED_EVENT, load)
    return () => window.removeEventListener(PARTS_CHANGED_EVENT, load)
  }, [])

  // The project's robot.yml. `saveSeqRef` guards a slow load from clobbering a
  // newer save; `robot:didChange` re-loads when ANY window saves it (so this
  // pane and the floating Board View stay in sync).
  const [robot, setRobot] = useState<RobotDefinition>(() => blankRobot())
  // Gate the pending-swap forwarding on the REAL robot.yml being loaded — the pane
  // mounts with a blank robot, and swapping against that would wipe the file (#…).
  const [robotLoaded, setRobotLoaded] = useState(false)
  const saveSeqRef = useRef(0)
  const [robotNonce, setRobotNonce] = useState(0)
  useEffect(() => window.api.robot.onChanged(() => setRobotNonce((n) => n + 1)), [])
  // A placement bridge rewrote the .urdf (#716) — re-read so the servo "drives
  // joint" picker sees links/joints added from another window too.
  useEffect(() => window.api.robot.onUrdfChanged(() => setRobotNonce((n) => n + 1)), [])

  // ── Undo/redo: the wiring document's history (the #187 stack, as #338 gave
  // the Build view) ─────────────────────────────────────────────────────────
  // The Electronics view edits ONE document and every action in it — drop a
  // part, drag it, wire two pins, recolour or delete a wire, rotate, rename,
  // duplicate, swap the board — ends in `commit` below, so checkpointing there
  // is undo over all of them. The stack lives in a ref (a checkpoint alone must
  // not re-render the canvas) with a counter to repaint the toolbar's enabled
  // states; `robot-history` holds the pure steps, and the reasoning about the
  // disk round-trip every save makes and the `urdfLink` MAIN stamps back.
  const robotRef = useRef(robot)
  robotRef.current = robot
  const histRef = useRef<History<RobotDefinition>>(historyInit(robot))
  const [, bumpHist] = useReducer((n: number) => n + 1, 0)
  // Which project the stack belongs to — history is per-project, and an
  // `undefined` folder is a real answer (an unsaved project), so "none yet"
  // needs a sentinel of its own.
  const histFolderRef = useRef<string | null>(null)
  /** Start a fresh stack on a newly-loaded document. Without this the blank
   *  robot the pane mounts with would sit in `past` as an undo target, and two
   *  Ctrl+Z from a fresh Electronics view would wipe the project's wiring.
   *  `force` re-seeds even for the same project (a load that FAILED: there is
   *  nothing behind it to step back to). */
  const resetHistory = useCallback(
    (d: RobotDefinition, force = false): void => {
      const key = folder ?? ''
      if (!force && histFolderRef.current === key) return // same project — keep the stack
      histFolderRef.current = key
      histRef.current = historyInit(d)
      bumpHist()
    },
    [folder]
  )

  useEffect(() => {
    let live = true
    const startSeq = saveSeqRef.current
    const fresh = (): boolean => live && saveSeqRef.current === startSeq
    window.api.robot
      .load(folder)
      .then((d) => {
        if (fresh()) {
          setRobot(d)
          setRobotLoaded(true)
          // The project's FIRST load is where undo starts from; a later re-read
          // (our own save echoing back, or another window's edit) leaves the
          // stack alone — `robot-history` folds those in on the next step.
          resetHistory(d)
        }
      })
      .catch(() => {
        // Leave robotLoaded false on a failed load, so a pending swap is never
        // applied against a blank robot (which would wipe the file). Clear any
        // punted swap so an unreadable robot.yml can't leave it stuck.
        if (fresh()) {
          const blank = blankRobot()
          setRobot(blank)
          resetHistory(blank, true)
          clearBoardSwap()
        }
      })
    return () => {
      live = false
    }
  }, [folder, robotNonce, clearBoardSwap, resetHistory])

  // The linked URDF's joint names, so a placed servo's inspector can offer a
  // "drives joint" picker (#) — mirrors the floating Board View window, which
  // loads these too. Read the `.urdf` pointed at by robot.yml; empty when there's
  // no URDF link / folder yet (then the picker shows "no joints"). Without this
  // the in-window board pane ALWAYS showed "no joints", even with a linked rig.
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

  // Low-level: write the document to robot.yml. NO checkpoint — this is also how
  // an undo puts a restored document back.
  const saveRobot = useCallback(
    (next: RobotDefinition): void => {
      saveSeqRef.current += 1
      setRobot(next)
      void window.api.robot.save(folder, next).catch(() => undefined)
    },
    [folder]
  )
  // Take a stepped stack: repaint the undo/redo controls, and write the document
  // out when the step actually moved the present (an undo with nothing behind it
  // must not dirty robot.yml).
  const applyHistory = useCallback(
    (h: History<RobotDefinition>): void => {
      histRef.current = h
      bumpHist()
      if (h.present !== robotRef.current) saveRobot(h.present)
    },
    [saveRobot]
  )
  /** The board's single edit choke point: check-point the current document, then
   *  save the new one — one undo step per action. */
  const commit = useCallback(
    (next: RobotDefinition): void => {
      applyHistory(commitRobot(histRef.current, robotRef.current, next))
    },
    [applyHistory]
  )
  const undo = useCallback(
    () => applyHistory(undoRobot(histRef.current, robotRef.current)),
    [applyHistory]
  )
  const redo = useCallback(
    () => applyHistory(redoRobot(histRef.current, robotRef.current)),
    [applyHistory]
  )
  // Append library part(s) to the project — the shared sequence (#716) both board
  // hosts use: unique ids, robot.yml saved synchronously, every part given its
  // Build body (mesh or footprint box). The urdfLink record-back happens in MAIN
  // (robot:patchPartLinks) against the file's current state, so this host holds
  // no late-firing whole-document save.
  const addToProject = useCallback(
    (libraryId: string, part: PartDefinition, pos?: { x: number; y: number }): void => {
      addPartsToProject({ robot, folder, libraries, saveRobot: commit }, [{ libraryId, part, pos }])
      offerLibraryInstall(part)
    },
    [robot, commit, folder, libraries]
  )

  // Add MANY parts at once (the full-screen catalog's "Add to project", #613) in a
  // SINGLE robot update — calling addToProject in a loop would re-read the stale
  // `robot` each time and only keep the last.
  const addManyToProject = useCallback(
    (items: { libraryId: string; part: PartDefinition }[]): void => {
      addPartsToProject(
        { robot, folder, libraries, saveRobot: commit },
        items.map(({ libraryId, part }) => ({ libraryId, part }))
      )
    },
    [robot, commit, folder, libraries]
  )

  // The Part Editor overlay (opened from the pane's library dock, exactly like
  // the floating window — same window event).
  const [editing, setEditing] = useState<{
    libraryId: string
    part: PartDefinition | null
    libraries: PartLibrary[]
    existingParts: PartDefinition[]
    isNew?: boolean
  } | null>(null)
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
          setEditing({
            libraryId: detail.libraryId,
            part: detail.part,
            libraries: [],
            existingParts: []
          })
        )
    }
    window.addEventListener(OPEN_PART_EDITOR_EVENT, handler)
    return () => window.removeEventListener(OPEN_PART_EDITOR_EVENT, handler)
  }, [])

  // Cmd/Ctrl+Z undoes, +Shift (or Ctrl+Y) redoes — anywhere in the Electronics
  // view, since the board fills it and the keys have nothing else to mean here.
  // Three exceptions, each of which would otherwise undo something twice or undo
  // the wrong document: while typing in a field (a text input has its own undo,
  // and Monaco certainly does), while the Part Editor overlay is open (it keeps
  // its own history on the same keys), and in the off-screen pane the PDF export
  // mounts — that one is a second, invisible BoardPane on the same project.
  useEffect(() => {
    if (mat || editing) return
    const onKey = (e: KeyboardEvent): void => {
      const k = e.key.toLowerCase()
      if (!(e.metaKey || e.ctrlKey) || (k !== 'z' && k !== 'y')) return
      const el = document.activeElement as HTMLElement | null
      if (
        el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.tagName === 'SELECT' ||
          el.isContentEditable ||
          el.closest('.monaco-editor'))
      )
        return
      e.preventDefault()
      if (k === 'y' || e.shiftKey) redo()
      else undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mat, editing, undo, redo])

  // Author a NEW board (a starter Microcontroller-family part in `my-parts`).
  // EVERYTHING THE BOARD IS DRAWN FROM IS HERE (#1168). A reader can see this
  // as "the pane has stopped filling in"; the PDF export needs it as a fact,
  // because a capture taken before the libraries land photographs placeholder
  // boxes and no wiring — which is what #1147 kept shipping.
  const ready = robotLoaded && librariesLoaded

  return (
    <section
      className="board-pane"
      aria-label="Board View"
      // Scoped mat (see {@link BoardPaneProps.mat}) — the CSS skins match on any
      // ancestor, so this dresses THIS pane's canvas and nothing else.
      data-breadboard-bg={mat}
      data-board-ready={ready ? '' : undefined}
      style={{ height: '100%', minWidth: 0, position: 'relative' }}
    >
      <BoardGraph
        source={source}
        fileName={fileName}
        isPython={isPython}
        robot={robot}
        onChangeRobot={commit}
        history={{
          canUndo: histCanUndo(histRef.current),
          canRedo: histCanRedo(histRef.current),
          undo,
          redo
        }}
        folder={folder}
        libraries={libraries}
        mat={mat}
        joints={joints}
        jointLimits={jointLimits}
        onAddToProject={addToProject}
        onAddManyToProject={addManyToProject}
        pendingSwapBoard={robotLoaded ? pendingBoardSwap : null}
        onSwapConsumed={clearBoardSwap}
      />
      {/* Electronics ⇄ Build reconcile (#717) — same control as the Build
          workspace and the pop-out window, self-contained on the folder. */}
      <div className="esync__float">
        <SyncControl folder={folder} />
      </div>
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
    </section>
  )
}

export default BoardPane
