import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { partFromYaml } from '../src/shared/part-yaml'
import {
  applyFilters,
  buildFacets,
  emptySelection,
  isRedundantTag,
  matchesQuery,
  primaryTagCount,
  toggleFacet,
  UNSET,
  type CatalogPart
} from '../src/renderer/src/components/part-facets'
import type { PartDefinition } from '../src/shared/part'

/**
 * Catalog facets (#740). Exercised against the REAL bundled library, because
 * the whole design came from its actual shape — 8 families, 10 manufacturers,
 * 69 tags of which most appear once or twice.
 */
const LIB = join(__dirname, '..', 'examples', 'parts', 'snakie-standard')
const CATALOG: CatalogPart[] = readdirSync(LIB, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .flatMap((e) => {
    try {
      return [{ libraryId: 'snakie-standard', part: partFromYaml(readFileSync(join(LIB, e.name, 'parts.yml'), 'utf-8')) }]
    } catch {
      return []
    }
  })

const p = (over: Partial<PartDefinition>): CatalogPart => ({
  libraryId: 'l',
  part: { id: 'x', name: 'X', description: '', ...over } as PartDefinition
})

describe('the real bundled library', () => {
  it('has parts to filter', () => {
    expect(CATALOG.length).toBeGreaterThan(30)
  })

  it('offers every family and manufacturer, counted', () => {
    const f = buildFacets(CATALOG)
    expect(f.families.length).toBeGreaterThan(5)
    expect(f.manufacturers.length).toBeGreaterThan(5)
    // Commonest first — Microcontroller dominates this library.
    expect(f.families[0].value).toBe('Microcontroller')
    expect(f.families[0].count).toBeGreaterThan(f.families[1].count - 1)
  })

  it('shows parts with no manufacturer rather than dropping them', () => {
    const man = buildFacets(CATALOG).manufacturers.find((m) => m.value === UNSET)
    expect(man, 'an (unset) bucket exists').toBeTruthy()
    expect(man!.count).toBeGreaterThan(0)
  })

  it('drops tags that merely restate a facet', () => {
    // 'sensor' and 'motor' are family names; 'seeed'/'adafruit' are makers.
    const tags = buildFacets(CATALOG).tags.map((t) => t.value)
    for (const dup of ['sensor', 'motor', 'power', 'adafruit', 'seeed']) {
      expect(tags, `${dup} duplicates a facet`).not.toContain(dup)
    }
    // …while the genuinely useful ones survive.
    expect(tags).toContain('i2c')
    expect(tags).toContain('qwiic')
  })

  it('keeps the long tail out of the way, not out of reach', () => {
    const tags = buildFacets(CATALOG).tags
    const shown = primaryTagCount(tags)
    expect(shown).toBeGreaterThan(3)
    expect(shown).toBeLessThan(tags.length) // there IS a tail
    // Everything up front is a real filter, not a search result of one.
    for (const t of tags.slice(0, shown)) expect(t.count).toBeGreaterThan(1)
  })
})

describe('selection semantics', () => {
  const parts = [
    p({ id: 'a', family: 'Sensor', manufacturer: 'Adafruit', tags: ['i2c'] }),
    p({ id: 'b', family: 'Sensor', manufacturer: 'Pimoroni', tags: ['spi'] }),
    p({ id: 'c', family: 'Motor', manufacturer: 'Adafruit', tags: ['i2c'] })
  ]
  const ids = (r: CatalogPart[]): string[] => r.map((x) => x.part.id).sort()

  it('is OR within a facet', () => {
    let sel = toggleFacet(emptySelection(), 'families', 'Sensor')
    sel = toggleFacet(sel, 'families', 'Motor')
    expect(ids(applyFilters(parts, sel))).toEqual(['a', 'b', 'c'])
  })

  it('is AND across facets', () => {
    let sel = toggleFacet(emptySelection(), 'families', 'Sensor')
    sel = toggleFacet(sel, 'manufacturers', 'Adafruit')
    expect(ids(applyFilters(parts, sel))).toEqual(['a'])
  })

  it('ANDs with the text query too', () => {
    const sel = toggleFacet(emptySelection(), 'families', 'Sensor')
    expect(ids(applyFilters(parts, sel, 'pimoroni'))).toEqual(['b'])
  })

  it('counts each value against the OTHER filters, not itself', () => {
    // With Adafruit chosen, the family counts must show what Adafruit leaves —
    // otherwise every number contradicts the grid the moment you filter.
    const sel = toggleFacet(emptySelection(), 'manufacturers', 'Adafruit')
    const f = buildFacets(parts, sel)
    expect(f.families.find((x) => x.value === 'Sensor')!.count).toBe(1)
    // …while the manufacturer axis still offers its alternatives at full count.
    expect(f.manufacturers.find((x) => x.value === 'Pimoroni')!.count).toBe(1)
  })

  it('toggling is reversible and immutable', () => {
    const base = emptySelection()
    const on = toggleFacet(base, 'tags', 'i2c')
    expect(on.tags.has('i2c')).toBe(true)
    expect(base.tags.size, 'the original is untouched').toBe(0)
    expect(toggleFacet(on, 'tags', 'i2c').tags.size).toBe(0)
  })

  it('keeps a SELECTED rare tag visible, so it can be un-picked', () => {
    const rare = [p({ id: 'r', tags: ['max22211'] }), p({ id: 's', tags: ['i2c'] }), p({ id: 't', tags: ['i2c'] })]
    const sel = toggleFacet(emptySelection(), 'tags', 'max22211')
    const tags = buildFacets(rare, sel).tags
    expect(tags.some((t) => t.value === 'max22211' && t.selected)).toBe(true)
    expect(primaryTagCount(tags)).toBeGreaterThan(0)
  })
})

describe('helpers', () => {
  it('isRedundantTag catches a manufacturer WORD, not just the whole name', () => {
    expect(isRedundantTag('seeed', [], ['Seeed Studio'])).toBe(true)
    expect(isRedundantTag('sensor', ['Sensor'], [])).toBe(true)
    expect(isRedundantTag('i2c', ['Sensor'], ['Seeed Studio'])).toBe(false)
  })

  it('matchesQuery searches name, description, maker, family and tags', () => {
    const part = { name: 'Widget', description: 'a thing', manufacturer: 'Acme', family: 'Sensor', tags: ['i2c'] } as PartDefinition
    for (const q of ['widget', 'thing', 'acme', 'sensor', 'i2c']) expect(matchesQuery(part, q)).toBe(true)
    expect(matchesQuery(part, 'nope')).toBe(false)
    expect(matchesQuery(part, '   ')).toBe(true) // blank filters nothing
  })
})
