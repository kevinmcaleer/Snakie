import { describe, it, expect } from 'vitest'
import {
  formatCoord,
  headingToRadians,
  INITIAL_TURTLE_STATE,
  MAX_SEGMENTS,
  reduceTurtle,
  worldToCanvas,
  type TurtleState
} from '../src/renderer/src/components/turtle-logic'
import type { TurtleTelemetry } from '../src/renderer/src/components/instrument-telemetry'

describe('reduceTurtle', () => {
  it('starts at the origin, facing north, pen down, visible', () => {
    expect(INITIAL_TURTLE_STATE).toEqual({
      x: 0,
      y: 0,
      heading: 0,
      pen: true,
      visible: true,
      segments: []
    })
  })

  it('a pos event updates x/y/heading without touching segments', () => {
    const reading: TurtleTelemetry = { kind: 'turtle', event: 'pos', x: 5, y: 10, heading: 90 }
    const next = reduceTurtle(INITIAL_TURTLE_STATE, reading)
    expect(next).toEqual({ ...INITIAL_TURTLE_STATE, x: 5, y: 10, heading: 90 })
  })

  it('a line event appends a segment', () => {
    const reading: TurtleTelemetry = {
      kind: 'turtle',
      event: 'line',
      x1: 0,
      y1: 0,
      x2: 0,
      y2: 10,
      colour: 'red',
      width: 2
    }
    const next = reduceTurtle(INITIAL_TURTLE_STATE, reading)
    expect(next.segments).toEqual([{ x1: 0, y1: 0, x2: 0, y2: 10, colour: 'red', width: 2 }])
  })

  it('a line event does not mutate the input state', () => {
    const state: TurtleState = { ...INITIAL_TURTLE_STATE, segments: [] }
    const reading: TurtleTelemetry = {
      kind: 'turtle',
      event: 'line',
      x1: 0,
      y1: 0,
      x2: 1,
      y2: 1,
      colour: 'black',
      width: 2
    }
    reduceTurtle(state, reading)
    expect(state.segments).toEqual([])
  })

  it('multiple line events accumulate in order', () => {
    let state = INITIAL_TURTLE_STATE
    const a: TurtleTelemetry = {
      kind: 'turtle',
      event: 'line',
      x1: 0,
      y1: 0,
      x2: 1,
      y2: 0,
      colour: 'black',
      width: 2
    }
    const b: TurtleTelemetry = {
      kind: 'turtle',
      event: 'line',
      x1: 1,
      y1: 0,
      x2: 1,
      y2: 1,
      colour: 'black',
      width: 2
    }
    state = reduceTurtle(state, a)
    state = reduceTurtle(state, b)
    expect(state.segments).toEqual([
      { x1: 0, y1: 0, x2: 1, y2: 0, colour: 'black', width: 2 },
      { x1: 1, y1: 0, x2: 1, y2: 1, colour: 'black', width: 2 }
    ])
  })

  it('a pen event toggles pen state', () => {
    const up = reduceTurtle(INITIAL_TURTLE_STATE, { kind: 'turtle', event: 'pen', down: false })
    expect(up.pen).toBe(false)
    const down = reduceTurtle(up, { kind: 'turtle', event: 'pen', down: true })
    expect(down.pen).toBe(true)
  })

  it('a vis event toggles visibility', () => {
    const hidden = reduceTurtle(INITIAL_TURTLE_STATE, {
      kind: 'turtle',
      event: 'vis',
      visible: false
    })
    expect(hidden.visible).toBe(false)
  })

  it('a clear event wipes segments but leaves position/heading alone', () => {
    const withLine = reduceTurtle(
      { ...INITIAL_TURTLE_STATE, x: 3, y: 4, heading: 45 },
      { kind: 'turtle', event: 'line', x1: 0, y1: 0, x2: 3, y2: 4, colour: 'black', width: 2 }
    )
    const cleared = reduceTurtle(withLine, { kind: 'turtle', event: 'clear' })
    expect(cleared.segments).toEqual([])
    expect(cleared.x).toBe(3)
    expect(cleared.y).toBe(4)
    expect(cleared.heading).toBe(45)
  })

  it('caps retained segments at MAX_SEGMENTS, dropping the oldest', () => {
    let state = INITIAL_TURTLE_STATE
    for (let i = 0; i < MAX_SEGMENTS + 5; i++) {
      state = reduceTurtle(state, {
        kind: 'turtle',
        event: 'line',
        x1: i,
        y1: 0,
        x2: i + 1,
        y2: 0,
        colour: 'black',
        width: 2
      })
    }
    expect(state.segments.length).toBe(MAX_SEGMENTS)
    // The oldest 5 segments (x1 = 0..4) were evicted; the newest survives.
    expect(state.segments[0].x1).toBe(5)
    expect(state.segments[state.segments.length - 1].x1).toBe(MAX_SEGMENTS + 4)
  })
})

describe('worldToCanvas', () => {
  it('maps the world origin to the canvas centre', () => {
    expect(worldToCanvas(0, 0, 400, 200)).toEqual({ x: 200, y: 100 })
  })

  it('maps +x right and +y UP (flipped to canvas -y)', () => {
    expect(worldToCanvas(10, 10, 400, 200)).toEqual({ x: 210, y: 90 })
  })

  it('maps negative world coordinates left/down', () => {
    expect(worldToCanvas(-10, -10, 400, 200)).toEqual({ x: 190, y: 110 })
  })

  it('applies a scale factor', () => {
    expect(worldToCanvas(10, 10, 400, 200, 2)).toEqual({ x: 220, y: 80 })
  })
})

describe('headingToRadians', () => {
  it('0 degrees is 0 radians', () => {
    expect(headingToRadians(0)).toBe(0)
  })

  it('90 degrees is pi/2 radians', () => {
    expect(headingToRadians(90)).toBeCloseTo(Math.PI / 2)
  })

  it('360 degrees is a full turn (2*pi radians)', () => {
    expect(headingToRadians(360)).toBeCloseTo(Math.PI * 2)
  })
})

describe('formatCoord', () => {
  it('formats a whole number without a decimal', () => {
    expect(formatCoord(10)).toBe('10')
  })

  it('formats a fractional number to one decimal place', () => {
    expect(formatCoord(10.456)).toBe('10.5')
  })

  it('formats zero and negative numbers', () => {
    expect(formatCoord(0)).toBe('0')
    expect(formatCoord(-3.2)).toBe('-3.2')
  })

  it('formats a non-finite value as an em dash', () => {
    expect(formatCoord(NaN)).toBe('—')
    expect(formatCoord(Infinity)).toBe('—')
  })
})
