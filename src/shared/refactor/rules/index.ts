/**
 * The refactoring catalogue (epic #634 §3) — every rule the engine knows about.
 *
 * Rules are grouped by the phase that shipped them so the list reads like the
 * epic. Adding a rule means writing `rules/<id>.ts` plus a
 * `test/fixtures/refactor/<id>/` folder; the table-driven suite picks both up
 * automatically.
 */
import type { RefactorRule } from '../types'
import { guardClauseRule } from './guard-clause'

/** R0/R1 — nesting & control flow (§3.1, §3.8). */
export const CONTROL_FLOW_RULES: RefactorRule<unknown>[] = [guardClauseRule]

/** Everything, in catalogue order. */
export const ALL_RULES: RefactorRule<unknown>[] = [...CONTROL_FLOW_RULES]

/** Look a rule up by id. */
export function ruleById(id: string): RefactorRule<unknown> | undefined {
  return ALL_RULES.find((r) => r.id === id)
}

/** The provably-safe subset "Tidy this file" (R7) is allowed to batch. */
export function safeRules(): RefactorRule<unknown>[] {
  return ALL_RULES.filter((r) => r.safe && !r.hintOnly)
}
