/**
 * THE BODY — where the whole robot sits, as part of a pose.
 * =============================================================================
 * A pose used to be joint values only, with the robot's first part nailed to
 * the origin. That is wrong for anything that stands: bend the knee of the leg
 * you are standing on and the BODY should move over the foot, not the foot
 * swing into the air. Pinning a foot (Animate ▸ Pin) does exactly that, and
 * the body's resulting position has to be remembered with the pose.
 *
 * It is stored IN the pose's `values`, under six reserved keys, so the file
 * format, the samplers and the easing all carry it for free (a joint can never
 * be called `@body.x`). Millimetres and degrees, like every other pose value,
 * in the robot's own frame (URDF: Z up). A pose WITHOUT the keys leaves the
 * body where it is — the same rule as a partial pose and its joints.
 *
 * Pure (no three.js / React), so it is unit-tested.
 */

export const BODY_KEYS = ['@body.x', '@body.y', '@body.z', '@body.rx', '@body.ry', '@body.rz'] as const
export type BodyKey = (typeof BODY_KEYS)[number]

/** Offset (mm) and tilt (degrees, XYZ order) of the robot's root. */
export interface BodyPose {
  x: number
  y: number
  z: number
  rx: number
  ry: number
  rz: number
}

export const HOME_BODY: BodyPose = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 }

const FIELDS = ['x', 'y', 'z', 'rx', 'ry', 'rz'] as const
const r2 = (n: number): number => Math.round(n * 100) / 100 || 0

export const isBodyKey = (k: string): boolean => (BODY_KEYS as readonly string[]).includes(k)

/** Does this pose say where the body is? */
export function hasBody(values: Record<string, number>): boolean {
  return BODY_KEYS.some((k) => typeof values[k] === 'number')
}

/** The body a pose stores, or `null` when it leaves the body alone. */
export function bodyOf(values: Record<string, number>): BodyPose | null {
  if (!hasBody(values)) return null
  const out = { ...HOME_BODY }
  FIELDS.forEach((f, i) => {
    const v = values[BODY_KEYS[i]]
    if (typeof v === 'number' && Number.isFinite(v)) out[f] = v
  })
  return out
}

/**
 * `values` with the body written in — rounded like every other pose value, or
 * `exact` for a live posture that will be put straight back on the model.
 */
export function withBody(values: Record<string, number>, body: BodyPose, exact = false): Record<string, number> {
  const out = { ...values }
  FIELDS.forEach((f, i) => {
    out[BODY_KEYS[i]] = exact ? body[f] : r2(body[f])
  })
  return out
}

/** `values` without the body keys. */
export function stripBody(values: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(values)) if (!isBodyKey(k)) out[k] = v
  return out
}

/** Copy the body keys (only) from `from` onto `values`. */
export function carryBody(values: Record<string, number>, from: Record<string, number>): Record<string, number> {
  const out = { ...values }
  for (const k of BODY_KEYS) if (typeof from[k] === 'number') out[k] = from[k]
  return out
}

export function isHomeBody(b: BodyPose, eps = 0.01): boolean {
  return FIELDS.every((f) => Math.abs(b[f]) <= eps)
}

type Vec3 = [number, number, number]

const norm = (v: Vec3): Vec3 | null => {
  const l = Math.hypot(v[0], v[1], v[2])
  return l > 1e-9 ? [v[0] / l, v[1] / l, v[2] / l] : null
}

/**
 * The body as it looks in a mirror standing along the robot's middle.
 * `lateral` is the left↔right direction in the robot's frame (URDF convention
 * is +Y; the caller can measure it from a left/right joint pair). A position
 * flips its sideways part; a tilt keeps its nod (about the sideways axis) and
 * flips its lean and its turn. Tilts are treated as a small rotation vector,
 * which is what a walking body's few degrees are.
 */
export function mirrorBody(b: BodyPose, lateral: Vec3 = [0, 1, 0]): BodyPose {
  const n = norm(lateral) ?? [0, 1, 0]
  const pd = b.x * n[0] + b.y * n[1] + b.z * n[2]
  const wd = b.rx * n[0] + b.ry * n[1] + b.rz * n[2]
  return {
    x: b.x - 2 * pd * n[0],
    y: b.y - 2 * pd * n[1],
    z: b.z - 2 * pd * n[2],
    rx: -b.rx + 2 * wd * n[0],
    ry: -b.ry + 2 * wd * n[1],
    rz: -b.rz + 2 * wd * n[2]
  }
}

/** Mirror the body keys of a pose's values (a pose without them is untouched). */
export function mirrorBodyValues(values: Record<string, number>, lateral?: Vec3): Record<string, number> {
  const b = bodyOf(values)
  return b ? withBody(values, mirrorBody(b, lateral)) : values
}

/**
 * WALK ON THE SPOT. Posing with a foot pinned makes the body travel forward
 * over that foot, which is right for one step but makes a looping walk drift
 * off and snap back. This takes the travel out: every pose's body keeps its
 * bob, sway and tilt, and loses its progress along the direction the walk goes
 * (first block → last block, flat on the floor). The feet then slide back
 * under the robot, as on a treadmill — how walk cycles are normally shown.
 *
 * `order` is the timeline's pose names in play order. Returns the same map when
 * there is nothing to take out.
 */
export function posesOnTheSpot(
  order: string[],
  posesByName: Record<string, Record<string, number>>
): Record<string, Record<string, number>> {
  const known = order.filter((n) => posesByName[n] && hasBody(posesByName[n]))
  if (known.length < 2) return posesByName
  const first = bodyOf(posesByName[known[0]])!
  // The walk's direction: the block that ends up furthest from the first.
  let far: Vec3 = [0, 0, 0]
  for (const n of known) {
    const b = bodyOf(posesByName[n])!
    const d: Vec3 = [b.x - first.x, b.y - first.y, 0]
    if (Math.hypot(d[0], d[1]) > Math.hypot(far[0], far[1])) far = d
  }
  if (Math.hypot(far[0], far[1]) < 1) return posesByName // under a millimetre: standing still
  const dir = norm(far)!
  const out = { ...posesByName }
  for (const n of new Set(known)) {
    const b = bodyOf(posesByName[n])!
    const along = (b.x - first.x) * dir[0] + (b.y - first.y) * dir[1]
    out[n] = withBody(posesByName[n], { ...b, x: b.x - along * dir[0], y: b.y - along * dir[1] })
  }
  return out
}

/** Does any pose on the timeline move the body (so "On the spot" means something)? */
export function timelineMovesBody(order: string[], posesByName: Record<string, Record<string, number>>): boolean {
  const bodies = order.map((n) => posesByName[n]).filter((v) => v && hasBody(v)).map((v) => bodyOf(v)!)
  if (bodies.length < 2) return false
  return bodies.some((b) => Math.hypot(b.x - bodies[0].x, b.y - bodies[0].y) >= 1)
}

/**
 * PIN CHAIN — the joints to turn when a part is dragged while another is pinned.
 * With nothing pinned a drag bends the joints between the part and the robot's
 * root. With a foot pinned, the foot is the fixed end instead: dragging the hips
 * must bend that leg's knee and ankle "backwards" (the body moves, the foot does
 * not). The chain runs from the dragged part to the pinned one — up to where
 * their branches meet, then down to the pin. Joints on the pin's side are
 * `reversed`: turning them moves the dragged part the opposite way.
 *
 * `parentJoint(link)` gives the joint above a link and that joint's parent link
 * (`undefined` at the root). Ordered from the dragged part outwards.
 */
export function pinChain(
  dragged: string,
  pinned: string | null,
  parentJoint: (link: string) => { joint: string; parent: string } | undefined
): { joint: string; reversed: boolean }[] {
  const up = (link: string): { joint: string; child: string; parent: string }[] => {
    const out: { joint: string; child: string; parent: string }[] = []
    const seen = new Set<string>()
    let cur: string | undefined = link
    while (cur && !seen.has(cur)) {
      seen.add(cur)
      const j = parentJoint(cur)
      if (!j) break
      out.push({ joint: j.joint, child: cur, parent: j.parent })
      cur = j.parent
    }
    return out
  }
  const a = up(dragged)
  if (!pinned) return a.map((s) => ({ joint: s.joint, reversed: false }))
  const b = up(pinned)
  // Links on the dragged part's way to the root, to find where the pin's way meets it.
  const onA = new Map<string, number>([[dragged, 0]])
  a.forEach((s, i) => onA.set(s.parent, i + 1))
  let meetA = a.length
  let meetB = b.length
  if (onA.has(pinned)) {
    meetA = onA.get(pinned)!
    meetB = 0
  } else {
    for (let i = 0; i < b.length; i++) {
      if (onA.has(b[i].parent)) {
        meetA = onA.get(b[i].parent)!
        meetB = i + 1
        break
      }
    }
  }
  return [
    ...a.slice(0, meetA).map((s) => ({ joint: s.joint, reversed: false })),
    ...b
      .slice(0, meetB)
      .reverse()
      .map((s) => ({ joint: s.joint, reversed: true }))
  ]
}
