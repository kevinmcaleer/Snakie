/**
 * Rule 32 — **Unused import or variable** (epic #634 §3.5) — *deliberately
 * detects nothing.*
 *
 * ```python
 * import time          # ruff: F401 unused import — with a fix, already offered
 * from machine import Pin
 *
 * def read(adc):
 *     raw = adc.read_u16()   # ruff: F841 local variable assigned but never used
 *     return adc.read_uv()
 * ```
 *
 * This catalogue slot is **owned by ruff**. Snakie already runs ruff over the
 * buffer, and ruff reports exactly this smell as `F401` (unused import) and
 * `F841` (local assigned but never read) — with an automatic fix attached, in a
 * checker that sees the whole file's imports far more thoroughly than a
 * single-purpose rule here ever would.
 *
 * §5 of the epic is explicit about what happens when ruff and a Snakie rule find
 * the same thing: **defer to ruff and do not double-report it.** Two blue
 * squiggles under one `import time` is not twice the help; it is a Problems
 * panel that looks broken, and a beginner cannot tell whether they have one
 * problem or two. `refactor-hints.ts` implements the other half of that policy
 * through `alreadyReported` — it drops any Snakie hint whose rule id ruff has
 * already covered — and this file is the reason it never has to for rule 32.
 *
 * So why does the file exist at all? Because the alternative is a hole in the
 * numbering, and a hole is something a future contributor has to *remember* is
 * intentional. A rule object that detects nothing, carries the catalogue number,
 * and explains itself keeps the delegation in the code rather than in a footnote
 * — and it means "every catalogue entry has a rule and a fixture" stays true.
 * The fixture pair is a file with an obviously unused import that this rule
 * leaves untouched: the golden suite therefore asserts our *silence*.
 *
 * If ruff ever stops being available (an offline install, Snakie for Web without
 * the host), the right answer is still not to switch this on quietly — a hint
 * that appears and disappears depending on what is installed is worse than one
 * that is consistently ruff's job.
 */
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorMatch } from '../types'

/** Nothing is ever carried, because nothing is ever matched. */
type NeverMatched = never

export const ruffOwnedUnusedRule = defineRule<NeverMatched>({
  id: 'ruff-owned-unused',
  title: 'Unused import or variable',
  message: 'Unused imports and variables are reported by ruff (F401 / F841), which also fixes them',
  catalogue: 32,
  category: 'functions',
  kind: 'quickfix',
  severity: 'hint',
  helpArticle: 'refactor-ruff-owned-unused',
  // Nothing to batch, but nothing unsafe either: this rule never fires.
  safe: true,
  hintOnly: true,

  /**
   * Always empty. Detection lives in ruff (F401/F841); reporting it here as well
   * would put two markers under one import (§5).
   */
  detect(): RefactorMatch<NeverMatched>[] {
    return []
  },

  /** Unreachable — `detect` never produces a match to apply. */
  apply(): TextEdit[] | null {
    return null
  }
})
