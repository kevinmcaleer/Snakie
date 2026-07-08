/**
 * ROBOT BUILD MATH (#315a, epic #309 Phase 5) — PURE, unit-tested. The push/pull
 * face-drag maths, free of three.js: which dimension a picked face edits, snapping
 * a dimension to a friendly grid, and resizing a primitive while keeping the
 * OPPOSITE face fixed (Fusion-style). Sizes are in METRES. `dims` is kind-shaped:
 * box `[x, y, z]`, cylinder `[radius, length]`, sphere `[radius]`.
 */
export type PrimitiveKind = 'box' | 'cylinder' | 'sphere'
export type Vec3 = [number, number, number]

/** The active builder tool (#335). */
export type BuildTool = 'select' | 'pushpull' | 'move' | 'joint'

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

// ── Snap points + move (#335) — PURE, unit-tested ───────────────────────────

/** A Fusion-style snap handle on a face: a corner, edge-midpoint, or the centre. */
export interface SnapPoint {
  p: Vec3
  role: 'corner' | 'edge' | 'centre'
}

/**
 * The snap handles of a picked face, in the LINK frame (metres): a box face gives
 * 4 corners + 4 edge-mids + centre; a cylinder cap gives a rim circle + centre;
 * anything else gives just the primitive centre. Reaches world via
 * `applyMatrix4(link.matrixWorld)` (rigid — no scale) in the view.
 */
export function faceSnapPoints(geom: { kind: PrimitiveKind; dims: number[]; origin: Vec3 }, face: FaceEdit): SnapPoint[] {
  const o = geom.origin
  if (geom.kind === 'box') {
    const h = [geom.dims[0] / 2, geom.dims[1] / 2, geom.dims[2] / 2]
    const a = face.axis
    const [u, v] = ([0, 1, 2].filter((i) => i !== a) as [number, number])
    const ca = o[a] + face.sign * h[a]
    const pt = (su: number, sv: number, role: SnapPoint['role']): SnapPoint => {
      const p: Vec3 = [0, 0, 0]
      p[a] = ca
      p[u] = o[u] + su * h[u]
      p[v] = o[v] + sv * h[v]
      return { p, role }
    }
    return [
      pt(1, 1, 'corner'), pt(1, -1, 'corner'), pt(-1, 1, 'corner'), pt(-1, -1, 'corner'),
      pt(1, 0, 'edge'), pt(-1, 0, 'edge'), pt(0, 1, 'edge'), pt(0, -1, 'edge'),
      pt(0, 0, 'centre')
    ]
  }
  if (geom.kind === 'cylinder' && face.axis === 2) {
    const r = geom.dims[0]
    const cz = o[2] + face.sign * (geom.dims[1] / 2)
    const d = r / Math.SQRT2
    return [
      { p: [o[0], o[1], cz], role: 'centre' },
      { p: [o[0] + r, o[1], cz], role: 'edge' }, { p: [o[0] - r, o[1], cz], role: 'edge' },
      { p: [o[0], o[1] + r, cz], role: 'edge' }, { p: [o[0], o[1] - r, cz], role: 'edge' },
      { p: [o[0] + d, o[1] + d, cz], role: 'corner' }, { p: [o[0] - d, o[1] + d, cz], role: 'corner' },
      { p: [o[0] + d, o[1] - d, cz], role: 'corner' }, { p: [o[0] - d, o[1] - d, cz], role: 'corner' }
    ]
  }
  return [{ p: [o[0], o[1], o[2]], role: 'centre' }]
}

/** Index of the nearest candidate point to `to` (Euclidean), or -1 if empty. */
export function nearestIndex(cands: readonly Vec3[], to: Vec3): { index: number; dist: number } {
  let index = -1
  let best = Infinity
  for (let i = 0; i < cands.length; i++) {
    const c = cands[i]
    const dx = c[0] - to[0]
    const dy = c[1] - to[1]
    const dz = c[2] - to[2]
    const d = dx * dx + dy * dy + dz * dz
    if (d < best) {
      best = d
      index = i
    }
  }
  return { index, dist: index < 0 ? Infinity : Math.sqrt(best) }
}

/**
 * Rotate a WORLD delta into the PARENT link frame (the fixed-joint origin frame).
 * `parentBasis` is the column-major 3×3 of the parent link's world matrix
 * (THREE.Matrix3().setFromMatrix4(parentLink.matrixWorld).elements); since link
 * transforms are rigid, the parent-frame delta is Rᵀ·d.
 */
export function worldDeltaToParent(worldDelta: Vec3, parentBasis: readonly number[]): Vec3 {
  const [dx, dy, dz] = worldDelta
  const e = parentBasis
  return [
    e[0] * dx + e[1] * dy + e[2] * dz,
    e[3] * dx + e[4] * dy + e[5] * dz,
    e[6] * dx + e[7] * dy + e[8] * dz
  ]
}

/** The moved fixed-joint origin: old origin + the world delta in the parent frame,
 *  optionally grid-snapped per axis. */
export function movedJointOrigin(
  oldXyz: Vec3,
  worldDelta: Vec3,
  parentBasis: readonly number[],
  opts: { step?: number } = {}
): Vec3 {
  const l = worldDeltaToParent(worldDelta, parentBasis)
  const r: Vec3 = [oldXyz[0] + l[0], oldXyz[1] + l[1], oldXyz[2] + l[2]]
  const s = opts.step
  return s ? [snapDimension(r[0], s), snapDimension(r[1], s), snapDimension(r[2], s)] : r
}

/** The joint origin (in B's frame) that makes A's local point coincide with B's —
 *  a plain subtraction (both points are in their own axis-aligned link frames). */
export function jointOriginForCoincident(aLocal: Vec3, bLocal: Vec3): Vec3 {
  return [bLocal[0] - aLocal[0], bLocal[1] - aLocal[1], bLocal[2] - aLocal[2]]
}

/**
 * Which principal axis a joint's `<axis>` vector points along, so the editor can
 * highlight the right X/Y/Z button. `'custom'` = an off-axis vector, `'none'` =
 * no axis (a fixed joint). Sign is ignored (X and −X both read as `'x'`).
 */
export function principalAxisName(axis: Vec3 | null): 'x' | 'y' | 'z' | 'custom' | 'none' {
  if (!axis) return 'none'
  const [x, y, z] = axis.map((n) => Math.abs(n))
  if (x > 0 && y === 0 && z === 0) return 'x'
  if (y > 0 && x === 0 && z === 0) return 'y'
  if (z > 0 && x === 0 && y === 0) return 'z'
  return 'custom'
}
