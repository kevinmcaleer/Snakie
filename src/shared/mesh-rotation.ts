/**
 * MESH ORIENTATION (#741) — the correction a part carries for its linked STL.
 * =============================================================================
 *
 * A downloaded STL follows no convention. Snakie's is the one the generated
 * Modulino mesh (#722) and the footprint-box placeholders (#716) both keep: the
 * board lies flat in XY, **Z is up**, the underside sits on `z = 0`. A mesh
 * authored Y-up, or lying on its side, lands wrong every time it is placed and
 * — until this module — there was nowhere to say so.
 *
 * **Store, don't bake** (Kevin's decision on #741). The user's file is never
 * rewritten; the part records a rotation and every consumer honours it. So the
 * original stays intact, the correction is reversible, and a part authored
 * before this existed keeps working: absent ⇒ identity, no migration.
 *
 * ## The representation: URDF roll-pitch-yaw, in degrees
 *
 * `PartDefinition.meshRotation` is `[x, y, z]` **degrees**, and it is the URDF
 * `rpy` convention — fixed-axis XYZ, i.e.
 *
 *     R = Rz(yaw) · Ry(pitch) · Rx(roll)
 *
 * Chosen because the rotation's destination is a URDF `<visual><origin rpy>`:
 * writing it in URDF's own convention means the only conversion at that boundary
 * is degrees → radians, so there is no axis-order mismatch to get wrong. Degrees
 * (not radians) because the values a human writes and reads in `parts.yml` are
 * `90` and `-90`, and because the whole point is that this is *editable*.
 *
 * Three.js consumers want {@link meshRotationRadians} fed into a `THREE.Euler`
 * with order **`'ZYX'`** — that is three's spelling of the same product.
 *
 * Everything here is pure and DOM-free: `test/meshRotation.test.ts` holds it.
 */

/** A mesh orientation: `[x, y, z]` degrees in the URDF roll-pitch-yaw convention. */
export type MeshRotation = [number, number, number]

/** A 3×3 rotation matrix, row-major (`m[row * 3 + col]`). */
export type Mat3 = readonly [number, number, number, number, number, number, number, number, number]

/** Below this many degrees a rotation is treated as no rotation at all. */
const IDENTITY_EPSILON = 1e-4

/** Below this the pitch is at ±90° and roll/yaw are no longer separable. */
const GIMBAL_EPSILON = 1e-9

const DEG = Math.PI / 180

/**
 * Wrap an angle into `(-180, 180]` and tidy the floating-point dust off it.
 *
 * Two jobs in one, both about what a human then reads in `parts.yml`: three 90°
 * turns should say `-90`, not `270`; and `atan2` on a matrix built from exact
 * quarter turns returns `89.99999999999999`, which must not be what a save
 * writes. Near-integers snap; a deliberate `22.5` does not.
 */
export function normaliseAngleDeg(deg: number): number {
  if (!Number.isFinite(deg)) return 0
  let v = ((deg % 360) + 360) % 360 // [0, 360)
  if (v > 180) v -= 360 // (-180, 180]
  v = Math.round(v * 1e4) / 1e4
  const nearest = Math.round(v)
  if (Math.abs(v - nearest) < 1e-3) v = nearest
  // -180 and 180 are the same turn; prefer the positive spelling, and never
  // write a negative zero (`-0` serialises as `-0` and reads as a mistake).
  if (v === -180) v = 180
  return v === 0 ? 0 : v
}

/**
 * Coerce anything off a `parts.yml` (or an editor state) into a usable rotation.
 *
 * Returns `undefined` — meaning "no correction" — for a malformed value AND for
 * an identity one. Absence is the identity everywhere in this schema, so a part
 * that has been rotated back to square writes no `meshRotation` at all rather
 * than a `[0, 0, 0]` that would sit in every diff forever.
 */
export function coerceMeshRotation(raw: unknown): MeshRotation | undefined {
  if (!Array.isArray(raw) || raw.length !== 3) return undefined
  const v = raw.map((n) => (typeof n === 'number' && Number.isFinite(n) ? normaliseAngleDeg(n) : NaN))
  if (v.some((n) => !Number.isFinite(n))) return undefined
  const out: MeshRotation = [v[0], v[1], v[2]]
  return isIdentityRotation(out) ? undefined : out
}

/** True when the rotation does nothing (and so should not be persisted). */
export function isIdentityRotation(r: MeshRotation | undefined | null): boolean {
  if (!r) return true
  return r.every((n) => Math.abs(normaliseAngleDeg(n)) < IDENTITY_EPSILON)
}

/** The same rotation in radians, for a `THREE.Euler(x, y, z, 'ZYX')`. */
export function meshRotationRadians(r: MeshRotation | undefined | null): [number, number, number] {
  if (!r) return [0, 0, 0]
  return [r[0] * DEG, r[1] * DEG, r[2] * DEG]
}

/** The URDF `rpy` attribute value (radians, space-separated), `dp` decimals. */
export function meshRotationRpy(r: MeshRotation | undefined | null, dp = 6): string {
  const trim = (n: number): string => {
    const s = n.toFixed(dp)
    // Strip trailing zeros so `0` stays `0` rather than `0.000000`.
    return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s
  }
  return meshRotationRadians(r)
    .map((n) => trim(Object.is(n, -0) ? 0 : n))
    .join(' ')
}

// --- The maths -------------------------------------------------------------

/** `R = Rz(yaw) · Ry(pitch) · Rx(roll)` — the URDF rpy product, from degrees. */
export function rotationMatrix(r: MeshRotation | undefined | null): Mat3 {
  const [a, b, c] = meshRotationRadians(r) // roll, pitch, yaw
  const sa = Math.sin(a)
  const ca = Math.cos(a)
  const sb = Math.sin(b)
  const cb = Math.cos(b)
  const sc = Math.sin(c)
  const cc = Math.cos(c)
  return [
    cb * cc, sa * sb * cc - ca * sc, ca * sb * cc + sa * sc,
    cb * sc, sa * sb * sc + ca * cc, ca * sb * sc - sa * cc,
    -sb, sa * cb, ca * cb
  ]
}

/**
 * The inverse of {@link rotationMatrix}: a rotation matrix back to rpy degrees.
 *
 * The decomposition is not unique — pitch is resolved into `[-90, 90]`, which is
 * the branch that yields the angles a person would have typed. At the poles
 * (pitch = ±90) roll and yaw describe the same turn, so yaw is pinned to 0 and
 * the whole rotation is carried by roll.
 */
export function matrixToRotation(m: Mat3): MeshRotation {
  const sb = -m[6]
  const cb = Math.hypot(m[0], m[3])
  const pitch = Math.atan2(sb, cb)
  let roll: number
  let yaw: number
  if (cb > GIMBAL_EPSILON) {
    yaw = Math.atan2(m[3], m[0])
    roll = Math.atan2(m[7], m[8])
  } else {
    yaw = 0
    roll = Math.atan2(sb > 0 ? m[1] : -m[1], m[4])
  }
  return [
    normaliseAngleDeg(roll / DEG),
    normaliseAngleDeg(pitch / DEG),
    normaliseAngleDeg(yaw / DEG)
  ]
}

/** `a · b`, row-major. */
export function multiplyMat3(a: Mat3, b: Mat3): Mat3 {
  const out = new Array<number>(9)
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      out[row * 3 + col] =
        a[row * 3] * b[col] + a[row * 3 + 1] * b[3 + col] + a[row * 3 + 2] * b[6 + col]
    }
  }
  return out as unknown as Mat3
}

/** Which axis a nudge turns the model about — the part's own frame, Z up. */
export type MeshAxis = 'x' | 'y' | 'z'

/** A rotation of `deg` about one axis. */
export function axisMatrix(axis: MeshAxis, deg: number): Mat3 {
  const s = Math.sin(deg * DEG)
  const c = Math.cos(deg * DEG)
  if (axis === 'x') return [1, 0, 0, 0, c, -s, 0, s, c]
  if (axis === 'y') return [c, 0, s, 0, 1, 0, -s, 0, c]
  return [c, -s, 0, s, c, 0, 0, 0, 1]
}

/**
 * Turn `current` a further `deg` about one of the **part frame's** axes — what
 * the editor's ±90° buttons do.
 *
 * Pre-multiplying (`axis · current`) is the deliberate half of this: the axes
 * the user is aiming at are the ones drawn in the scene, which do not move as
 * the model turns. Adding `deg` to the matching Euler component instead would
 * agree only for the first nudge and then quietly diverge — the classic reason a
 * rotate button "stops working properly" after a couple of presses.
 *
 * Returns `undefined` when the result is the identity, so the caller can drop
 * the field rather than persist a no-op.
 */
export function rotateMesh(
  current: MeshRotation | undefined | null,
  axis: MeshAxis,
  deg: number
): MeshRotation | undefined {
  const next = matrixToRotation(multiplyMat3(axisMatrix(axis, deg), rotationMatrix(current)))
  return isIdentityRotation(next) ? undefined : next
}

/** Set one component directly (the numeric fields), re-normalised. `undefined`
 *  when the result is the identity — same rule as {@link rotateMesh}. */
export function setMeshRotationAxis(
  current: MeshRotation | undefined | null,
  axis: MeshAxis,
  deg: number
): MeshRotation | undefined {
  const idx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2
  const base: MeshRotation = current ? [current[0], current[1], current[2]] : [0, 0, 0]
  base[idx] = normaliseAngleDeg(deg)
  return isIdentityRotation(base) ? undefined : base
}

/**
 * Apply the rotation to a point in the mesh's own frame — used to work out where
 * a corrected mesh's bounding box actually lands (is it still on the ground
 * plane?), and the one place the maths is checked against something physical.
 */
export function applyMeshRotation(
  r: MeshRotation | undefined | null,
  p: readonly [number, number, number]
): [number, number, number] {
  const m = rotationMatrix(r)
  return [
    m[0] * p[0] + m[1] * p[1] + m[2] * p[2],
    m[3] * p[0] + m[4] * p[1] + m[5] * p[2],
    m[6] * p[0] + m[7] * p[1] + m[8] * p[2]
  ]
}

/** A short human label for a rotation — `"none"`, or `"90°, 0°, -90°"`. */
export function formatMeshRotation(r: MeshRotation | undefined | null): string {
  if (isIdentityRotation(r)) return 'none'
  return (r as MeshRotation).map((n) => `${normaliseAngleDeg(n)}°`).join(', ')
}
