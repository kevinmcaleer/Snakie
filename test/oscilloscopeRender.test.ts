import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Oscilloscope } from '../src/renderer/src/components/Oscilloscope'
import type { UsedPins } from '../src/renderer/src/components/parse-pins'

/**
 * Render the scope to static markup and assert the realism upgrades (#…): the PWM
 * trace has SLOPED edges (finite rise), the graticule is EVENLY divided, and the
 * time/div label is derived from the real period.
 */
const conn: UsedPins = { type: 'pwm', pins: ['15'], variable: 'led', constructor: 'PWM(Pin(15))' }
const fileSource = 'led = PWM(Pin(15))\nled.freq(1000)\nled.duty_u16(49151)' // ~75% duty, 1 kHz

const html = renderToStaticMarkup(
  createElement(Oscilloscope, { conn, sources: [conn], fileSource, docked: true })
)

describe('Oscilloscope realism', () => {
  it('draws the PWM trace with SLOPED (finite-rise) edges, not vertical ones', () => {
    // Pull the trace path(s). A vertical edge would be "L<x> 28 L<x> 144" (same x);
    // a sloped edge steps x between the two rails.
    const paths = [...html.matchAll(/d="(M0 28[^"]*)"/g)].map((m) => m[1])
    expect(paths.length).toBeGreaterThan(0)
    const d = paths[0]
    // A rail transition exists (28 = yHigh, 144 = yLow), and it is NOT vertical.
    const vertical = /L(\d+(?:\.\d+)?) 28 L\1 144/.test(d)
    const sloped = /L(\d+(?:\.\d+)?) 28 L(\d+(?:\.\d+)?) 144/.test(d)
    expect(sloped).toBe(true)
    expect(vertical).toBe(false)
  })

  it('renders an evenly-divided graticule (5 interior vertical lines for 6 divisions)', () => {
    // Interior vertical minor-grid lines are at multiples of 358/6 ≈ 59.67.
    const xs = [1, 2, 3, 4, 5].map((i) => ((i * 358) / 6).toString())
    for (const x of xs) expect(html).toContain(`x1="${x}"`)
  })

  it('shows a time/div label derived from the real period (500 µs/div at 1 kHz)', () => {
    // period = 1ms; a period spans 2 divisions → 500 µs/div.
    expect(html).toContain('500 µs/div')
  })
})

describe('Oscilloscope live PWM reading (read_pwm)', () => {
  // A passive `read_pwm` reading drives liveDuty/liveFreq; with NO raw samples the
  // scope must draw the SQUARE WAVE at that duty (animating), not a value trace.
  const live = renderToStaticMarkup(
    createElement(Oscilloscope, {
      conn,
      sources: [conn],
      fileSource: 'led = PWM(Pin(15))',
      liveDuty: 0.05,
      liveFreq: 1000,
      samples: undefined,
      docked: true
    })
  )

  it('draws a square wave (rails at 28/144), not a raw sample slope', () => {
    const d = ([...live.matchAll(/d="(M0 28[^"]*)"/g)][0]?.[1]) ?? ''
    expect(d).toMatch(/L\d/) // a real trace path
    // both rails are visited (square wave), and it starts high (M0 28 = yHigh).
    expect(d).toContain('144')
    expect(d.startsWith('M0 28')).toBe(true)
  })

  it('reflects the live freq in the time/div (500 µs/div at 1 kHz)', () => {
    expect(live).toContain('500 µs/div')
  })

  it('shows the live duty in the readout (5.0 %)', () => {
    expect(live).toContain('5.0 %')
  })
})
