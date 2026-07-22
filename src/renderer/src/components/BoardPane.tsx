import { useCallback, useEffect, useRef, useState } from 'react'
import { BoardGraph } from './BoardGraph'
import { PartEditor } from './PartEditor'
import { OPEN_PART_EDITOR_EVENT, PARTS_CHANGED_EVENT, type OpenPartEditorDetail } from './PartsPanel'
import { blankRobot, type RobotDefinition } from '../../../shared/robot'
import { readRobotModel } from '../../../shared/krf'
import { jointNames, jointDisplayLimits } from './robot-assembly'
import { attachPartMesh } from './robot-part-mesh'
import { useWorkspace } from '../store/workspace'
import { useEditorSettings } from '../store/settings'
import type {
  BoardDefinition,
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
let cachedUserBoards: BoardDefinition[] = []

export function BoardPane(): JSX.Element {
  const { openFiles, activeId, currentFolder } = useWorkspace()
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
    document.documentElement.setAttribute(
      'data-breadboard-bg',
      breadboardBg === 'blueprint' ? 'blueprint' : 'dark'
    )
  }, [breadboardBg])

  // User-authored boards (Microcontroller-family parts saved to disk).
  const [userBoards, setUserBoards] = useState<BoardDefinition[]>(() => cachedUserBoards)
  const refreshUserBoards = useCallback((): void => {
    window.api.board
      .listUserBoards()
      .then((b) => {
        cachedUserBoards = b
        setUserBoards(b)
      })
      .catch(() => setUserBoards([]))
  }, [])
  useEffect(() => {
    refreshUserBoards()
  }, [refreshUserBoards])

  // Installed part libraries (wiring canvas + add-to-project); refresh on save.
  const [libraries, setLibraries] = useState<PartLibraryWithParts[]>(() => cachedLibraries)
  useEffect(() => {
    const load = (): void => {
      window.api.parts.listLibraries()
        .then((l) => {
          cachedLibraries = l
          setLibraries(l)
        })
        .catch(() => setLibraries([]))
    }
    load()
    window.addEventListener(PARTS_CHANGED_EVENT, load)
    return () => window.removeEventListener(PARTS_CHANGED_EVENT, load)
  }, [])

  // The project's robot.yml. `saveSeqRef` guards a slow load from clobbering a
  // newer save; `robot:didChange` re-loads when ANY window saves it (so this
  // pane and the floating Board View stay in sync).
  const [robot, setRobot] = useState<RobotDefinition>(() => blankRobot())
  const saveSeqRef = useRef(0)
  const [robotNonce, setRobotNonce] = useState(0)
  useEffect(() => window.api.robot.onChanged(() => setRobotNonce((n) => n + 1)), [])
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
        setJoints(jointNames(content))
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

  const saveRobot = useCallback(
    (next: RobotDefinition): void => {
      saveSeqRef.current += 1
      setRobot(next)
      void window.api.robot.save(folder, next).catch(() => undefined)
    },
    [folder]
  )

  // Append a library part to the project — same rules as the floating window
  // (unique instance id; drag-drop position; mip offer only for driver-less
  // parts, the Driver Install banner owns bundled drivers).
  const addToProject = useCallback(
    (libraryId: string, part: PartDefinition, pos?: { x: number; y: number }): void => {
      const ids = new Set(['board', ...robot.parts.map((p) => p.id)])
      let id = part.id
      let n = 2
      while (ids.has(id)) id = `${part.id}${n++}`
      const placed = pos ? { x: Math.round(pos.x), y: Math.round(pos.y) } : {}
      const withPart: RobotDefinition = {
        ...robot,
        parts: [...robot.parts, { id, lib: libraryId, part: part.id, label: part.name, ...placed }]
      }
      if (part.mesh && folder) {
        // #406: a mesh-linked part ALSO drops its STL into the project URDF (creating +
        // linking one if absent). Save the part + link SYNCHRONOUSLY (so a rapid second
        // drop / cross-window reload can't clobber it), THEN write the mesh into the
        // .urdf. It shows in the Robot View the next time that URDF is loaded (e.g. on
        // switching to Robot mode); an already-open Robot View won't refresh live.
        const existingUrdf = readRobotModel(robot)?.urdf
        const urdfName = existingUrdf || 'robot.urdf'
        saveRobot(
          existingUrdf
            ? withPart
            : { ...withPart, robot: { ...(withPart.robot ?? {}), version: 1, urdf: urdfName } }
        )
        void attachPartMesh(folder, urdfName, libraryId, part).catch(() => undefined)
      } else {
        saveRobot(withPart)
      }
      const lib = part.library
      if (lib?.url && !(part.drivers && part.drivers.length > 0)) {
        const mod = lib.module || part.name
        if (
          window.confirm(
            `Install the "${mod}" MicroPython library for "${part.name}" onto the connected board?`
          )
        ) {
          void window.api.packages
            .install(lib.url)
            .then((r) => {
              if (!r.ok)
                window.alert(
                  `Couldn't install ${mod}.\n${r.log || 'Open the Packages panel for details.'}`
                )
              else window.api.modules.notifyChanged()
            })
            .catch(() => window.alert(`Couldn't install ${mod} — is a board connected?`))
        }
      }
    },
    [robot, saveRobot, folder]
  )

  // Add MANY parts at once (the full-screen catalog's "Add to project", #613) in a
  // SINGLE robot update — calling addToProject in a loop would re-read the stale
  // `robot` each time and only keep the last. Unique instance ids are assigned
  // across the whole batch.
  const addManyToProject = useCallback(
    (items: { libraryId: string; part: PartDefinition }[]): void => {
      if (items.length === 0) return
      const ids = new Set(['board', ...robot.parts.map((p) => p.id)])
      const placed = items.map(({ libraryId, part }) => {
        let id = part.id
        let n = 2
        while (ids.has(id)) id = `${part.id}${n++}`
        ids.add(id)
        return { id, lib: libraryId, part: part.id, label: part.name }
      })
      saveRobot({ ...robot, parts: [...robot.parts, ...placed] })
    },
    [robot, saveRobot]
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

  // Author a NEW board (a starter Microcontroller-family part in `my-parts`).
  return (
    <section className="board-pane" aria-label="Board View" style={{ height: '100%', minWidth: 0 }}>
      <BoardGraph
        source={source}
        fileName={fileName}
        isPython={isPython}
        userBoards={userBoards}
        robot={robot}
        onChangeRobot={saveRobot}
        libraries={libraries}
        joints={joints}
        jointLimits={jointLimits}
        onAddToProject={addToProject}
        onAddManyToProject={addManyToProject}
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
    </section>
  )
}

export default BoardPane
