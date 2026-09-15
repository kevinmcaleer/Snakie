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
