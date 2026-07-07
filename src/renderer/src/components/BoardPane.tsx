import { useCallback, useEffect, useRef, useState } from 'react'
import { BoardGraph } from './BoardGraph'
import { PartEditor } from './PartEditor'
import { OPEN_PART_EDITOR_EVENT, PARTS_CHANGED_EVENT, type OpenPartEditorDetail } from './PartsPanel'
import { blankPart } from './part-editor.util'
import { blankRobot, type RobotDefinition } from '../../../shared/robot'
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
  const [userBoards, setUserBoards] = useState<BoardDefinition[]>([])
  const refreshUserBoards = useCallback((): void => {
    window.api.board
      .listUserBoards()
      .then(setUserBoards)
      .catch(() => setUserBoards([]))
  }, [])
  useEffect(() => {
    refreshUserBoards()
  }, [refreshUserBoards])

  // Installed part libraries (wiring canvas + add-to-project); refresh on save.
  const [libraries, setLibraries] = useState<PartLibraryWithParts[]>([])
  useEffect(() => {
    const load = (): void => {
      window.api.parts.listLibraries().then(setLibraries).catch(() => setLibraries([]))
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
      saveRobot({
        ...robot,
        parts: [...robot.parts, { id, lib: libraryId, part: part.id, label: part.name, ...placed }]
      })
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
  const newBoard = useCallback((): void => {
    const starter: PartDefinition = {
      ...blankPart(),
      id: 'my-board',
      name: 'My Board',
      family: 'Microcontroller'
    }
    window.api.parts
      .listLibraries()
      .then((libs) => {
        const lib = libs.find((l) => l.id === 'my-parts')
        setEditing({
          libraryId: 'my-parts',
          part: starter,
          libraries: libs,
          existingParts: lib?.parts ?? [],
          isNew: true
        })
      })
      .catch(() =>
        setEditing({ libraryId: 'my-parts', part: starter, libraries: [], existingParts: [], isNew: true })
      )
  }, [])

  return (
    <section className="board-pane" aria-label="Board View" style={{ height: '100%', minWidth: 0 }}>
      <BoardGraph
        source={source}
        fileName={fileName}
        isPython={isPython}
        userBoards={userBoards}
        onOpenBoardsFolder={() => void window.api.board.openBoardsFolder().catch(() => undefined)}
        onEnterCreator={newBoard}
        robot={robot}
        onChangeRobot={saveRobot}
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
    </section>
  )
}

export default BoardPane
