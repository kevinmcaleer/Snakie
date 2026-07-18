import { describe, it, expect } from 'vitest'
import {
  numericValue,
  compareCells,
  cellPasses,
  isActiveFilter,
  computeView,
  nextSort,
  summariseColumn,
  type Filter
} from '../src/renderer/src/components/data-view-ops'
import type { Column } from '../src/renderer/src/components/data-table'

const cols = (...types: Column['type'][]): Column[] =>
  types.map((type, index) => ({ name: `c${index}`, type, index }))

describe('numericValue (#275)', () => {
  it('parses numbers, ISO timestamps and clock times', () => {
    expect(numericValue('21.5', 'number')).toBe(21.5)
    expect(numericValue('', 'number')).toBeNaN()
    expect(numericValue('abc', 'number')).toBeNaN()
    expect(numericValue('2026-01-01T00:00:00Z', 'timestamp')).toBe(Date.parse('2026-01-01T00:00:00Z'))
    // Bare clock → ms-of-day.
    expect(numericValue('01:00', 'timestamp')).toBe(3600 * 1000)
    expect(numericValue('00:00:30', 'timestamp')).toBe(30 * 1000)
  })
})

describe('compareCells — type-aware sort (#275)', () => {
  it('numbers sort numerically, not lexically (2 < 10 < 100)', () => {
    const nums = ['100', '2', '10'].sort((a, b) => compareCells(a, b, 'number'))
    expect(nums).toEqual(['2', '10', '100'])
  })
  it('text sorts lexically', () => {
    expect(['b', 'a', 'c'].sort((a, b) => compareCells(a, b, 'string'))).toEqual(['a', 'b', 'c'])
  })
  it('timestamps sort chronologically', () => {
    const ts = ['2026-03-01', '2026-01-01', '2026-02-01'].sort((a, b) => compareCells(a, b, 'timestamp'))
    expect(ts).toEqual(['2026-01-01', '2026-02-01', '2026-03-01'])
  })
})

describe('filters (#275)', () => {
  it('numeric range: min/max inclusive, null cell fails', () => {
    const f: Filter = { kind: 'range', min: 10, max: 20 }
    expect(cellPasses('15', 'number', f)).toBe(true)
    expect(cellPasses('10', 'number', f)).toBe(true)
    expect(cellPasses('20', 'number', f)).toBe(true)
    expect(cellPasses('9', 'number', f)).toBe(false)
    expect(cellPasses('', 'number', f)).toBe(false)
  })
  it('one-sided range', () => {
    expect(cellPasses('5', 'number', { kind: 'range', min: null, max: 10 })).toBe(true)
    expect(cellPasses('50', 'number', { kind: 'range', min: 10, max: null })).toBe(true)
    expect(cellPasses('5', 'number', { kind: 'range', min: 10, max: null })).toBe(false)
  })
  it('text contains / equals (case-insensitive)', () => {
    expect(cellPasses('Warm', 'string', { kind: 'text', mode: 'contains', value: 'arm' })).toBe(true)
    expect(cellPasses('Warm', 'string', { kind: 'text', mode: 'equals', value: 'warm' })).toBe(true)
    expect(cellPasses('Warm', 'string', { kind: 'text', mode: 'equals', value: 'war' })).toBe(false)
  })
  it('empty filters are inactive (pass everything)', () => {
    expect(isActiveFilter({ kind: 'range', min: null, max: null })).toBe(false)
    expect(isActiveFilter({ kind: 'text', mode: 'contains', value: '  ' })).toBe(false)
    expect(cellPasses('anything', 'number', { kind: 'range', min: null, max: null })).toBe(true)
  })
})

describe('computeView — filter + sort composition (#275)', () => {
  const columns = cols('number', 'number', 'string')
  const rows = [
    ['1', '100', 'ok'],
    ['2', '2', 'warm'],
    ['3', '10', 'ok'],
    ['4', '', 'cool'], // null in col 1
    ['5', '50', 'warm']
  ]

  it('sorts a numeric column numerically, nulls last', () => {
    const view = computeView(rows, columns, new Map(), { col: 1, dir: 'asc' })
    // col1 values: 100,2,10,(null),50 → asc: 2,10,50,100, then null row.
    expect(view.map((i) => rows[i][1])).toEqual(['2', '10', '50', '100', ''])
  })

  it('desc keeps nulls last (not first)', () => {
    const view = computeView(rows, columns, new Map(), { col: 1, dir: 'desc' })
    expect(view.map((i) => rows[i][1])).toEqual(['100', '50', '10', '2', ''])
  })

  it('a numeric range filter + a text contains filter combine', () => {
    const filters = new Map<number, Filter>([
      [1, { kind: 'range', min: 5, max: 100 }],
      [2, { kind: 'text', mode: 'contains', value: 'warm' }]
    ])
    const view = computeView(rows, columns, filters, null)
    // col1 in [5,100] → rows 0(100),2(10),4(50); of those col2=warm → row 4 only.
    expect(view).toEqual([4])
  })

  it('stable across re-sorts (equal keys keep order)', () => {
    const r2 = [
      ['a', '1'],
      ['b', '1'],
      ['c', '1']
    ]
    const c2 = cols('string', 'number')
    const view = computeView(r2, c2, new Map(), { col: 1, dir: 'asc' })
    expect(view.map((i) => r2[i][0])).toEqual(['a', 'b', 'c'])
  })
})

describe('nextSort cycle (#275)', () => {
  it('none → asc → desc → none, resets on a new column', () => {
    expect(nextSort(null, 2)).toEqual({ col: 2, dir: 'asc' })
    expect(nextSort({ col: 2, dir: 'asc' }, 2)).toEqual({ col: 2, dir: 'desc' })
    expect(nextSort({ col: 2, dir: 'desc' }, 2)).toBeNull()
    expect(nextSort({ col: 2, dir: 'desc' }, 3)).toEqual({ col: 3, dir: 'asc' })
  })
})

describe('summariseColumn — over the visible set (#275)', () => {
  const rows = [
    ['10', 'ok'],
    ['20', 'ok'],
    ['', 'warm'], // null number
    ['30', 'ok']
  ]

  it('numeric: min/max/mean + null count over given indices', () => {
    const s = summariseColumn(rows, 0, 'number', [0, 1, 2, 3])
    expect(s).toMatchObject({ type: 'number', count: 3, nulls: 1, min: 10, max: 30 })
    expect(s.mean).toBeCloseTo(20)
  })

  it('recomputes for a filtered subset only', () => {
    const s = summariseColumn(rows, 0, 'number', [0, 1]) // just 10, 20
    expect(s).toMatchObject({ count: 2, min: 10, max: 20 })
    expect(s.mean).toBeCloseTo(15)
  })

  it('text: distinct + top value + null count', () => {
    const s = summariseColumn(rows, 1, 'string', [0, 1, 2, 3])
    expect(s).toMatchObject({ type: 'string', distinct: 2, top: 'ok', topCount: 3, nulls: 0 })
  })

  it('all-null column → count 0, no min/max', () => {
    const s = summariseColumn([['']], 0, 'number', [0])
    expect(s).toMatchObject({ count: 0, nulls: 1 })
    expect(s.min).toBeUndefined()
  })
})
