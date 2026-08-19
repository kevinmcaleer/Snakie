/**
 * PART→BUILD BODY BRIDGE (#406, #716, epic #720). When a Parts Library part is
 * added to a design, it gets a body in the Build workspace's URDF:
 *
 *  - a part with a `mesh` drops its bundled STL into the project's `meshes/`
 *    and links it (the original #406 path);
 *  - a part WITHOUT a mesh — still most of the standard library (#715) — gets a
 *    **footprint box**: its real 2-D dimensions extruded to a family-tuned
 *    height, so the 3-D scene resembles the robot and CoM/support-polygon
 *    geometry stays meaningful (decided under epic #720).
 *
 * Either body lands at the part's MIRRORED breadboard position (initial drop
 * only — Build owns the pose after that), carries `<inertial>` when the part
 * declares a mass (#535: the library mass source), and the created link name is
 * returned so the caller can persist it as `RobotPart.urdfLink` (#626 Part 1).
 */
import type { PartDefinition } from '../../../shared/part'
import type { RobotPart } from '../../../shared/robot'
import {
  addBoxLink,
  addMeshLink,
  blankUrdf,
  meshImportScale,
  rootLink,
  setInertial,
  type InertialSpec
} from './robot-assembly'
import { isAbsolutePath } from './robot-mesh'

/**
 * Serialise ALL part-body drops. Each does a read-modify-write of a `.urdf` through the
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
 * The footprint-box stand-in for a meshless part (#716): real width × depth from
 * the part's declared `dimensions` (mm → m), height by family — a PCB-and-headers
 * slab for board-shaped families, a taller brick for batteries and motors. The
 * colour is the part's PCB colour pulled toward grey, so the box is recognisable
 * but visibly not a real model. Pure.
 */
export function placeholderBoxSpec(part: PartDefinition): {
  size: [number, number, number]
  rgb: [number, number, number]
} {
  const FAMILY_HEIGHT_MM: Record<string, number> = {
    Power: 15,
    Motor: 20,
    Carrier: 14
  }
  const dims = part.dimensions
  const wMm = dims && dims.width > 0 ? dims.width : 20
  const dMm = dims && dims.height > 0 ? dims.height : 20
  const hMm = FAMILY_HEIGHT_MM[part.family ?? ''] ?? 12
  // PCB colour → rgb, pulled 40% toward mid-grey (the "stand-in" finish).
  const hex = /^#?([0-9a-f]{6})$/i.exec((part.pcbColor ?? '').trim())
  let rgb: [number, number, number] = [0.55, 0.55, 0.55]
  if (hex) {
    const n = parseInt(hex[1], 16)
    const toward = (c: number): number => {
      const v = c / 255
      return Math.round((v + (0.5 - v) * 0.4) * 1000) / 1000
    }
    rgb = [toward((n >> 16) & 0xff), toward((n >> 8) & 0xff), toward(n & 0xff)]
  }
  return { size: [wMm / 1000, dMm / 1000, hMm / 1000], rgb }
}

/**
 * The mirrored Build-workspace position for a placed part (#716, decided under
 * epic #720). RobotPart.x/y are stored in the wiring canvas's viewBox PIXELS —
 * NOT millimetres — drawn at one dynamic px-per-mm (#637: the widest body fits
 * the cap), so the caller supplies that scale (`canvasPxPerMm`) and the px
 * divide out FIRST; the part's mm half-dimensions then re-centre the box (the
 * stored x/y is the part's top-left) and the result lands in metres on the
 * ground plane. Canvas y grows DOWN the screen while URDF y grows left, so y is
 * negated or the scene comes out mirror-imaged. `null` for a part placed
 * without a position (click-add auto-layout) — the caller falls back to the
 * legacy stagger. Best-effort mirroring by design: adding a new widest part
 * rescales the canvas under every stored position. Pure.
 */
export function mirroredOrigin(
  placed: Pick<RobotPart, 'x' | 'y'>,
  part: PartDefinition,
  pxPerMm: number
): [number, number, number] | null {
  if (typeof placed.x !== 'number' || typeof placed.y !== 'number' || !(pxPerMm > 0)) return null
  const dims = part.dimensions
  const cxMm = placed.x / pxPerMm + (dims && dims.width > 0 ? dims.width / 2 : 0)
  const cyMm = placed.y / pxPerMm + (dims && dims.height > 0 ? dims.height / 2 : 0)
  const round = (mm: number): number => Math.round(mm) / 1000
  return [round(cxMm), -round(cyMm), 0]
}

/**
 * The `<inertial>` a placed part contributes (#535's `library` mass source, live
 * at last): mass in grams → kilograms, CoM in part-frame millimetres → metres.
 * With no declared CoM, a box body defaults its CoM to the box centre (half the
 * box height up — a uniform box's true centroid) rather than the ground-plane
 * origin; a mesh body keeps the link origin. `null` when the part declares no
 * usable mass — absence, not zero, per the everywhere-else convention. Pure.
 */
export function partInertial(
  part: Pick<PartDefinition, 'mass_g' | 'com_xyz'>,
  boxHeightM?: number
): InertialSpec | null {
  if (typeof part.mass_g !== 'number' || part.mass_g <= 0) return null
  const com: [number, number, number] = part.com_xyz
    ? [part.com_xyz[0] / 1000, part.com_xyz[1] / 1000, part.com_xyz[2] / 1000]
    : [0, 0, boxHeightM ? boxHeightM / 2 : 0]
  return { mass: part.mass_g / 1000, com }
}

/**
 * Run an arbitrary URDF edit on the SAME serialisation chain the placement
 * bridge uses (#717: the sync reconcile removes links, swaps placeholders for
 * meshes and writes library masses — read-modify-writes that would race a
 * concurrent drop if they went around the chain). `edit` gets the current text
 * and returns the new text, or `null` for "leave the file alone". Resolves true
 * when a write happened (the URDF-changed bus is notified); false otherwise.
 */
export async function queueUrdfEdit(
  folder: string,
  urdfName: string,
  edit: (urdf: string) => string | null
): Promise<boolean> {
  if (!folder || !safeUrdfName(urdfName)) return false
  let wrote = false
  const run = chain.then(async () => {
    const urdfPath = `${folder.replace(/[/\\]$/, '')}/${urdfName}`
    let urdf: string
    try {
      urdf = await window.api.fs.readFile(urdfPath)
    } catch {
      return // no URDF — nothing to edit
    }
    const next = edit(urdf)
    if (next == null || next === urdf) return
    await window.api.fs.writeFile(urdfPath, next)
    wrote = true
    window.api.robot.notifyUrdfChanged()
  })
  chain = run.catch(() => undefined)
  await run
  return wrote
}

/**
 * Give `part` its Build-workspace body in the project URDF `urdfName`: the
 * bundled mesh when it has one, else the footprint box; at the mirrored board
 * position when the placement carries one; with `<inertial>` when the part
 * declares mass. Creates a blank URDF at that name if the project had none.
 * Only touches the `.urdf` file (+ its `meshes/`) — the CALLER links `urdfName`
 * in `robot.yml` and persists the returned link name as `RobotPart.urdfLink`.
 * Resolves to the created link name, or `null` when nothing was written (no
 * folder / unsafe name). Best-effort on the mesh copy: a failed copy degrades to
 * the footprint box so the part still has a body. Announces the URDF change so
 * an open Build view refreshes (#716 — previously only a remount noticed).
 */
export async function attachPartBody(
  folder: string,
  urdfName: string,
  libraryId: string,
  part: PartDefinition,
  /** Joint origin in metres (the caller's mirrored board position), or null for
   *  the legacy stagger. */
  atOrigin: [number, number, number] | null
): Promise<string | null> {
  if (!folder || !safeUrdfName(urdfName)) return null
  let created: string | null = null
  const run = chain.then(async () => {
    const dir = folder.replace(/[/\\]$/, '')
    const urdfPath = `${dir}/${urdfName}`
    // Copy the part's bundled STL into <dir>/meshes/ (collision-safe, in main).
    const res = part.mesh
      ? await window.api.robot
          .importPartMesh(urdfPath, libraryId, part.id, part.mesh)
          .catch(() => null)
      : null
    // Read the project URDF, or start a blank one if the project had none.
    let urdf: string
    try {
      urdf = await window.api.fs.readFile(urdfPath)
    } catch {
      urdf = blankUrdf('my_robot')
    }
    const at = atOrigin ?? undefined
    let link: string
    if (res?.rel) {
      const scale = meshImportScale(part, res.maxDim)
      ;({ urdf, link } = addMeshLink(urdf, {
        meshRel: res.rel,
        linkBase: part.name || part.id,
        scale,
        parent: rootLink(urdf),
        at
      }))
      const inertial = partInertial(part)
      if (inertial) urdf = setInertial(urdf, link, inertial)
    } else {
      const box = placeholderBoxSpec(part)
      ;({ urdf, link } = addBoxLink(urdf, {
        linkBase: part.name || part.id,
        size: box.size,
        rgb: box.rgb,
        parent: rootLink(urdf),
        at
      }))
      const inertial = partInertial(part, box.size[2])
      if (inertial) urdf = setInertial(urdf, link, inertial)
    }
    await window.api.fs.writeFile(urdfPath, urdf)
    created = link
    // Tell every window's Build view the URDF changed on disk (#716) — without
    // this, an open Robot View shows the new part only after a remount.
    window.api.robot.notifyUrdfChanged()
  })
  // Keep the chain alive even if this drop throws, so a later drop still runs.
  chain = run.catch(() => undefined)
  await run
  return created
}
