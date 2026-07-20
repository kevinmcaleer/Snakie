import { describe, expect, it } from 'vitest'
import {
  DEFAULT_INFILL,
  MATERIAL_NAMES,
  estimateFromMesh,
  estimateWarning,
  gramsToKg,
  kgToGrams,
  mToMm,
  mmToM,
  resolveMass,
  sourceLabel,
  summariseMass
} from '../src/renderer/src/components/robot-mass'
import type { MeshTriangles, Vec3 } from '../src/renderer/src/components/robot-mass-geometry'

/** A closed axis-aligned box, corner at min, given size — reused from the
 *  geometry tests' shape but inline so this file stands alone. */
function boxMesh(min: Vec3, size: Vec3): MeshTriangles {
  const [x, y, z] = min
  const [w, h, d] = size
  const v: Vec3[] = [
    [x, y, z], [x + w, y, z], [x + w, y + h, z], [x, y + h, z],
    [x, y, z + d], [x + w, y, z + d], [x + w, y + h, z + d], [x, y + h, z + d]
  ]
  const faces: Array<[number, number, number]> = [
    [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4],
    [3, 7, 6], [3, 6, 2], [0, 4, 7], [0, 7, 3], [1, 2, 6], [1, 6, 5]
  ]
  const positions: number[] = []
  for (const [a, b, c] of faces) positions.push(...v[a], ...v[b], ...v[c])
  return { positions }
}

describe('estimateFromMesh', () => {
  it('estimates a printed cube: volume × density × infill', () => {
    // A 10 mm cube authored in mm (scale 1) → 1000 mm³ = 1 cm³.
    // PLA 1.24 g/cm³ at 100 % infill = 1.24 g.
    const est = estimateFromMesh(boxMesh([0, 0, 0], [10, 10, 10]), {
      material: 'PLA',
      infill: 1,
      unitScaleToMm: 1
    })
    expect(est.grams).toBeCloseTo(1.24, 6)
    expect(est.method).toBe('mesh')
    est.centroidMm.forEach((c) => expect(c).toBeCloseTo(5, 6))
  })

  it('applies infill linearly', () => {
    const full = estimateFromMesh(boxMesh([0, 0, 0], [10, 10, 10]), { material: 'PLA', infill: 1, unitScaleToMm: 1 })
    const fifth = estimateFromMesh(boxMesh([0, 0, 0], [10, 10, 10]), { material: 'PLA', infill: 0.2, unitScaleToMm: 1 })
    expect(fifth.grams).toBeCloseTo(full.grams * 0.2, 6)
  })

  it('scales volume by the CUBE of unitScaleToMm (a metre-authored mesh)', () => {
    // A 0.01 m cube authored in metres, scale 1000 → 10 mm cube = 1 cm³.
    const est = estimateFromMesh(boxMesh([0, 0, 0], [0.01, 0.01, 0.01]), {
      material: 'PLA',
      infill: 1,
      unitScaleToMm: 1000
    })
    expect(est.grams).toBeCloseTo(1.24, 5)
    est.centroidMm.forEach((c) => expect(c).toBeCloseTo(5, 5)) // 0.005 m → 5 mm
  })

  it('defaults material to PLA and infill to 20%', () => {
    const withDefaults = estimateFromMesh(boxMesh([0, 0, 0], [10, 10, 10]), { unitScaleToMm: 1 })
    const explicit = estimateFromMesh(boxMesh([0, 0, 0], [10, 10, 10]), {
      material: 'PLA',
      infill: DEFAULT_INFILL,
      unitScaleToMm: 1
    })
    expect(withDefaults.grams).toBeCloseTo(explicit.grams, 6)
    expect(withDefaults.grams).toBeCloseTo(1.24 * 0.2, 6)
  })
})

describe('estimateWarning', () => {
  it('is null for a clean closed mesh', () => {
    const est = estimateFromMesh(boxMesh([0, 0, 0], [10, 10, 10]), { unitScaleToMm: 1 })
    expect(estimateWarning(est)).toBeNull()
  })

  it('warns about a hull (holey mesh) and a bbox (no volume)', () => {
    const box = boxMesh([0, 0, 0], [10, 10, 10])
    const holey = estimateFromMesh({ positions: Array.from(box.positions).slice(0, -18) }, { unitScaleToMm: 1 })
    expect(estimateWarning(holey)).toMatch(/hull|holes/i)

    const flat = estimateFromMesh(
      { positions: [0, 0, 0, 4, 0, 0, 4, 3, 0, 0, 0, 0, 4, 3, 0, 0, 3, 0] },
      { unitScaleToMm: 1 }
    )
    expect(estimateWarning(flat)).toMatch(/bounding box/i)
  })
})

describe('resolveMass — trust order', () => {
  it('measured beats library beats estimated', () => {
    expect(resolveMass({ measuredG: 9, libraryG: 8, estimateG: 5 })).toEqual({ grams: 9, source: 'measured' })
    expect(resolveMass({ libraryG: 8, estimateG: 5 })).toEqual({ grams: 8, source: 'library' })
    expect(resolveMass({ estimateG: 5 })).toEqual({ grams: 5, source: 'estimated' })
  })

  it('falls through non-positive / non-finite values', () => {
    expect(resolveMass({ measuredG: 0, libraryG: 8 })).toEqual({ grams: 8, source: 'library' })
    expect(resolveMass({ measuredG: -1, estimateG: 5 })).toEqual({ grams: 5, source: 'estimated' })
    expect(resolveMass({ measuredG: Number.NaN, libraryG: 8 })).toEqual({ grams: 8, source: 'library' })
  })

  it('reports none when nothing is known', () => {
    expect(resolveMass({})).toEqual({ grams: 0, source: 'none' })
    expect(resolveMass({ estimateG: 0 })).toEqual({ grams: 0, source: 'none' })
  })
})

describe('unit conversions', () => {
  it('grams ↔ kilograms and mm ↔ metres round-trip', () => {
    expect(gramsToKg(9)).toBeCloseTo(0.009, 9)
    expect(kgToGrams(0.009)).toBeCloseTo(9, 9)
    expect(mmToM(50)).toBeCloseTo(0.05, 9)
    expect(mToMm(0.05)).toBeCloseTo(50, 9)
  })
})

describe('summariseMass — breakdown table', () => {
  const rows = [
    { link: 'base', grams: 300, source: 'estimated' as const },
    { link: 'arm', grams: 9, source: 'measured' as const },
    { link: 'gripper', grams: 0, source: 'none' as const },
    { link: 'wrist', grams: 50, source: 'library' as const }
  ]

  it('sorts heaviest-first by default and totals the set masses', () => {
    const b = summariseMass(rows)
    expect(b.rows.map((r) => r.link)).toEqual(['base', 'wrist', 'arm', 'gripper'])
    expect(b.totalG).toBe(359)
    expect(b.unsetCount).toBe(1)
  })

  it('sorts by name when asked', () => {
    const b = summariseMass(rows, 'name')
    expect(b.rows.map((r) => r.link)).toEqual(['arm', 'base', 'gripper', 'wrist'])
    expect(b.totalG).toBe(359)
  })

  it('breaks mass ties by link name for a stable order', () => {
    const b = summariseMass([
      { link: 'z', grams: 10, source: 'measured' },
      { link: 'a', grams: 10, source: 'measured' }
    ])
    expect(b.rows.map((r) => r.link)).toEqual(['a', 'z'])
  })

  it('an all-empty robot totals zero with everything unset', () => {
    const b = summariseMass([
      { link: 'a', grams: 0, source: 'none' },
      { link: 'b', grams: 0, source: 'none' }
    ])
    expect(b.totalG).toBe(0)
    expect(b.unsetCount).toBe(2)
  })

  it('does not mutate the caller’s array', () => {
    const input = [...rows]
    summariseMass(input)
    expect(input.map((r) => r.link)).toEqual(['base', 'arm', 'gripper', 'wrist'])
  })
})

describe('presentation', () => {
  it('labels each source', () => {
    expect(sourceLabel('measured')).toBe('measured')
    expect(sourceLabel('library')).toBe('from part')
    expect(sourceLabel('estimated')).toBe('estimated')
    expect(sourceLabel('none')).toBe('not set')
  })

  it('exposes the material presets in order', () => {
    expect(MATERIAL_NAMES).toContain('PLA')
    expect(MATERIAL_NAMES).toContain('PETG')
  })
})
