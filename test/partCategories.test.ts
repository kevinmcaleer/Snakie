import { describe, it, expect } from 'vitest'
import {
  PART_CATEGORIES,
  OTHER_CATEGORY,
  partCategory,
  categoryRank,
  groupByCategory
} from '../src/renderer/src/components/part-categories'

/**
 * Category grouping for the parts library section headers (#193, epic #191).
 * The category is the part's `family`; these cover the canonical ordering, the
 * unknown-family + no-family fallbacks, and the grouping/sort.
 */
describe('partCategory', () => {
  it('is the trimmed family, or Other when unset', () => {
    expect(partCategory({ family: 'Sensor' })).toBe('Sensor')
    expect(partCategory({ family: '  Power  ' })).toBe('Power')
    expect(partCategory({ family: '' })).toBe(OTHER_CATEGORY)
    expect(partCategory({})).toBe(OTHER_CATEGORY)
    expect(partCategory({ family: null })).toBe(OTHER_CATEGORY)
  })
})

describe('categoryRank', () => {
  it('orders canonical categories by PART_CATEGORIES, case-insensitively', () => {
    expect(categoryRank('Microcontroller')).toBe(0)
    expect(categoryRank('microcontroller')).toBe(0)
    expect(categoryRank('Computer')).toBe(1)
    expect(categoryRank('IC')).toBe(PART_CATEGORIES.length - 1)
    expect(categoryRank('Microcontroller')).toBeLessThan(categoryRank('Power'))
  })

  it('ranks unknown families after canonical, and Other last', () => {
    expect(categoryRank('Breakout')).toBeGreaterThan(categoryRank('IC'))
    expect(categoryRank(OTHER_CATEGORY)).toBeGreaterThan(categoryRank('Breakout'))
  })
})

describe('groupByCategory', () => {
  const parts = [
    { name: 'VL53L0X', family: 'Sensor' },
    { name: 'Pico 2 W', family: 'Microcontroller' },
    { name: 'Pico', family: 'Microcontroller' },
    { name: 'Mystery widget' }, // no family → Other
    { name: 'Some breakout', family: 'Breakout' }, // unknown family
    { name: 'AMS1117', family: 'Power' }
  ]

  it('orders sections canonical-first, then unknown, then Other', () => {
    const groups = groupByCategory(parts)
    expect(groups.map((g) => g.category)).toEqual([
      'Microcontroller',
      'Sensor',
      'Power',
      'Breakout',
      OTHER_CATEGORY
    ])
  })

  it('sorts parts within a section by name', () => {
    const mcu = groupByCategory(parts).find((g) => g.category === 'Microcontroller')!
    expect(mcu.items.map((p) => p.name)).toEqual(['Pico', 'Pico 2 W'])
  })

  it('handles an empty list', () => {
    expect(groupByCategory([])).toEqual([])
  })
})
