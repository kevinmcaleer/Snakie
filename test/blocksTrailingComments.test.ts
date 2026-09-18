import { describe, it, expect, beforeEach } from 'vitest'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import { generateProgram } from '../src/renderer/src/lib/blocks/generator'
import { installBlockDefinitions, resetBlockRegistry } from '../src/renderer/src/lib/blocks/registry'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import { pythonToBlocks } from '../src/renderer/src/lib/blocks/python-to-blocks'

/**
 * A STATEMENT WITH A NOTE ON THE END (W5, #1092, epic #1086).
 * =============================================================================
 *
 * **1,532 raw lines across 55 of 73 projects** — grey for nothing but having a
 * comment on the end of them. `x = 5  # how many times` is one of the commonest
 * shapes in teaching code.
 *
 * #1068 made the reader refuse such a line outright, and that was the right call
 * at the time: `tokenize` stops at the `#`, so every recogniser matched the code
 * and silently dropped the rest, and no block held both halves. Recognising it
 * would have meant choosing which half to keep.
 *
 * A block DOES hold both. Blockly's comment bubble is a field every block
 * already has — the `def` block has carried a docstring in it since #1007 — and
 * it serialises with the block, so **nothing about the file format changes**.
 * The reader hangs the note there and the generator writes it back onto the end
 * of the block's first line.
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

describe('the note rides on the block', () => {
  it('on an assignment', () => {
    expect(types('x = 5  # how many times\n')).toContain('variables_set')
    roundTrips('x = 5  # how many times\n')
  })

  it('on a call the rules know', () => {
    const src = ['import time', '', 'time.sleep(1)  # pause', ''].join('\n')
    expect(types(src)).toContain('snakie_wait_seconds')
    roundTrips(src)
  })

  it('on a method call on an object', () => {
    expect(types('display.show()  # push it to the screen\n')).toContain('snakie_python_call')
    roundTrips('display.show()  # push it to the screen\n')
  })

  it('on a suite header, and not on its body', () => {
    const src = ['if x:  # check first', '    print(1)', ''].join('\n')
    expect(types(src)).toContain('controls_if')
    roundTrips(src)
  })

  it('on several lines of the same program at once', () => {
    const src = [
      'import time',
      '',
      'x = 5  # how many times',
      '',
      'while True:  # forever',
      '    time.sleep(1)  # a second',
      '    if x:  # check',
      '        print(x)  # say it',
      ''
    ].join('\n')
    expect(types(src)).not.toContain('snakie_python_statement')
    roundTrips(src)
  })

  it('counts as recognised, which is the whole 1,532 lines', () => {
    const { report } = pythonToBlocks('x = 5  # how many\n')
    expect(report.raw).toBe(0)
    expect(report.recognised).toBe(1)
  })

  it('survives a terminal block being demoted (#1068)', () => {
    // `while True:` has no next connection, so a chain under it is demoted to a
    // raw suite. The note has to come with it, or a comment the learner wrote is
    // dropped — and the round-trip gate would then refuse the whole file's
    // conversion rather than this one line.
    const src = ['while True:  # forever', '    break  # done', 'print(1)', ''].join('\n')
    roundTrips(src)
  })
})

describe('the lines that still keep both halves raw', () => {
  it('a code half that is not a block', () => {
    expect(types('assert ok  # really\n')).toEqual(['snakie_python_statement'])
    roundTrips('assert ok  # really\n')
  })

  it('an import, because the block is hoisted away from its line', () => {
    expect(types('import time  # for the delays\n')).toEqual(['snakie_python_statement'])
    roundTrips('import time  # for the delays\n')
  })

  it('a `from x import a, b`, which is two blocks and one note', () => {
    expect(types('from machine import Pin, PWM  # both\n')).toEqual(['snakie_python_statement'])
    roundTrips('from machine import Pin, PWM  # both\n')
  })

  it('a `def`, whose bubble is already the docstring', () => {
    const src = ['def go():  # the main loop', '    print(1)', ''].join('\n')
    expect(types(src)).toContain('snakie_python_suite')
    roundTrips(src)
  })

  it('a `name pin`, which is lifted into the setup section', () => {
    const src = ['from machine import Pin', '', 'echo = Pin(0, Pin.IN)  # the sensor', ''].join('\n')
    expect(types(src)).not.toContain('snakie_name_pin')
    roundTrips(src)
  })

  it('a hash inside a string is not a comment at all', () => {
    expect(types("print('# not a comment')\n")).toContain('text_print')
    roundTrips("print('# not a comment')\n")
  })

  it('a line that is nothing but a comment is still the comment block', () => {
    expect(types('# just a note\nx = 1\n')).toContain('snakie_python_comment')
    roundTrips('# just a note\nx = 1\n')
  })
})

describe('the generator half, on its own', () => {
  it('writes a bubble somebody typed as a comment, adding the hash', () => {
    // A bubble is free text, and `  fix this later` is not Python. A round trip
    // never goes through this branch — the reader stores the comment verbatim,
    // `#` and all — but a learner typing into the bubble does.
    const ws = new Blockly.Workspace()
    Blockly.serialization.workspaces.load(
      {
        blocks: {
          languageVersion: 0,
          blocks: [
            {
              type: 'text_print',
              icons: { comment: { text: 'fix this later', pinned: false, height: 40, width: 220 } },
              inputs: { TEXT: { block: { type: 'text', fields: { TEXT: 'hi' } } } }
            }
          ]
        }
      } as never,
      ws
    )
    expect(generateProgram(ws).code).toBe("print('hi')  # fix this later\n")
  })

  it('leaves a multi-line bubble as a bubble', () => {
    // A paragraph somebody wrote about a block is a description, and folding it
    // onto the end of a line of code would change what they wrote.
    const ws = new Blockly.Workspace()
    Blockly.serialization.workspaces.load(
      {
        blocks: {
          languageVersion: 0,
          blocks: [
            {
              type: 'text_print',
              icons: { comment: { text: 'two\nlines', pinned: false, height: 40, width: 220 } },
              inputs: { TEXT: { block: { type: 'text', fields: { TEXT: 'hi' } } } }
            }
          ]
        }
      } as never,
      ws
    )
    expect(generateProgram(ws).code).toBe("print('hi')\n")
  })
})
