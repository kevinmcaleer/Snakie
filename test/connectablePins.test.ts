import { describe, expect, it } from 'vitest'
import { connectablePinCount } from '../src/shared/part'
import type { PartDefinition } from '../src/shared/part'

/**
 * One rule, two callers (the Part Editor's `validatePart` and the main process's
 * `writePart`). They used to disagree: the editor counted connector contacts,
 * the save guard asked only that `headers` be non-empty. A Grove module — whose
 * only electrical interface is its socket — passed the editor and was rejected
 * on save with "a part needs at least one header with pins", naming a thing it
 * correctly does not have.
 */
const part = (over: Partial<PartDefinition> = {}): PartDefinition => ({
  id: 'p',
  name: 'P',
  headers: [],
  ...over
})

describe('connectablePinCount', () => {
  it('counts a Grove socket with no header at all — the reported bug', () => {
    const grove = part({
      connectors: [
        {
          kind: 'grove',
          variant: 'digital',
          x: 0.5,
          y: 0.9,
          pins: [
            { name: 'SIG', type: 'io' },
            { name: 'NC', type: 'io' },
            { name: 'VCC', type: 'pwr' },
            { name: 'GND', type: 'gnd' }
          ]
        }
      ]
    })
    expect(connectablePinCount(grove)).toBe(4)
  })

  it('counts header pins', () => {
    expect(
      connectablePinCount(
        part({ headers: [{ edge: 'left', pins: [{ name: 'GP0', type: 'io', number: 1 }] }] })
      )
    ).toBe(1)
  })

  it('adds both together', () => {
    expect(
      connectablePinCount(
        part({
          headers: [{ edge: 'left', pins: [{ name: 'GP0', type: 'io', number: 1 }] }],
          connectors: [{ kind: 'qwiic', x: 0.1, y: 0.5, pins: [{ name: 'GND', type: 'gnd' }] }]
        })
      )
    ).toBe(2)
  })

  it('ignores unnamed pins — `normalisePart` drops them, so they connect nothing', () => {
    expect(
      connectablePinCount(
        part({ headers: [{ edge: 'left', pins: [{ name: '  ', type: 'io', number: 1 }] }] })
      )
    ).toBe(0)
  })

  it('a header carrying NO pins does not satisfy the rule', () => {
    // The old guard's wording promised "at least one header with pins" but only
    // checked that the array was non-empty.
    expect(connectablePinCount(part({ headers: [{ edge: 'left', pins: [] }] }))).toBe(0)
  })

  it('a part with nothing at all counts zero', () => {
    expect(connectablePinCount(part())).toBe(0)
  })
})
