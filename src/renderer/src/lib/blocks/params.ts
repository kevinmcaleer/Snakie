import * as Blockly from 'blockly/core'

/**
 * PARAMETERS, SHARED BY EVERY BLOCK THAT DECLARES THEM (B2, #1221, epic #1206).
 * =============================================================================
 *
 * #1134 gave Blockly's two `def` blocks a field for the parameters its mutator
 * cannot hold — a default (`flip_x=None`), a type annotation, `*args`,
 * `**kwargs`. The machinery was written inside `palette/functions.ts`, because
 * at the time `def` was the only block that had parameters at all: the method
 * block carried its WHOLE signature as one free-text `PARAMS` field.
 *
 * B2 rebuilds the method block with a real parameter list, and #1221 is
 * explicit that it must SHARE this code rather than copy it — so the extras
 * row, the field that hides itself when it is blank, and the splitter that
 * decides which half of a signature goes where all live here, one level up
 * from both palettes. `palette/functions.ts` re-exports the three helpers
 * `BlocksCanvas.tsx` reaches for, so nothing that imported them had to move.
 */

/** The field the extra parameters live in, and the input that carries it. */
export const EXTRAS_FIELD = 'EXTRAS'
export const EXTRAS_INPUT = 'SNAKIE_EXTRAS'

/**
 * THE ROW IS NOT THERE UNTIL IT HOLDS SOMETHING.
 *
 * `def` is the block a learner meets on their first afternoon, and a defaulted
 * parameter is a thing they will want in their second month. An always-visible
 * `extra parameters` row asks every one of them, every time, to wonder what it
 * is for — which is a poor trade for a field most programs never fill in.
 *
 * So the row is HIDDEN while it is empty, and appears the moment it has
 * something to say: the learner asks for it from the block's right-click menu
 * (`Add extra parameters…`, registered in `BlocksCanvas.tsx`), or a file being
 * read gives it a value. Nothing about what the field GENERATES changes — the
 * signature is built from the value, not from whether the row is on screen —
 * so a hidden empty row and no row at all write the same Python.
 *
 * SHOWING IS IMMEDIATE, HIDING WAITS for the editor to close (see
 * {@link syncExtras}). Blockly's text input commits its value on every
 * keystroke, so hiding on an empty one would pull the row — and the editor
 * attached to it — out from under a learner who has just selected all and typed
 * over it.
 */
export function setExtrasVisible(block: Blockly.Block, visible: boolean): void {
  const input = block.getInput(EXTRAS_INPUT)
  if (!input || input.isVisible() === visible) return
  input.setVisible(visible)
  ;(block as Blockly.BlockSvg).queueRender?.()
}

/** Is this a block the extras row is installed on? */
export function hasExtrasRow(block: Blockly.Block): boolean {
  return !!block.getInput(EXTRAS_INPUT)
}

/** Is the extras row on screen? False for a block that has no such row. */
export function extrasVisible(block: Blockly.Block): boolean {
  return !!block.getInput(EXTRAS_INPUT)?.isVisible()
}

/** What the extras field holds, trimmed. `''` for a block without one. */
export function extrasText(block: Blockly.Block): string {
  return String(block.getFieldValue(EXTRAS_FIELD) ?? '').trim()
}

/**
 * The extra parameters as they stand — the same text as {@link extrasText}.
 *
 * Named for the pair it belongs to: the settings dialog (A4, #1218) reads with
 * `getExtras` and writes with {@link setExtras}, and a reader following that
 * call should not have to notice that one half is spelled differently.
 */
export function getExtras(block: Blockly.Block): string {
  return extrasText(block)
}

/**
 * Set the extra parameters, and put the row away when they are emptied.
 *
 * The one writing path the settings dialog (A4, #1218) uses. The field's own
 * validator only ever SHOWS the row — hiding is left to the editor closing, so
 * a learner who selects all and types over the text does not have the row
 * pulled out from under them mid-edit. A dialog has no such moment: it commits
 * once, when OK is pressed, and by then the answer is final.
 *
 * A TRAILING COMMA IS TIDIED AWAY, because the dialog is a box a learner types
 * a list into and `times=3,` there means the same as `times=3`. The method
 * block's own field keeps one verbatim (see `palette/structure.ts`) — that is
 * about giving a file back exactly as it was read, which is a different job.
 */
export function setExtras(block: Blockly.Block, text: string): void {
  const value = String(text ?? '')
    .trim()
    .replace(/,\s*$/, '')
  block.setFieldValue(value, EXTRAS_FIELD)
  setExtrasVisible(block, value !== '')
}

/** The extras row, shown iff `value` is non-blank. Used on load and on edit. */
function syncExtras(field: Blockly.Field, value: string, allowHide: boolean): void {
  const block = field.getSourceBlock()
  // No source block yet: the field is validated once while it is still being
  // constructed, before `appendField` has attached it to anything.
  if (!block) return
  const wanted = String(value ?? '').trim() !== ''
  if (wanted || allowHide) setExtrasVisible(block, wanted)
}

/**
 * The extras field: a text input that carries the row's visibility with it.
 *
 * A subclass rather than a plain {@link Blockly.FieldTextInput} with a
 * validator, because the two halves of the rule fire at different moments —
 * the validator on every committed value (a keystroke, and a workspace being
 * deserialised), `onFinishEditing_` once the editor closes.
 */
class ExtrasField extends Blockly.FieldTextInput {
  constructor() {
    super('', (value) => {
      syncExtras(this, value, false)
      return value
    })
  }

  override onFinishEditing_(value: string): void {
    super.onFinishEditing_(value)
    syncExtras(this, value, true)
  }
}

/**
 * Append the extras row to a block, hidden and empty.
 *
 * `before` is the input it should sit above — the body, so the row reads as
 * part of the signature rather than as something under the function. Left out,
 * it lands at the foot of the block.
 */
export function appendExtrasRow(block: Blockly.Block, before?: string): void {
  block
    .appendDummyInput(EXTRAS_INPUT)
    // `and also` said nothing about what belongs in the box. This names it.
    .appendField('extra parameters:')
    .appendField(new ExtrasField(), EXTRAS_FIELD)
  if (before && block.getInput(before)) block.moveInputBefore(EXTRAS_INPUT, before)
  // Empty, so out of the way — see {@link setExtrasVisible}. A block being
  // deserialised turns it back on when the field takes its value.
  setExtrasVisible(block, false)
}

export {
  defaultLead,
  splitMethodSignature,
  splitSignature,
  type MethodLead,
  type MethodSignature
} from './signature'
