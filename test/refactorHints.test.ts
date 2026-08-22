/**
 * The whole-file hint pass and the Problems-panel merge (epic #634 R7 / #807,
 * plus the §5 unification).
 *
 * The behaviour worth pinning down here is policy, not plumbing: which hints a
 * beginner sees by default, that a half-typed file stays quiet, and that two
 * producers reporting the same thing is one row, not two.
 */
import { describe, expect, it } from 'vitest'
import {
  REFACTOR_SOURCE,
  diagnosticSources,
  mergeDiagnostics,
  refactorHints
} from '../src/renderer/src/components/refactor-hints'
import { ALL_RULES } from '../src/shared/refactor/rules'
import type { Diagnostic } from '../src/main/plugins/types'

const diag = (over: Partial<Diagnostic> = {}): Diagnostic => ({
  line: 1,
  severity: 'error',
  message: 'boom',
  source: 'ruff',
  ...over
})

describe('whole-file hint pass (#634 R7)', () => {
  it('says nothing about a file that does not parse', () => {
    expect(refactorHints('def broken(:\n', { includeStyleHints: true })).toEqual([])
  })

  it('says nothing about a clean file', () => {
    const clean = 'from machine import Pin\n\nled = Pin(25, Pin.OUT)\nled.on()\n'
    expect(refactorHints(clean, { includeStyleHints: true })).toEqual([])
  })

  it('tags every hint with the refactor source, a rule id and a "Why?" article', () => {
    const src = 'def read(bus):\n    if bus is not None:\n        raw = bus.read()\n        return raw\n'
    const hints = refactorHints(src, { includeStyleHints: true })
    expect(hints.length).toBeGreaterThan(0)
    for (const h of hints) {
      expect(h.source).toBe(REFACTOR_SOURCE)
      expect(h.ruleId).toBeTruthy()
      expect(h.helpArticle).toBeTruthy()
      expect(h.line).toBeGreaterThan(0)
    }
  })

  it('holds style hints back by default, so a learner is not buried in blue', () => {
    const styleOnly = 'def read(bus):\n    if bus is not None:\n        raw = bus.read()\n        return raw\n'
    expect(refactorHints(styleOnly)).toEqual([])
    expect(refactorHints(styleOnly, { includeStyleHints: true }).length).toBeGreaterThan(0)
  })

  it('shows MicroPython hints without being asked — those are latent bugs', () => {
    // A raw tick subtraction misbehaves when the counter wraps; the user should
    // hear about that whether or not they opted into style advice.
    const src = [
      'import time',
      '',
      'start = time.ticks_ms()',
      'while True:',
      '    if time.ticks_ms() - start > 500:',
      '        break',
      ''
    ].join('\n')
    const hints = refactorHints(src)
    const micropythonRuleIds = new Set(
      ALL_RULES.filter((r) => r.category === 'micropython').map((r) => r.id)
    )
    expect(hints.some((h) => micropythonRuleIds.has(h.ruleId ?? ''))).toBe(true)
  })

  it('offers no board-gated hints when no board is connected', () => {
    const boardRules = ALL_RULES.filter((r) => r.requires)
    // Nothing in the catalogue with a capability gate may fire without caps.
    const src = 'def hot():\n    total = 0\n    for i in range(100):\n        total += i\n    return total\n'
    const gatedIds = new Set(boardRules.map((r) => r.id))
    const hints = refactorHints(src, { includeStyleHints: true })
    expect(hints.filter((h) => gatedIds.has(h.ruleId ?? ''))).toEqual([])
  })

  it('does not repeat a smell another producer already reported (§5)', () => {
    const src = 'def read(bus):\n    if bus is not None:\n        raw = bus.read()\n        return raw\n'
    const all = refactorHints(src, { includeStyleHints: true })
    expect(all.length).toBeGreaterThan(0)
    const suppressed = refactorHints(src, {
      includeStyleHints: true,
      alreadyReported: new Set(all.map((h) => h.ruleId!))
    })
    expect(suppressed).toEqual([])
  })
})

describe('Problems-panel merge (#634 §5)', () => {
  it('orders every producer together by position', () => {
    const merged = mergeDiagnostics(
      [diag({ line: 10, source: 'ruff' })],
      [diag({ line: 2, source: 'refactor', ruleId: 'a' })],
      [diag({ line: 5, source: 'yaml' })]
    )
    expect(merged.map((d) => d.line)).toEqual([2, 5, 10])
  })

  it('sorts by column within a line', () => {
    const merged = mergeDiagnostics([
      diag({ line: 3, column: 20, message: 'second' }),
      diag({ line: 3, column: 4, message: 'first' })
    ])
    expect(merged.map((d) => d.message)).toEqual(['first', 'second'])
  })

  it('collapses the same rule reported twice at the same place', () => {
    const one = diag({ line: 4, column: 1, source: 'refactor', ruleId: 'guard-clause' })
    expect(mergeDiagnostics([one], [{ ...one }])).toHaveLength(1)
  })

  it('keeps two different producers that genuinely disagree in position', () => {
    expect(
      mergeDiagnostics(
        [diag({ line: 4, source: 'ruff', message: 'unused import' })],
        [diag({ line: 4, source: 'refactor', ruleId: 'x', message: 'something else' })]
      )
    ).toHaveLength(2)
  })

  it('lists the sources present, for the filter chips', () => {
    expect(
      diagnosticSources([
        diag({ source: 'refactor' }),
        diag({ source: 'ruff' }),
        diag({ source: 'refactor' })
      ])
    ).toEqual(['refactor', 'ruff'])
  })
})
