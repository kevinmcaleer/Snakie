/**
 * WHOSE HIGHLIGHT IS IT (#1050, #1016)?
 * =============================================================================
 *
 * Clicking a line in the Python lights up the block that wrote it. Clicking a
 * different line has to put the first one out again — and Blockly will not do
 * that for us, which is the whole of the bug this file exists to fix.
 *
 * `BlockSvg.select()` highlights a block, but in Blockly 13 the CURRENT
 * selection belongs to the focus manager: `common.setSelected` is `@internal`
 * and its own doc says a selection is cleared by focusing something else, which
 * a programmatic `select()` never does. So the highlights ACCUMULATED. Clicking
 * four lines in turn left four blocks lit, and the only way to put one out was
 * to click it on the canvas and then click away.
 *
 * So the canvas remembers the one block it lit and takes it off itself. The rule
 * is three lines long and it is wrong in two interesting ways if you write it
 * from intuition, which is why it lives here with a test rather than inline in
 * an effect:
 *
 *  - **What is already lit may be what should stay lit.** The canvas's own
 *    `select()` echoes straight back through Blockly's selection event, and
 *    putting the light out on that echo means it never appears at all.
 *  - **"Nothing is selected" is not the same as "they chose nothing".** Our own
 *    `unselect()` of the previous block fires a selection event with no id, and
 *    it arrives AFTER the new block has been lit. Treating that as a choice put
 *    the fresh highlight out the instant it appeared.
 *
 * Structurally typed rather than importing Blockly, so the rule is unit-tested
 * in plain node against a fake — `BlocksCanvas` itself cannot be imported there,
 * since it pulls in Monaco for #1018's code fields.
 */

/** The little of a block this needs: the ability to stop being highlighted. */
export interface Unselectable {
  unselect(): void
}

/** The little of a workspace this needs. */
export interface BlockLookup {
  getBlockById(id: string): Unselectable | null
}

/** A mutable box holding the id of the block we lit, or null. */
export interface LitRef {
  current: string | null
}

/**
 * Put out the highlight we added, unless it is the one that should stay lit.
 *
 * `keep` is the block that should remain highlighted — the one now being asked
 * for, or the one Blockly has just selected. Passing the same id we already hold
 * is how our own `select()` echoing back is recognised and left alone.
 *
 * A no-op when we hold nothing, when what we hold is what should stay, or when
 * the block has since been deleted. Never throws.
 */
export function putOutHighlight(
  ws: BlockLookup | null | undefined,
  litRef: LitRef,
  keep: string | null
): void {
  const lit = litRef.current
  if (!lit || lit === keep) return
  ws?.getBlockById(lit)?.unselect()
  litRef.current = null
}
