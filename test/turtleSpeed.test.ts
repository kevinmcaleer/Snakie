import { describe, it, expect } from 'vitest'
import {
  DEFAULT_TURTLE_SPEED,
  INITIAL_TURTLE_STATE,
  isTurtleMovement,
  playTurtleStep,
  splitBacklog,
  TURTLE_BACKLOG_CAP,
  TURTLE_SLIDER_MAX,
  turtleSliderForSpeed,
  turtleSpeedForSlider,
  turtleSpeedLabel,
  turtleStepMs
} from '../src/renderer/src/components/turtle-logic'
import { parseTelemetry } from '../src/renderer/src/components/instrument-telemetry'
import type { TurtleTelemetry } from '../src/renderer/src/components/instrument-telemetry'

/**
 * WATCHING IT DRAW (#1046).
 * =============================================================================
 *
 * The instrument drew every segment the instant its telemetry arrived, so a
 * square appeared finished with nothing to watch — and `speed()` never reached
 * the IDE at all, which made the speed block a call that did nothing.
 *
 * The pure half of the fix is here: how long a movement takes, what counts as a
 * movement, and how much backlog is worth animating.
 */

const line = (x2: number): TurtleTelemetry => ({
  kind: 'turtle',
  event: 'line',
  x1: 0,
  y1: 0,
  x2,
  y2: 0,
  colour: 'white',
  width: 2
})

describe('the speed curve (#1046, re-scaled by #1059)', () => {
  it('runs one second to a tenth of a second, end to end', () => {
    // The two numbers the curve is pinned to. It used to START at 5.7 seconds
    // a movement — not a pace anyone watches, so a third of the dial was
    // unusable. One second is the slowest thing worth having.
    expect(turtleStepMs(1)).toBe(1000)
    expect(turtleStepMs(10)).toBe(100)
  })

  it('is geometric, so every notch is the same proportional change', () => {
    expect(Math.round(turtleStepMs(4))).toBe(464)
    expect(Math.round(turtleStepMs(7))).toBe(215)
    // Equal ratios, not equal differences: the middle of the dial is the
    // geometric middle rather than a crawl.
    const step = turtleStepMs(2) / turtleStepMs(1)
    for (let s = 1; s < 10; s++) {
      expect(turtleStepMs(s + 1) / turtleStepMs(s)).toBeCloseTo(step, 6)
    }
  })

  it('leaves the default a brisk one, not a slow one', () => {
    // 6 is still CPython turtle's "normal" and still what `turtle.py` starts
    // at — but on the new scale that is 278ms, not the second it used to be.
    // Compressing the range is the point of #1059; this is what it costs.
    expect(DEFAULT_TURTLE_SPEED).toBe(6)
    expect(Math.round(turtleStepMs(DEFAULT_TURTLE_SPEED))).toBe(278)
  })

  it('is monotonic — higher is always faster', () => {
    for (let s = 1; s < 10; s++) expect(turtleStepMs(s + 1)).toBeLessThan(turtleStepMs(s))
  })

  it('0 means no animation at all', () => {
    // CPython turtle's "fastest", and the escape hatch for a long drawing.
    expect(turtleStepMs(0)).toBe(0)
  })

  it('clamps rather than trusting the number', () => {
    expect(turtleStepMs(99)).toBe(turtleStepMs(10))
    expect(turtleStepMs(-5)).toBe(0)
    expect(turtleStepMs(Number.NaN)).toBe(1000)
  })
})

describe('the dial is not the API (#1059)', () => {
  it('runs slow to fast, left to right, with instant at the far right', () => {
    // THE BUG: `speed(0)` means "instant", so a slider bound straight to the
    // API value sorted 0 to the far LEFT — the control read *instant,
    // slowest, …, fastest*, with the one setting that skips the animation
    // parked at the slow end.
    expect(turtleSpeedForSlider(0)).toBe(1)
    expect(turtleSpeedForSlider(TURTLE_SLIDER_MAX)).toBe(0)
    const paces = Array.from({ length: TURTLE_SLIDER_MAX + 1 }, (_, pos) =>
      turtleStepMs(turtleSpeedForSlider(pos))
    )
    for (let i = 0; i < paces.length - 1; i++) expect(paces[i + 1]).toBeLessThan(paces[i])
    expect(paces[paces.length - 1]).toBe(0)
  })

  it('round-trips every speed', () => {
    for (let speed = 0; speed <= 10; speed++) {
      expect(turtleSpeedForSlider(turtleSliderForSpeed(speed))).toBe(speed)
    }
  })

  it('puts the default where the default is', () => {
    expect(turtleSliderForSpeed(DEFAULT_TURTLE_SPEED)).toBe(5)
  })
})

describe('the readout beside the slider (#1059)', () => {
  it('uses milliseconds under a second', () => {
    // `toFixed(1)` would call a quarter-second step "0.3s" — wrong, and the
    // same string as the notches either side, so the fast half of the dial
    // read as four identical settings.
    expect(turtleSpeedLabel(1)).toBe('1.0s')
    expect(turtleSpeedLabel(10)).toBe('100ms')
    expect(turtleSpeedLabel(DEFAULT_TURTLE_SPEED)).toBe('278ms')
  })

  it('names the instant setting', () => {
    expect(turtleSpeedLabel(0)).toBe('INSTANT')
  })

  it('never says the same thing twice', () => {
    const labels = Array.from({ length: TURTLE_SLIDER_MAX + 1 }, (_, pos) =>
      turtleSpeedLabel(turtleSpeedForSlider(pos))
    )
    expect(new Set(labels).size).toBe(labels.length)
  })
})

describe('what takes time (#1046)', () => {
  it('movement does', () => {
    expect(isTurtleMovement(line(10))).toBe(true)
    expect(isTurtleMovement({ kind: 'turtle', event: 'pos', x: 1, y: 1, heading: 0 })).toBe(true)
  })

  it('bookkeeping does not', () => {
    // Pausing a second on each would make `penup(); pendown()` feel like a hang.
    expect(isTurtleMovement({ kind: 'turtle', event: 'pen', down: true })).toBe(false)
    expect(isTurtleMovement({ kind: 'turtle', event: 'vis', visible: false })).toBe(false)
    expect(isTurtleMovement({ kind: 'turtle', event: 'clear' })).toBe(false)
    expect(isTurtleMovement({ kind: 'turtle', event: 'speed', speed: 3 })).toBe(false)
  })
})

describe('the backlog cap (#1046)', () => {
  it('skips nothing under the cap — every lesson is here', () => {
    const four = [line(1), line(2), line(3), line(4)]
    expect(splitBacklog(four)).toEqual({ drain: [], animate: four })
  })

  it('over the cap, animates only the tail', () => {
    // A spirograph at a second a move is eight minutes of watching a picture
    // that finished drawing long ago.
    const many = Array.from({ length: TURTLE_BACKLOG_CAP + 40 }, (_, i) => line(i))
    const split = splitBacklog(many)
    expect(split.drain).toHaveLength(40)
    expect(split.animate).toHaveLength(TURTLE_BACKLOG_CAP)
    // Nothing is LOST — the drained ones are applied, just not watched.
    expect([...split.drain, ...split.animate]).toEqual(many)
  })
})

describe('playing one step (#1046)', () => {
  it('draws one segment and waits', () => {
    const frame = playTurtleStep(INITIAL_TURTLE_STATE, [line(1), line(2), line(3)], 6)
    expect(frame.state.segments).toHaveLength(1)
    expect(frame.rest).toHaveLength(2)
    // Whatever the curve says for 6 — this test is about waiting once per
    // movement, not about where the dial is scaled (#1059 moved that).
    expect(frame.waitMs).toBe(turtleStepMs(6))
  })

  it('a stroke and the position it ended at are ONE movement', () => {
    // `forward()` with the pen down prints a LINE and then a POS. Counting them
    // as two made a square take twice as long as it was asked to.
    const pos: TurtleTelemetry = { kind: 'turtle', event: 'pos', x: 5, y: 0, heading: 0 }
    const frame = playTurtleStep(INITIAL_TURTLE_STATE, [line(5), pos, line(9)], 6)
    expect(frame.state.segments).toHaveLength(1)
    expect(frame.state.x).toBe(5)
    expect(frame.rest).toHaveLength(1)
  })

  it('a POS on its own is still a movement — that is what a turn is', () => {
    const turn: TurtleTelemetry = { kind: 'turtle', event: 'pos', x: 0, y: 0, heading: 90 }
    const frame = playTurtleStep(INITIAL_TURTLE_STATE, [turn, line(1)], 6)
    expect(frame.state.heading).toBe(90)
    expect(frame.state.segments).toHaveLength(0)
    expect(frame.rest).toHaveLength(1)
  })

  it('carries instantaneous readings along with the movement', () => {
    // `penup(); forward(50)` is ONE wait, not two.
    const frame = playTurtleStep(
      INITIAL_TURTLE_STATE,
      [{ kind: 'turtle', event: 'pen', down: false }, line(1), line(2)],
      6
    )
    expect(frame.state.pen).toBe(false)
    expect(frame.state.segments).toHaveLength(1)
    expect(frame.rest).toHaveLength(1)
  })

  it('a speed reading changes the pace from that point on', () => {
    // `speed(10); forward(50)` means the move is fast, not that the NEXT run is.
    const frame = playTurtleStep(
      INITIAL_TURTLE_STATE,
      [{ kind: 'turtle', event: 'speed', speed: 10 }, line(1)],
      6
    )
    expect(frame.speed).toBe(10)
    expect(frame.waitMs).toBe(turtleStepMs(10))
  })

  it('speed 0 drains the whole queue at once', () => {
    const frame = playTurtleStep(INITIAL_TURTLE_STATE, [line(1), line(2), line(3)], 0)
    expect(frame.state.segments).toHaveLength(3)
    expect(frame.rest).toHaveLength(0)
    expect(frame.waitMs).toBe(0)
  })

  it('an empty queue asks for no wait', () => {
    const frame = playTurtleStep(INITIAL_TURTLE_STATE, [], 6)
    expect(frame.rest).toHaveLength(0)
    expect(frame.waitMs).toBe(0)
  })

  it('a big drawing still finishes, and keeps every segment', () => {
    // The property that matters for the cap: watching less must never mean
    // drawing less.
    let state = INITIAL_TURTLE_STATE
    let pending: readonly TurtleTelemetry[] = Array.from({ length: 500 }, (_, i) => line(i))
    let ticks = 0
    while (pending.length > 0 && ticks < 5000) {
      const frame = playTurtleStep(state, pending, 6)
      state = frame.state
      pending = frame.rest
      ticks += 1
    }
    expect(state.segments).toHaveLength(500)
    // 440 drained on the first tick, then one per tick for the capped tail.
    expect(ticks).toBe(TURTLE_BACKLOG_CAP)
  })
})

describe('the SPEED line on the wire (#1046)', () => {
  it('parses', () => {
    expect(parseTelemetry('SNK TURT SPEED 3')).toEqual({ kind: 'turtle', event: 'speed', speed: 3 })
    expect(parseTelemetry('SNK TURT SPEED 0')).toEqual({ kind: 'turtle', event: 'speed', speed: 0 })
  })

  it('clamps a reading rather than trusting it', () => {
    // A reading is untrusted input, and a negative delay would be a frozen
    // instrument rather than a fast one.
    expect(parseTelemetry('SNK TURT SPEED 99')).toEqual({
      kind: 'turtle',
      event: 'speed',
      speed: 10
    })
    expect(parseTelemetry('SNK TURT SPEED -4')).toEqual({
      kind: 'turtle',
      event: 'speed',
      speed: 0
    })
  })

  it('rejects nonsense', () => {
    expect(parseTelemetry('SNK TURT SPEED fast')).toBe(null)
    expect(parseTelemetry('SNK TURT SPEED')).toBe(null)
  })

  it('leaves the other turtle events alone', () => {
    expect(parseTelemetry('SNK TURT CLEAR')).toEqual({ kind: 'turtle', event: 'clear' })
  })
})
