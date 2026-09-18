import { describe, it, expect, beforeEach } from 'vitest'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import { generateProgram } from '../src/renderer/src/lib/blocks/generator'
import { installBlockDefinitions, resetBlockRegistry } from '../src/renderer/src/lib/blocks/registry'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import { pythonToBlocks } from '../src/renderer/src/lib/blocks/python-to-blocks'
import { PYTHON_DOCSTRING } from '../src/renderer/src/lib/blocks/palette/python'

/**
 * DOCSTRINGS AND MULTI-LINE STRINGS (W4, #1091, epic #1086).
 * =============================================================================
 *
 * **2,174 raw lines across 48 of 73 projects.** Every docstring in a
 * well-documented program was a grey block, which is most of why a class-heavy
 * file opened as a wall.
 *
 * Cheaper than it looked: `python-tokens.ts` has always folded a triple-quoted
 * literal into ONE logical line and kept its line count honest, so a thirty-line
 * module header arrives as a single unrecognised statement rather than thirty of
 * them. What was missing was a recogniser for a bare string expression and a
 * block that renders several lines without collapsing them.
 *
 * THE PROPERTY THAT MATTERS HERE IS BYTE-FOR-BYTE. Prose is the one thing in a
 * file whose exact spacing IS its content — an indented example, a blank line
 * between paragraphs, the quote style somebody chose. So the block keeps the
 * characters rather than parsing them, exactly as the comment block does.
 */

beforeEach(() => {
  resetBlockRegistry()
  installCorePalette()
  installBlockDefinitions()
})

function regenerate(source: string): string {
  const { workspace } = pythonToBlocks(source)
  const ws = new Blockly.Workspace()
  Blockly.serialization.workspaces.load(workspace as never, ws)
  return generateProgram(ws).code
}

function roundTrips(source: string): void {
  expect(regenerate(source)).toBe(source)
}

function types(source: string): string[] {
  const { workspace } = pythonToBlocks(source)
  const out: string[] = []
  const walk = (block: Record<string, unknown> | undefined): void => {
    if (!block) return
    out.push(block.type as string)
    for (const input of Object.values((block.inputs ?? {}) as Record<string, unknown>)) {
      walk((input as { block?: Record<string, unknown> }).block)
    }
    walk((block.next as { block?: Record<string, unknown> } | undefined)?.block)
  }
  const roots = (workspace as { blocks?: { blocks?: Record<string, unknown>[] } }).blocks?.blocks
  for (const block of roots ?? []) walk(block)
  return out
}

describe('a description standing on its own', () => {
  it('reads a module docstring as a block', () => {
    const src = '"""What this program does."""\n\nprint(1)\n'
    expect(types(src)).toContain(PYTHON_DOCSTRING)
    roundTrips(src)
  })

  it('reads a multi-line one, blank lines and all', () => {
    const src = [
      '"""Small helpers shared by the workshop programs.',
      '',
      'Nothing in here touches the hardware; it is all arithmetic.',
      '"""',
      '',
      'RAW_MIN = 300',
      ''
    ].join('\n')
    expect(types(src)).toContain(PYTHON_DOCSTRING)
    roundTrips(src)
  })

  it('gives an indented one its body indent back, not twice', () => {
    // `logicalLines` strips the indent from the FIRST physical line only, and
    // the generator re-indents whatever the block emits by the depth it sits
    // at — so handing the lines back as they arrived would indent them twice.
    const src = [
      'class Thing:',
      '    """A thing.',
      '',
      '    It does things, some of them',
      '        indented like this.',
      '    """',
      '',
      '    def go(self):',
      '        print(1)',
      ''
    ].join('\n')
    expect(types(src)).toContain(PYTHON_DOCSTRING)
    roundTrips(src)
  })

  it('keeps the quote style somebody chose', () => {
    const src = ["def go():", "    '''Old-style quotes stay as they are.'''", '    print(1)', ''].join('\n')
    expect(types(src)).toContain(PYTHON_DOCSTRING)
    roundTrips(src)
  })

  it('counts as recognised, so the coverage number can see it', () => {
    const { report } = pythonToBlocks('"""A module."""\n')
    expect(report.raw).toBe(0)
    expect(report.recognised).toBe(1)
  })
})

describe('what it must not take', () => {
  it('a `def`’s leading docstring is still the block’s bubble', () => {
    // One idea in two notations. `definition()` has already taken it before this
    // recogniser is reached, so there is no second home for it.
    const src = ['def distance():', '    """Returns the distance."""', '    return 1', ''].join('\n')
    expect(types(src)).not.toContain(PYTHON_DOCSTRING)
    expect(types(src)).toContain('procedures_defreturn')
    roundTrips(src)
  })

  it('a triple-quoted string used as a VALUE is unaffected', () => {
    // And it regenerates verbatim, which it did not before: the expression
    // reader was happy to take `"""hello"""` as the text `""hello""` and the
    // generator quoted that again, so `banner = """hello"""` came back
    // `banner = '""hello""'` — a rewrite the round-trip gate forgives, because
    // a string is a placeholder in a line signature.
    const src = 'banner = """hello"""\n'
    expect(types(src)).not.toContain(PYTHON_DOCSTRING)
    expect(types(src)).toContain('variables_set')
    roundTrips(src)
    roundTrips('banner = """two\nlines"""\n')
  })

  it('a string with something after it is not a description', () => {
    // Asked of the tokenizer, not of a regex: this starts and ends with the
    // right quotes and is an expression.
    const src = '"""a""" + x\n'
    expect(types(src)).not.toContain(PYTHON_DOCSTRING)
    roundTrips(src)
  })

  it('a plain single-quoted string on its own IS one', () => {
    // A bare string expression is a bare string expression whatever quotes it
    // wears; Python treats a single-quoted one at the top of a module as the
    // docstring too.
    expect(types("'just a note'\n")).toContain(PYTHON_DOCSTRING)
    roundTrips("'just a note'\n")
  })
})
