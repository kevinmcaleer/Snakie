import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { partFromYaml } from '../src/shared/part-yaml'
import { flattenPartPins } from '../src/shared/netlist'

/**
 * The STS3215 bus servo and the Waveshare Bus Servo Adapter (A) draw their ports
 * as real housings (JST XH-pitch 5264 ports, the UART header, the DC terminal)
 * rather than loose pads. Wires address a pin by its flattened `#index`, so the
 * move from headers to connectors must keep every pin at the index it had —
 * otherwise every saved project's wiring would land on the wrong contact.
 */
const LIB = join(__dirname, '..', 'examples', 'parts', 'snakie-standard')
const partOf = (id: string) => partFromYaml(readFileSync(join(LIB, id, 'parts.yml'), 'utf8'))

describe('bus-servo part connectors', () => {
  it('the STS3215 has two JST XH-pitch bus ports, pins in the old order', () => {
    const part = partOf('sts3215-bus-servo')
    expect(part.connectors?.map((c) => [c.kind, c.variant])).toEqual([
      ['jst', 'xh'],
      ['jst', 'xh']
    ])
    expect(flattenPartPins(part).map((p) => p.name)).toEqual(['D1', 'V1', 'G1', 'D2', 'V2', 'G2'])
    // Each contact still reads D / V / G on the board.
    expect(part.connectors?.[0].pins.map((p) => p.label)).toEqual(['D', 'V', 'G'])
    // The electrical model still finds its supply pins by name.
    const names = new Set(flattenPartPins(part).map((p) => p.name))
    expect(names.has(part.electrical!.terminals!.positive!)).toBe(true)
    expect(names.has(part.electrical!.terminals!.negative!)).toBe(true)
  })

  it('the adapter draws servo ports, a UART header and a DC terminal, pins in the old order', () => {
    const part = partOf('waveshare-bus-servo-adapter')
    expect(part.connectors?.map((c) => c.kind)).toEqual(['jst', 'jst', 'dupont', 'terminal'])
    expect(flattenPartPins(part).map((p) => p.name)).toEqual([
      'D1', 'V1', 'G1', 'D2', 'V2', 'G2', 'TX', 'RX', 'GND', 'DC+', 'DC-'
    ])
    // The UART pins keep their capability, so the ERC and pin pickers still see a UART.
    const tx = flattenPartPins(part).find((p) => p.name === 'TX')
    expect(tx?.capabilities).toContain('uart')
    expect(tx?.signals?.uart).toBe('TX')
  })
})
