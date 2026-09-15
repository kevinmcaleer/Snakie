import * as Blockly from 'blockly/core'
import type { BlockCategoryId } from './theme'
import type { PyImport } from './imports'
import type { MicroPythonGenerator } from './generator'

/**
 * THE BLOCK REGISTRY (#1010, epic #1007).
 * =============================================================================
 *
 * One place a block is declared, and everything that needs to know about it —
 * Blockly's definition table, the generator's emitter table, and the toolbox
 * category it appears in — is derived from that one declaration.
 *
 * The alternative, and the reason this exists, is three lists: a block defined
 * in one file, its generator function in a god-file of emitters, and its name
 * typed a third time into a toolbox. Two of those three go stale silently — a
 * block with no emitter generates `undefined` into a child's program, and a
 * block in no category simply cannot be reached. Here they cannot disagree,
 * because there is only one of them.
 *
 * The palettes (#1011–#1014), the `blocks.yml` manifest (#1017) and the escape
 * hatches (#1018) all arrive through {@link defineBlocks}.
 */

/**
 * What a block's emitter returns.
 *
 * A STATEMENT block returns its lines, newline-terminated. A VALUE block returns
 * `[expression, precedence]` — Blockly's own convention, so the expression is
 * parenthesised only where it has to be.
 */
export type BlockCode = string | [string, number]

/** Emit the code for one block. `gen` carries the imports and the setup section. */
export type BlockEmitter = (block: Blockly.Block, gen: MicroPythonGenerator) => BlockCode

export interface BlockDefinition {
  /** Blockly block type id, e.g. `snakie_turtle_forward`. */
  type: string
  /** The toolbox category it lives in — from the theme's one category list. */
  category: BlockCategoryId
  /**
   * The Blockly JSON definition (`message0`, `args0`, `previousStatement`, …).
   * `style` is filled in from `category` when absent, so a block can't end up a
   * different colour from the category it sits in.
   */
  json: Record<string, unknown>
  /** What this block needs in scope, whenever it emits. */
  imports?: readonly PyImport[]
  /** Emit the code. */
  code: BlockEmitter
  /**
   * Toolbox entry overrides — shadow blocks for the number inputs, mostly, so a
   * block dragged out of the flyout already has sensible values in it rather
   * than empty sockets a beginner has to discover how to fill.
   */
  toolbox?: Record<string, unknown>
}

const REGISTRY = new Map<string, BlockDefinition>()

/**
 * Register blocks. Idempotent per type: re-registering the same type replaces
 * it, so a hot reload doesn't end up with two definitions racing.
 */
export function defineBlocks(defs: readonly BlockDefinition[]): void {
  for (const def of defs) REGISTRY.set(def.type, def)
}

/** Every registered block, in registration order. */
export function registeredBlocks(): BlockDefinition[] {
  return [...REGISTRY.values()]
}

/** The registered blocks in one category, in registration order. */
export function blocksInCategory(category: BlockCategoryId): BlockDefinition[] {
  return registeredBlocks().filter((b) => b.category === category)
}

/** One block's definition, or undefined. */
export function blockDefinition(type: string): BlockDefinition | undefined {
  return REGISTRY.get(type)
}

/**
 * Teach Blockly the registered blocks' shapes.
 *
 * Separate from registration because the two have different lifetimes: a block
 * can be registered before Blockly is loaded at all (the registry is a plain
 * Map; the canvas is a lazy chunk), and a definition has to be installed once
 * Blockly exists and again for anything registered since.
 *
 * `style` falls back to the block's CATEGORY, so a block cannot end up a
 * different colour from the category it sits in — the one way those two could
 * disagree if each were written out by hand.
 */
export function installBlockDefinitions(): void {
  const defs = registeredBlocks().map((def) => ({
    type: def.type,
    style: `${def.category}_blocks`,
    ...def.json
  }))
  if (defs.length > 0) Blockly.defineBlocksWithJsonArray(defs)
}

/** Forget everything — for tests, which must not leak blocks into each other. */
export function resetBlockRegistry(): void {
  REGISTRY.clear()
}
