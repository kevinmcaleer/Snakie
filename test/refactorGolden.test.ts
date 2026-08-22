/**
 * Table-driven golden-file suite for the refactoring catalogue (epic #634 §4).
 *
 * Adding a rule means adding a folder — this file never changes:
 *
 * ```
 * test/fixtures/refactor/<rule-id>/
 *   before.py        applying the rule everywhere it fires must produce…
 *   after.py         …exactly this, byte for byte
 *   before-2.py      further pairs, e.g. a tab-indented or 2-space variant
 *   after-2.py
 *   no-match/*.py    code that LOOKS like the smell but must not trigger
 * ```
 *
 * Every pair is also checked against the epic's §2.6 safety properties:
 * the result re-parses cleanly, the rule is idempotent (running it on
 * `after.py` changes nothing), and every byte outside the edited ranges is
 * unchanged.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'fs'
import { join, resolve } from 'path'
import { ALL_RULES } from '../src/shared/refactor/rules'
import { applyOffer, createContext, detectAll, runRuleToFixpoint } from '../src/shared/refactor/engine'
import { parsePython } from '../src/shared/refactor/parser'
import type { BoardCapabilities, RefactorRule } from '../src/shared/refactor/types'

const FIXTURES = resolve(__dirname, 'fixtures/refactor')

/**
 * Board capabilities used when a fixture belongs to a board-gated rule (R6b).
 * Deliberately generous — the *gating* is tested separately in
 * `refactorCapabilities.test.ts`; here we only want the rewrite to run.
 */
const FULL_CAPS: BoardCapabilities = {
  native: true,
  viper: true,
  asm: 'thumb',
  pio: true,
  machine: 'Raspberry Pi Pico with RP2040',
  version: '1.24.0',
  memFree: 180000,
  stateMachines: 8
}

/** Fixture folders that actually exist on disk, paired to their rule. */
function fixtureDirs(): { rule: RefactorRule<unknown>; dir: string }[] {
  if (!existsSync(FIXTURES)) return []
  const dirs = readdirSync(FIXTURES, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
  return dirs
    .map((name) => ({ rule: ALL_RULES.find((r) => r.id === name), dir: join(FIXTURES, name) }))
    .filter((x): x is { rule: RefactorRule<unknown>; dir: string } => x.rule != null)
}

/** `before.py`/`after.py` pairs inside one fixture folder. */
function pairsIn(dir: string): { name: string; before: string; after: string }[] {
  return readdirSync(dir)
    .filter((f) => f.startsWith('before') && f.endsWith('.py'))
    .sort()
    .map((f) => {
      const afterName = f.replace(/^before/, 'after')
      const afterPath = join(dir, afterName)
      if (!existsSync(afterPath)) throw new Error(`fixture ${dir}/${f} has no ${afterName}`)
      return {
        name: f,
        before: readFileSync(join(dir, f), 'utf8'),
        after: readFileSync(afterPath, 'utf8')
      }
    })
}

function noMatchFiles(dir: string): { name: string; src: string }[] {
  const sub = join(dir, 'no-match')
  if (!existsSync(sub)) return []
  return readdirSync(sub)
    .filter((f) => f.endsWith('.py'))
    .sort()
    .map((f) => ({ name: f, src: readFileSync(join(sub, f), 'utf8') }))
}

const dirs = fixtureDirs()

describe('refactor golden fixtures (#634 §4)', () => {
  it('every rule in the catalogue has a fixture folder', () => {
    const missing = ALL_RULES.filter((r) => !dirs.some((d) => d.rule.id === r.id)).map((r) => r.id)
    expect(missing).toEqual([])
  })

  for (const { rule, dir } of dirs) {
    describe(`${rule.id} (catalogue #${rule.catalogue})`, () => {
      const opts = rule.requires ? { capabilities: FULL_CAPS } : {}

      for (const pair of pairsIn(dir)) {
        it(`rewrites ${pair.name} to match its golden file`, () => {
          expect(runRuleToFixpoint(rule, pair.before, opts)).toBe(pair.after)
        })

        it(`${pair.name}: the result still parses cleanly`, () => {
          const result = runRuleToFixpoint(rule, pair.before, opts)
          expect(parsePython(result).errors).toEqual([])
        })

        it(`${pair.name}: applying twice is the same as applying once`, () => {
          const once = runRuleToFixpoint(rule, pair.before, opts)
          expect(runRuleToFixpoint(rule, once, opts)).toBe(once)
        })

        it(`${pair.name}: leaves every byte outside the edited ranges alone`, () => {
          const ctx = createContext(pair.before, opts)
          expect(ctx).not.toBeNull()
          const offers = detectAll(ctx!, [rule])
          for (const offer of offers) {
            const applied = applyOffer(offer, ctx!)
            if (!applied) continue
            // Rebuild the file from the untouched spans plus the new text and
            // check it equals what the engine produced — proving the edits
            // account for every byte that changed.
            const sorted = [...applied.edits].sort((a, b) => a.start - b.start)
            let rebuilt = ''
            let cursor = 0
            for (const e of sorted) {
              rebuilt += pair.before.slice(cursor, e.start) + e.newText
              cursor = e.end
            }
            rebuilt += pair.before.slice(cursor)
            expect(rebuilt).toBe(applied.result)
          }
        })
      }

      for (const nm of noMatchFiles(dir)) {
        it(`does not fire on no-match/${nm.name}`, () => {
          const ctx = createContext(nm.src, opts)
          // A no-match fixture that doesn't parse would pass vacuously.
          expect(ctx, `${nm.name} should be valid Python`).not.toBeNull()
          const offers = detectAll(ctx!, [rule])
          const applied = offers.map((o) => applyOffer(o, ctx!)).filter(Boolean)
          expect(applied, `${rule.id} should offer nothing for ${nm.name}`).toEqual([])
        })
      }
    })
  }
})
