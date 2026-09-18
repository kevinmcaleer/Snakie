import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, beforeEach } from 'vitest'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import {
  installBlockDefinitions,
  registeredBlocks,
  resetBlockRegistry
} from '../src/renderer/src/lib/blocks/registry'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import { NOTE_FIELD_CLASS, PYTHON_BLANK, PYTHON_COMMENT } from '../src/renderer/src/lib/blocks/palette/python'

/**
 * THE BLANK-LINE BLOCK LOOKS LIKE A NOTE, NOT LIKE A STEP.
 * =============================================================================
 *
 * A blank line is about the SHAPE of a program rather than something it does,
 * and at the Python category's weight a canvas of real work read as half
 * spacing — a stack of solid blocks, every other one of them nothing.
 *
 * So it borrows the comment block's grey (#1062 gave comments their own, for the
 * same reason) and puts its label in italics.
 *
 * TWO MECHANISMS, BOTH WORTH A TEST, because neither is obvious:
 *
 *  - the **style** comes from `json.style`, which the registry lets win over the
 *    one it derives from `category` — so the block stays in the Python drawer
 *    while wearing the comment colour;
 *  - the **italics** come from a CLASS on the label, because Blockly's font
 *    style is per-workspace: there is one for the whole canvas, so anything
 *    per-block has to go through CSS. A bare `message0: 'blank line'` builds a
 *    label this cannot reach, which is why the block says `%1`.
 */

beforeEach(() => {
  resetBlockRegistry()
  installCorePalette()
  installBlockDefinitions()
})

const definition = (type: string): Record<string, unknown> =>
  registeredBlocks().find((b) => b.type === type)!.json as Record<string, unknown>

describe('the blank-line block', () => {
  it('wears the comment block’s colour rather than the Python category’s', () => {
    expect(definition(PYTHON_BLANK).style).toBe('comment_blocks')
  })

  it('wears the same one the comment block does, whatever that becomes', () => {
    // Asserted against the comment block ITSELF rather than against the string,
    // so renaming the style moves both or fails here. Built in a real workspace
    // because the comment block is installed as a mixin (`linesBlockMixin`) and
    // sets its style in `init` — there is no JSON to read it off.
    const ws = new Blockly.Workspace()
    const blank = ws.newBlock(PYTHON_BLANK)
    const comment = ws.newBlock(PYTHON_COMMENT)
    expect(blank.getStyleName()).toBe(comment.getStyleName())
  })

  it('stays in the Python drawer, where a learner looks for it', () => {
    // The colour is borrowed; the home is not. `snakie_python_comment` is in the
    // Python drawer too, so this is about the block not quietly moving.
    expect(registeredBlocks().find((b) => b.type === PYTHON_BLANK)!.category).toBe('python')
  })

  it('puts its words in a label it can reach, rather than in the message', () => {
    const json = definition(PYTHON_BLANK)
    expect(json.message0).toBe('%1')
    expect(json.args0).toEqual([
      { type: 'field_label', text: 'blank line', class: NOTE_FIELD_CLASS }
    ])
  })

  it('still writes one empty line and nothing else', () => {
    // The whole point of the block, unchanged by any of the above.
    const code = registeredBlocks().find((b) => b.type === PYTHON_BLANK)!.code
    expect((code as () => string)()).toBe('\n')
  })
})

describe('the italics reach it', () => {
  // A cascade is not something vitest can evaluate, so this asserts the shape of
  // the selector — and the shape is the whole fix. Blockly builds its text rule
  // from the theme's `fontStyle` as the `font` SHORTHAND, at three classes, and
  // a shorthand resets every longhand it does not name: it sets `font-style:
  // normal` without ever mentioning it. The two-class rule this started as lost
  // to that silently, and the label rendered upright.
  const CSS = readFileSync(
    resolve(__dirname, '../src/renderer/src/components/BlocksCanvas.css'),
    'utf8'
  ).replace(/\/\*[\s\S]*?\*\//g, '')

  const selectors = (() => {
    for (const [, head, body] of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (/font-style:\s*italic/.test(body) && head.includes(NOTE_FIELD_CLASS)) {
        return head.split(',').map((s) => s.replace(/\s+/g, ' ').trim())
      }
    }
    throw new Error(`no rule italicises .${NOTE_FIELD_CLASS}`)
  })()

  it('out-specifies the three-class shorthand that would reset it', () => {
    for (const selector of selectors) {
      const classes = selector.match(/\.[\w-]+/g) ?? []
      expect({ selector, classes: classes.length > 3 }).toEqual({ selector, classes: true })
    }
  })

  it('covers the flyout as well as the canvas', () => {
    // The flyout's blocks live in their own SVG rather than under the canvas's,
    // so a selector written for one misses the other — and the drawer is where
    // a learner meets the block first.
    expect(selectors.some((s) => s.includes('.blocklyFlyout'))).toBe(true)
    expect(selectors.some((s) => s.includes('.blocklySvg'))).toBe(true)
  })
})
