/**
 * DROP BRIDGE for mesh-linked Parts Library parts (#406). When a part that declares a
 * `mesh` is added to a design, its bundled STL is copied into the project URDF's
 * `meshes/` folder and appended as a loose, unconnected link — so it shows up in the
 * 3-D Robot View (the next time that URDF is loaded) ready to place + join, like a
 * manual STL import. Pure glue over existing pieces (`robot:importPartMesh`,
 * `addMeshLink`, `blankUrdf`).
 */
import type { PartDefinition } from '../../../shared/part'
import { addMeshLink, blankUrdf, meshImportScale, rootLink } from './robot-assembly'
import { isAbsolutePath } from './robot-mesh'

/**
 * Serialise ALL part-mesh drops. Each does a read-modify-write of a `.urdf` through the
 * fs bridge (NOT the main-process per-path write queue `robot:save` uses), so two drops
 * in quick succession could both read the same base text and the second write would
 * clobber the first's link. Chaining makes each read-modify-write atomic vs. the others.
 */
let chain: Promise<void> = Promise.resolve()

/**
 * Whether a URDF filename from `robot.yml` is safe to write to: a bare in-project
 * relative path — not absolute, and not escaping the project via `..`. A crafted
 * `robot: { urdf: '../../evil.urdf' }` must not redirect a drop's file write out of
 * the project folder (#406 review).
 */
export function safeUrdfName(name: string): boolean {
  if (!name || isAbsolutePath(name)) return false
  return !/(^|[/\\])\.\.([/\\]|$)/.test(name)
}

/**
 * Copy `part`'s bundled STL into `<folder>/meshes/` and append it as a loose link to
 * the project URDF `urdfName`. Creates a blank URDF at that name if the project had
 * none. Only touches the `.urdf` file (+ its `meshes/`) — the CALLER links `urdfName`
 * in `robot.yml`. Best-effort: on a copy failure it still leaves a valid URDF so the
 * robot.yml link is never dangling. No-op for a part without a `mesh` or an unsafe name.
 */
export async function attachPartMesh(
  folder: string,
  urdfName: string,
  libraryId: string,
  part: PartDefinition
): Promise<void> {
  const mesh = part.mesh
  if (!mesh || !folder || !safeUrdfName(urdfName)) return
  const run = chain.then(async () => {
    const dir = folder.replace(/[/\\]$/, '')
    const urdfPath = `${dir}/${urdfName}`
    // Copy the part's bundled STL into <dir>/meshes/ (collision-safe, in main).
    const res = await window.api.robot.importPartMesh(urdfPath, libraryId, part.id, mesh)
    // Read the project URDF, or start a blank one if the project had none.
    let urdf: string
    try {
      urdf = await window.api.fs.readFile(urdfPath)
    } catch {
      urdf = blankUrdf('my_robot')
    }
    if (res?.rel) {
      const scale = meshImportScale(part, res.maxDim)
      urdf = addMeshLink(urdf, {
        meshRel: res.rel,
        linkBase: part.name || part.id,
        scale,
        parent: rootLink(urdf)
      }).urdf
    }
    await window.api.fs.writeFile(urdfPath, urdf)
  })
  // Keep the chain alive even if this drop throws, so a later drop still runs.
  chain = run.catch(() => undefined)
  return run
}
