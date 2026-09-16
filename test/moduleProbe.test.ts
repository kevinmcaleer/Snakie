import { describe, it, expect } from 'vitest'
import {
  MEMBER_MARK,
  memberProbeSnippet,
  readMemberProbe
} from '../src/renderer/src/lib/blocks/module-probe'

/**
 * ASKING THE BOARD (#1048).
 * =============================================================================
 *
 * The tier for everything with no source: a frozen module, a C module, a `.mpy`.
 * `machine` is the example — there is no `machine.py` anywhere, and never will
 * be.
 */

describe('the snippet', () => {
  const py = memberProbeSnippet(['machine', 'time'])

  it('probes each module in one round trip', () => {
    expect(py).toContain("__import__('machine')")
    expect(py).toContain("__import__('time')")
  })

  it('tells a class from a function, in that order', () => {
    // `isinstance(_, type)` FIRST: a class is callable too, and answering
    // "function" for `machine.Pin` would build the wrong kind of block.
    const cls = py.indexOf('isinstance(')
    const fn = py.indexOf('callable(')
    expect(cls).toBeGreaterThan(-1)
    expect(cls).toBeLessThan(fn)
  })

  it('drops underscored names on the BOARD, not in the renderer', () => {
    // The serial link is the slow part; filtering here keeps the line count down.
    expect(py).toContain("startswith('_')")
  })

  it('survives a module that will not import', () => {
    // It must not take the rest of the batch down with it.
    expect(py).toContain('except Exception:')
  })

  it('refuses to interpolate anything that is not a module name', () => {
    const nasty = memberProbeSnippet(["x'); import os; os.system('rm -rf /"])
    expect(nasty).not.toContain('rm -rf')
    expect(nasty).toContain("__import__('ximportosossystemrmrf')")
  })

  it('is nothing at all for nothing at all', () => {
    expect(memberProbeSnippet([])).toBe('')
    expect(memberProbeSnippet(['!!!'])).toBe('')
  })
})

describe('reading it back', () => {
  it('groups members by module, with their kinds', () => {
    const out = readMemberProbe(
      [
        `${MEMBER_MARK} machine class Pin`,
        `${MEMBER_MARK} machine class PWM`,
        `${MEMBER_MARK} machine function freq`,
        `${MEMBER_MARK} machine constant ID`,
        `${MEMBER_MARK} time function sleep`
      ].join('\n')
    )
    expect(out.machine).toEqual([
      { name: 'Pin', kind: 'class' },
      { name: 'PWM', kind: 'class' },
      { name: 'freq', kind: 'function' },
      { name: 'ID', kind: 'constant' }
    ])
    expect(out.time).toEqual([{ name: 'sleep', kind: 'function' }])
  })

  it('ignores the learner’s own prints, which share this stream', () => {
    const out = readMemberProbe(
      ['hello from my program', `${MEMBER_MARK} machine class Pin`, '42'].join('\n')
    )
    expect(out).toEqual({ machine: [{ name: 'Pin', kind: 'class' }] })
  })

  it('drops a garbled or truncated line rather than guessing', () => {
    const out = readMemberProbe(
      [
        `${MEMBER_MARK} machine class`,
        `${MEMBER_MARK} machine weirdkind Pin`,
        `${MEMBER_MARK} machine class not-an-identifier`
      ].join('\n')
    )
    expect(out).toEqual({})
  })

  it('does not list a name twice', () => {
    // A module re-exporting its own import can list one name more than once.
    const out = readMemberProbe(
      [`${MEMBER_MARK} m class Pin`, `${MEMBER_MARK} m class Pin`].join('\n')
    )
    expect(out.m).toHaveLength(1)
  })

  it('nothing in, nothing out', () => {
    expect(readMemberProbe('')).toEqual({})
  })
})
