/**
 * POSE TIMELINE — pure edits for the Animate timeline of pose blocks.
 * =============================================================================
 * The timeline a person sees is a row of POSE BLOCKS with a gap between each
 * pair: the gap is how long the robot takes to move from one pose to the next,
 * and how it eases. That is exactly a {@link MotionSequence} (each step's
 * `duration`/`easing` is its OUTGOING gap), so the file format, the preview
 * sampler and the MicroPython export are unchanged — this module only adds the
 * edits the block timeline needs. No three.js or React, so it is unit-tested.
 */
import type { MotionEasing, MotionSequence, MotionTimeline, NamedPose, PoseStep, PuppetControl } from './robot'
import { sampleTimeline, sequenceSegments } from './robot-timeline'

/** The gap a new block gets (seconds). */
export const DEFAULT_GAP = 0.5
/** The shortest gap a drag can make (seconds). */
export const MIN_GAP = 0.05

const r2 = (n: number): number => Math.round(n * 100) / 100

/** When each block is reached (seconds), plus the total play time. */
export function blockTimes(seq: MotionSequence): { starts: number[]; total: number } {
  const segs = sequenceSegments(seq)
  const starts: number[] = []
  let acc = 0
  for (let i = 0; i < seq.steps.length; i++) {
    starts.push(acc)
    acc += segs[i] ?? 0
  }
  return { starts, total: segs.reduce((a, b) => a + b, 0) }
}

/** The block the playhead is on or has most recently passed (−1 when empty). */
export function blockAt(seq: MotionSequence, t: number): number {
  const { starts } = blockTimes(seq)
  let at = -1
  for (let i = 0; i < starts.length; i++) if (starts[i] <= t + 1e-6) at = i
  return at
}

/** Insert a block for `pose` right after block `after` (−1 = at the start). */
export function insertBlock(seq: MotionSequence, pose: string, after: number, gap = DEFAULT_GAP): MotionSequence {
  const step: PoseStep = { pose, duration: gap, easing: 'easeInOut' }
  const i = Math.max(0, Math.min(seq.steps.length, after + 1))
  return { ...seq, steps: [...seq.steps.slice(0, i), step, ...seq.steps.slice(i)] }
}

export function removeBlock(seq: MotionSequence, index: number): MotionSequence {
  return { ...seq, steps: seq.steps.filter((_, i) => i !== index) }
}

/**
 * Move block `from` so it lands at position `to`. A block carries its pose only:
 * the gaps stay where they are, so reordering never changes the timing.
 */
export function moveBlock(seq: MotionSequence, from: number, to: number): MotionSequence {
  const n = seq.steps.length
  if (from < 0 || from >= n) return seq
  const dest = Math.max(0, Math.min(n - 1, to))
  if (dest === from) return seq
  const poses = seq.steps.map((s) => s.pose)
  const [moved] = poses.splice(from, 1)
  poses.splice(dest, 0, moved)
  return { ...seq, steps: seq.steps.map((s, i) => ({ ...s, pose: poses[i] })) }
}

/** Set the gap after block `index` (seconds), rounded to hundredths. */
export function setGap(seq: MotionSequence, index: number, seconds: number): MotionSequence {
  if (index < 0 || index >= seq.steps.length) return seq
  const d = r2(Math.max(MIN_GAP, Number.isFinite(seconds) ? seconds : DEFAULT_GAP))
  return { ...seq, steps: seq.steps.map((s, i) => (i === index ? { ...s, duration: d } : s)) }
}

export function setGapEasing(seq: MotionSequence, index: number, easing: MotionEasing): MotionSequence {
  if (index < 0 || index >= seq.steps.length) return seq
  return { ...seq, steps: seq.steps.map((s, i) => (i === index ? { ...s, easing } : s)) }
}

/** Follow a pose rename into the timeline's blocks. Returns `seq` when untouched. */
export function renamePoseInSequence(seq: MotionSequence, from: string, to: string): MotionSequence {
  if (!seq.steps.some((s) => s.pose === from)) return seq
  return { ...seq, steps: seq.steps.map((s) => (s.pose === from ? { ...s, pose: to } : s)) }
}

/** Follow a pose rename into the Perform sliders. Returns `controls` when untouched. */
export function renamePoseInControls(controls: PuppetControl[], from: string, to: string): PuppetControl[] {
  if (!controls.some((c) => c.poses.includes(from))) return controls
  return controls.map((c) =>
    c.poses.includes(from) ? { ...c, poses: c.poses.map((p) => (p === from ? to : p)) } : c
  )
}

/**
 * MAKE WALK CYCLE — turn half a cycle into a whole one. The blocks you made
 * (say: step with the left leg) are followed by the same blocks mirrored (step
 * with the right), with the same gaps, and the timeline loops. `mirrorOf` gives
 * the mirrored pose's name for a pose name (the caller creates those poses);
 * a block whose mirror is unknown is repeated as it is.
 */
export function makeWalkCycle(seq: MotionSequence, mirrorOf: (pose: string) => string | undefined): MotionSequence {
  if (seq.steps.length === 0) return seq
  const second = seq.steps.map((s) => ({ ...s, pose: mirrorOf(s.pose) ?? s.pose }))
  return { ...seq, loop: true, steps: [...seq.steps, ...second] }
}

/**
 * KEYFRAMES → POSE BLOCKS. A joint-track clip becomes one pose per moment that
 * has a keyframe (every joint sampled there), and blocks spaced by the same
 * times. The clip's last moment is dropped when it repeats the first on a loop
 * (the loop seam already returns there). Pose names avoid `taken`.
 */
export function keyframesToBlocks(
  tl: MotionTimeline,
  taken: Iterable<string>
): { poses: NamedPose[]; sequence: MotionSequence } {
  const used = new Set(taken)
  const times = [...new Set(tl.tracks.flatMap((t) => t.keys.map((k) => r2(k.t))))].sort((a, b) => a - b)
  const empty: MotionSequence = { name: 'sequence', loop: tl.loop, fps: tl.fps, steps: [] }
  if (times.length === 0) return { poses: [], sequence: empty }

  const sample = (t: number): Record<string, number> => {
    const out: Record<string, number> = {}
    for (const [j, v] of Object.entries(sampleTimeline(tl, t))) out[j] = r2(v)
    return out
  }
  const same = (a: Record<string, number>, b: Record<string, number>): boolean => {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    for (const k of keys) if (Math.abs((a[k] ?? 0) - (b[k] ?? 0)) > 0.01) return false
    return true
  }
  let moments = times.map((t) => ({ t, values: sample(t) }))
  if (tl.loop && moments.length > 1 && same(moments[0].values, moments[moments.length - 1].values)) {
    moments = moments.slice(0, -1)
  }

  const poses: NamedPose[] = []
  const steps: PoseStep[] = []
  let n = 1
  const end = Math.max(tl.duration, times[times.length - 1])
  moments.forEach((m, i) => {
    while (used.has(`Key ${n}`)) n++
    const name = `Key ${n}`
    used.add(name)
    poses.push({ name, values: m.values })
    const next = i + 1 < moments.length ? moments[i + 1].t : end
    steps.push({ pose: name, duration: r2(Math.max(MIN_GAP, next - m.t)), easing: tl.easing })
  })
  return { poses, sequence: { ...empty, steps } }
}
