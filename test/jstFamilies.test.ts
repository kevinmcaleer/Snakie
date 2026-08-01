import { describe, it, expect } from 'vitest'
import {
  JST_FAMILIES,
  coerceConnectorVariant,
  coerceJstFamily
} from '../src/shared/part'
import { connectorFit, connectorKindName } from '../src/renderer/src/components/cable'
import { connectorSize } from '../src/renderer/src/components/part-body'
import { partFromYaml, partToYaml } from '../src/shared/part-yaml'
import { normalisePart } from '../src/renderer/src/components/part-editor.util'
import type { PartConnector, PartDefinition } from '../src/shared/part'

/** JST families (#668): one `variant` field, validated per kind. */
const jst = (variant?: string, n = 2): PartConnector =>
  ({
    kind: 'jst',
    variant,
    x: 0.5,
    y: 0.5,
    pins: Array.from({ length: n }, (_, i) => ({ name: i ? 'GND' : 'SIG', type: i ? 'gnd' : 'io' }))
  }) as unknown as PartConnector

describe('coerceConnectorVariant (#668)', () => {
  it('validates the variant against the kind that carries it', () => {
    expect(coerceConnectorVariant('jst', 'xh')).toBe('xh')
    expect(coerceConnectorVariant('grove', 'i2c')).toBe('i2c')
    // A Grove wiring is not a JST family, and vice versa.
    expect(coerceConnectorVariant('jst', 'i2c')).toBeUndefined()
    expect(coerceConnectorVariant('grove', 'xh')).toBeUndefined()
  })

  it('drops a variant on kinds that have none', () => {
    for (const k of ['qwiic', 'dupont', 'terminal'] as const) {
      expect(coerceConnectorVariant(k, 'ph')).toBeUndefined()
    }
  })

  it('rejects junk', () => {
    expect(coerceJstFamily('nonsense')).toBeUndefined()
    expect(coerceJstFamily(undefined)).toBeUndefined()
    expect(JST_FAMILIES).toContain('ph')
  })
})

describe('a JST family drives the drawn size (#668)', () => {
  it('scales with the pitch', () => {
    const w = (v?: string): number => connectorSize(jst(v), 10).w
    expect(w('sh')).toBeLessThan(w('ph'))
    expect(w('ph')).toBeLessThan(w('xh'))
    expect(w('xh')).toBeLessThan(w('vh'))
  })

  it('defaults to PH, so connectors authored before families are unchanged', () => {
    expect(connectorSize(jst(undefined), 10).w).toBe(connectorSize(jst('ph'), 10).w)
  })
})

describe('a lead only fits its own family (#668)', () => {
  it('refuses a cross-family lead, naming both', () => {
    const fit = connectorFit(jst('ph'), jst('xh'))
    expect(fit.ok).toBe(false)
    expect(fit.reason).toContain('JST-PH')
    expect(fit.reason).toContain('JST-XH')
  })

  it('joins two of the same family, contact for contact', () => {
    const fit = connectorFit(jst('xh'), jst('xh'))
    expect(fit.ok).toBe(true)
    // Identical housings pair by INDEX, and every contact that carries a role
    // (here signal + ground) is joined — names are never consulted.
    expect(fit.pairs).toEqual([
      [0, 0],
      [1, 1]
    ])
  })

  it('treats an unset family as PH rather than as "any"', () => {
    expect(connectorFit(jst(undefined), jst('ph')).ok).toBe(true)
    expect(connectorFit(jst(undefined), jst('vh')).ok).toBe(false)
  })

  it('names the family in the human label', () => {
    expect(connectorKindName(jst('gh'))).toBe('JST-GH')
    expect(connectorKindName(jst(undefined))).toBe('JST')
  })
})

describe('the family round-trips through parts.yml (#668)', () => {
  it('survives save + reload, and a bogus one is dropped', () => {
    const part = normalisePart({
      id: 'p',
      name: 'P',
      headers: [],
      connectors: [jst('gh'), { ...jst('i2c'), kind: 'jst' }]
    } as unknown as PartDefinition)
    const back = partFromYaml(partToYaml(part))
    expect(back.connectors?.[0].variant).toBe('gh')
    expect(back.connectors?.[1].variant).toBeUndefined()
  })
})
