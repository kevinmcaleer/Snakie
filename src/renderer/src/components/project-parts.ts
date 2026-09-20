/**
 * SHARED "ADD PART(S) TO PROJECT" (#716, epic #720) — the ONE sequence that puts
 * library parts into robot.yml and gives each a Build-workspace body, used by
 * the in-window BoardPane, the pop-out board-main window AND the I²C-detect
 * scanner's "add this part". The logic was previously duplicated per host and
 * had already diverged: batch add (#613) skipped the Build side entirely, so
 * catalog-added parts never reached the 3-D view.
 *
 * Sequence per add:
 *  1. Assign unique instance ids across the whole batch ('board' reserved — the
 *     MCU's canvas key must never be shadowed).
 *  2. Save robot.yml with the new parts SYNCHRONOUSLY, linking `robot.urdf` if
 *     the project has none — so a rapid second drop or cross-window reload can't
 *     clobber the manifest.
 *  3. Give each part its URDF body via {@link attachPartBody} (mesh or footprint
 *     box, mirrored position, inertial), serialised on the bridge's chain.
 *  4. Record the created link names as `urdfLink` (#626 Part 1) via the MAIN
 *     process's targeted `robot:patchPartLinks` merge — never by saving this
 *     renderer's whole (by then stale) document back, which would silently
 *     revert anything another window saved while the meshes were copying.
 */
import type { PartDefinition, PartLibraryWithParts } from '../../../shared/part'
import type { RobotDefinition, RobotPart } from '../../../shared/robot'
import { readRobotModel } from '../../../shared/krf'
import { attachPartBody, mirroredOrigin } from './robot-part-mesh'
import { errorMessage, reportError } from '../lib/report-error'
import { PX_PER_MM } from './WiringCanvas'

/** What a board host lends the shared add sequence. `libraries` feeds part
 *  resolution for the canvas-scale maths (see {@link canvasPxPerMm}). */
export interface PartsProjectHost {
  robot: RobotDefinition
  folder: string | null | undefined
  libraries: PartLibraryWithParts[]
  saveRobot: (next: RobotDefinition) => void
}

/** One part to add; `pos` is the drag-drop canvas position (viewBox px), absent
 *  on click/catalog adds (the canvas auto-lays those out). */
export interface AddPartItem {
  libraryId: string
  part: PartDefinition
  pos?: { x: number; y: number }
}

/**
 * The wiring canvas's px-per-mm — the SAME number WiringCanvas draws at. It is a
 * FIXED scale ({@link PX_PER_MM}): adding a large part no longer rescales every
 * other body (that used to leave the board's fixed-size pads overlapping), so a
 * stored RobotPart.x/y always means the same millimetres. The Build mirror (#716)
 * converts px to mm with exactly this number. Pure.
 */
export function canvasPxPerMm(): number {
  return PX_PER_MM
}

/** The planned outcome of an add: the new placed parts and the manifest to save
 *  (with `robot.urdf` linked when a Build body will be written). Pure — this is
 *  the testable half of {@link addPartsToProject}. */
export function planPartAdditions(
  robot: RobotDefinition,
  items: AddPartItem[],
  willAttachBodies: boolean
): { placed: RobotPart[]; next: RobotDefinition; urdfName: string } {
  const ids = new Set(['board', ...robot.parts.map((p) => p.id)])
  const placed = items.map(({ libraryId, part, pos }) => {
    let id = part.id
    let n = 2
    while (ids.has(id)) id = `${part.id}${n++}`
    ids.add(id)
    const row: RobotPart = { id, lib: libraryId, part: part.id, label: part.name }
    if (pos) {
      row.x = Math.round(pos.x)
      row.y = Math.round(pos.y)
    }
    return row
  })
  const existingUrdf = readRobotModel(robot)?.urdf
  const urdfName = existingUrdf || 'robot.urdf'
  const withParts: RobotDefinition = { ...robot, parts: [...robot.parts, ...placed] }
  const next =
    willAttachBodies && !existingUrdf
      ? { ...withParts, robot: { ...(withParts.robot ?? {}), version: 1, urdf: urdfName } }
      : withParts
  return { placed, next, urdfName }
}

/**
 * Add `items` to the project through `host`. Fire-and-forget: the manifest save
 * is synchronous (optimistic), the Build bodies land asynchronously behind it.
 */
export function addPartsToProject(host: PartsProjectHost, items: AddPartItem[]): void {
  if (items.length === 0) return
  const folder = host.folder ?? ''
  const { placed, next, urdfName } = planPartAdditions(host.robot, items, Boolean(folder))
  host.saveRobot(next)
  if (!folder) return
  const pxPerMm = canvasPxPerMm()
  void (async (): Promise<void> => {
    // Sequential on purpose: attachPartBody serialises on its own chain anyway,
    // and doing it here keeps link creation in placement order.
    const links: { partId: string; link: string }[] = []
    for (let i = 0; i < placed.length; i++) {
      const at = mirroredOrigin(placed[i], items[i].part, pxPerMm)
      const body = await attachPartBody(folder, urdfName, items[i].libraryId, items[i].part, at).catch(
        (err: unknown) => ({ link: null, problem: errorMessage(err) })
      )
      // A part that declares a mesh and didn't get one still gets a box — but
      // the user is told, in the status bar, rather than left with a mystery
      // block that reads as a rendering bug (#787 fault 3).
      if (body.problem) {
        reportError('build: part mesh', body.problem, { notify: body.problem })
      }
      if (body.link) links.push({ partId: placed[i].id, link: body.link })
    }
    if (links.length === 0) return
    // Targeted merge in MAIN against the file's current state — a part deleted
    // while its body was being written is skipped there (#717 reconciles it).
    await window.api.robot.patchPartLinks(folder || undefined, links).catch(() => undefined)
  })()
}

/**
 * The post-add mip offer (#166), shared verbatim by both hosts: offer the part's
 * linked MicroPython library ONLY when the part ships no bundled drivers — when
 * it declares `drivers`, the Driver Install banner owns the install (an extra
 * mip offer is redundant, and a stale `library.url` fails confusingly).
 */
export function offerLibraryInstall(part: PartDefinition): void {
  const lib = part.library
  if (!lib?.url || (part.drivers && part.drivers.length > 0)) return
  const mod = lib.module || part.name
  if (
    !window.confirm(
      `Install the "${mod}" MicroPython library for "${part.name}" onto the connected board?`
    )
  ) {
    return
  }
  void window.api.packages
    .install(lib.url)
    .then((r) => {
      if (!r.ok) {
        window.alert(`Couldn't install ${mod}.\n${r.log || 'Open the Packages panel for details.'}`)
      } else {
        // Files landed on the board — the main window's Device Files tree +
        // library banners refresh off this broadcast.
        window.api.modules.notifyChanged()
      }
    })
    .catch(() => window.alert(`Couldn't install ${mod} — is a board connected?`))
}
