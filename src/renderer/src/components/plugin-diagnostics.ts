/**
 * Pure helpers turning Snakie plugin diagnostics (from the Python host's `lint`
 * RPC) into Monaco editor decorations:
 *
 *  - {@link diagnosticToMarker} maps a 1-based {@link Diagnostic} to a Monaco
 *    `IMarkerData` (squiggle), defaulting an absent end to the end of the word /
 *    line so the squiggle has a visible span.
 *  - {@link resolveFixRange} resolves a fix's (possibly absent) range against
 *    the diagnostic it belongs to — an absent range means "the diagnostic's own
 *    range" (used by the code-action provider to build a WorkspaceEdit).
 *
 * These are deliberately free of any Monaco *instance* state so they unit-test
 * with a small stub (see test/diagnosticToMarker.test.ts).
 */
import type { Diagnostic, DiagnosticFix } from '../../../preload/index.d'

/** Monaco's `MarkerSeverity` enum values (kept here so this module stays pure). */
export const MarkerSeverity = {
  Hint: 1,
  Info: 2,
  Warning: 4,
  Error: 8
} as const

export type MarkerSeverityValue = (typeof MarkerSeverity)[keyof typeof MarkerSeverity]

/** A minimal Monaco model surface this module needs to default end positions. */
export interface ModelLike {
  getLineMaxColumn(lineNumber: number): number
  getLineCount(): number
  getWordAtPosition(position: { lineNumber: number; column: number }): { endColumn: number } | null
}

/** A Monaco `IMarkerData`-compatible shape (subset we set). */
export interface MarkerData {
  severity: MarkerSeverityValue
  message: string
  source: string
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}

/** A resolved, fully-specified 1-based range. */
export interface ResolvedRange {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}

/** Map a diagnostic severity string to a Monaco `MarkerSeverity` value. */
export function severityToMarker(severity: string): MarkerSeverityValue {
  switch (severity) {
    case 'error':
      return MarkerSeverity.Error
    case 'info':
      return MarkerSeverity.Info
    case 'hint':
      return MarkerSeverity.Hint
    case 'warning':
    default:
      return MarkerSeverity.Warning
  }
}

/** Clamp a 1-based line number into the model's range. */
function clampLine(model: ModelLike, line: number): number {
  const max = Math.max(1, model.getLineCount())
  return Math.min(Math.max(1, Math.floor(line)), max)
}

/**
 * Resolve a diagnostic's full 1-based start/end range against the model,
 * defaulting an absent column to 1 and an absent end to the end of the
 * word-at-start (if any) or the end of the line.
 */
export function diagnosticRange(model: ModelLike, diag: Diagnostic): ResolvedRange {
  const startLine = clampLine(model, diag.line)
  const startColumn = diag.column != null ? Math.max(1, Math.floor(diag.column)) : 1
  const endLine = diag.endLine != null ? clampLine(model, diag.endLine) : startLine

  let endColumn: number
  if (diag.endColumn != null) {
    endColumn = Math.max(startColumn + (endLine === startLine ? 0 : -startColumn + 1), Math.floor(diag.endColumn))
  } else {
    const word = model.getWordAtPosition({ lineNumber: startLine, column: startColumn })
    endColumn = word && word.endColumn > startColumn ? word.endColumn : model.getLineMaxColumn(endLine)
    // Guarantee a non-empty span on the start line so the squiggle is visible.
    if (endLine === startLine && endColumn <= startColumn) {
      endColumn = Math.max(startColumn + 1, model.getLineMaxColumn(startLine))
    }
  }

  return { startLineNumber: startLine, startColumn, endLineNumber: endLine, endColumn }
}

/** Map a diagnostic to a Monaco `IMarkerData` (squiggle). */
export function diagnosticToMarker(model: ModelLike, diag: Diagnostic): MarkerData {
  const range = diagnosticRange(model, diag)
  return {
    severity: severityToMarker(diag.severity),
    message: diag.message,
    source: diag.source,
    startLineNumber: range.startLineNumber,
    startColumn: range.startColumn,
    endLineNumber: range.endLineNumber,
    endColumn: range.endColumn
  }
}

/**
 * Resolve a fix's edit range. An absent range on the fix means "replace the
 * diagnostic's own range" — so we fall back to {@link diagnosticRange}. A
 * partially-specified range fills missing parts from the diagnostic range.
 */
export function resolveFixRange(model: ModelLike, diag: Diagnostic, fix: DiagnosticFix): ResolvedRange {
  const base = diagnosticRange(model, diag)
  const e = fix.edit
  const hasAny =
    e.line != null || e.column != null || e.endLine != null || e.endColumn != null
  if (!hasAny) return base
  const startLineNumber = e.line != null ? clampLine(model, e.line) : base.startLineNumber
  const startColumn = e.column != null ? Math.max(1, Math.floor(e.column)) : base.startColumn
  const endLineNumber = e.endLine != null ? clampLine(model, e.endLine) : startLineNumber
  const endColumn =
    e.endColumn != null ? Math.max(1, Math.floor(e.endColumn)) : model.getLineMaxColumn(endLineNumber)
  return { startLineNumber, startColumn, endLineNumber, endColumn }
}
