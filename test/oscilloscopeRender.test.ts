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
