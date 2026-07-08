/**
 * ROBOT BUILD MATH (#315a, epic #309 Phase 5) — PURE, unit-tested. The push/pull
 * face-drag maths, free of three.js: which dimension a picked face edits, snapping
 * a dimension to a friendly grid, and resizing a primitive while keeping the
 * OPPOSITE face fixed (Fusion-style). Sizes are in METRES. `dims` is kind-shaped:
 * box `[x, y, z]`, cylinder `[radius, length]`, sphere `[radius]`.
 */
export type PrimitiveKind = 'box' | 'cylinder' | 'sphere'

/** Which dimension a picked face resizes, and how. */
export interface FaceEdit {
  /** The LINK-frame axis the face normal points along (0=x, 1=y, 2=z). */
  axis: 0 | 1 | 2
  /** +1 for the +axis face, −1 for the −axis face. */
  sign: 1 | -1
  /** Index into `dims` that this face grows. */
  dim: number
  /** True when the shape is symmetric about the axis (radius/sphere) — no origin
   *  shift needed; false (box face, cylinder cap) shifts the origin to pin the
   *  opposite face. */
  symmetric: boolean
}

/**
 * Classify a picked face from its LINK-frame normal + the primitive kind. Returns
 * null only for a non-primitive. The cylinder's length axis is the link Z (the
 * mesh is rotated 90° so geometry-Y → link-Z), so a |z|-dominant normal is the
 * CAP (edits length) and any other is the SIDE (edits radius).
 */
export function classifyFace(nLink: readonly [number, number, number], kind: PrimitiveKind): FaceEdit {
  const abs = [Math.abs(nLink[0]), Math.abs(nLink[1]), Math.abs(nLink[2])]
  const axis: 0 | 1 | 2 = abs[0] >= abs[1] && abs[0] >= abs[2] ? 0 : abs[1] >= abs[2] ? 1 : 2
  const sign: 1 | -1 = nLink[axis] >= 0 ? 1 : -1
  if (kind === 'box') return { axis, sign, dim: axis, symmetric: false }
  if (kind === 'sphere') return { axis, sign, dim: 0, symmetric: true }
  // cylinder
  if (axis === 2) return { axis: 2, sign, dim: 1, symmetric: false } // cap → length (dims[1])
  return { axis, sign, dim: 0, symmetric: true } // side → radius (dims[0]), symmetric
}

/** Snap a metre dimension to a `step` grid (e.g. 5 mm), keeping it finite. */
export function snapDimension(metres: number, step: number): number {
  if (!(step > 0) || !Number.isFinite(metres)) return metres
  // Round via mm to avoid float cruft, then back to metres.
  return Math.round(metres / step) * step
}

/**
 * Resize a primitive from a face drag. `deltaM` is the signed distance (metres)
 * the grabbed face travels along its OUTWARD normal (+ grows). Snaps the resulting
 * dimension to `step`, clamps to `min`, and — for an asymmetric face (box, cylinder
 * cap) — shifts the visual origin by half the growth so the opposite face stays put.
 */
export function resizeFromDrag(
  dims: readonly number[],
  origin: readonly [number, number, number],
  face: FaceEdit,
  deltaM: number,
  opts: { min?: number; step?: number } = {}
): { dims: number[]; origin: [number, number, number] } {
  const min = opts.min ?? 0.002
  const step = opts.step ?? 0.005
  const d = [...dims]
  const o: [number, number, number] = [origin[0], origin[1], origin[2]]
  const oldDim = d[face.dim]
  let newDim = snapDimension(oldDim + deltaM, step)
  if (!(newDim >= min)) newDim = min
  // Clean tiny float error so the emitted XML is tidy (5 mm grid → 4 dp is exact).
  newDim = Math.round(newDim * 1e6) / 1e6
  d[face.dim] = newDim
  if (!face.symmetric) o[face.axis] += (face.sign * (newDim - oldDim)) / 2
  return { dims: d, origin: o }
}
