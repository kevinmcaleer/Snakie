/**
 * The diff behind the refactoring preview modal (epic #634 §2.4, #799).
 *
 * "Every offered refactoring shows a diff preview before it touches the file"
 * is an acceptance criterion, so the hunk-building is worth testing directly
 * rather than only through the UI.
 */
import { describe, expect, it } from 'vitest'
import { diffLines, diffStats } from '../src/shared/refactor/diff'
import { runRuleToFixpoint } from '../src/shared/refactor/engine'
import { guardClauseRule } from '../src/shared/refactor/rules/guard-clause'

describe('preview diff (#634 §2.4)', () => {
  it('reports no hunks when nothing changed', () => {
    expect(diffLines('a\nb\nc\n', 'a\nb\nc\n')).toEqual([])
  })

  it('marks a replaced line as one remove plus one add', () => {
    const hunks = diffLines('a\nb\nc\n', 'a\nB\nc\n')
    expect(hunks).toHaveLength(1)
    const kinds = hunks[0].lines.map((l) => `${l.kind}:${l.text}`)
    expect(kinds).toContain('remove:b')
    expect(kinds).toContain('add:B')
    expect(diffStats(hunks)).toEqual({ added: 1, removed: 1 })
  })

  it('numbers lines against the correct side', () => {
    const hunks = diffLines('a\nb\n', 'a\nx\nb\n')
    const added = hunks[0].lines.find((l) => l.kind === 'add')!
    expect(added.afterLine).toBe(2)
    expect(added.beforeLine).toBeUndefined()
    const context = hunks[0].lines.filter((l) => l.kind === 'context')
    expect(context[0]).toMatchObject({ beforeLine: 1, afterLine: 1 })
  })

  it('splits distant changes into separate hunks but keeps nearby ones together', () => {
    const before = Array.from({ length: 40 }, (_, i) => `line${i}`).join('\n')
    const after = before.replace('line2', 'CHANGED2').replace('line30', 'CHANGED30')
    expect(diffLines(after === before ? '' : before, after, 3)).toHaveLength(2)

    const near = before.replace('line10', 'A10').replace('line11', 'A11')
    expect(diffLines(before, near, 3)).toHaveLength(1)
  })

  it('keeps the requested amount of surrounding context', () => {
    const before = Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n')
    const after = before.replace('l10', 'X10')
    const hunk = diffLines(before, after, 2)[0]
    // 2 context lines each side, plus the removed and the added line.
    expect(hunk.lines.filter((l) => l.kind === 'context')).toHaveLength(4)
  })

  it('handles a pure insertion and a pure deletion', () => {
    expect(diffStats(diffLines('a\nc\n', 'a\nb\nc\n'))).toEqual({ added: 1, removed: 0 })
    expect(diffStats(diffLines('a\nb\nc\n', 'a\nc\n'))).toEqual({ added: 0, removed: 1 })
  })

  it('describes a real guard-clause rewrite the way the modal will show it', () => {
    const before = 'def read(bus):\n    if bus is not None:\n        raw = bus.read()\n        return raw\n'
    const after = runRuleToFixpoint(guardClauseRule, before)
    const hunks = diffLines(before, after)
    expect(hunks.length).toBeGreaterThan(0)
    const addedText = hunks
      .flatMap((h) => h.lines)
      .filter((l) => l.kind === 'add')
      .map((l) => l.text.trim())
    expect(addedText).toContain('if bus is None:')
    expect(addedText).toContain('return')
  })
})
