import { describe, it, expect } from 'vitest'
import {
  API_EQUIVALENTS,
  API_EQUIVALENTS_BY_ID,
  apiFor,
  crossDialectHint,
  dialectSource,
  dialectTag,
  effectiveDialect,
  foreignApi,
  foreignApiArticle,
  inScope,
  otherDialect,
  type DialectPreference
} from '../src/shared/dialect-api'
import type { Dialect } from '../src/shared/dialect'

const DIALECTS: Dialect[] = ['micropython', 'circuitpython', 'unknown']

/**
 * The dialect API table (#763, epic #209) is the single answer to "which API for
 * which runtime". These tests pin the PROPERTIES that make it safe to build the
 * help tree and the completions on top of it — above all that `unknown` never
 * collapses into MicroPython (the flaw #770 reported), and that a symbol is
 * never simultaneously right and wrong.
 */
describe('inScope — what each dialect is shown', () => {
  it('hides the other runtime only when the dialect is established', () => {
    expect(inScope('micropython', 'micropython')).toBe(true)
    expect(inScope('micropython', 'circuitpython')).toBe(false)
    expect(inScope('circuitpython', 'micropython')).toBe(false)
  })

  it('shows an unestablished dialect everything, rather than defaulting to MicroPython', () => {
    // The #770 failure mode: `unknown` silently meaning "MicroPython". If this
    // ever flips to false for 'circuitpython', a CircuitPython user with a probe
    // that didn't answer is back to being taught `machine.Pin`.
    expect(inScope('micropython', 'unknown')).toBe(true)
    expect(inScope('circuitpython', 'unknown')).toBe(true)
  })

  it('treats plain Python (both / undeclared) as always in scope', () => {
    for (const d of DIALECTS) {
      expect(inScope('both', d)).toBe(true)
      expect(inScope(undefined, d)).toBe(true)
    }
  })
})

describe('dialectTag — labelling only where the reader cannot infer it', () => {
  it('labels dialect-specific items only when the runtime is unknown', () => {
    expect(dialectTag('micropython', 'unknown')).toBe('MicroPython')
    expect(dialectTag('circuitpython', 'unknown')).toBe('CircuitPython')
    // On an established runtime the label would be on every row — pure noise.
    expect(dialectTag('micropython', 'micropython')).toBe('')
    expect(dialectTag('circuitpython', 'circuitpython')).toBe('')
  })

  it('never labels plain Python', () => {
    for (const d of DIALECTS) expect(dialectTag('both', d)).toBe('')
  })
})

describe('effectiveDialect — the manual override', () => {
  it('follows the board when set to auto', () => {
    expect(effectiveDialect('auto', 'circuitpython')).toBe('circuitpython')
    expect(effectiveDialect('auto', 'micropython')).toBe('micropython')
  })

  it('resolves to unknown with no board, not to MicroPython', () => {
    expect(effectiveDialect('auto', undefined)).toBe('unknown')
    expect(effectiveDialect('auto', 'unknown')).toBe('unknown')
  })

  it('an explicit preference wins over whatever is plugged in', () => {
    const prefs: DialectPreference[] = ['micropython', 'circuitpython']
    for (const pref of prefs) {
      for (const board of [...DIALECTS, undefined]) {
        expect(effectiveDialect(pref, board)).toBe(pref)
      }
    }
  })

  it('reports where the answer came from', () => {
    expect(dialectSource('auto', 'circuitpython')).toBe('board')
    expect(dialectSource('auto', 'unknown')).toBe('none')
    expect(dialectSource('auto', undefined)).toBe('none')
    expect(dialectSource('micropython', 'circuitpython')).toBe('manual')
  })
})

describe('the equivalence table', () => {
  it('has a unique id per row and both halves filled in', () => {
    const ids = API_EQUIVALENTS.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const row of API_EQUIVALENTS) {
      expect(API_EQUIVALENTS_BY_ID[row.id]).toBe(row)
      for (const d of ['micropython', 'circuitpython'] as const) {
        const api = apiFor(row, d)!
        expect(api, `${row.id}.${d}`).toBeTruthy()
        expect(api.snippet.length, `${row.id}.${d} snippet`).toBeGreaterThan(0)
        expect(api.article.length, `${row.id}.${d} article`).toBeGreaterThan(0)
      }
    }
  })

  it('has no half for an unestablished runtime', () => {
    for (const row of API_EQUIVALENTS) expect(apiFor(row, 'unknown')).toBeNull()
  })

  it('never lists the same symbol on both sides of a row', () => {
    // A symbol claimed by both runtimes could be reported as foreign AND native,
    // which would make `foreignApi` order-dependent.
    for (const row of API_EQUIVALENTS) {
      const mp = new Set(row.micropython.symbols)
      for (const s of row.circuitpython.symbols) {
        expect(mp.has(s), `${row.id}: ${s} claimed by both`).toBe(false)
      }
    }
  })

  it("each side's snippet actually uses that side's modules", () => {
    for (const row of API_EQUIVALENTS) {
      for (const d of ['micropython', 'circuitpython'] as const) {
        const api = apiFor(row, d)!
        for (const mod of api.modules) {
          expect(api.snippet, `${row.id}.${d} snippet mentions ${mod}`).toContain(mod)
        }
      }
    }
  })
})

describe('foreignApi — spotting the other runtime’s vocabulary', () => {
  it('flags every symbol of the other runtime, on both runtimes', () => {
    for (const row of API_EQUIVALENTS) {
      for (const d of ['micropython', 'circuitpython'] as const) {
        const other = otherDialect(d)!
        for (const sym of apiFor(row, other)!.symbols) {
          // The symbol may legitimately belong to this runtime via another row,
          // in which case it is correctly NOT foreign; otherwise it must resolve.
          const claimedHere = API_EQUIVALENTS.some((r) => apiFor(r, d)!.symbols.includes(sym))
          if (claimedHere) continue
          expect(foreignApi(sym, d), `${sym} on ${d}`).toBeTruthy()
        }
      }
    }
  })

  it('never flags a symbol on the runtime that owns it', () => {
    for (const row of API_EQUIVALENTS) {
      for (const d of ['micropython', 'circuitpython'] as const) {
        for (const sym of apiFor(row, d)!.symbols) {
          expect(foreignApi(sym, d), `${sym} on its own runtime`).toBeNull()
        }
      }
    }
  })

  it('says nothing when the runtime is not established', () => {
    // Nothing is "wrong" until we know what the board is — this is the same
    // discipline as the greeting, which prints no runtime rather than a guess.
    expect(foreignApi('machine', 'unknown')).toBeNull()
    expect(foreignApi('digitalio', 'unknown')).toBeNull()
    expect(crossDialectHint('machine', 'unknown')).toBeNull()
  })

  it('ignores blanks and words it has never heard of', () => {
    for (const d of DIALECTS) {
      expect(foreignApi('', d)).toBeNull()
      expect(foreignApi(null, d)).toBeNull()
      expect(foreignApi('wibble', d)).toBeNull()
    }
  })

  it('matches case-insensitively, the way a right-click gives us the word', () => {
    expect(foreignApi('MACHINE', 'circuitpython')?.id).toBe('digital-out')
    expect(foreignApi('DigitalInOut', 'micropython')).toBeTruthy()
  })

  it('a module that exists on both is never foreign', () => {
    // `time` is in both halves of the delay row; only its MEMBERS differ.
    expect(foreignApi('time', 'circuitpython')).toBeNull()
    expect(foreignApi('time', 'micropython')).toBeNull()
  })
})

describe('crossDialectHint — the sentence a beginner needs', () => {
  it('names the wrong runtime, the right runtime and the replacement', () => {
    const hint = crossDialectHint('machine', 'circuitpython')!
    expect(hint).toContain('MicroPython')
    expect(hint).toContain('CircuitPython')
    expect(hint).toContain('digitalio')
  })

  it('works in the other direction too', () => {
    const hint = crossDialectHint('digitalio', 'micropython')!
    expect(hint).toContain('machine')
  })

  it('sends a foreign symbol to the page that teaches the same thing here', () => {
    // The whole point: `from machine import Pin` pasted into a CircuitPython
    // project resolves to the digitalio page, not to a dead end.
    expect(foreignApiArticle('machine', 'circuitpython')).toBe('cp-digitalio')
    expect(foreignApiArticle('sleep_ms', 'circuitpython')).toBe('cp-timing')
    expect(foreignApiArticle('try_lock', 'micropython')).toBe('ref-i2c')
    expect(foreignApiArticle('duty_cycle', 'micropython')).toBe('ref-pwm')
  })
})
