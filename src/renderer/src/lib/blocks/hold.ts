import type { ConversionHold } from './round-trip'

/**
 * WHEN THE BLOCKS AND THE FILE STOP AGREEING (#1068, epic #1007).
 * =============================================================================
 *
 * The Blocks workspace runs on one premise: the canvas and the Python are two
 * views of one program. Three separate things can break it, and before this they
 * broke it three separate ways, all of them silent:
 *
 *  1. **A block this build cannot generate.** A part unwired in Electronics
 *     takes its blocks out of the registry while Blockly keeps rendering them,
 *     so the canvas looks perfectly normal and the mirror quietly loses those
 *     lines. `BlocksSplit` refused to write — correctly — and said nothing, so
 *     the file simply stopped saving, with no unsaved dot and no message, for
 *     the rest of the session.
 *  2. **An emitter that threw.** Same outcome, and it did not even reach the
 *     refusal: `missing` only knows about types with no emitter, so a program
 *     short of a whole stack was written over the learner's file. See
 *     `GeneratedProgram.failed`.
 *  3. **A conversion that is not faithful.** #1069 gates this while they type in
 *     the code pane; a `.py` Snakie did not write went straight onto the canvas
 *     without the check, and the first block dragged rewrote the file from
 *     blocks that were only ever an approximation of it.
 *
 * NOT A HAND-EDIT CONFLICT, and that is worth writing down because #1008 says
 * otherwise. A `.py` edited under a stale footer was #1008's modal — *which side
 * wins?* — and #1034 settled it the other way: the `.py` IS the program, so
 * `BlocksSplit` re-derives the blocks from the code and there is nothing to ask.
 * `docs/blocks.md` is the current word on it. If that re-derivation turns out
 * not to be faithful, it arrives here as case 3 like any other conversion.
 *
 * ONE STATE, ONE ANSWER. All three are the same sentence — *the blocks on screen
 * and the Python in the file are not the same program* — and the same rule
 * follows from it: **the blocks do not get to write the file.** What differs is
 * only what to say, which is what {@link BlocksHold} carries.
 *
 * Pure, so the precedence below is a test rather than something you discover by
 * unwiring a part at the wrong moment.
 */

/** Why the blocks and the file are not the same program. */
export type BlocksHold =
  /**
   * Some blocks did not generate: no emitter for the type, or one that threw.
   * `types` names them where we know the names (#1017's part and plugin blocks
   * are the reachable case); empty when only an emitter failed.
   */
  | { kind: 'incomplete'; types: string[] }
  /** This file converted into blocks that do not regenerate it (#1069's check). */
  | { kind: 'unfaithful'; reason: ConversionHold }
  /** They are typing, and what they have typed so far will not convert back. */
  | { kind: 'mid-edit'; reason: ConversionHold }

/** What the split knows when it asks. */
export interface HoldInput {
  /** The current program, once the canvas has generated one. */
  program: { missing: readonly string[]; failed: readonly string[] } | null
  /**
   * The verdict on converting THIS FILE into the blocks on screen — set only for
   * a file that arrived without a footer and had to be converted to be shown.
   */
  opened: ConversionHold | null
  /** The verdict on what they are typing right now (#1069). */
  typing: ConversionHold | null
}

/**
 * Which hold applies, or null when the two views agree.
 *
 * PRECEDENCE IS THE DESIGN, not tidiness. `incomplete` outranks the rest because
 * it is the only one that is about the blocks THEMSELVES being unusable rather
 * than about how well they match some text — a learner whose part came unwired
 * needs to hear that and not a sentence about conversion fidelity. `mid-edit` is
 * last: it is the mildest, much the most common, and the only one that goes away
 * on its own with the next keystroke.
 */
export function holdFor(input: HoldInput): BlocksHold | null {
  const { missing = [], failed = [] } = input.program ?? {}
  if (missing.length > 0 || failed.length > 0) return { kind: 'incomplete', types: [...missing] }
  if (input.opened) return { kind: 'unfaithful', reason: input.opened }
  if (input.typing) return { kind: 'mid-edit', reason: input.typing }
  return null
}

/**
 * May the canvas write this program to the file?
 *
 * Everything except `mid-edit`, and that exception is the point rather than a
 * gap: a `mid-edit` hold is about text in the code pane that has not been
 * committed to anything. The blocks on the canvas are still the last ones that
 * were true, and a learner who reaches past their half-typed line to drag a
 * block has chosen the blocks — which is an answer, and the hold clears.
 */
export function blocksMayWrite(hold: BlocksHold | null): boolean {
  return hold === null || hold.kind === 'mid-edit'
}
