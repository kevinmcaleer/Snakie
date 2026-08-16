import { describe, expect, it } from 'vitest'
import { cornerRadiusFraction } from '../src/shared/part'
import { partFromYaml, partToYaml } from '../src/shared/part-yaml'
import { blankPart, normalisePart } from '../src/renderer/src/components/part-editor.util'
import type { PartDefinition } from '../src/shared/part'

/**
 * The board outline's corner radius in millimetres (#739).
 *
 * A PCB is specified in mm, so a part that declares its physical size should be
 * able to say "2 mm" instead of a fraction derived from it. The fraction stays
 * for parts with no dimensions, and everything that DRAWS resolves the two
 * through `cornerRadiusFraction` rather than reading either field.
 */
const dims = { width: 41, height: 25.36 }

describe('cornerRadiusFraction', () => {
  it('converts mm against the SMALLER board side', () => {
    // 2 mm on a 41 × 25.36 board → 2 / 25.36.
    expect(cornerRadiusFraction({ kind: 'rect', cornerRadiusMm: 2 }, dims)).toBeCloseTo(
      2 / 25.36,
      6
    )
  })

  it('prefers mm over the fraction when both are set', () => {
    const frac = cornerRadiusFraction(
      { kind: 'rect', cornerRadius: 0.04, cornerRadiusMm: 2 },
      dims
    )
    expect(frac).toBeCloseTo(2 / 25.36, 6)
    expect(frac).not.toBeCloseTo(0.04, 4)
  })

  it('falls back to the fraction when there are no dimensions to convert against', () => {
    // Nothing to scale mm by, so the authored fraction still draws — and the
    // editor says so rather than silently drawing nothing.
    expect(cornerRadiusFraction({ kind: 'rect', cornerRadius: 0.04, cornerRadiusMm: 2 }, undefined))
      .toBeCloseTo(0.04, 6)
  })

  it('honours an explicit 0 mm as SQUARE corners, not "unset"', () => {
    expect(cornerRadiusFraction({ kind: 'rect', cornerRadius: 0.25, cornerRadiusMm: 0 }, dims)).toBe(0)
  })

  it('clamps a radius bigger than half the smaller side (undrawable)', () => {
    expect(cornerRadiusFraction({ kind: 'rect', cornerRadiusMm: 999 }, dims)).toBe(0.5)
  })

  it('is undefined when nothing is specified, so callers keep their own default', () => {
    expect(cornerRadiusFraction({ kind: 'rect' }, dims)).toBeUndefined()
    expect(cornerRadiusFraction(undefined, dims)).toBeUndefined()
  })

  it('ignores a negative or non-finite mm', () => {
    expect(cornerRadiusFraction({ kind: 'rect', cornerRadius: 0.1, cornerRadiusMm: -3 }, dims))
      .toBeCloseTo(0.1, 6)
    expect(cornerRadiusFraction({ kind: 'rect', cornerRadius: 0.1, cornerRadiusMm: NaN }, dims))
      .toBeCloseTo(0.1, 6)
  })

  it('ignores a zero-sized board rather than dividing by zero', () => {
    expect(
      cornerRadiusFraction({ kind: 'rect', cornerRadius: 0.1, cornerRadiusMm: 2 }, { width: 0, height: 0 })
    ).toBeCloseTo(0.1, 6)
  })
})

describe('cornerRadiusMm survives the whitelists (#739)', () => {
  const withMm = (): PartDefinition => ({
    ...blankPart(),
    dimensions: { ...dims },
    shape: { kind: 'rect', cornerRadius: 0.04, cornerRadiusMm: 2 }
  })

  it('round-trips through parts.yml', () => {
    const back = partFromYaml(partToYaml(withMm()))
    expect(back.shape?.cornerRadiusMm).toBe(2)
    expect(back.shape?.cornerRadius).toBeCloseTo(0.04, 6)
  })

  it('round-trips an explicit 0 mm (square corners) rather than dropping it', () => {
    const part = { ...withMm(), shape: { kind: 'rect' as const, cornerRadiusMm: 0 } }
    expect(partFromYaml(partToYaml(part)).shape?.cornerRadiusMm).toBe(0)
  })

  it('survives normalisePart, the editor save path', () => {
    expect(normalisePart(withMm()).shape?.cornerRadiusMm).toBe(2)
  })

  it('normalisePart does NOT clamp mm to the fraction range — it is a real dimension', () => {
    // 6 mm is a perfectly ordinary radius; clamping it to 0.5 would be nonsense.
    const part = { ...withMm(), shape: { kind: 'rect' as const, cornerRadiusMm: 6 } }
    expect(normalisePart(part).shape?.cornerRadiusMm).toBe(6)
  })

  it('drops a negative mm on the way in', () => {
    const part = { ...withMm(), shape: { kind: 'rect' as const, cornerRadiusMm: -1 } }
    expect(normalisePart(part).shape?.cornerRadiusMm).toBeUndefined()
    expect(partFromYaml(partToYaml(part)).shape?.cornerRadiusMm).toBeUndefined()
  })
})
