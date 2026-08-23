/**
 * MESH POSITION (#788) — the other half of #741's orientation correction.
 * =============================================================================
 *
 * An STL's origin is wherever the exporter left it: a corner of the build plate,
 * the centre of a sketch, sometimes a point outside the model entirely. Snakie's
 * convention is board flat in XY, **Z up**, underside resting on `z = 0`, origin
 * at the part's centre — and until this module there was no way to say "the file
 * disagrees" short of re-exporting from CAD.
 *
 * Same bargain as the rotation: **store, don't bake.** The user's file is never
 * rewritten; the part records `meshOffset` and every consumer honours it.
 * Absent ⇒ no translation, so parts authored before this keep working.
 *
 * ## The representation: millimetres, in the part's own frame
 *
 * `PartDefinition.meshOffset` is `[x, y, z]` **millimetres**. Millimetres
 * because every other physical length in the schema is millimetres —
 * `dimensions`, `pinSpacing`, `com_xyz`, `contacts` — so an offset can be read
 * against the part's declared size without a conversion in the reader's head.
 * The URDF boundary divides by 1000, and that is the only conversion.
 *
 * ## AFTER the rotation — the decision, and why it is the only workable one
 *
 * The composition is
 *
 *     p_part = R(meshRotation) · p_mesh + meshOffset
 *
 * i.e. the model is turned first, then slid along the **part frame's** axes —
 * the ones drawn in the editor's stage, which do not move as the model turns.
 * Three reasons, and they agree:
 *
 *  1. **It is what a user sees.** Nudging *after* rotating must move the model
 *    along the axis on the button. Offset-before-rotation would send it along
 *    the mesh's own tilted axes, so +X would drift diagonally once the part was
 *    turned — the exact complaint that made `rotateMesh` pre-multiply rather
 *    than add to an Euler component.
 *  2. **It is what URDF already means.** `<visual><origin xyz rpy>` is defined
 *    as rotate-by-rpy-then-translate-by-xyz, both in the link frame. Matching it
 *    means the boundary writes the stored numbers straight out (÷1000) with no
 *    compensation term. Offset-first would need `xyz = R · t` reproduced
 *    identically in the editor stage, the catalog viewer and the URDF writer —
 *    three chances to disagree, which is precisely how this class of bug ships.
 *  3. **It makes snapping arithmetic rather than search.** With the translation
 *    last, putting a chosen feature of the rotated model at the origin is just
 *    `offset = −feature`. See {@link snapOffsetFor}.
 *
 * In three.js this needs no extra group: a `THREE.Object3D` composes its own
 * matrix as `T · R · S`, so setting `position` on the SAME group that carries
 * the rotation gives exactly the product above.
 *
 * ## No guessing (the Join tool's lesson, #785)
 *
 * There is no auto-fit here and no inference of what the user "probably meant".
 * They name the feature — a corner, an edge midpoint, a face centre, the centre
 * — and this module does the arithmetic. {@link MeshAnchor} is three
 * independent per-axis picks precisely so that the whole vocabulary is one
 * predictable rule rather than a list of special cases.
 *
 * Everything here is pure and DOM-free: `test/meshOffset.test.ts` holds it.
 */

import type { MeshAxis } from './mesh-rotation'

/** A mesh position correction: `[x, y, z]` millimetres in the part's frame. */
export type MeshOffset = [number, number, number]

/** Below this many millimetres an offset is treated as no offset at all. */
const ZERO_EPSILON = 1e-4

/** Millimetres kept when an offset is stored — 0.001 mm is a micron, well past
 *  any print tolerance, and it stops float dust reaching `parts.yml`. */
const DECIMALS = 3

/** Which slot of a {@link MeshOffset} an axis occupies. */
export const OFFSET_AXIS_INDEX: Record<MeshAxis, 0 | 1 | 2> = { x: 0, y: 1, z: 2 }

/**
 * The nudge steps the editor offers, in millimetres — **fixed**, not a fraction
 * of the model.
 *
 * A fixed step is reproducible: the same button moves a 5 mm sensor and a 100 mm
 * battery by the same distance, the number that lands in `parts.yml` is one a
 * person chose, and it can be checked against the part's declared `dimensions`
 * without knowing the model's bounding box. A proportional step adapts, but the
 * distance it moves is then unknowable without measuring the mesh first, and two
 * parts nudged "three clicks left" end up differently placed.
 *
 * The three values are a decade apart and each means something concrete: 0.1 mm
 * is finer than any FDM layer, 1 mm is the default working unit, and 10 mm is
 * exactly ONE SQUARE of the stage's grid — so the coarse step is a distance you
 * can watch happen rather than infer.
 */
export const MESH_NUDGE_STEPS_MM = [0.1, 1, 10] as const

/** Tidy a millimetre value: finite, rounded, and never a negative zero (which
 *  serialises as `-0` and reads as a mistake). */
function tidy(mm: number): number {
  if (!Number.isFinite(mm)) return 0
  const v = Math.round(mm * 10 ** DECIMALS) / 10 ** DECIMALS
  return v === 0 ? 0 : v
}

/**
 * Coerce anything off a `parts.yml` (or an editor state) into a usable offset.
 *
 * `undefined` — meaning "no translation" — for a malformed value AND for a zero
 * one. Absence is the identity everywhere in this schema, so a model nudged back
 * to where it started writes no `meshOffset` at all rather than a `[0, 0, 0]`
 * that would sit in every diff for ever. Exactly `coerceMeshRotation`'s rule.
 */
export function coerceMeshOffset(raw: unknown): MeshOffset | undefined {
  if (!Array.isArray(raw) || raw.length !== 3) return undefined
  const v = raw.map((n) => (typeof n === 'number' && Number.isFinite(n) ? tidy(n) : NaN))
  if (v.some((n) => !Number.isFinite(n))) return undefined
  const out: MeshOffset = [v[0], v[1], v[2]]
  return isZeroOffset(out) ? undefined : out
}

/** True when the offset moves nothing (and so should not be persisted). */
export function isZeroOffset(o: MeshOffset | undefined | null): boolean {
  if (!o) return true
  return o.every((n) => Math.abs(n) < ZERO_EPSILON)
}

/** The offset in METRES, for the URDF world. */
export function meshOffsetMetres(o: MeshOffset | undefined | null): [number, number, number] {
  if (!o) return [0, 0, 0]
  return [o[0] / 1000, o[1] / 1000, o[2] / 1000]
}

/** The URDF `xyz` attribute value (metres, space-separated), `dp` decimals. */
export function meshOffsetXyz(o: MeshOffset | undefined | null, dp = 6): string {
  const trim = (n: number): string => {
    const s = n.toFixed(dp)
    return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s
  }
  return meshOffsetMetres(o)
    .map((n) => trim(Object.is(n, -0) ? 0 : n))
    .join(' ')
}

/**
 * Slide the model a further `mm` along ONE of the part frame's axes — what the
 * editor's nudge buttons do.
 *
 * Plain addition, and that is the point: because the translation is applied
 * after the rotation, the axes never move, so a nudge is the same displacement
 * whatever the model's attitude. (Contrast `rotateMesh`, which has to
 * pre-multiply matrices for exactly the reason this does not.)
 *
 * `undefined` when the result is zero, so the caller drops the field rather than
 * persisting a no-op.
 */
export function nudgeMeshOffset(
  current: MeshOffset | undefined | null,
  axis: MeshAxis,
  mm: number
): MeshOffset | undefined {
  const base: MeshOffset = current ? [current[0], current[1], current[2]] : [0, 0, 0]
  base[OFFSET_AXIS_INDEX[axis]] = tidy(base[OFFSET_AXIS_INDEX[axis]] + (Number.isFinite(mm) ? mm : 0))
  return isZeroOffset(base) ? undefined : base
}

/** Set one component directly (the numeric fields). `undefined` when the result
 *  is zero — same rule as {@link nudgeMeshOffset}. */
export function setMeshOffsetAxis(
  current: MeshOffset | undefined | null,
  axis: MeshAxis,
  mm: number
): MeshOffset | undefined {
  const base: MeshOffset = current ? [current[0], current[1], current[2]] : [0, 0, 0]
  base[OFFSET_AXIS_INDEX[axis]] = tidy(mm)
  return isZeroOffset(base) ? undefined : base
}

/** A short human label — `"none"`, or `"0 mm, -12.5 mm, 3 mm"`. */
export function formatMeshOffset(o: MeshOffset | undefined | null): string {
  if (isZeroOffset(o)) return 'none'
  return (o as MeshOffset).map((n) => `${tidy(n)} mm`).join(', ')
}

// --- Snapping a chosen feature to the origin --------------------------------

/**
 * An axis-aligned box in the part's own frame, millimetres — the model's extent
 * AFTER its rotation and scale, and BEFORE its offset.
 *
 * "Before its offset" is deliberate and is what keeps {@link snapOffsetFor} a
 * pure function of the box: the answer then does not depend on where the model
 * happens to be sitting right now, so snapping twice to the same feature gives
 * the same offset rather than compounding.
 */
export interface MeshBounds {
  min: [number, number, number]
  max: [number, number, number]
}

/** Which end of one axis a feature sits at. */
export type MeshAnchorAxis = 'min' | 'centre' | 'max'

/** The feature of the bounding box that goes to the origin, named one axis at a
 *  time. Three independent picks span the whole vocabulary the issue asks for:
 *  all three `centre` is the CENTRE, all three at an extreme is one of the 8
 *  CORNERS, two extremes and a centre is one of the 12 EDGE midpoints, and one
 *  extreme with two centres is one of the 6 FACE centres. */
export type MeshAnchor = [MeshAnchorAxis, MeshAnchorAxis, MeshAnchorAxis]

/** The box's centre: the anchor a fresh snap starts from. */
export const CENTRE_ANCHOR: MeshAnchor = ['centre', 'centre', 'centre']

/** The point of `box` that `anchor` names, in part-frame millimetres. */
export function anchorPoint(box: MeshBounds, anchor: MeshAnchor): [number, number, number] {
  const at = (i: 0 | 1 | 2): number => {
    const lo = box.min[i]
    const hi = box.max[i]
    if (anchor[i] === 'min') return lo
    if (anchor[i] === 'max') return hi
    return (lo + hi) / 2
  }
  return [at(0), at(1), at(2)]
}

/**
 * The offset that puts `anchor` exactly on the origin.
 *
 * Because the translation is applied last, this is simply the negated feature
 * point — no matrices, no search, no fitting. The user says which corner (or
 * edge, or face, or the centre) belongs at (0, 0, 0) and this is the arithmetic
 * that gets it there; nothing here infers what they might have wanted.
 *
 * `undefined` when the answer is "don't move", so the caller drops the field.
 */
export function snapOffsetFor(box: MeshBounds, anchor: MeshAnchor): MeshOffset | undefined {
  const [x, y, z] = anchorPoint(box, anchor)
  const out: MeshOffset = [tidy(-x), tidy(-y), tidy(-z)]
  return isZeroOffset(out) ? undefined : out
}

/** What the picked anchor IS, in words — "centre", "face centre", "edge
 *  midpoint" or "corner" — so the button can say what it is about to snap. */
export function describeAnchor(anchor: MeshAnchor): string {
  const extremes = anchor.filter((a) => a !== 'centre').length
  if (extremes === 0) return 'centre'
  if (extremes === 1) return 'face centre'
  if (extremes === 2) return 'edge midpoint'
  return 'corner'
}
