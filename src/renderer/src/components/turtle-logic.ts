/**
 * TURTLE LOGIC — pure, DOM-free helpers for the Turtle graphics instrument
 * (issue #1003, "Turtle Graphics Feature").
 * =============================================================================
 *
 * `micropython/turtle.py` prints one `SNK TURT ...` line per state change (see
 * {@link ./instrument-telemetry}'s `TurtleTelemetry`); this module folds that
 * reading stream into the drawable {@link TurtleState} (accumulated line
 * segments + the turtle's current position/heading/pen/visibility) and maps
 * the turtle's world coordinates onto a canvas.
 *
 * Coordinate + heading conventions (see `micropython/turtle.py`'s docstring —
 * deliberately NOT CPython `turtle`'s convention):
 *
 *   - heading 0 points UP (canvas -y); degrees increase CLOCKWISE.
 *   - the origin (0, 0) is canvas-CENTRE; world x increases right, world y
 *     increases UP — opposite of the canvas's native y-down axis, so
 *     {@link worldToCanvas} flips y. The learner never sees this; it is purely
 *     a rendering-layer detail (per the design brief).
 *
 * Kept React/DOM-free (mirrors {@link ./range-logic}) so it is unit-testable in
 * plain node. NOTHING here throws.
 */

import type { TurtleTelemetry } from './instrument-telemetry'

/** One drawn line segment, in WORLD coordinates (not yet mapped to a canvas). */
export interface TurtleSegment {
  x1: number
  y1: number
  x2: number
  y2: number
  colour: string
  width: number
}

/** The turtle's accumulated drawable state. */
export interface TurtleState {
  x: number
  y: number
  /** Compass heading in degrees: 0 = up, clockwise positive. */
  heading: number
  pen: boolean
  visible: boolean
  segments: TurtleSegment[]
}

/** The turtle starts at the origin, facing north (up), pen down, visible. */
export const INITIAL_TURTLE_STATE: TurtleState = {
  x: 0,
  y: 0,
  heading: 0,
  pen: true,
  visible: true,
  segments: []
}

/**
 * Hard cap on retained segments so an unattended long-running program can't
 * grow the canvas's memory without bound — the OLDEST segments drop off once
 * the cap is hit (a scrolling window of "recent drawing"), mirroring the
 * Plotter's rolling sample window.
 */
export const MAX_SEGMENTS = 20000

/**
 * Fold one parsed `SNK TURT ...` reading into `state`, returning a NEW state
 * (never mutates `state`). Unknown/malformed readings are unreachable here —
 * {@link parseTelemetry} already filters those to `null` — but the function is
 * total over every {@link TurtleTelemetry} event for safety.
 */
export function reduceTurtle(state: TurtleState, reading: TurtleTelemetry): TurtleState {
  switch (reading.event) {
    case 'pos':
      return { ...state, x: reading.x, y: reading.y, heading: reading.heading }
    case 'line': {
      const segment: TurtleSegment = {
        x1: reading.x1,
        y1: reading.y1,
        x2: reading.x2,
        y2: reading.y2,
        colour: reading.colour,
        width: reading.width
      }
      const segments =
        state.segments.length >= MAX_SEGMENTS
          ? [...state.segments.slice(state.segments.length - MAX_SEGMENTS + 1), segment]
          : [...state.segments, segment]
      return { ...state, segments }
    }
    case 'pen':
      return { ...state, pen: reading.down }
    case 'vis':
      return { ...state, visible: reading.visible }
    case 'clear':
      return { ...state, segments: [] }
    default:
      return state
  }
}

/** An (x, y) point, in whichever space the caller documents. */
export interface Point {
  x: number
  y: number
}

/**
 * Map a WORLD point (origin centre, y-up) to a CANVAS point (origin top-left,
 * y-down) for a `canvasW`×`canvasH` drawing surface, at `scale` canvas-pixels
 * per world unit (default 1:1, matching `forward(100)` moving ~100 px on an
 * unscaled canvas — the same feel as CPython `turtle`). Pure; never throws (a
 * non-finite input maps through unchanged, so a caller sees `NaN` rather than
 * a silent wrong answer).
 */
export function worldToCanvas(
  x: number,
  y: number,
  canvasW: number,
  canvasH: number,
  scale = 1
): Point {
  return { x: canvasW / 2 + x * scale, y: canvasH / 2 - y * scale }
}

/**
 * Convert a compass heading (degrees, 0 = up, clockwise) to radians for
 * `CanvasRenderingContext2D.rotate()`. Canvas rotation is clockwise-positive
 * in its native (y-down) space, which already matches our clockwise-positive
 * compass convention — so this is a straight degrees→radians conversion, kept
 * as a named helper for clarity at the call site.
 */
export function headingToRadians(heading: number): number {
  return (heading * Math.PI) / 180
}

/** Format a world coordinate/heading for the on-screen readout (e.g. `"12.3"`). */
export function formatCoord(n: number): string {
  if (!Number.isFinite(n)) return '—'
  const r = Math.round(n * 10) / 10
  return Number.isInteger(r) ? String(r) : r.toFixed(1)
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function isSegment(v: unknown): v is TurtleSegment {
  if (typeof v !== 'object' || v === null) return false
  const s = v as Record<string, unknown>
  return (
    isFiniteNumber(s.x1) &&
    isFiniteNumber(s.y1) &&
    isFiniteNumber(s.x2) &&
    isFiniteNumber(s.y2) &&
    typeof s.colour === 'string' &&
    isFiniteNumber(s.width)
  )
}

/**
 * Type-guard a persisted/round-tripped value (e.g. read back over IPC from the
 * cross-window turtle-state buffer, issue: undocking lost the drawn picture) as
 * a well-formed {@link TurtleState}. Rejects anything malformed (a stale shape
 * from an older Snakie version, a corrupt buffer, `null`) rather than crash
 * rendering on a bad restore — the caller falls back to
 * {@link INITIAL_TURTLE_STATE} in that case. Pure + unit-testable.
 */
export function isTurtleState(v: unknown): v is TurtleState {
  if (typeof v !== 'object' || v === null) return false
  const s = v as Record<string, unknown>
  return (
    isFiniteNumber(s.x) &&
    isFiniteNumber(s.y) &&
    isFiniteNumber(s.heading) &&
    typeof s.pen === 'boolean' &&
    typeof s.visible === 'boolean' &&
    Array.isArray(s.segments) &&
    s.segments.every(isSegment)
  )
}

// ---------------------------------------------------------------------------
// PLAYBACK — watching it draw (#1046)
// ---------------------------------------------------------------------------
//
// `reduceTurtle` folds each reading in the instant it arrives, and a board
// emits a square's four sides faster than an eye can follow — so the picture
// appeared all at once, finished, with nothing to watch. `speed()` was supposed
// to pace it and never reached the IDE at all.
//
// So readings QUEUE, and a timer drains them at the pace the speed asks for.
// The functions below are the pure half of that: how long one movement takes,
// and how much backlog is worth animating. The timer itself lives in the
// component, because only it has a clock.

/**
 * The speed a turtle starts at, matching `micropython/turtle.py`'s `_speed`.
 *
 * Six rather than five, which is also CPython `turtle`'s `"normal"`.
 */
export const DEFAULT_TURTLE_SPEED = 6

/** How long ONE movement takes at {@link DEFAULT_TURTLE_SPEED} (ms). */
export const TURTLE_STEP_MS_AT_DEFAULT = 1000

/**
 * How long one movement takes, in ms, at `speed`.
 *
 * A HALVING CURVE: every two steps up doubles the pace, so the dial spans
 * something worth spanning rather than the narrow band a linear mapping gives.
 * Anchored so the DEFAULT is exactly one second, which is the pace a class can
 * actually follow a square at:
 *
 *   1 → 5657ms   2 → 4000ms   4 → 2000ms   6 → 1000ms   8 → 500ms   10 → 250ms
 *
 * `0` is CPython `turtle`'s "fastest", which means **no animation at all** —
 * the escape hatch for a drawing too long to sit through.
 */
export function turtleStepMs(speed: number): number {
  if (!Number.isFinite(speed)) return TURTLE_STEP_MS_AT_DEFAULT
  const clamped = Math.max(0, Math.min(10, Math.round(speed)))
  if (clamped === 0) return 0
  return TURTLE_STEP_MS_AT_DEFAULT * Math.pow(2, (DEFAULT_TURTLE_SPEED - clamped) / 2)
}

/**
 * The most movements worth holding back to animate.
 *
 * A spirograph is five hundred segments, and five hundred seconds is eight
 * minutes of watching a picture that finished drawing long ago. Past this many
 * queued movements the excess is applied AT ONCE and only the tail is animated
 * — so a big drawing appears, and you still see the last of it being drawn.
 *
 * Chosen for the shape of the thing being taught: a square is 4, a polygon
 * lesson is tens, and anything in the hundreds is a pattern nobody was going to
 * watch stroke by stroke anyway.
 */
export const TURTLE_BACKLOG_CAP = 60

/**
 * Split a pending queue into "apply now, silently" and "animate".
 *
 * Pure so the cap is a tested number rather than something you discover by
 * running a spirograph. Under the cap nothing is skipped, which is the case
 * every lesson is in.
 */
export function splitBacklog<T>(
  pending: readonly T[],
  cap: number = TURTLE_BACKLOG_CAP
): { drain: readonly T[]; animate: readonly T[] } {
  if (pending.length <= cap) return { drain: [], animate: pending }
  return { drain: pending.slice(0, pending.length - cap), animate: pending.slice(-cap) }
}

/**
 * Does this reading take TIME to play, or is it instantaneous?
 *
 * Only movement is worth watching. Putting the pen down, hiding the turtle and
 * setting the speed are bookkeeping — pausing a second on each would make a
 * `penup()`/`pendown()` pair feel like the program had hung.
 *
 * ONE CALL IS NOT ALWAYS ONE READING, which is the subtlety here. A pen-down
 * `forward()` prints a `LINE` **and then** a `POS` — the stroke, and where the
 * turtle ended up. They are one movement, and counting them as two made a
 * square take twice as long as it was asked to. `pendingPos` below is how the
 * caller collapses them; a `POS` on its own is still a movement, because that
 * is what `right()` and a pen-up `forward()` emit.
 */
export function isTurtleMovement(reading: TurtleTelemetry): boolean {
  return reading.event === 'line' || reading.event === 'pos'
}

/** What one playback tick did, and how long to wait before the next. */
export interface TurtleFrame {
  state: TurtleState
  /** Readings still queued. */
  rest: readonly TurtleTelemetry[]
  /** The pace in force after this tick — a `speed` reading can change it. */
  speed: number
  /** How long to wait before the next tick (ms). Zero means "immediately". */
  waitMs: number
}

/**
 * Play ONE step of the queue.
 *
 * Instantaneous readings — pen, visibility, clear, speed — are applied without
 * costing time, up to and including the next movement, which is the one thing
 * worth watching. So `penup(); forward(50); pendown()` is one wait, not three,
 * and a program that only changes colours never appears to hang.
 *
 * The backlog cap is applied first: past `cap` queued readings the excess is
 * folded in silently and only the tail is animated, so a five-hundred-segment
 * spirograph appears rather than taking eight minutes to arrive. Under the cap
 * — which is every lesson this was built for — nothing is skipped.
 *
 * Speed 0 drains everything at once, CPython `turtle`'s "fastest".
 *
 * Pure, so "does a big drawing still finish" is a test.
 */
export function playTurtleStep(
  state: TurtleState,
  pending: readonly TurtleTelemetry[],
  speed: number,
  cap: number = TURTLE_BACKLOG_CAP
): TurtleFrame {
  let next = state
  let pace = speed
  const apply = (reading: TurtleTelemetry): void => {
    if (reading.event === 'speed') pace = reading.speed
    else next = reduceTurtle(next, reading)
  }

  if (pending.length === 0) return { state: next, rest: [], speed: pace, waitMs: 0 }

  const { drain, animate } = splitBacklog(pending, cap)
  for (const reading of drain) apply(reading)

  // No animation asked for: everything, now.
  if (turtleStepMs(pace) === 0) {
    for (const reading of animate) apply(reading)
    return { state: next, rest: [], speed: pace, waitMs: 0 }
  }

  let i = 0
  while (i < animate.length) {
    const reading = animate[i]
    i += 1
    const movement = isTurtleMovement(reading)
    apply(reading)
    if (!movement) continue
    // A drawn stroke is followed by the position it ended at — the same
    // movement, reported twice. Take both, or every pen-down `forward()` costs
    // two waits and a square draws at half the speed it was asked for.
    if (reading.event === 'line' && animate[i]?.event === 'pos') {
      apply(animate[i])
      i += 1
    }
    break
  }
  return { state: next, rest: animate.slice(i), speed: pace, waitMs: turtleStepMs(pace) }
}
