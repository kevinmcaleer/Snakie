/**
 * DATA VIEW ops (#275, epic #272) — type-aware sort, filter and column summary
 * over the parsed {@link ./data-table} model.
 * =============================================================================
 *
 * Everything works on ROW INDICES (not row copies) so the virtualised table can
 * render a filtered/sorted view of an 86k-row log without cloning it. Pure and
 * DOM-free → unit-tested in node. `Date.parse` sniffs timestamps (string arg,
 * deterministic).
 */
import type { Column, ColumnType } from './data-table'

export type SortDir = 'asc' | 'desc'
export interface SortState {
  col: number
  dir: SortDir
}

/** A per-column filter. Range for number/timestamp; text for string columns. */
export type Filter =
  | { kind: 'range'; min: number | null; max: number | null }
  | { kind: 'text'; mode: 'contains' | 'equals'; value: string }

/** Is a cell "null" for its type (blank, or non-parseable for number/timestamp)? */
export function isBlank(cell: string): boolean {
  return cell.trim() === ''
}

/** The numeric ordering value of a cell: float for numbers, epoch-ms for
 *  timestamps (incl. bare `HH:MM(:SS)` as seconds-of-day), else NaN. */
export function numericValue(cell: string, type: ColumnType): number {
  const s = cell.trim()
  if (s === '') return NaN
  if (type === 'number') return Number(s)
  if (type === 'timestamp') {
    const clock = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s)
    if (clock) return (+clock[1] * 3600 + +clock[2] * 60 + (clock[3] ? +clock[3] : 0)) * 1000
    const t = Date.parse(s)
    return Number.isNaN(t) ? NaN : t
  }
  return NaN
}

/** Type-aware compare of two NON-null cells (-1/0/1). */
export function compareCells(a: string, b: string, type: ColumnType): number {
  if (type === 'number' || type === 'timestamp') {
    const av = numericValue(a, type)
    const bv = numericValue(b, type)
    return av < bv ? -1 : av > bv ? 1 : 0
  }
  return a.localeCompare(b, undefined, { numeric: false, sensitivity: 'base' })
}

/** Whether a filter actually constrains anything (empty filters are ignored). */
export function isActiveFilter(f: Filter): boolean {
  return f.kind === 'range' ? f.min !== null || f.max !== null : f.value.trim() !== ''
}

/** Does one cell pass a filter? A null cell fails any active filter. */
export function cellPasses(cell: string, type: ColumnType, f: Filter): boolean {
  if (!isActiveFilter(f)) return true
  if (f.kind === 'range') {
    const v = numericValue(cell, type)
    if (Number.isNaN(v)) return false
    if (f.min !== null && v < f.min) return false
    if (f.max !== null && v > f.max) return false
    return true
  }
  const hay = cell.trim().toLowerCase()
  const needle = f.value.trim().toLowerCase()
  return f.mode === 'equals' ? hay === needle : hay.includes(needle)
}

/**
 * Build the visible view: row indices that pass all active filters, then sorted
 * by `sort` (nulls always last, independent of direction). Stable — equal keys
 * keep their filtered order, so re-sorting is deterministic.
 */
export function computeView(
  rows: readonly string[][],
  columns: readonly Column[],
  filters: ReadonlyMap<number, Filter>,
  sort: SortState | null
): number[] {
  const active: Array<[number, Filter]> = []
  for (const [col, f] of filters) if (isActiveFilter(f)) active.push([col, f])

  const idx: number[] = []
  for (let i = 0; i < rows.length; i++) {
    let ok = true
    for (const [col, f] of active) {
      const type = columns[col]?.type ?? 'string'
      if (!cellPasses(rows[i][col] ?? '', type, f)) {
        ok = false
        break
      }
    }
    if (ok) idx.push(i)
  }

  if (sort && columns[sort.col]) {
    const { col, dir } = sort
    const type = columns[col].type
    const mul = dir === 'asc' ? 1 : -1
    const nullOf = (cell: string): boolean =>
      type === 'string' ? isBlank(cell) : Number.isNaN(numericValue(cell, type))
    idx.sort((ia, ib) => {
      const a = rows[ia][col] ?? ''
      const b = rows[ib][col] ?? ''
      const an = nullOf(a)
      const bn = nullOf(b)
      if (an && bn) return 0
      if (an) return 1 // nulls last, regardless of dir
      if (bn) return -1
      return mul * compareCells(a, b, type)
    })
  }
  return idx
}

/** Cycle a column's sort: none → asc → desc → none. */
export function nextSort(current: SortState | null, col: number): SortState | null {
  if (!current || current.col !== col) return { col, dir: 'asc' }
  if (current.dir === 'asc') return { col, dir: 'desc' }
  return null
}

/** A per-column summary over a set of row indices (the filtered/visible set). */
export interface ColumnSummary {
  type: ColumnType
  /** Non-null values counted. */
  count: number
  /** Null / blank values in the visible set. */
  nulls: number
  /** number/timestamp. */
  min?: number
  max?: number
  mean?: number
  /** text. */
  distinct?: number
  top?: string
  topCount?: number
}

/** Summarise one column over `indices` (recomputed on every sort/filter). */
export function summariseColumn(
  rows: readonly string[][],
  col: number,
  type: ColumnType,
  indices: readonly number[]
): ColumnSummary {
  let nulls = 0
  if (type === 'number' || type === 'timestamp') {
    let count = 0
    let min = Infinity
    let max = -Infinity
    let sum = 0
    for (const i of indices) {
      const v = numericValue(rows[i][col] ?? '', type)
      if (Number.isNaN(v)) {
        nulls++
        continue
      }
      count++
      if (v < min) min = v
      if (v > max) max = v
      sum += v
    }
    return count === 0
      ? { type, count: 0, nulls }
      : { type, count, nulls, min, max, mean: sum / count }
  }
  // text: distinct + the most frequent value
  const freq = new Map<string, number>()
  let count = 0
  for (const i of indices) {
    const v = (rows[i][col] ?? '').trim()
    if (v === '') {
      nulls++
      continue
    }
    count++
    freq.set(v, (freq.get(v) ?? 0) + 1)
  }
  let top: string | undefined
  let topCount = 0
  for (const [v, n] of freq) if (n > topCount) ((top = v), (topCount = n))
  return { type, count, nulls, distinct: freq.size, top, topCount }
}
