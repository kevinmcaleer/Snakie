import { useEffect, useMemo, useRef, useState } from 'react'
import type { PartLibraryWithParts } from '../../../shared/part'
import type { RobotDefinition } from '../../../shared/robot'
import { blankRobot } from '../../../shared/robot'
import { readRobotModel } from '../../../shared/krf'
import {
  massCoverage,
  unifiedTree,
  type HierarchyNode,
  type MassCoverage
} from './hierarchy-tree'

/**
 * THE HIERARCHY'S DATA (#718, epic #720) — one loader for all three mounts.
 *
 * The unified tree needs three things: robot.yml (the board + placed parts), the
 * project URDF (links + joints + masses) and the part libraries. Each of the
 * three mounts — the in-window board pane, the popped-out board window and the
 * Build view — already had SOME of them and not others, which is exactly how a
 * feature added to one board host silently diverged from the other before
 * (#453). So this hook fetches whatever it wasn't handed, off the same shared
 * change buses {@link SyncControl} uses, and every mount derives the tree
 * through the same call.
 *
 * A caller passes an override ONLY when it holds a live copy that is fresher
 * than disk — the wiring canvas's in-flight robot.yml, the Build view's unsaved
 * URDF text. Everything else is loaded here, so a mount cannot forget a field.
 */
export interface UseHierarchyOptions {
  /** The project folder. Without one there is no project URDF to read. */
  folder?: string | null
  /** Live URDF text (the Build view's editor buffer). `undefined` ⇒ read the
   *  project's `.urdf` off disk; `null`/`''` ⇒ genuinely no Build model. */
  urdf?: string | null
  /** Live robot.yml (the wiring canvas's in-flight document). Omit ⇒ load it. */
  robot?: RobotDefinition | null
  /** Installed part libraries, when the caller already has them. Omit ⇒ load. */
  libraries?: readonly PartLibraryWithParts[]
  /** The base link the Build view is using (its `chosenBase`). */
  baseLink?: string | null
  /** The MCU's display name, when the host already resolved a board definition
   *  the part libraries don't hold (a built-in board). */
  boardLabel?: string
}

export interface UseHierarchyResult {
  nodes: HierarchyNode[]
  /** How much of the robot is actually weighed (#719) — derived from the same
   *  rows, so the badges, the readout and the total can't disagree. */
  coverage: MassCoverage
  /** The robot.yml the tree was built from (live override or freshly loaded). */
  robot: RobotDefinition
}

export function useHierarchy(opts: UseHierarchyOptions): UseHierarchyResult {
  const { folder, urdf: liveUrdf, robot: liveRobot, libraries: liveLibs, baseLink, boardLabel } = opts
  const [loadedRobot, setLoadedRobot] = useState<RobotDefinition>(() => blankRobot())
  const [loadedLibs, setLoadedLibs] = useState<PartLibraryWithParts[]>([])
  const [loadedUrdf, setLoadedUrdf] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const seqRef = useRef(0)

  const wantRobot = liveRobot == null
  const wantLibs = liveLibs === undefined
  const wantUrdf = liveUrdf === undefined

  // One reload path off the shared buses: robot.yml saves anywhere, URDF
  // rewrites anywhere (the placement bridge), library changes.
  useEffect(() => window.api.robot.onChanged(() => setNonce((n) => n + 1)), [])
  useEffect(() => window.api.robot.onUrdfChanged(() => setNonce((n) => n + 1)), [])
  useEffect(() => window.api.parts.onChanged?.(() => setNonce((n) => n + 1)) ?? undefined, [])

  // The URDF path is the honest dependency for the disk read — `liveRobot`'s
  // identity churns on every canvas keystroke, and re-reading the file then
  // would be pure waste.
  const liveUrdfPath = readRobotModel(liveRobot ?? blankRobot())?.urdf

  useEffect(() => {
    if (!wantRobot && !wantLibs && !wantUrdf) return
    const seq = ++seqRef.current
    const fresh = (): boolean => seq === seqRef.current
    void (async (): Promise<void> => {
      const r = wantRobot
        ? await window.api.robot.load(folder ?? undefined).catch(() => blankRobot())
        : null
      const libs = wantLibs
        ? ((await window.api.parts.listLibraries().catch(() => [])) as PartLibraryWithParts[])
        : null
      let text: string | null = null
      if (wantUrdf) {
        const rel = r ? readRobotModel(r)?.urdf : liveUrdfPath
        if (rel && folder) {
          text = await window.api.fs.readFile(`${folder.replace(/[/\\]$/, '')}/${rel}`).catch(() => null)
        }
      }
      if (!fresh()) return
      if (r) setLoadedRobot(r)
      if (libs) setLoadedLibs(libs)
      if (wantUrdf) setLoadedUrdf(text)
    })()
  }, [folder, nonce, wantRobot, wantLibs, wantUrdf, liveUrdfPath])

  const robot = liveRobot ?? loadedRobot
  const libraries = liveLibs ?? loadedLibs
  const urdf = wantUrdf ? loadedUrdf : liveUrdf
  const model = readRobotModel(robot)

  const nodes = useMemo(
    () =>
      unifiedTree({
        board: robot.board,
        boardLabel,
        boardMountedOn: robot.boardMountedOn,
        boardLink: model?.boardLink,
        parts: robot.parts,
        urdf,
        libraries,
        linkMass: model?.linkMass,
        baseLink: baseLink ?? model?.baseLink ?? null
      }),
    [robot, model, urdf, libraries, baseLink, boardLabel]
  )
  const coverage = useMemo(() => massCoverage(nodes), [nodes])
  return { nodes, coverage, robot }
}
