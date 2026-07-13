/**
 * Exploded-view helpers (#499) — pure math, unit-tested.
 * =============================================================================
 * The Robot View's exploded view translates each link outward from the
 * assembly's centre (à la Fusion 360). These helpers compute the per-link
 * directions, the animation easing, and the optional orbiting camera path;
 * the three.js wiring lives in RobotView.
 */

export interface Vec3 {
  x: number
  y: number
  z: number
}

/** Smooth in-out cubic easing on [0,1]. */
export function easeInOutCubic(t: number): number {
  const c = Math.max(0, Math.min(1, t))
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2
}

/**
 * The explosion progress for an out-and-back animation: rises 0→1 over the
 * first half (eased), holds briefly, and returns 1→0 over the last half — so
 * a recorded clip ends exactly where it started.
 */
export function explodeProgress(t: number, hold = 0.14): number {
  const c = Math.max(0, Math.min(1, t))
  const leg = (1 - hold) / 2
  if (c < leg) return easeInOutCubic(c / leg)
  if (c > 1 - leg) return easeInOutCubic((1 - c) / leg)
  return 1
}

/**
 * Per-link unit explosion directions: from the assembly centre through each
 * link's centroid. A link sitting AT the centre (degenerate) explodes upward.
 */
export function explodeDirections(
  centroids: Map<string, Vec3>,
  centre: Vec3
): Map<string, Vec3> {
  const out = new Map<string, Vec3>()
  for (const [name, c] of centroids) {
    const dx = c.x - centre.x
    const dy = c.y - centre.y
    const dz = c.z - centre.z
    const len = Math.hypot(dx, dy, dz)
    out.set(name, len < 1e-9 ? { x: 0, y: 1, z: 0 } : { x: dx / len, y: dy / len, z: dz / len })
  }
  return out
}

/**
 * Camera position for the optional orbit: a full 2π turn around the vertical
 * axis through `target`, preserving the start's radius and height — t=0 and
 * t=1 are exactly the starting position.
 */
export function orbitPosition(t: number, start: Vec3, target: Vec3): Vec3 {
  const rx = start.x - target.x
  const rz = start.z - target.z
  const a = 2 * Math.PI * t
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  return {
    x: target.x + rx * cos - rz * sin,
    y: start.y,
    z: target.z + rx * sin + rz * cos
  }
}

/** The best supported recording mime — mp4 where the runtime can mux it. */
export function pickVideoMime(
  isSupported: (m: string) => boolean
): { mime: string; ext: string } | null {
  const candidates: [string, string][] = [
    ['video/mp4;codecs=avc1.42E01E', 'mp4'],
    ['video/mp4', 'mp4'],
    ['video/webm;codecs=h264', 'webm'],
    ['video/webm;codecs=vp9', 'webm'],
    ['video/webm', 'webm']
  ]
  for (const [mime, ext] of candidates) {
    try {
      if (isSupported(mime)) return { mime, ext }
    } catch {
      /* isTypeSupported can throw on odd strings — try the next */
    }
  }
  return null
}
