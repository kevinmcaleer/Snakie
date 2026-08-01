import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { partFromYaml } from '../src/shared/part-yaml'
import { housedGroupConnectors } from '../src/renderer/src/components/part-editor.util'
import { connectorFit, pairContacts } from '../src/renderer/src/components/cable'
import { flattenPartPins } from '../src/shared/netlist'
import type { PartDefinition } from '../src/shared/part'

/**
 * A servo lead cables to a PCA9685 channel in one drag.
 *
 * A cable is connector-to-connector. The PCA9685 end had housings; the SG90's
 * three pins were grouped but the group had no registry entry, so no housing —
 * nothing to cable FROM.
 */
const load = (id: string): PartDefinition =>
  partFromYaml(readFileSync(`examples/parts/snakie-standard/${id}/parts.yml`, 'utf8'))

describe('servo lead → PCA9685 channel', () => {
  const sg90 = load('sg90')
  const pca = load('pca9685')

  it('the SG90 presents its lead as a 3-way connector', () => {
    const [lead] = housedGroupConnectors(sg90)
    expect(lead?.conn.kind).toBe('dupont')
    expect(lead.conn.pins.map((p) => p.name)).toEqual(['Signal', 'VCC', 'GND'])
  })

  it('the PCA9685 presents 16 servo channels', () => {
    expect(housedGroupConnectors(pca).filter((h) => h.conn.kind === 'dupont')).toHaveLength(16)
  })

  it('a lead fits a channel, joining all THREE conductors', () => {
    const lead = housedGroupConnectors(sg90)[0].conn
    const ch = housedGroupConnectors(pca).find((h) => h.conn.kind === 'dupont')!.conn
    const fit = connectorFit(lead, ch)
    expect(fit.ok).toBe(true)
    expect(fit.pairs).toHaveLength(3)
  })

  it('lands the right way round even dragged backwards', () => {
    const lead = housedGroupConnectors(sg90)[0].conn
    const ch = housedGroupConnectors(pca).find((h) => h.conn.kind === 'dupont')!.conn
    // Signal→S, VCC→V, GND→G whichever end the drag started at.
    expect(pairContacts(lead, ch)).toEqual(pairContacts(ch, lead).map(([a, b]) => [b, a]))
  })

  it('did not disturb either part"s wiring', () => {
    expect(flattenPartPins(sg90).map((p) => p.name)).toEqual(['Signal', 'VCC', 'GND'])
    expect(flattenPartPins(pca).length).toBeGreaterThan(50)
  })
})
