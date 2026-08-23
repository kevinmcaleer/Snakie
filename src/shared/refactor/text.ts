/**
 * Text-edit primitives for the refactoring engine (epic #634, phase R0).
 *
 * Every refactoring is expressed as a list of ranged {@link TextEdit}s computed
 * from AST node offsets — we never unparse the tree. That is the single most
 * important correctness rule in the epic (§2.2): the user's comments, blank
 * lines and formatting must survive byte-identical outside the edited range,
 * and a range-based rewrite gets that for free.
 *
 * The other half of "don't mangle my file" is matching what is already there:
 * {@link detectIndentUnit} and {@link detectEol} read the file's own
 * conventions so a rule never imposes 4 spaces on a 2-space file (§2.6.5).
 */
import type { NodeBase } from './ast'

/** A replacement of `[start, end)` with `newText`. Offsets are into the source. */
export interface TextEdit {
  start: number
  end: number
  newText: string
}

/** A 1-based line/column position, matching Monaco's coordinate system. */
export interface Position {
  line: number
  column: number
}

/** A 1-based line/column range. */
export interface LineRange {
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
}

/**
 * Apply edits to `src`. Edits must not overlap; they are applied right-to-left
 * so earlier offsets stay valid. Returns null if any pair overlaps, so a buggy
 * rule fails loudly in tests rather than silently corrupting a file.
 */
export function applyEdits(src: string, edits: readonly TextEdit[]): string | null {
  if (edits.length === 0) return src
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end)
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start < sorted[i - 1].end) return null
  }
  for (const e of sorted) {
    if (e.start < 0 || e.end > src.length || e.start > e.end) return null
  }
  let out = src
  for (let i = sorted.length - 1; i >= 0; i--) {
    const e = sorted[i]
    out = out.slice(0, e.start) + e.newText + out.slice(e.end)
  }
  return out
}

/** The line ending the file already uses. Defaults to `\n` for a single line. */
export function detectEol(src: string): string {
  const firstLf = src.indexOf('\n')
  if (firstLf > 0 && src[firstLf - 1] === '\r') return '\r\n'
  return '\n'
}

/**
 * The file's own indent unit: a tab, or the smallest positive space step
 * between a line and the line that introduced it. Falls back to four spaces.
 */
export function detectIndentUnit(src: string): string {
  const lines = src.split(/\r?\n/)
  let best = 0
  let prev = 0
  for (const line of lines) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    const ws = /^[ \t]*/.exec(line)![0]
    if (ws.includes('\t')) return '\t'
    const width = ws.length
    if (width > prev) {
      const step = width - prev
      if (best === 0 || step < best) best = step
    }
    prev = width
  }
  return ' '.repeat(best > 0 ? best : 4)
}

/** Offset of the first character of the line containing `offset`. */
export function lineStart(src: string, offset: number): number {
  const nl = src.lastIndexOf('\n', Math.max(0, offset - 1))
  return nl < 0 ? 0 : nl + 1
}

/**
 * Offset just past the newline ending the line containing `offset` (i.e. the
 * start of the next line), or the end of the source.
 */
export function lineEnd(src: string, offset: number): number {
  const nl = src.indexOf('\n', offset)
  return nl < 0 ? src.length : nl + 1
}

/** The leading whitespace of the line containing `offset`. */
export function indentAt(src: string, offset: number): string {
  const start = lineStart(src, offset)
  return /^[ \t]*/.exec(src.slice(start))![0]
}

/**
 * The range of whole lines spanned by `node`, from the start of its first line
 * to the start of the line after its last. Use this to move or delete a whole
 * statement — it takes the indentation and the trailing newline with it.
 */
export function fullLineRange(src: string, node: NodeBase): { start: number; end: number } {
  return { start: lineStart(src, node.start), end: lineEnd(src, node.end) }
}

/**
 * Remove one level of indentation (`unit`) from every line of `text`. Lines
 * shallower than one unit lose whatever leading whitespace they have; blank
 * lines are left alone so a dedent never introduces trailing spaces.
 */
export function dedent(text: string, unit: string): string {
  return text
    .split('\n')
    .map((line) => {
      if (!line.trim()) return line
      if (line.startsWith(unit)) return line.slice(unit.length)
      const ws = /^[ \t]*/.exec(line)![0]
      return line.slice(ws.length)
    })
    .join('\n')
}

/** Add one level of indentation to every non-blank line of `text`. */
export function indent(text: string, unit: string): string {
  return text
    .split('\n')
    .map((line) => (line.trim() ? unit + line : line))
    .join('\n')
}

/**
 * Re-indent a block of source that currently sits at `from` to sit at `to`,
 * preserving the relative shape of nested lines. Blank lines stay blank.
 */
export function reindent(text: string, from: string, to: string): string {
  return text
    .split('\n')
    .map((line) => {
      if (!line.trim()) return line
      return line.startsWith(from) ? to + line.slice(from.length) : to + line.trimStart()
    })
    .join('\n')
}

/** Fast offset ↔ line/column mapping for one source string. */
export class LineIndex {
  /** Offset of the start of each line, 0-based index = line - 1. */
  private readonly starts: number[] = [0]

  constructor(private readonly src: string) {
    for (let i = 0; i < src.length; i++) {
      if (src[i] === '\n') this.starts.push(i + 1)
    }
  }

  /** 1-based line/column for an offset. */
  positionAt(offset: number): Position {
    const o = Math.max(0, Math.min(offset, this.src.length))
    let lo = 0
    let hi = this.starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.starts[mid] <= o) lo = mid
      else hi = mid - 1
    }
    return { line: lo + 1, column: o - this.starts[lo] + 1 }
  }

  /** Offset for a 1-based line/column. */
  offsetAt(pos: Position): number {
    const line = Math.max(1, Math.min(pos.line, this.starts.length))
    const base = this.starts[line - 1]
    const next = line < this.starts.length ? this.starts[line] : this.src.length + 1
    return Math.min(base + Math.max(0, pos.column - 1), next - 1)
  }

  /** A node's offsets as a 1-based line/column range. */
  rangeOf(node: { start: number; end: number }): LineRange {
    const s = this.positionAt(node.start)
    const e = this.positionAt(node.end)
    return { startLine: s.line, startColumn: s.column, endLine: e.line, endColumn: e.column }
  }

  /** Total number of lines. */
  get lineCount(): number {
    return this.starts.length
  }
}

/**
 * Is `expr` simple enough to duplicate without changing behaviour or cost?
 * Used by rules that would otherwise evaluate the same source text twice
 * (De Morgan, `x in (…)`, guard inversion). A call or subscript might have side
 * effects or cost real time on a microcontroller, so those are never duplicated.
 */
export function isTriviallyRepeatable(src: string, node: NodeBase): boolean {
  const text = src.slice(node.start, node.end)
  return text.length <= 40 && !/[()[\]]/.test(text)
}

/** Wrap `text` in parentheses unless it is already a single atom. */
export function parenthesizeIfNeeded(text: string, needed: boolean): string {
  if (!needed) return text
  return `(${text})`
}
