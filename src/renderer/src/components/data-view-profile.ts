/**
 * DATA VIEW column profiling (#276, epic #272) — per-column distributions for
 * the summary side panel (the DuckDB Column Explorer pattern).
 * =============================================================================
 *
 * Builds a type-aware profile over a set of row INDICES (the filtered/visible
 * set from {@link ./data-view-ops}): numeric/timestamp → min/max/mean/median +
 * a histogram; text → the top values by frequency. Plus the null/gap count,
 * which teaches data-quality (dropped readings are common in device logs).
 *
 * Pure + DOM-free → unit-tested. One O(n) pass for the stats + one O(n log n)
 * sort for the median; only run when the panel is open (see DataColumnPanel).
 */
import { numericValue } from './data-view-ops'
import type { ColumnType } from './data-table'

export interface NumericProfile {
  kind: 'number' | 'timestamp'
  /** Non-null values counted. */
  count: number
  /** Null / blank / non-parseable values in the visible set. */
  nulls: number
  min: number
  max: number
  mean: number
  median: number
  /** Histogram bucket counts. */
  bins: number[]
  /** Bucket edges (length = bins.length + 1). */
  binEdges: number[]
}

export interface TextProfile {
  kind: 'string'
  count: number
  nulls: number
  distinct: number
  /** The most frequent values, descending, capped. */
  top: Array<{ value: string; count: number }>
}

export type ColumnProfile = NumericProfile | TextProfile

export const DEFAULT_BINS = 16
export const DEFAULT_TOP_K = 10

/** Bucket `values` into `binCount` equal-width bins across [min, max]. */
export function histogram(
  values: readonly number[],
  min: number,
  max: number,
  binCount: number = DEFAULT_BINS
): { bins: number[]; binEdges: number[] } {
  const n = Math.max(1, Math.floor(binCount))
  const bins = new Array(n).fill(0)
  const binEdges = new Array(n + 1)
  const span = max - min
  for (let i = 0; i <= n; i++) binEdges[i] = span === 0 ? min : min + (span * i) / n
  if (span === 0) {
    bins[0] = values.length
    return { bins, binEdges }
  }
  for (const v of values) {
    let b = Math.floor(((v - min) / span) * n)
    if (b < 0) b = 0
    if (b >= n) b = n - 1 // the max value lands in the last bin
    bins[b]++
  }
  return { bins, binEdges }
}

/** Median of an already-collected value list (sorts a copy). */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** Null / gap percentage (0–100) of a profile — dropped-reading quality signal. */
export function gapPercent(p: ColumnProfile): number {
  const total = p.count + p.nulls
  return total === 0 ? 0 : (p.nulls / total) * 100
}

/**
 * Profile one column over `indices`. Numeric/timestamp → stats + histogram;
 * text → top values. Recomputed whenever the filtered view changes.
 */
export function profileColumn(
  rows: readonly string[][],
  col: number,
  type: ColumnType,
  indices: readonly number[],
  binCount: number = DEFAULT_BINS,
  topK: number = DEFAULT_TOP_K
): ColumnProfile {
  if (type === 'number' || type === 'timestamp') {
    const vals: number[] = []
    let nulls = 0
    for (const i of indices) {
      const v = numericValue(rows[i][col] ?? '', type)
      if (Number.isNaN(v)) nulls++
      else vals.push(v)
    }
    if (vals.length === 0) {
      return { kind: type, count: 0, nulls, min: 0, max: 0, mean: 0, median: 0, bins: [], binEdges: [] }
    }
    let min = Infinity
    let max = -Infinity
    let sum = 0
    for (const v of vals) {
      if (v < min) min = v
      if (v > max) max = v
      sum += v
    }
    const { bins, binEdges } = histogram(vals, min, max, binCount)
    return {
      kind: type,
      count: vals.length,
      nulls,
      min,
      max,
      mean: sum / vals.length,
      median: median(vals),
      bins,
      binEdges
    }
  }

  const freq = new Map<string, number>()
  let nulls = 0
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
  const top = [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, topK)
    .map(([value, c]) => ({ value, count: c }))
  return { kind: 'string', count, nulls, distinct: freq.size, top }
}
