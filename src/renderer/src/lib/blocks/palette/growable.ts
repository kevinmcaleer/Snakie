import * as Blockly from 'blockly/core'

/**
 * BLOCKS THAT GROW A ROW AT A TIME (#1121, epic #1119).
 * =============================================================================
 *
 * A tuple, a dictionary literal, a `bytes(...)` and a `print` with several
 * things in it are all the same shape: a head, then as many sockets as the
 * learner wants, added one at a time. `python.ts` built that once for the two
 * `call` blocks and argued the design there; this is the same idea lifted out
 * so the four blocks that arrived with epic #1119 share it rather than each
 * growing their own copy.
 *
 * **A pair of `+` / `−` buttons rather than Blockly's gear mutator.** The gear
 * opens a second, miniature workspace in a bubble and asks the learner to drag
 * rows into a container — a mechanism with nothing else like it in the app,
 * discovered by accident if at all. Two buttons on the block are visible,
 * obvious and need no explanation. That argument is `python.ts`'s and it is
 * repeated here because it is the whole reason this file is not a mutator.
 *
 * The count serialises through `saveExtraState`/`loadExtraState`, so a saved
 * file reopens with the sockets it had — and a block saved before a row was
 * added or removed still loads, because the state is a NUMBER and a missing
 * one falls back to the block's default.
 */

/** How many rows a block of this kind may grow to. */
export const MAX_ITEMS = 12

export interface GrowableOptions {
  /** The theme style, e.g. `lists_blocks`. */
  style: string
  /** Fields on the head row, before the first socket. */
  head: string
  /** How many rows a freshly dragged block arrives with. */
  defaults: number
  /** The word before the first socket, and the one between the rest. */
  first: string
  separator: string
  tooltip: string
  /** A value block (an output) rather than a statement. */
  value?: boolean
  /**
   * What the FIRST socket is called, when it cannot be `ADD0` (#1125).
   *
   * `text_print` is the one block here that already existed with one socket, in
   * every workspace anybody has ever saved — and that socket is called `TEXT`.
   * Renaming it would make `Blockly.serialization` unable to place the block a
   * learner plugged in, which does not warn: it throws, and the throw costs
   * them every block in the file. So the first row keeps the old name and the
   * rest grow beside it.
   */
  firstSocket?: string
  /** What the `+` button's hover text calls a row — "item", "byte", "value". */
  noun: string
  /**
   * A SECOND socket per row, for the blocks whose rows are pairs.
   *
   * The dictionary literal is the reason: a row there is a key AND a value, and
   * two parallel `KEY0`/`VALUE0` sockets is the shape, not two blocks. Absent
   * means one socket per row, named `ADD0…ADDn` the way Blockly's own list
   * block names them.
   */
  pair?: { keyPrefix: string; valuePrefix: string; between: string }
}

/** How many rows this block currently has. */
export function itemCount(block: Blockly.Block): number {
  return (block as unknown as { itemCount_?: number }).itemCount_ ?? 0
}

/**
 * The `+` / `−` stepper, as a data URI.
 *
 * Copied from `python.ts` rather than exported from it, because importing the
 * escape-hatch module for an icon would drag the Python field and the syntax
 * checker into every palette that grows a row.
 */
function stepperIcon(sign: '+' | '−'): string {
  const glyph =
    sign === '+'
      ? '<path d="M8 4v8M4 8h8" stroke="#fff" stroke-width="2" stroke-linecap="round"/>'
      : '<path d="M4 8h8" stroke="#fff" stroke-width="2" stroke-linecap="round"/>'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="rgba(255,255,255,0.22)"/>${glyph}</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/** The Blockly mixin for one growable block. */
export function growableMixin(options: GrowableOptions): Record<string, unknown> {
  const update = (block: Blockly.Block, n: number): void =>
    (block as unknown as { updateItems_: (n: number) => void }).updateItems_(n)

  return {
    // ZERO, not the default: `init` calls `updateItems_(defaults)` and that only
    // adds the sockets it can see are missing. Starting at the target would make
    // it a no-op and build a block with no sockets at all.
    itemCount_: 0,

    init(this: Blockly.Block): void {
      this.setStyle(options.style)
      this.appendDummyInput('HEAD').appendField(options.head)
      this.setInputsInline(true)
      if (options.value) this.setOutput(true, null)
      else {
        this.setPreviousStatement(true, null)
        this.setNextStatement(true, null)
      }
      this.setTooltip(options.tooltip)
      update(this, options.defaults)
    },

    saveExtraState(this: Blockly.Block): { items: number } {
      return { items: itemCount(this) }
    },

    loadExtraState(this: Blockly.Block, state: { items?: number }): void {
      update(this, Math.max(0, Math.min(MAX_ITEMS, Number(state?.items ?? options.defaults))))
    },

    /** Add or remove rows so there are exactly `n`, and re-label them. */
    updateItems_(this: Blockly.Block, n: number): void {
      const self = this as unknown as { itemCount_: number }
      const target = Math.max(0, Math.min(MAX_ITEMS, n))
      const names = (i: number): string[] =>
        options.pair
          ? [`${options.pair.keyPrefix}${i}`, `${options.pair.valuePrefix}${i}`]
          : [i === 0 && options.firstSocket ? options.firstSocket : `ADD${i}`]
      for (let i = self.itemCount_ ?? 0; i > target; i--) {
        for (const name of names(i - 1)) this.removeInput(name, true)
      }
      for (let i = self.itemCount_ ?? 0; i < target; i++) {
        const label = i === 0 ? options.first : options.separator
        if (options.pair) {
          this.appendValueInput(`${options.pair.keyPrefix}${i}`).setCheck(null).appendField(label)
          this.appendValueInput(`${options.pair.valuePrefix}${i}`)
            .setCheck(null)
            .appendField(options.pair.between)
        } else {
          this.appendValueInput(names(i)[0]).setCheck(null).appendField(label)
        }
      }
      self.itemCount_ = target
      // The buttons live on their own input at the END, so they stay to the
      // right of whatever the row is now.
      if (this.getInput('STEP')) this.removeInput('STEP')
      this.appendDummyInput('STEP')
        .appendField(
          new Blockly.FieldImage(stepperIcon('+'), 16, 16, `add a ${options.noun}`, () =>
            update(this, target + 1)
          ),
          'ADD'
        )
        .appendField(
          new Blockly.FieldImage(stepperIcon('−'), 16, 16, `remove a ${options.noun}`, () =>
            update(this, target - 1)
          ),
          'REMOVE'
        )
    }
  }
}
