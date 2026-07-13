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

/**
 * Make every part travel a STRAIGHT world-space line along its own direction.
 * Links are nested in the URDF tree, so a child's local offset rides on top of
 * its (moving) ancestors — uncompensated, its world path bends diagonally as it
 * tracks the exploding parent. Subtracting the nearest exploded ancestor's
 * desired direction from each link's own yields the local direction whose
 * accumulated world displacement is exactly `desired · f` for every link.
 */
export function compensateAncestors(
  desired: Map<string, Vec3>,
  parentOf: Map<string, string | null>
): Map<string, Vec3> {
  const out = new Map<string, Vec3>()
  for (const [name, d] of desired) {
    const p = parentOf.get(name) ?? null
    const pd = p != null ? desired.get(p) : undefined
    out.set(name, pd ? { x: d.x - pd.x, y: d.y - pd.y, z: d.z - pd.z } : { ...d })
  }
  return out
}

/**
 * Tree depth per link (root = 0). Explode magnitudes scale with depth so parts
 * nearest the root move least and leaves move most — which also guarantees that
 * a chain sharing one direction still SEPARATES (the child always travels
 * further than its parent along the same line).
 */
export function hierarchyDepths(parentOf: Map<string, string | null>): Map<string, number> {
  const out = new Map<string, number>()
  const depth = (n: string, seen: Set<string>): number => {
    const memo = out.get(n)
    if (memo !== undefined) return memo
    if (seen.has(n)) return 0 // cycle guard — malformed trees stay finite
    seen.add(n)
    const p = parentOf.get(n) ?? null
    const d = p == null ? 0 : depth(p, seen) + 1
    out.set(n, d)
    return d
  }
  for (const n of parentOf.keys()) depth(n, new Set())
  return out
}

/** A part's rest-pose world AABB + its straight explode line. */
export interface PartBox {
  name: string
  centre: Vec3
  half: Vec3
  dir: Vec3 // unit direction (zero for anchored parts)
  travel: number // world-units travel at full explode
  depth: number
}

/**
 * Nudge travels so no two parts overlap at the FINAL exploded position: for
 * each intersecting pair, the deeper part is pushed further along its own
 * (fixed) line. AABBs are world-aligned at rest and only translate, so the
 * test is exact; iteration is bounded.
 */
export function resolveOverlaps(parts: PartBox[], margin: number, maxIter = 80): Map<string, number> {
  const travel = new Map(parts.map((p) => [p.name, p.travel]))
  const pos = (p: PartBox): Vec3 => {
    const t = travel.get(p.name) ?? 0
    return { x: p.centre.x + p.dir.x * t, y: p.centre.y + p.dir.y * t, z: p.centre.z + p.dir.z * t }
  }
  const overlaps = (a: PartBox, b: PartBox): boolean => {
    const pa = pos(a)
    const pb = pos(b)
    return (
      Math.abs(pa.x - pb.x) < a.half.x + b.half.x + margin &&
      Math.abs(pa.y - pb.y) < a.half.y + b.half.y + margin &&
      Math.abs(pa.z - pb.z) < a.half.z + b.half.z + margin
    )
  }
  const movable = (p: PartBox): boolean => Math.hypot(p.dir.x, p.dir.y, p.dir.z) > 1e-9
  const step = Math.max(margin, 1e-6) * 2
  for (let it = 0; it < maxIter; it++) {
    let bumped = false
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        const a = parts[i]
        const b = parts[j]
        if (!overlaps(a, b)) continue
        // Push the deeper movable part further out (tie → the second one).
        const cand = [a, b].filter(movable).sort((x, y) => y.depth - x.depth)[0]
        if (!cand) continue // both anchored — nothing to do
        travel.set(cand.name, (travel.get(cand.name) ?? 0) + step)
        bumped = true
      }
    }
    if (!bumped) break
  }
  return travel
}

/** Candidate recording mimes, best first. Bare `video/mp4` is deliberately
 *  absent: engines can accept it while lacking a working encoder (Electron has
 *  no H.264), yielding empty/invalid files — codecs must be explicit. */
export const RECORD_MIME_CANDIDATES: readonly string[] = [
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4;codecs=avc1.4D401E',
  'video/webm;codecs=h264',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm'
]

/** File extension for a (negotiated) recorder mime. */
export const extForMime = (mime: string): string => (mime.includes('mp4') ? 'mp4' : 'webm')

/** Container sanity check: mp4 must carry `ftyp` at offset 4; webm/mkv the
 *  EBML magic. Empty/near-empty output (a codec that silently failed) → false. */
export function videoBytesLookValid(bytes: Uint8Array, mime: string): boolean {
  if (bytes.length < 2048) return false
  if (mime.includes('mp4')) {
    return bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70 // 'ftyp'
  }
  return bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3 // EBML
}

/**
 * Prove a mime actually RECORDS on this engine: a short silent capture of the
 * canvas (frames forced via requestFrame so a static scene still yields data),
 * validated by {@link videoBytesLookValid}. `isTypeSupported` alone lies —
 * it can accept a container whose encoder is missing.
 */
export async function probeRecorderMime(
  canvas: HTMLCanvasElement & { captureStream?: (fps?: number) => MediaStream },
  candidates: readonly string[] = RECORD_MIME_CANDIDATES,
  probeMs = 350
): Promise<string | null> {
  if (typeof MediaRecorder === 'undefined' || !canvas.captureStream) return null
  for (const mime of candidates) {
    try {
      if (!MediaRecorder.isTypeSupported(mime)) continue
      const stream = canvas.captureStream(30)
      const track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void }
      const rec = new MediaRecorder(stream, { mimeType: mime })
      const chunks: Blob[] = []
      rec.ondataavailable = (e): void => {
        if (e.data.size) chunks.push(e.data)
      }
      const done = new Promise<void>((res) => {
        rec.onstop = (): void => res()
        rec.onerror = (): void => res()
      })
      rec.start()
      const kick = window.setInterval(() => track.requestFrame?.(), 40)
      await new Promise((res) => window.setTimeout(res, probeMs))
      window.clearInterval(kick)
      rec.stop()
      await done
      stream.getTracks().forEach((t) => t.stop())
      const blob = new Blob(chunks, { type: mime })
      if (blob.size > 0) {
        const bytes = new Uint8Array(await blob.arrayBuffer())
        if (videoBytesLookValid(bytes, mime)) return mime
      }
    } catch {
      /* constructor/encoder rejected this combo — try the next */
    }
  }
  return null
}
