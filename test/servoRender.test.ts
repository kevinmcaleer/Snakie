import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ServoInstrument } from '../src/renderer/src/components/ServoInstrument'
import { INSTRUMENTS } from '../src/renderer/src/components/instruments-registry'

const def = INSTRUMENTS.find((d) => d.id === 'servo')!
const html = renderToStaticMarkup(createElement(ServoInstrument, { def, docked: true }))

describe('ServoInstrument render', () => {
  it('registers a servo singleton in the instruments table', () => {
    expect(def).toBeTruthy()
    expect(def.kind).toBe('singleton')
    expect(def.group).toBe('output')
    expect(def.hints).toContain('servo')
  })

  it('draws the top-down dial with the arm at the default 90° (pointing up)', () => {
    expect(html).toContain('servopanel__dial')
    expect(html).toContain('servopanel__arm')
    expect(html).toContain('servopanel__hub')
    // At 90° the arm is vertical: it ends at x = 100 (CX), above the pivot.
    expect(html).toMatch(/servopanel__arm"[^>]*x2="100"/)
    expect(html).toContain('>90°</text>')
  })

  it('has the knob controls: slider, SWEEP, MIN/MAX/PIN, DETACH', () => {
    expect(html).toContain('servopanel__slider')
    expect(html).toContain('SWEEP')
    expect(html).toContain('DETACH')
    expect(html).toContain('>MIN<')
    expect(html).toContain('>MAX<')
    expect(html).toContain('>PIN<')
  })

  it('shows the readout (ANGLE / PULSE / RANGE) with the 90° = 1.5 ms pulse', () => {
    expect(html).toContain('ANGLE')
    expect(html).toContain('PULSE')
    expect(html).toContain('RANGE')
    expect(html).toContain('1.50 ms') // 90° → 1.5 ms
    expect(html).toContain('0–180°')
  })
})
