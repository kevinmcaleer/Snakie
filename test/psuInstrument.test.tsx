import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PsuInstrument } from '../src/renderer/src/components/PsuInstrument'
import { instrumentById } from '../src/renderer/src/components/instruments-registry'

/** The bench PSU instrument (#602) rendered to static HTML — structure only. */
const html = (node: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(node)

const DEF = instrumentById('psu')!

describe('Bench PSU instrument (#602)', () => {
  it('is registered as an output singleton', () => {
    expect(DEF).toBeDefined()
    expect(DEF.kind).toBe('singleton')
    expect(DEF.group).toBe('output')
    expect(DEF.name).toBe('Bench PSU')
  })

  it('renders V + A seven-seg displays, controls, and starts OFF', () => {
    const out = html(<PsuInstrument def={DEF} />)
    // Two seven-seg lines with ghost backing.
    expect(out).toContain('88.88') // volts ghost
    expect(out).toContain('8.888') // amps ghost
    // Default 5.00 V set-point shows in the readout; output starts OFF so the
    // live display reads 0.00 V and the OFF annunciator is lit.
    expect(out).toContain('OUTPUT OFF')
    expect(out).toContain('0.00') // live V while output is off
    expect(out).toContain('SET V')
    expect(out).toContain('LIMIT A')
    // Voltage + current-limit sliders present.
    expect(out).toContain('Output voltage')
    expect(out).toContain('Current limit')
  })
})
