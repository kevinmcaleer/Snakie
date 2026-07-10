/**
 * MOTION TIMELINE ENGINE (#314, epic #309 Phase 4) — PURE, unit-tested.
 * =============================================================================
 *
 * Sampling / easing (drives both the live 3-D preview AND the export, so
 * hardware reproduces exactly what you see), keyframe editing, left↔right
 * mirroring, importing a pose as a keyframe, and generating runnable MicroPython
 * servo choreography from the servo↔joint map.
 *
 * Values are in DISPLAY units (deg for revolute, mm for prismatic) — the same as
 * {@link NamedPose} + the servo map's jointMin/jointMax — so nothing here needs a
 * unit conversion. No three.js / React / fs. Dependency is one-way: this imports
 * {@link jointToServo} from `./krf`; krf never imports this.
 */
import type {
  MirrorPair,
  MotionEasing,
  MotionKey,
  MotionSequence,
  MotionTimeline,
  MotionTrack,
  ServoJointBinding
} from './robot'
import type { ManagedSequenceStep } from './managed-blocks'
import { jointToServo } from './krf'

/** Default preview / export sample rate. */
export const DEFAULT_FPS = 20
/** Refuse to bake more than this many frames (a huge FRAMES tuple can OOM a Pico). */
export const MAX_FRAMES = 600

/** Eased progress for `u` in 0..1: linear, or smoothstep (ease-in-out). */
export function ease(easing: MotionEasing, u: number): number {
  const x = u < 0 ? 0 : u > 1 ? 1 : u
  return easing === 'linear' ? x : x * x * (3 - 2 * x)
}

/**
 * The interpolated value of one track at time `t` (seconds), holding the first /
 * last key outside the keyed range. Returns `null` for an empty track.
 */
export function sampleTrack(track: MotionTrack, t: number, easing: MotionEasing): number | null {
  const k = track.keys
  if (k.length === 0) return null
  if (k.length === 1 || t <= k[0].t) return k[0].value
  const last = k[k.length - 1]
  if (t >= last.t) return last.value
  // Find the bracketing keys (keys are sorted by t).
  let i = 0
  while (i < k.length - 1 && k[i + 1].t <= t) i++
  const a = k[i]
  const b = k[i + 1]
  const span = b.t - a.t
  const u = span <= 0 ? 0 : (t - a.t) / span
  return a.value + (b.value - a.value) * ease(easing, u)
}

/** Every track sampled at `t`: joint name → display value. */
export function sampleTimeline(tl: MotionTimeline, t: number): Record<string, number> {
  const out: Record<string, number> = {}
  for (const track of tl.tracks) {
    const v = sampleTrack(track, t, tl.easing)
    if (v !== null) out[track.joint] = v
  }
  return out
}

/** The number of baked frames for a timeline at `fps` (drops the loop seam). */
export function frameCount(tl: MotionTimeline, fps = tl.fps ?? DEFAULT_FPS): number {
  const n = Math.max(1, Math.round(tl.duration * fps))
  return tl.loop ? n : n + 1 // one-shot includes the final frame; a loop omits the seam
}

// ── Pose-to-pose sequences (#415) ────────────────────────────────────────────

/**
 * The per-SEGMENT durations of a pose sequence (seconds). Segment `i` transitions
 * from `steps[i].pose` to the next pose using `steps[i].duration`/`easing`. A loop
 * has one segment per step (the last wraps back to the first); a one-shot has
 * `steps.length - 1` (the last step's duration is a no-op end hold). Negative /
 * NaN durations are clamped to 0.
 */
export function sequenceSegments(seq: MotionSequence): number[] {
  const n = seq.steps.length
  const count = seq.loop ? n : Math.max(0, n - 1)
  const out: number[] = []
  for (let i = 0; i < count; i++) out.push(Math.max(0, seq.steps[i].duration || 0))
  return out
}

/** Total play time of a sequence (seconds) — the scrubber's span. */
export function sequenceDuration(seq: MotionSequence): number {
  return sequenceSegments(seq).reduce((a, b) => a + b, 0)
}

/**
 * Interpolate two poses joint-wise at eased progress `e` (0..1). A joint present
 * in BOTH is lerped; a joint in only one pose takes that pose's value (a partial
 * pose holds its specified joints and leaves the rest to the caller's model).
 */
export function lerpPoses(
  a: Record<string, number>,
  b: Record<string, number>,
  e: number
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const j of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const av = a[j]
    const bv = b[j]
    if (typeof av === 'number' && typeof bv === 'number') out[j] = av + (bv - av) * e
    else out[j] = typeof av === 'number' ? av : bv
  }
  return out
}

/**
 * Sample a pose sequence at time `t` (seconds): the joint→display-value map of the
 * posture between the bracketing steps' poses, eased by the from-step's easing.
 * `posesByName` resolves a step's pose name to its stored joint values
 * (`NamedPose.values`). A looping sequence wraps `t` over its total duration; a
 * one-shot holds the first pose before `0` and the last pose after the end.
 * Returns `{}` for an empty sequence.
 */
export function samplePoseSequence(
  seq: MotionSequence,
  posesByName: Record<string, Record<string, number>>,
  t: number
): Record<string, number> {
  const steps = seq.steps
  const n = steps.length
  if (n === 0) return {}
  const poseOf = (i: number): Record<string, number> => posesByName[steps[i].pose] ?? {}
  if (n === 1) return { ...poseOf(0) }

  const segs = sequenceSegments(seq)
  const total = segs.reduce((a, b) => a + b, 0)
  if (total <= 0) return { ...poseOf(0) }

  let time: number
  if (seq.loop) {
    time = ((t % total) + total) % total // wrap into [0, total)
  } else {
    if (t <= 0) return { ...poseOf(0) }
    if (t >= total) return { ...poseOf(n - 1) }
    time = t
  }

  // Locate the segment containing `time`.
  let i = 0
  let acc = 0
  while (i < segs.length - 1 && acc + segs[i] <= time) {
    acc += segs[i]
    i++
  }
  const segDur = segs[i]
  const u = segDur <= 0 ? 1 : (time - acc) / segDur
  const from = poseOf(i)
  const to = poseOf(seq.loop ? (i + 1) % n : i + 1)
  return lerpPoses(from, to, ease(steps[i].easing ?? 'easeInOut', u))
}

/**
 * Blend a puppet control's poses at slider position `t` (#416): the N poses sit at
 * even stops `i/(N-1)`, `t` is clamped to 0..1, and the bracketing pair is
 * linearly interpolated joint-wise (a joint present in only one neighbour holds —
 * see {@link lerpPoses}). Returns the joint→display map to drive the model/board.
 * `posesByName` resolves each pose name to its stored values (`NamedPose.values`).
 */
export function sampleControl(
  control: { poses: string[] },
  posesByName: Record<string, Record<string, number>>,
  t: number
): Record<string, number> {
  const names = control.poses
  const n = names.length
  if (n === 0) return {}
  const poseOf = (i: number): Record<string, number> => posesByName[names[i]] ?? {}
  if (n === 1) return { ...poseOf(0) }
  const u = t < 0 ? 0 : t > 1 ? 1 : t
  const pos = u * (n - 1)
  const i = Math.min(n - 2, Math.floor(pos)) // bracket lower index (clamped so i+1 exists)
  return lerpPoses(poseOf(i), poseOf(i + 1), pos - i)
}

/**
 * Convert a sequence's steps to the managed-block / runtime form (#413/#415):
 * `[[poseName, durationMs, easing], …]`. The editor stores each step's duration as
 * the OUTGOING segment (time to the next pose), but `snakie_motion.Rig.play`
 * transitions INTO each step's pose over that step's duration. So each exported
 * step's duration/easing is the PREVIOUS segment's — the one that reaches this
 * pose — keeping hardware timing identical to the preview:
 *  - one-shot: pose[0] is reached at 0 ms (start there); pose[k>0] over step[k-1].
 *  - loop: pose[k] over step[k-1] (pose[0]'s incoming is the seam = the last step).
 */
export function poseSequenceToManagedSteps(seq: MotionSequence): ManagedSequenceStep[] {
  const steps = seq.steps
  const n = steps.length
  if (n === 0) return []
  const durMs = (s: number): number => Math.max(0, Math.round((s || 0) * 1000))
  const easeOf = (i: number): MotionEasing => steps[i].easing ?? 'easeInOut'
  if (n === 1) return [[steps[0].pose, 0, 'linear']]
  if (seq.loop) {
    return steps.map((s, i): ManagedSequenceStep => {
      const prev = (i - 1 + n) % n
      return [s.pose, durMs(steps[prev].duration), easeOf(prev)]
    })
  }
  const out: ManagedSequenceStep[] = [[steps[0].pose, 0, 'linear']]
  for (let i = 1; i < n; i++) out.push([steps[i].pose, durMs(steps[i - 1].duration), easeOf(i - 1)])
  return out
}

// ── Editing ────────────────────────────────────────────────────────────────

/** Insert/replace a key at time `t` on `joint`'s track (creating it if absent). */
export function upsertKey(tl: MotionTimeline, joint: string, t: number, value: number): MotionTimeline {
  const tracks = tl.tracks.map((tr) => ({ joint: tr.joint, keys: [...tr.keys] }))
  let track = tracks.find((tr) => tr.joint === joint)
  if (!track) {
    track = { joint, keys: [] }
    tracks.push(track)
  }
  const at = track.keys.findIndex((k) => Math.abs(k.t - t) < 1e-6)
  if (at >= 0) track.keys[at] = { t, value }
  else track.keys.push({ t, value })
  track.keys.sort((a, b) => a.t - b.t)
  return { ...tl, tracks }
}

/** Remove the key nearest `t` (within `eps`) on `joint`'s track. */
export function deleteKey(tl: MotionTimeline, joint: string, t: number, eps = 1e-6): MotionTimeline {
  const tracks = tl.tracks
    .map((tr) =>
      tr.joint === joint ? { joint: tr.joint, keys: tr.keys.filter((k) => Math.abs(k.t - t) > eps) } : tr
    )
    .filter((tr) => tr.keys.length > 0)
  return { ...tl, tracks }
}

const KEY_EPS = 1e-6

/** A free time at/after `from + dt` for a copy: `from + dt` if free, else the
 *  midpoint of the gap toward the offset direction; null if there's no room.
 *  Times PAST the current end are allowed (the caller grows the clip). */
function freeSlot(keyTimes: number[], from: number, dt: number, duration: number): number | null {
  const taken = (x: number): boolean => keyTimes.some((t) => Math.abs(t - x) < KEY_EPS)
  const nt = Math.max(0, from + dt)
  if (nt > duration || !taken(nt)) return nt // past the end (grow) or an empty slot
  // Occupied: drop into the gap between `from` and the nearest key in the dt dir.
  const fwd = keyTimes.filter((t) => (dt >= 0 ? t > from + KEY_EPS : t < from - KEY_EPS))
  const bound = fwd.length ? (dt >= 0 ? Math.min(...fwd) : Math.max(...fwd)) : nt
  const mid = (from + bound) / 2
  return Math.abs(mid - from) < KEY_EPS || taken(mid) ? null : mid
}

/**
 * Duplicate the key nearest `t` on `joint`'s track to a free slot at/after
 * `t + dt`. Never overwrites a DISTINCT existing key (drops into the gap toward
 * the offset instead), and grows the clip `duration` if the copy lands past the
 * end (so duplicating the last key extends the animation). No-op if the track is
 * empty or there's genuinely no room.
 */
export function duplicateKey(tl: MotionTimeline, joint: string, t: number, dt: number): MotionTimeline {
  const track = tl.tracks.find((tr) => tr.joint === joint)
  if (!track || track.keys.length === 0) return tl
  const key = track.keys.reduce((best, k) => (Math.abs(k.t - t) < Math.abs(best.t - t) ? k : best))
  const nt = freeSlot(track.keys.map((k) => k.t), key.t, dt, tl.duration)
  if (nt === null) return tl
  const grown = nt > tl.duration ? { ...tl, duration: Number(nt.toFixed(6)) } : tl
  return upsertKey(grown, joint, nt, key.value)
}

/**
 * Stamp the whole sampled pose at `t` as keyframes at `t + dt`, per `animatable`
 * joint — "duplicate this pose later in the clip". Grows the clip if the copy
 * lands past the end; skips any joint whose target slot already holds a distinct
 * key (never clobbers a value).
 */
export function duplicatePose(
  tl: MotionTimeline,
  t: number,
  dt: number,
  animatable: string[]
): MotionTimeline {
  const values = sampleTimeline(tl, t)
  const nt = Math.max(0, t + dt)
  let out = nt > tl.duration ? { ...tl, duration: Number(nt.toFixed(6)) } : tl
  for (const joint of animatable) {
    const v = values[joint]
    if (typeof v !== 'number' || !Number.isFinite(v)) continue
    const track = out.tracks.find((tr) => tr.joint === joint)
    if (track && track.keys.some((k) => Math.abs(k.t - nt) < KEY_EPS)) continue // occupied → skip
    out = upsertKey(out, joint, nt, v)
  }
  return out
}

/** Move a key from `fromT` to `toT` (clamped to 0..duration) on `joint`. */
export function moveKey(tl: MotionTimeline, joint: string, fromT: number, toT: number): MotionTimeline {
  const t = Math.max(0, Math.min(tl.duration, toT))
  const track = tl.tracks.find((tr) => tr.joint === joint)
  const key = track?.keys.find((k) => Math.abs(k.t - fromT) < 1e-6)
  if (!key) return tl
  return upsertKey(deleteKey(tl, joint, fromT), joint, t, key.value)
}

/**
 * Drop a pose (joint → display value) as keyframes at time `t`. Only joints in
 * `animatable` (movable, non-mimic) are keyed — mimics auto-follow, so we never
 * keyframe them. Import-a-pose (#314): a straight copy (same units).
 */
export function dropPose(
  tl: MotionTimeline,
  values: Record<string, number>,
  t: number,
  animatable: string[]
): MotionTimeline {
  let next = tl
  for (const joint of animatable) {
    const v = values[joint]
    if (typeof v === 'number' && Number.isFinite(v)) next = upsertKey(next, joint, t, v)
  }
  return next
}

// ── Mirror ───────────────────────────────────────────────────────────────

// Ordered: whole-word first, then a boundary-delimited l/r (so `arm_l`, `l_hip`
// swap but `wheel`/`motor` don't), then a trailing uppercase L/R (`legL`↔`legR`).
const SIDE_SWAPS: Array<[RegExp, string]> = [
  [/left/i, 'right'],
  [/right/i, 'left'],
  [/(^|[_-])l(?=[_-]|\d|$)/, '$1r'],
  [/(^|[_-])r(?=[_-]|\d|$)/, '$1l'],
  [/(^|[_-])L(?=[_-]|\d|$)/, '$1R'],
  [/(^|[_-])R(?=[_-]|\d|$)/, '$1L'],
  [/L$/, 'R'],
  [/R$/, 'L']
]

/** The mirror partner of a joint name by naming convention, or null. */
export function mirrorName(joint: string): string | null {
  for (const [re, rep] of SIDE_SWAPS) {
    if (re.test(joint)) {
      const swapped = joint.replace(re, rep)
      if (swapped !== joint) return swapped
    }
  }
  return null
}

/**
 * Seed mirror pairs from joint names by convention (left↔right, _l↔_r, …). Each
 * pair is listed once (a < b) so duplicates don't accumulate.
 */
export function autoMirrorPairs(jointNames: string[]): MirrorPair[] {
  const set = new Set(jointNames)
  const seen = new Set<string>()
  const pairs: MirrorPair[] = []
  for (const j of jointNames) {
    const partner = mirrorName(j)
    if (!partner || !set.has(partner) || partner === j) continue
    const key = [j, partner].sort().join(' ')
    if (seen.has(key)) continue
    seen.add(key)
    const [a, b] = [j, partner].sort()
    pairs.push({ a, b })
  }
  return pairs
}

/**
 * Copy each pair's `a` track onto `b` (and vice-versa) to make a symmetric
 * motion. `phase: true` offsets the copy by half the duration (wrapped) — what
 * turns a leg mirror into a WALK rather than a hop. `invert` (per pair) reflects
 * the value about the target joint's `neutral` (default 0) for an opposite-axis
 * partner. Only existing source tracks are mirrored; the transform is pure.
 */
export function mirrorTracks(
  tl: MotionTimeline,
  pairs: MirrorPair[],
  opts: { phase?: boolean; neutral?: Record<string, number> } = {}
): MotionTimeline {
  const dur = tl.duration
  const phase = opts.phase ? dur / 2 : 0
  const neutral = opts.neutral ?? {}
  const byJoint = new Map(tl.tracks.map((tr) => [tr.joint, tr]))
  const wrap = (t: number): number => ((t % dur) + dur) % dur

  const reflect = (target: string, value: number, invert?: boolean): number =>
    invert ? 2 * (neutral[target] ?? 0) - value : value

  const copyTrack = (src: MotionTrack, target: string, invert?: boolean): MotionTrack => {
    if (!phase) {
      return {
        joint: target,
        keys: src.keys
          .map((k) => ({ t: k.t, value: reflect(target, k.value, invert) }))
          .sort((a, b) => a.t - b.t)
      }
    }
    // Half-cycle: target(t) = source(t − phase). Shift each key's time by phase
    // (wrapped) and add matching seam keys at 0 and duration so the loop stays
    // CONTINUOUS — no freeze/jump at the wrap. Dedupe collisions by rounded t.
    const byT = new Map<number, MotionKey>()
    for (const k of src.keys) {
      const t = wrap(k.t + phase)
      byT.set(Number(t.toFixed(6)), { t, value: reflect(target, k.value, invert) })
    }
    const seamSrc = sampleTrack(src, wrap(dur - phase), tl.easing) ?? src.keys[0].value
    const seam = reflect(target, seamSrc, invert)
    byT.set(0, { t: 0, value: seam }) // seam keys win over any wrapped key at 0/dur
    byT.set(Number(dur.toFixed(6)), { t: dur, value: seam })
    return { joint: target, keys: [...byT.values()].sort((a, b) => a.t - b.t) }
  }

  const result = new Map(tl.tracks.map((tr) => [tr.joint, tr]))
  for (const p of pairs) {
    const ta = byJoint.get(p.a)
    const tb = byJoint.get(p.b)
    if (ta) result.set(p.b, copyTrack(ta, p.b, p.invert))
    else if (tb) result.set(p.a, copyTrack(tb, p.a, p.invert))
  }
  return { ...tl, tracks: [...result.values()] }
}

// ── Export → MicroPython ─────────────────────────────────────────────────

/** A pin token → its integer GPIO, or NaN (`GP16`/`gp0`/`5` → 16/0/5). A blank
 *  or number-less token (`''`, `GP`, `SDA`) is NaN — NOT 0 — so it's skipped. */
export function pinNumber(pin: string): number {
  const rest = String(pin).trim().replace(/^gp/i, '')
  return /^-?\d+$/.test(rest) ? Number(rest) : NaN
}

/** A safe Python identifier from a joint name, for naming the exported servo
 *  variables (`base` → `base`, `l-arm` → `l_arm`, `2wheel` → `_2wheel`). */
export function pyIdent(name: string): string {
  const s = String(name).replace(/[^A-Za-z0-9_]/g, '_')
  return !s || /^[0-9]/.test(s) ? `_${s}` : s
}

export interface MotionExport {
  code: string
  /** Non-fatal problems (unbound joints, non-numeric pins) for the UI. */
  warnings: string[]
  /** Joints that WILL be driven (have a track + a numeric-pin binding). */
  boundJoints: string[]
  /** Animated joints with no usable servo binding (previewed, not exported). */
  skippedJoints: string[]
}

/**
 * Generate runnable MicroPython that reproduces the timeline on hardware (#314).
 * Bakes the SAME eased samples the preview uses into a flat FRAMES table, maps
 * each joint value to a whole servo degree via {@link jointToServo}, and drives
 * pure `PWM(Pin(n))` → `Servo(pwm, pin=n)` variables named by joint. Iterates the
 * BINDINGS (a joint on two pins drives both). `DT = 1/FPS` is symbolic to avoid
 * sleep drift; the loop seam is dropped.
 */
export function generateMicroPython(
  tl: MotionTimeline,
  bindings: ServoJointBinding[],
  opts: { robotName?: string; fps?: number } = {}
): MotionExport {
  const fps = Math.max(1, Math.round(opts.fps ?? tl.fps ?? DEFAULT_FPS))
  const name = (opts.robotName || 'robot').trim() || 'robot'
  const warnings: string[] = []

  const trackByJoint = new Map(tl.tracks.filter((t) => t.keys.length > 0).map((t) => [t.joint, t]))

  // One servo entry per usable binding (numeric pin + an animated joint), sorted
  // by pin so a joint with two pins drives both.
  const servos = bindings
    .filter((b) => trackByJoint.has(b.joint))
    .map((b) => ({ b, pin: pinNumber(b.pin) }))
    .filter((s) => {
      if (Number.isFinite(s.pin)) return true
      warnings.push(`pin "${s.b.pin}" for joint "${s.b.joint}" is not a number — skipped`)
      return false
    })
    .sort((a, b) => a.pin - b.pin)

  const boundJoints = [...new Set(servos.map((s) => s.b.joint))]
  const skippedJoints = [...trackByJoint.keys()].filter((j) => !bindings.some((b) => b.joint === j))
  if (skippedJoints.length) {
    warnings.push(`no servo bound (previewed, not exported): ${skippedJoints.join(', ')}`)
  }

  const frames = frameCount(tl, fps)
  if (servos.length && frames * servos.length > MAX_FRAMES * 4) {
    warnings.push(`long clip (${frames} frames) — consider a lower fps or shorter duration`)
  }

  const header = [
    `# ${name} — motion exported from Snakie Robot View (#314).`,
    `# ${servos.length} servo(s), ${tl.duration}s @ ${fps}fps, ${tl.easing}${tl.loop ? ', looping' : ''}.`,
    ...warnings.map((w) => `# ! ${w}`),
    'try:',
    '    from machine import Pin, PWM',
    'except ImportError:  # Snakie simulator (CPython) — headless stubs',
    '    from instruments import Pin, PWM',
    'from instruments import Servo',
    'import time',
    '',
    `FPS = ${fps}`,
    'DT = 1 / FPS',
    ''
  ]

  if (servos.length === 0) {
    return {
      code: [
        ...header,
        '# No joints have a servo binding yet — bind pins to joints in the',
        '# Robot View Servos panel, then export again.',
        ''
      ].join('\n'),
      warnings,
      boundJoints,
      skippedJoints
    }
  }

  // Bake frames: each row is the servo angle per servo, in `servos` order. Sample
  // at t = i/fps so the baked spacing matches the emitted `sleep(1/FPS)` exactly
  // (else a non-integer duration×fps time-scales the exported motion).
  const rows: number[][] = []
  for (let i = 0; i < frames; i++) {
    const t = i / fps
    rows.push(
      servos.map((s) => {
        const v = sampleTrack(trackByJoint.get(s.b.joint) as MotionTrack, t, tl.easing) ?? s.b.jointMin
        return jointToServo(s.b, v)
      })
    )
  }

  // Pure pin → typed-variable setup: `<joint>_servo = PWM(Pin(n))` then
  // `<joint> = Servo(<joint>_servo, pin=n)`. `pin=` lets each Servo emit SNK SERVO
  // telemetry so running this code also drives the 3-D model. Names are the joint
  // (a safe identifier), de-collided when a joint drives two pins.
  const usedVars = new Set<string>()
  const servoVars = servos.map((s) => {
    const base = pyIdent(s.b.joint) || `servo_${s.pin}`
    let v = base
    let n = 2
    while (usedVars.has(v)) v = `${base}_${n++}`
    usedVars.add(v)
    return v
  })
  const servoDecls = servos.flatMap((s, i) => [
    `${servoVars[i]}_servo = PWM(Pin(${s.pin}))`,
    `${servoVars[i]} = Servo(${servoVars[i]}_servo, pin=${s.pin})`
  ])
  // A 1-element Python tuple needs a trailing comma, else `(90)` is just an int.
  const framesLit = rows.map((r) => `    (${r.join(', ')}${r.length === 1 ? ',' : ''}),`)

  const body = [
    ...servoDecls,
    `SERVOS = (${servoVars.join(', ')}${servos.length === 1 ? ',' : ''})`,
    '',
    '# Baked servo angles (degrees) — one row per frame, easing already applied.',
    'FRAMES = (',
    ...framesLit,
    ')',
    '',
    '',
    'def play():',
    '    for frame in FRAMES:',
    '        for servo, angle in zip(SERVOS, frame):',
    '            servo.angle(angle)',
    '        time.sleep(DT)',
    '',
    ''
  ]

  const runner = tl.loop
    ? ['try:', '    while True:', '        play()', 'except KeyboardInterrupt:', '    pass', '']
    : ['play()', '']

  return {
    code: [...header, ...body, ...runner].join('\n'),
    warnings,
    boundJoints,
    skippedJoints
  }
}
