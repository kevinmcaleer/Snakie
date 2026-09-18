import { describe, it, expect, beforeEach } from 'vitest'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import { generateProgram } from '../src/renderer/src/lib/blocks/generator'
import { installBlockDefinitions, resetBlockRegistry } from '../src/renderer/src/lib/blocks/registry'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import { pythonToBlocks } from '../src/renderer/src/lib/blocks/python-to-blocks'
import { commentDocstring, docstringComment } from '../src/renderer/src/lib/blocks/docstring'

/**
 * A DOCSTRING IS THE FUNCTION BLOCK'S DESCRIPTION.
 * =============================================================================
 *
 * Blockly's comment bubble and a Python docstring say the same thing about the
 * same function, so they are one thing in two notations. Type the docstring in
 * the code pane and the bubble fills in; write the bubble and the docstring
 * appears.
 *
 * THE PROPERTY THAT MATTERS is not "a docstring becomes a bubble" — it is that
 * moving a line out of the program and into a block's metadata never changes
 * the program. So every case here checks the round trip as well, and the ones
 * that CANNOT survive it are tested for staying exactly as they were.
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

/** The description the first converted block carries, if any. */
function description(source: string): string | undefined {
  const { workspace } = pythonToBlocks(source)
  const blocks = (workspace as never as { blocks: { blocks: Record<string, unknown>[] } }).blocks.blocks
  return (blocks[0]?.icons as { comment?: { text?: string } } | undefined)?.comment?.text
}

/** The block types the conversion produced, flattened. */
function types(source: string): string[] {
  const { workspace } = pythonToBlocks(source)
  const out: string[] = []
  const walk = (b: Record<string, unknown> | undefined): void => {
    if (!b) return
    out.push(b.type as string)
    for (const i of Object.values((b.inputs ?? {}) as Record<string, { block?: never }>)) {
      walk((i as { block?: never }).block)
    }
    walk((b.next as { block?: never } | undefined)?.block)
  }
  for (const b of (workspace as never as { blocks: { blocks: Record<string, unknown>[] } }).blocks.blocks) walk(b)
  return out
}

describe('a docstring becomes the description', () => {
  it('on one line', () => {
    const src = 'def distance():\n    """Returns the distance."""\n    return 1\n'
    expect(description(src)).toBe('Returns the distance.')
    expect(regenerate(src)).toBe(src)
  })

  it('and over several, in the shape PEP 257 asks for', () => {
    const src = [
      'def distance():',
      '    """Returns the distance.',
      '',
      '    In centimetres.',
      '    """',
      '    return 1',
      ''
    ].join('\n')
    expect(description(src)).toBe('Returns the distance.\n\nIn centimetres.')
    expect(regenerate(src)).toBe(src)
  })

  it('on a function that returns nothing', () => {
    const src = 'def go():\n    """Drive forwards."""\n    print(1)\n'
    expect(description(src)).toBe('Drive forwards.')
    expect(regenerate(src)).toBe(src)
  })

  it('and it leaves the body, rather than sitting at the top of it as a raw block', () => {
    // The whole point: before this the docstring came back as a raw Python
    // block — a true rendering of the line and a poor rendering of what it is
    // for.
    const src = 'def go():\n    """Drive forwards."""\n    print(1)\n'
    expect(types(src)).not.toContain('snakie_python_statement')
  })

  it('even when it is the whole body — a docstring IS a statement', () => {
    const src = 'def go():\n    """Drive forwards."""\n'
    expect(description(src)).toBe('Drive forwards.')
    // No `pass` filler: the docstring is already a legal function body.
    expect(regenerate(src)).toBe(src)
  })
})

describe('a description becomes a docstring', () => {
  const withComment = (text: string): string => {
    const ws = new Blockly.Workspace()
    Blockly.serialization.workspaces.load(
      {
        blocks: {
          languageVersion: 0,
          blocks: [
            {
              type: 'procedures_defnoreturn',
              id: 'd',
              fields: { NAME: 'go' },
              icons: { comment: { text, pinned: false, height: 80, width: 160 } }
            }
          ]
        }
      } as never,
      ws
    )
    return generateProgram(ws).code
  }

  it('written on the first line when it is one line', () => {
    expect(withComment('Drive forwards.')).toBe('def go():\n    """Drive forwards."""\n')
  })

  it('and with the closing quotes on their own when it is more', () => {
    expect(withComment('Drive forwards.\n\nUntil told to stop.')).toBe(
      'def go():\n    """Drive forwards.\n\n    Until told to stop.\n    """\n'
    )
  })

  it('and an empty bubble writes nothing at all', () => {
    expect(withComment('   ')).toBe('def go():\n    pass\n')
  })
})

describe('what stays exactly as it was', () => {
  // Moving a line out of the program and into metadata is the most dangerous
  // thing a decompiler does. `docstring.ts` re-renders what it read and refuses
  // anything that does not come back character for character, so none of these
  // becomes the block's DESCRIPTION — the line stays in the program, where it
  // was, and regenerates exactly.
  //
  // What it stays AS moved in W4 (#1091): a lone string statement is now the
  // docstring block rather than a grey raw one. That is a rendering change and
  // not a semantic one — the line is still a line of the program, still in the
  // same place, still character for character what was typed.
  const staysInPlace = (src: string, as: string): void => {
    expect(description(src)).toBeUndefined()
    expect(types(src)).toContain(as)
    expect(regenerate(src)).toBe(src)
  }

  it("a `'''` docstring, which this generator does not write", () =>
    staysInPlace("def go():\n    '''Drive forwards.'''\n    print(1)\n", 'snakie_python_docstring'))

  it('a string that is only the start of an expression', () =>
    staysInPlace('def go():\n    """a""" + "b"\n    print(1)\n', 'snakie_python_statement'))

  it('a string statement that is not the first line', () =>
    staysInPlace('def go():\n    print(1)\n    """later"""\n', 'snakie_python_docstring'))

  it('and a function with no docstring is untouched', () => {
    const src = 'def go():\n    print(1)\n'
    expect(description(src)).toBeUndefined()
    expect(regenerate(src)).toBe(src)
  })
})

describe('the formatter, on its own', () => {
  it('is its own inverse for everything it accepts', () => {
    for (const comment of [
      'One line.',
      'Two\nlines.',
      'A summary.\n\nAnd a paragraph under it.',
      'Trailing blanks are trimmed.'
    ]) {
      const line = commentDocstring(comment)
      expect(line, comment).not.toBeNull()
      expect(docstringComment(line as string), comment).toBe(comment)
    }
  })

  it('declines a comment it could not quote safely', () => {
    // The quotes that would close the docstring, and a backslash that would
    // escape them. The bubble keeps the text; the Python simply has none.
    expect(commentDocstring('He said """hello""".')).toBeNull()
    expect(commentDocstring('Ends with a backslash \\')).toBeNull()
    expect(commentDocstring('')).toBeNull()
    expect(commentDocstring(null)).toBeNull()
  })

  it('and declines a line that is not a docstring it wrote', () => {
    expect(docstringComment('x = 1')).toBeNull()
    expect(docstringComment("'''single'''")).toBeNull()
    expect(docstringComment('""""""')).toBeNull()
    // Two-space continuation: this generator writes four, so it could not be
    // put back as it was found.
    expect(docstringComment('"""Summary.\n\n  Detail.\n  """')).toBeNull()
  })
})
