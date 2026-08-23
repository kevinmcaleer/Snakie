/**
 * The refactoring rule interface (epic #634, §2.3).
 *
 * Every rule is a pure pair of functions over an immutable {@link RefactorContext}:
 * `detect` says "this smell is here", `apply` turns one match into ranged text
 * edits. Both are side-effect free and synchronous, so a rule can be unit-tested
 * with nothing but a source string — no Electron, no Monaco, no device, no
 * Python interpreter.
 *
 * `detect` runs twice in the product: over the current selection for the
 * right-click menu and the lightbulb, and over the whole file for the
 * Problems-panel hint pass (§2.4).
 */
import type { Comment } from './lexer'
import type { Module } from './ast'
import type { LineIndex, TextEdit } from './text'

/** How loudly a match is reported in the Problems panel. */
export type RefactorSeverity = 'hint' | 'info' | 'warning' | 'error'

/**
 * Which family a rule belongs to. Drives the Problems filter chips, the
 * settings toggles, and which phase of the epic shipped it.
 */
export type RefactorCategory =
  | 'control-flow'
  | 'extraction'
  | 'conditionals'
  | 'loops'
  | 'functions'
  | 'micropython'
  | 'board'

/**
 * What the connected board's firmware can actually do (epic §2.5). Board-gated
 * rules consult this and offer nothing when it is absent — a wrong optimisation
 * hint costs more trust than a missing one.
 */
export interface BoardCapabilities {
  /** `@micropython.native` compiles on this firmware. */
  native: boolean
  /** `@micropython.viper` compiles on this firmware. */
  viper: boolean
  /** Which inline assembler is available, if any. */
  asm: 'thumb' | 'xtensa' | 'rv32' | null
  /** `rp2.asm_pio` is importable (RP2040 / RP2350). */
  pio: boolean
  /** `os.uname().machine`. */
  machine: string
  /** `os.uname().release`. */
  version: string
  /** `gc.mem_free()` at probe time, in bytes. */
  memFree: number
  /**
   * True when these values came from the static per-MCU fallback table rather
   * than a live probe. Board hints then hedge ("your firmware probably
   * supports…") instead of asserting.
   */
  inferred?: boolean
  /** Number of PIO state machines available (8 on RP2040, 12 on RP2350). */
  stateMachines?: number
}

/** Thresholds a user can tune; rules read these instead of hard-coding numbers. */
export interface RefactorSettings {
  /** Lines before a function is "too long" (rule 11). */
  longFunctionLines: number
  /** Nesting depth at which we suggest extracting (rule 5). */
  maxNestingDepth: number
  /** Positional parameters before we suggest a parameter object (rule 25). */
  maxParameters: number
  /** Times a literal must repeat before we offer to name it (rule 14). */
  magicLiteralRepeats: number
}

/** The defaults every context starts from. */
export const DEFAULT_SETTINGS: RefactorSettings = {
  longFunctionLines: 40,
  maxNestingDepth: 4,
  maxParameters: 5,
  magicLiteralRepeats: 2
}

/** An offset range in the source. */
export interface OffsetRange {
  start: number
  end: number
}

/** Everything a rule may read. Immutable — a rule must never mutate it. */
export interface RefactorContext {
  /** The file's full source text. */
  src: string
  /** The parsed module. Guaranteed error-free: the engine refuses otherwise. */
  module: Module
  /** `#` comments, in source order. */
  comments: Comment[]
  /** The file's own indent unit (`'    '`, `'\t'`, …) — never impose another. */
  indentUnit: string
  /** The file's own line ending. */
  eol: string
  /** Offset ↔ line/column mapping. */
  lines: LineIndex
  /** The user's selection or cursor, when the run came from the editor. */
  selection?: OffsetRange
  /** The connected board's probed capabilities; absent when nothing is connected. */
  capabilities?: BoardCapabilities
  /** Tunable thresholds. */
  settings: RefactorSettings
  /** The file's name, for rules that care (e.g. `main.py` vs a library). */
  fileName?: string
}

/**
 * One detected smell. `data` is the rule's own payload, handed back verbatim to
 * `apply` — rules keep the AST nodes they found there rather than re-searching.
 */
export interface RefactorMatch<D = unknown> {
  /** The rule that produced this match. Filled in by the engine. */
  ruleId: string
  /** The source range the smell covers (highlight / marker range). */
  start: number
  end: number
  /** Menu label for this specific match; falls back to the rule's `title`. */
  title?: string
  /** Problems-panel message for this match; falls back to the rule's `message`. */
  message?: string
  /** Rule-private payload. */
  data: D
}

/**
 * A rule. Author with a concrete `D`, then wrap in {@link defineRule} so the
 * registry can hold rules of differing payload types.
 */
export interface RefactorRule<D = unknown> {
  /** Stable id, kebab-case: `guard-clause`, `const-pin`, `non-blocking-loop`. */
  id: string
  /** Default menu label, e.g. 'Convert to guard clause'. */
  title: string
  /** Default Problems-panel message. */
  message: string
  /** Catalogue number in the epic (§3), for traceability. */
  catalogue: number
  category: RefactorCategory
  /** Monaco CodeActionKind family. */
  kind: 'refactor' | 'quickfix'
  /** Severity of the whole-file hint pass entry. */
  severity: RefactorSeverity
  /** The '#634 §…' help article id backing this rule's "Why?" link. */
  helpArticle: string
  /**
   * True when the rewrite is provably behaviour-preserving and cheap to check,
   * so "Tidy this file" (R7) may batch it. Anything that trades safety, RAM or
   * portability for speed is false.
   */
  safe: boolean
  /**
   * Board capability this rule needs. When set, the rule is offered ONLY if
   * `ctx.capabilities` is present and the predicate passes.
   */
  requires?: (caps: BoardCapabilities) => boolean
  /**
   * True when this rule is a hint with no automatic rewrite — the preview shows
   * the explanation and the "Why?" article rather than a diff.
   */
  hintOnly?: boolean
  /** Find every occurrence of the smell. Pure, cheap, no side effects. */
  detect(ctx: RefactorContext): RefactorMatch<D>[]
  /** Produce the edits. Pure. Returns null when it can't be done safely. */
  apply(match: RefactorMatch<D>, ctx: RefactorContext): TextEdit[] | null
}

/**
 * Erase a rule's payload type so differently-typed rules share one registry.
 * The engine only ever hands a rule back its own matches, so the cast is sound.
 */
export function defineRule<D>(rule: RefactorRule<D>): RefactorRule<unknown> {
  return rule as unknown as RefactorRule<unknown>
}

/** A match paired with the rule that produced it, ready to offer to the user. */
export interface RefactorOffer {
  rule: RefactorRule<unknown>
  match: RefactorMatch<unknown>
}
