import { describe, expect, it } from 'vitest'
import {
  MarkerSeverity,
  diagnosticRange,
  diagnosticToMarker,
  resolveFixRange,
  severityToMarker,
  type ModelLike
} from '../src/renderer/src/components/plugin-diagnostics'
import type { Diagnostic } from '../src/main/plugins/types'

/**
 * Unit tests for the pure diagnostic -> Monaco-marker mapping used by the
 * reactive linter. A tiny model stub stands in for Monaco's ITextModel so the
 * coordinate/defaulting logic is testable without the editor.
 */
function model(lines: string[]): ModelLike {
  return {
    getLineCount: () => lines.length,
    getLineMaxColumn: (n) => (lines[n - 1]?.length ?? 0) + 1,
    getWordAtPosition: ({ lineNumber, column }) => {
      const text = lines[lineNumber - 1] ?? ''
      const re = /[A-Za-z0-9_]+/g
      let m: RegExpExecArray | null
      while ((m = re.exec(text))) {
        const start = m.index + 1
        const end = start + m[0].length
        if (column >= start && column <= end) return { endColumn: end }
      }
      return null
    }
  }
}

const diag = (over: Partial<Diagnostic>): Diagnostic => ({
  line: 1,
  severity: 'warning',
  message: 'm',
  source: 's',
  ...over
})

describe('severityToMarker', () => {
  it('maps each severity, defaulting unknown to Warning', () => {
    expect(severityToMarker('error')).toBe(MarkerSeverity.Error)
    expect(severityToMarker('warning')).toBe(MarkerSeverity.Warning)
    expect(severityToMarker('info')).toBe(MarkerSeverity.Info)
    expect(severityToMarker('hint')).toBe(MarkerSeverity.Hint)
    expect(severityToMarker('bogus')).toBe(MarkerSeverity.Warning)
  })
})

describe('diagnosticRange', () => {
  it('uses an explicit full range as-is', () => {
    const r = diagnosticRange(model(['hello world']), diag({ line: 1, column: 7, endColumn: 12 }))
    expect(r).toEqual({ startLineNumber: 1, startColumn: 7, endLineNumber: 1, endColumn: 12 })
  })

  it('defaults absent end to the end of the word at the start position', () => {
    const r = diagnosticRange(model(['foo = bar']), diag({ line: 1, column: 1 }))
    // word "foo" is columns 1..3, endColumn is exclusive (4)
    expect(r.startColumn).toBe(1)
    expect(r.endColumn).toBe(4)
  })

  it('falls back to end of line when there is no word at the position', () => {
    const r = diagnosticRange(model(['x = 1   ']), diag({ line: 1, column: 6 }))
    // trailing whitespace -> no word, extend to line end (len 8 + 1)
    expect(r.endColumn).toBe(9)
  })

  it('clamps an out-of-range line to the model', () => {
    const r = diagnosticRange(model(['only one line']), diag({ line: 99, column: 1 }))
    expect(r.startLineNumber).toBe(1)
  })
})

describe('diagnosticToMarker', () => {
  it('produces a Monaco IMarkerData with mapped severity + span', () => {
    const marker = diagnosticToMarker(
      model(['x = 1   ']),
      diag({ line: 1, column: 6, endColumn: 9, severity: 'warning', message: 'Trailing whitespace' })
    )
    expect(marker).toEqual({
      severity: MarkerSeverity.Warning,
      message: 'Trailing whitespace',
      source: 's',
      startLineNumber: 1,
      startColumn: 6,
      endLineNumber: 1,
      endColumn: 9
    })
  })
})

describe('resolveFixRange', () => {
  it('uses the diagnostic range when the fix omits its range', () => {
    const d = diag({ line: 1, column: 6, endColumn: 9 })
    const r = resolveFixRange(model(['x = 1   ']), d, { title: 'fix', edit: { newText: '' } })
    expect(r).toEqual({ startLineNumber: 1, startColumn: 6, endLineNumber: 1, endColumn: 9 })
  })

  it('uses the fix range when fully specified', () => {
    const d = diag({ line: 1, column: 1 })
    const r = resolveFixRange(model(['abcdef']), d, {
      title: 'fix',
      edit: { newText: '', line: 1, column: 2, endLine: 1, endColumn: 5 }
    })
    expect(r).toEqual({ startLineNumber: 1, startColumn: 2, endLineNumber: 1, endColumn: 5 })
  })
})
