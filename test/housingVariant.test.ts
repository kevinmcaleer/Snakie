import { describe, it, expect } from 'vitest'
import { withGroupHousing, normalisePart } from '../src/renderer/src/components/part-editor.util'
import { partFromYaml, partToYaml } from '../src/shared/part-yaml'
import type { PartDefinition } from '../src/shared/part'

/**
 * A HOUSED GROUP can say which wiring it is (#705).
 *
 * Grove's four port types are the same physical shell wired four different ways,
 * so the variant is the only thing that can stop an I²C module being cabled into a
 * digital port — where the plug fits, nothing looks wrong, and the module simply
 * never responds. `connectorFit` has always checked it and `GroupHousing` has
 * always carried it; the Part Editor's housing menu only ever set the KIND, so a
 * housed group could never declare one.
 *
 * Reported by a user whose Grove ultrasonic wouldn't cable to a Grove port they
 * had built as a housed group.
 */
const part = (): PartDefinition =>
  ({
    id: 'demo',
    name: 'Demo',
    headers: [
      {
        edge: 'left',
        pins: [
          { name: 'SIG', type: 'io', group: 'g1', x: 0.1, y: 0.2 },
          { name: 'NC', type: 'other', group: 'g1', x: 0.1, y: 0.3 },
          { name: 'VCC', type: 'pwr', group: 'g1', x: 0.1, y: 0.4 },
          { name: 'GND', type: 'gnd', group: 'g1', x: 0.1, y: 0.5 }
        ]
      }
    ],
    groups: [{ id: 'g1', name: 'Grove port' }]
  }) as unknown as PartDefinition

const housingOf = (p: PartDefinition, patch: Partial<PartDefinition>): Record<string, unknown> =>
  ((patch.groups ?? p.groups) ?? []).find((g) => g.id === 'g1')?.housing as unknown as Record<
    string,
    unknown
  >

describe('a housed group carries its variant (#705)', () => {
  it('sets the Grove wiring alongside the kind', () => {
    const h = housingOf(part(), withGroupHousing(part(), 'g1', 'grove', 'digital'))
    expect(h.kind).toBe('grove')
    expect(h.variant).toBe('digital')
  })

  it('keeps the variant when only the kind is re-applied', () => {
    // "Change the kind" and "change the variant" are the same call, so re-picking
    // Grove from the menu must not silently wipe the wiring already chosen.
    const p = part()
    const withVariant = { ...p, ...withGroupHousing(p, 'g1', 'grove', 'uart') }
    const again = housingOf(withVariant, withGroupHousing(withVariant, 'g1', 'grove'))
    expect(again.variant).toBe('uart')
  })

  it('drops a variant that means nothing for the new kind', () => {
    // Switching a Grove group to a QWIIC must not leave `uart` behind, where no
    // renderer reads it and `connectorFit` would never consult it.
    const p = part()
    const grove = { ...p, ...withGroupHousing(p, 'g1', 'grove', 'uart') }
    const qwiic = housingOf(grove, withGroupHousing(grove, 'g1', 'qwiic'))
    expect(qwiic.kind).toBe('qwiic')
    expect(qwiic.variant).toBeUndefined()
  })

  it('takes a JST family too', () => {
    const h = housingOf(part(), withGroupHousing(part(), 'g1', 'jst', 'xh'))
    expect(h.variant).toBe('xh')
  })

  it('keeps the author’s label across a wiring change', () => {
    // The label is the author's, not a consequence of the kind.
    const p = part()
    const named = {
      ...p,
      groups: [{ id: 'g1', housing: { kind: 'grove', variant: 'i2c', x: 0.1, y: 0.35, label: 'QW/ST' } }]
    } as unknown as PartDefinition
    const h = housingOf(named, withGroupHousing(named, 'g1', 'grove', 'digital'))
    expect(h.variant).toBe('digital')
    expect(h.label).toBe('QW/ST')
  })

  it('survives BOTH whitelists — normalise and the parts.yml round trip', () => {
    // The pair that silently drops a new field. `coerceGroupHousing` already
    // handled variants, so this is a regression guard rather than a new hole.
    const p = part()
    const set = { ...p, ...withGroupHousing(p, 'g1', 'grove', 'digital') } as PartDefinition
    expect(housingOf(set, {}).variant).toBe('digital')

    const normalised = normalisePart(set) as PartDefinition
    expect(housingOf(normalised, {}).variant).toBe('digital')

    const round = partFromYaml(partToYaml(normalised)) as PartDefinition
    expect(housingOf(round, {}).variant).toBe('digital')
  })

  it('ignores a bogus variant rather than storing it', () => {
    const h = housingOf(
      part(),
      withGroupHousing(part(), 'g1', 'grove', 'spi' as unknown as 'i2c')
    )
    expect(h.variant).toBeUndefined()
  })
})
