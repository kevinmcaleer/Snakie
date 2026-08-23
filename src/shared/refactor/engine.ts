/**
 * The refactoring engine (epic #634, phase R0) — parse, detect, apply.
 *
 * Pure TypeScript with no Electron, Monaco, device or Python dependency, so it
 * runs unchanged in the desktop renderer, in Snakie for Web (#267, where there
 * is no plugin host at all) and under vitest. That was the whole point of
 * putting it in `src/shared/` rather than behind the Python host (§2.1).
 *
 * The engine owns the safety rules in §2.6 so no individual rule has to
 * remember them:
 *
 * 1. **No refactor on a file that doesn't parse.** {@link createContext}
 *    returns null when the parser reported anything, so there is no context to
 *    run rules against.
 * 2. **Idempotent** and 3. **round-trips** — enforced by {@link applyOffer},
 *    which re-parses the result and refuses to hand back a rewrite that broke
 *    the file, and asserted per rule by the golden-file suite.
 * 4. **Comment-preserving** and 5. **indentation-preserving** — a consequence of
 *    edits being ranged (nothing outside a range can change) plus rules reading
 *    `ctx.indentUnit` instead of assuming four spaces.
 * 6. **Never silently changes behaviour** — a rule returns null from `apply`
 *    when it cannot prove equivalence, and the engine drops the offer.
 */
import { parsePython } from './parser'
import type { AnyNode, Stmt } from './ast'
import { walk } from './ast'
import { LineIndex, applyEdits, detectEol, detectIndentUnit } from './text'
import type { TextEdit } from './text'
import type {
  BoardCapabilities,
  OffsetRange,
  RefactorCategory,
  RefactorContext,
  RefactorMatch,
  RefactorOffer,
  RefactorRule,
  RefactorSettings
} from './types'
import { DEFAULT_SETTINGS } from './types'

/** Options for building a context. */
export interface ContextOptions {
  selection?: OffsetRange
  capabilities?: BoardCapabilities
  settings?: Partial<RefactorSettings>
  fileName?: string
}

/**
 * Parse `src` and build the immutable context rules read.
 *
 * Returns **null** when the file does not parse — the engine's flat refusal to
 * refactor code it cannot fully understand (§2.6.1, and the epic's first
 * acceptance criterion). Callers surface that as "no refactorings available",
 * never as an error.
 */
export function createContext(src: string, opts: ContextOptions = {}): RefactorContext | null {
  const parsed = parsePython(src)
  if (parsed.errors.length > 0) return null
  return {
    src,
    module: parsed.module,
    comments: parsed.comments,
    indentUnit: detectIndentUnit(src),
    eol: detectEol(src),
    lines: new LineIndex(src),
    selection: opts.selection,
    capabilities: opts.capabilities,
    settings: { ...DEFAULT_SETTINGS, ...opts.settings },
    fileName: opts.fileName
  }
}

/** True when the board gate on `rule` is satisfied by the context. */
export function capabilityAllows(rule: RefactorRule<unknown>, ctx: RefactorContext): boolean {
  if (!rule.requires) return true
  // No connected board ⇒ no board-specific hints (§2.5). A wrong optimisation
  // hint costs more trust than a missing one.
  if (!ctx.capabilities) return false
  try {
    return rule.requires(ctx.capabilities)
  } catch {
    return false
  }
}

/**
 * Run every rule's `detect` over the whole file. A rule that throws is skipped
 * rather than taking the whole menu down with it.
 */
export function detectAll(
  ctx: RefactorContext,
  rules: readonly RefactorRule<unknown>[]
): RefactorOffer[] {
  const offers: RefactorOffer[] = []
  for (const rule of rules) {
    if (!capabilityAllows(rule, ctx)) continue
    let matches: RefactorMatch<unknown>[] = []
    try {
      matches = rule.detect(ctx)
    } catch {
      continue
    }
    for (const match of matches) {
      offers.push({ rule, match: { ...match, ruleId: rule.id } })
    }
  }
  return offers.sort((a, b) => a.match.start - b.match.start || a.rule.id.localeCompare(b.rule.id))
}

/** Does a match overlap (or touch) the given range? */
function overlaps(match: RefactorMatch<unknown>, range: OffsetRange): boolean {
  return match.start <= range.end && range.start <= match.end
}

/**
 * The refactorings to offer for a cursor or selection: every match that
 * overlaps it, innermost first, so "Merge nested conditions" on the inner `if`
 * beats the same rule matched on an enclosing one.
 */
export function offersFor(
  ctx: RefactorContext,
  rules: readonly RefactorRule<unknown>[],
  selection: OffsetRange
): RefactorOffer[] {
  return detectAll(ctx, rules)
    .filter((o) => overlaps(o.match, selection))
    .sort((a, b) => {
      const sizeA = a.match.end - a.match.start
      const sizeB = b.match.end - b.match.start
      return sizeA - sizeB || a.match.start - b.match.start
    })
}

/** A verified rewrite, ready to preview and apply. */
export interface AppliedRefactor {
  edits: TextEdit[]
  /** The full new file contents. */
  result: string
}

/**
 * Turn one offer into verified edits.
 *
 * Returns null when the rule declined, when the edits are malformed or
 * overlapping, or when the result no longer parses — the last of which is the
 * round-trip guarantee (§2.6.3) enforced at runtime, not just in tests. A
 * caller that gets null should simply not offer the action.
 */
export function applyOffer(offer: RefactorOffer, ctx: RefactorContext): AppliedRefactor | null {
  let edits: TextEdit[] | null = null
  try {
    edits = offer.rule.apply(offer.match, ctx)
  } catch {
    return null
  }
  if (!edits || edits.length === 0) return null
  const result = applyEdits(ctx.src, edits)
  if (result == null) return null
  if (result === ctx.src) return null
  // Round-trip: the rewrite must leave a file that still parses cleanly.
  if (parsePython(result).errors.length > 0) return null
  return { edits, result }
}

/**
 * Apply several offers at once ("Tidy this file", R7). Offers whose edits would
 * overlap an already-accepted one are skipped rather than merged, and the whole
 * batch is verified as one rewrite so it lands under a single undo.
 */
export function applyOffers(
  offers: readonly RefactorOffer[],
  ctx: RefactorContext
): AppliedRefactor | null {
  const taken: TextEdit[] = []
  for (const offer of offers) {
    let edits: TextEdit[] | null = null
    try {
      edits = offer.rule.apply(offer.match, ctx)
    } catch {
      continue
    }
    if (!edits || edits.length === 0) continue
    const clashes = edits.some((e) => taken.some((t) => e.start < t.end && t.start < e.end))
    if (clashes) continue
    // Each rule's edits must be individually sane before joining the batch.
    if (edits.some((e) => e.start < 0 || e.end > ctx.src.length || e.start > e.end)) continue
    taken.push(...edits)
  }
  if (taken.length === 0) return null
  const result = applyEdits(ctx.src, taken)
  if (result == null || result === ctx.src) return null
  if (parsePython(result).errors.length > 0) return null
  return { edits: taken, result }
}

/**
 * Convenience for tests and the "Why?" tooling: run one named rule over a
 * source string and return the rewritten text, or null if it didn't fire.
 */
export function runRule(
  rule: RefactorRule<unknown>,
  src: string,
  opts: ContextOptions = {}
): string | null {
  const ctx = createContext(src, opts)
  if (!ctx) return null
  if (!capabilityAllows(rule, ctx)) return null
  const offers = detectAll(ctx, [rule])
  if (offers.length === 0) return null
  const applied = applyOffer(offers[0], ctx)
  return applied ? applied.result : null
}

/**
 * Apply a rule everywhere it matches, repeatedly, until it stops firing. Used
 * by the golden-file suite (a fixture usually contains several instances of the
 * smell) and by "Tidy this file".
 *
 * Bounded so a rule that is accidentally non-idempotent fails the test with a
 * wrong answer rather than hanging CI.
 */
export function runRuleToFixpoint(
  rule: RefactorRule<unknown>,
  src: string,
  opts: ContextOptions = {},
  maxRounds = 20
): string {
  let current = src
  for (let round = 0; round < maxRounds; round++) {
    const ctx = createContext(current, opts)
    if (!ctx) return current
    if (!capabilityAllows(rule, ctx)) return current
    const offers = detectAll(ctx, [rule])
    if (offers.length === 0) return current
    const applied = applyOffers(offers, ctx)
    if (!applied) {
      // Batch failed (overlapping edits); fall back to one at a time.
      let progressed = false
      for (const offer of offers) {
        const one = applyOffer(offer, ctx)
        if (one) {
          current = one.result
          progressed = true
          break
        }
      }
      if (!progressed) return current
      continue
    }
    current = applied.result
  }
  return current
}

/** Statement nesting depth of a node, counting block statements only. */
export function nestingDepth(node: AnyNode): number {
  let depth = 0
  let cur = node.parent
  while (cur) {
    if (
      cur.type === 'If' ||
      cur.type === 'For' ||
      cur.type === 'While' ||
      cur.type === 'With' ||
      cur.type === 'Try' ||
      cur.type === 'ExceptHandler'
    ) {
      depth++
    }
    if (cur.type === 'FunctionDef' || cur.type === 'Lambda') break
    cur = cur.parent
  }
  return depth
}

/** Every statement in the module, in source order, including nested ones. */
export function allStatements(ctx: RefactorContext): Stmt[] {
  const out: Stmt[] = []
  walk(ctx.module as AnyNode, (n) => {
    if (isStatement(n)) out.push(n as Stmt)
  })
  return out
}

const STATEMENT_TYPES = new Set([
  'FunctionDef',
  'ClassDef',
  'Return',
  'Delete',
  'Assign',
  'AugAssign',
  'AnnAssign',
  'For',
  'While',
  'If',
  'With',
  'Raise',
  'Try',
  'Assert',
  'Import',
  'ImportFrom',
  'Global',
  'Nonlocal',
  'ExprStmt',
  'Pass',
  'Break',
  'Continue'
])

/** True when a node is a statement (as opposed to an expression or helper). */
export function isStatement(node: AnyNode): boolean {
  return STATEMENT_TYPES.has(node.type)
}

/** Group offers by rule category, for the Problems filter chips. */
export function groupByCategory(offers: readonly RefactorOffer[]): Map<RefactorCategory, RefactorOffer[]> {
  const out = new Map<RefactorCategory, RefactorOffer[]>()
  for (const o of offers) {
    const list = out.get(o.rule.category)
    if (list) list.push(o)
    else out.set(o.rule.category, [o])
  }
  return out
}
