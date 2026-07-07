/**
 * DATA TABLE ingest (#274, epic #272 Data View) — parse a logged CSV/TXT file
 * into a typed, in-memory table, robust against the mess real device logs carry.
 * =============================================================================
 *
 * Device logs are written by a microcontroller that can be unplugged mid-write,
 * drop readings, or emit ragged rows — so parsing NEVER throws: bad rows are
 * normalised and counted, never fatal. The result is a flat, column-typed model
 * that the virtualised table renders and (later #272 steps) sorts/filters/graphs.
 *
 * Deliberately NOT single-file-hardcoded: {@link DataTable} is a plain value, so
 * a future multi-file compare (epic #272 "Deferred") can hold several.
 *
 * Pure + DOM-free (parsing only) so it unit-tests in node. `Date.parse` is used
 * for timestamp sniffing — it takes a string, so it's deterministic here.
 */

/** A column's inferred (or user-overridden) value type. */
export type ColumnType = 'number' | 'timestamp' | 'string'

/** The delimiter kinds we auto-detect. `ws` = run-of-whitespace. */
export type Delimiter = ',' | '\t' | ';' | 'ws'

export interface Column {
  name: string
  type: ColumnType
  /** 0-based position. */
  index: number
}

export interface DataTable {
  columns: Column[]
  /** Row-major cell strings, each row normalised to `columns.length` cells. */
  rows: string[][]
  delimiter: Delimiter
  hasHeader: boolean
  rowCount: number
  /** How many rows were ragged (padded/truncated) — a data-quality signal. */
  raggedRows: number
}

export interface ParseOptions {
  /** Force a delimiter instead of auto-detecting. */
  delimiter?: Delimiter
  /** Force whether the first row is a header. */
  hasHeader?: boolean
  /** Per-column type overrides (by column index). */
  columnTypes?: Record<number, ColumnType>
}

const DELIMS: Exclude<Delimiter, 'ws'>[] = [',', '\t', ';']
/** A number cell: optional sign, digits, optional fraction, optional exponent. */
const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/
/** Common timestamp shapes: ISO date(-time), `YYYY/MM/DD`, or `HH:MM(:SS)`. */
const TIMESTAMP_RE =
  /^(\d{4}[-/]\d{2}[-/]\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?|\d{1,2}:\d{2}(:\d{2})?)$/

/** Split a file into non-empty physical lines (any newline style). */
export function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/).filter((l) => l.trim().length > 0)
}

/**
 * Quote-aware split of one line on a single-char delimiter (RFC-4180-ish: a
 * `"…"` cell may contain the delimiter, and `""` is an escaped quote). For the
 * `ws` delimiter we split on runs of whitespace instead.
 */
export function splitLine(line: string, delim: Delimiter): string[] {
  if (delim === 'ws') return line.trim().split(/\s+/)
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else inQuotes = false
      } else cur += c
    } else if (c === '"') {
      inQuotes = true
    } else if (c === delim) {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

/**
 * Auto-detect the delimiter: for each candidate, measure how CONSISTENTLY it
 * splits the sampled lines (same count per line = a real delimiter). The most
 * consistent candidate with ≥2 columns wins; fall back to whitespace.
 */
export function detectDelimiter(lines: string[]): Delimiter {
  const sample = lines.slice(0, 50)
  if (sample.length === 0) return ','
  let best: Delimiter = 'ws'
  let bestScore = -1
  for (const d of [...DELIMS, 'ws' as const]) {
    const counts = sample.map((l) => splitLine(l, d).length)
    const cols = counts[0]
    if (cols < 2) continue
    const consistent = counts.filter((c) => c === cols).length / counts.length
    // Prefer more columns as a tie-breaker (a real table beats accidental splits).
    const score = consistent + Math.min(cols, 20) / 1000
    if (score > bestScore) {
      bestScore = score
      best = d
    }
  }
  return best
}

/**
 * Header heuristic: the first row is a header when its cells are all non-empty,
 * all distinct, and — crucially — at least one column is NUMERIC in the data
 * rows but the header cell there is NOT (labels like `time,temp` over numbers).
 * With no numeric columns we fall back to "first row is all non-numeric text".
 */
export function detectHeader(rows: string[][]): boolean {
  if (rows.length === 0) return false
  const first = rows[0]
  if (first.some((c) => c.trim() === '')) return false
  if (new Set(first).size !== first.length) return false
  const body = rows.slice(1, 51)
  if (body.length === 0) return first.every((c) => !isNumeric(c))
  let numericColSawHeaderText = false
  for (let col = 0; col < first.length; col++) {
    const colVals = body.map((r) => r[col] ?? '').filter((v) => v !== '')
    if (colVals.length === 0) continue
    const numericShare = colVals.filter(isNumeric).length / colVals.length
    if (numericShare >= 0.8 && !isNumeric(first[col])) numericColSawHeaderText = true
  }
  if (numericColSawHeaderText) return true
  // No numeric column to contrast — treat an all-text first row as a header.
  return first.every((c) => !isNumeric(c))
}

export function isNumeric(v: string): boolean {
  return v !== '' && NUMBER_RE.test(v.trim())
}

export function isTimestamp(v: string): boolean {
  const t = v.trim()
  if (!TIMESTAMP_RE.test(t)) return false
  // A bare `HH:MM` has no date for Date.parse; accept it on the regex alone.
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(t)) return true
  return !Number.isNaN(Date.parse(t))
}

/**
 * Infer a column's type from its (non-blank) values: `number` when ≥80% are
 * numeric, else `timestamp` when ≥80% are timestamps, else `string`. Blank
 * cells are ignored (they're nulls, common in device logs).
 */
export function inferColumnType(values: string[]): ColumnType {
  const nonBlank = values.filter((v) => v.trim() !== '')
  if (nonBlank.length === 0) return 'string'
  const nums = nonBlank.filter(isNumeric).length
  if (nums / nonBlank.length >= 0.8) return 'number'
  const stamps = nonBlank.filter(isTimestamp).length
  if (stamps / nonBlank.length >= 0.8) return 'timestamp'
  return 'string'
}

/**
 * Parse a whole file into a {@link DataTable}. Never throws: ragged rows are
 * padded (short) or truncated (long) to the column count and tallied; blank
 * lines are dropped; a torn final row is kept, padded.
 */
export function parseTable(text: string, opts: ParseOptions = {}): DataTable {
  const lines = splitLines(text)
  if (lines.length === 0) {
    return { columns: [], rows: [], delimiter: ',', hasHeader: false, rowCount: 0, raggedRows: 0 }
  }
  const delimiter = opts.delimiter ?? detectDelimiter(lines)
  const cells = lines.map((l) => splitLine(l, delimiter))
  const hasHeader = opts.hasHeader ?? detectHeader(cells)

  // Column count = the modal row width (robust to a ragged header/final row).
  const width = modalWidth(cells)
  const headerCells = hasHeader ? cells[0] : null
  const bodyCells = hasHeader ? cells.slice(1) : cells

  // Normalise every body row to `width` cells; count the ones we had to fix.
  let raggedRows = 0
  const rows = bodyCells.map((r) => {
    if (r.length !== width) raggedRows++
    if (r.length < width) return [...r, ...Array(width - r.length).fill('')]
    if (r.length > width) return r.slice(0, width)
    return r
  })

  const columns: Column[] = []
  for (let i = 0; i < width; i++) {
    const name = headerCells?.[i]?.trim() || `col ${i + 1}`
    const type = opts.columnTypes?.[i] ?? inferColumnType(rows.map((r) => r[i] ?? ''))
    columns.push({ name, type, index: i })
  }

  return { columns, rows, delimiter, hasHeader, rowCount: rows.length, raggedRows }
}

/** The most common row width across a sample — the table's true column count. */
function modalWidth(cells: string[][]): number {
  const freq = new Map<number, number>()
  for (const r of cells.slice(0, 200)) freq.set(r.length, (freq.get(r.length) ?? 0) + 1)
  let width = 0
  let best = -1
  for (const [w, n] of freq) {
    if (n > best || (n === best && w > width)) {
      best = n
      width = w
    }
  }
  return Math.max(width, 1)
}

/** A human label for a delimiter (for the UI / status). */
export function delimiterLabel(d: Delimiter): string {
  return d === ',' ? 'comma' : d === '\t' ? 'tab' : d === ';' ? 'semicolon' : 'whitespace'
}
