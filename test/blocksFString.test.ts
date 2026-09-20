import { describe, it, expect, beforeEach } from 'vitest'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import { generateProgram } from '../src/renderer/src/lib/blocks/generator'
import { installBlockDefinitions, resetBlockRegistry } from '../src/renderer/src/lib/blocks/registry'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import { pythonToBlocks } from '../src/renderer/src/lib/blocks/python-to-blocks'
import { countHoles, readFString, renderFString, templateHoles } from '../src/renderer/src/lib/blocks/fstring'

/**
 * `print` THAT UNDERSTANDS AN f-STRING.
 * =============================================================================
 *
 * `print(f"ping.distance {ping.distance()}")` is the line every sensor program
 * has in its loop, and it used to open as a grey block. The template block holds
 * the f-string as its TEXT with a `{}` per value, and grows a socket per hole.
 */

describe('a template and its holes', () => {
  it('counts a hole per {} and keeps a spec with its hole', () => {
    expect(templateHoles('ping.distance {}')).toEqual([{ start: 14, end: 16, inner: '' }])
    expect(countHoles('{} and {:.1f} and {!r:>10}')).toBe(3)
  })

  it('a doubled brace is a literal, not a hole', () => {
    expect(countHoles('a {{literal}} {}')).toBe(1)
  })

  it('a nested format is not a hole this block can hold', () => {
    expect(countHoles('{:{width}}')).toBe(0)
  })

  it('renders the f-string, dropping an empty hole rather than writing {}', () => {
    expect(renderFString('ping.distance {}', ['ping.distance()'])).toBe(
      'f"ping.distance {ping.distance()}"'
    )
    expect(renderFString('{:.1f} cm', ['d'])).toBe('f"{d:.1f} cm"')
    expect(renderFString('value is {}', [''])).toBe('f"value is "')
  })

  it('escapes what a child can type that would end the line', () => {
    expect(renderFString('say "hi" {}', ['x'])).toBe('f"say \\"hi\\" {x}"')
    expect(renderFString('a\\b\n', [])).toBe('f"a\\\\b\\n"')
  })
})

describe('reading an f-string apart', () => {
  it('lifts each expression out and leaves its spec in the template', () => {
    expect(readFString('f"ping.distance {ping.distance()}"')).toEqual({
      template: 'ping.distance {}',
      exprs: ['ping.distance()']
    })
    expect(readFString('f"a {{literal}} {d[\'k\']!r:>10} {x:.1f}"')).toEqual({
      template: "a {{literal}} {!r:>10} {:.1f}",
      exprs: ["d['k']", 'x']
    })
  })

  it('keeps brackets and quotes inside an expression whole', () => {
    expect(readFString('f"{f(a, {1: 2}[1])} {s[\':\']}"')?.exprs).toEqual(['f(a, {1: 2}[1])', "s[':']"])
    expect(readFString('f"{a != b}"')?.exprs).toEqual(['a != b'])
  })

  it('declines what the block would regenerate differently', () => {
    expect(readFString("f'single {x}'")).toBeNull() // the block writes double quotes
    expect(readFString('f"{x=}"')).toBeNull() // a debug field
    expect(readFString('f"tab\\t{x}"')).toBeNull() // an escape
    expect(readFString('f"{}"')).toBeNull() // an empty hole
    expect(readFString('f"{x:{w}}"')).toBeNull() // a nested spec
    expect(readFString('f"{d["k"]}"')).toBeNull() // a quote the outer string reuses
    expect(readFString('f"oops }"')).toBeNull() // an unbalanced brace
  })
})

describe('the blocks, end to end', () => {
  beforeEach(() => {
    resetBlockRegistry()
    installCorePalette()
    installBlockDefinitions()
  })

  function convert(source: string): { code: string; first: Record<string, unknown> } {
    const { workspace } = pythonToBlocks(source)
    const ws = new Blockly.Workspace()
    Blockly.serialization.workspaces.load(workspace as never, ws)
    const first = (workspace as { blocks: { blocks: Record<string, unknown>[] } }).blocks.blocks[0]
    return { code: generateProgram(ws).code, first }
  }

  it('print(f"…") is the print-format block, and round-trips exactly', () => {
    const src = 'print(f"ping.distance {ping.distance()}")\n'
    const { code, first } = convert(src)
    expect(first.type).toBe('snakie_print_format')
    expect(first.fields).toEqual({ TEMPLATE: 'ping.distance {}' })
    expect(first.extraState).toEqual({ items: 1 })
    expect(code).toBe(src)
  })

  it('an f-string anywhere else is the value block', () => {
    const src = 'oled.text(f"temp: {t:.1f} C", 0, 0)\n'
    const { code, first } = convert(src)
    const arg = (first.inputs as Record<string, { block: Record<string, unknown> }>).ARG0.block
    expect(arg.type).toBe('snakie_fstring')
    expect(arg.fields).toEqual({ TEMPLATE: 'temp: {:.1f} C' })
    expect(code).toBe(src)
  })

  it('leaves the one f-string the format blocks write to them', () => {
    const { first } = convert('print(f"{t:.1f}")\n')
    expect(first.type).toBe('text_print')
    const inner = (first.inputs as Record<string, { block: Record<string, unknown> }>).TEXT.block
    expect(inner.type).toBe('snakie_format_places')
  })

  it('a value the reader cannot make sense of sits grey in its socket, and the line still regenerates', () => {
    const src = 'print(f"{x if x else y} done")\n'
    const { code, first } = convert(src)
    expect(first.type).toBe('snakie_print_format')
    expect(code).toBe(src)
  })

  it('folds a format block plugged into a hole rather than nesting an f-string', () => {
    const ws = new Blockly.Workspace()
    Blockly.serialization.workspaces.load(
      {
        blocks: {
          languageVersion: 0,
          blocks: [
            {
              type: 'snakie_print_format',
              fields: { TEMPLATE: 'temp {} and {}' },
              extraState: { items: 2 },
              inputs: {
                ADD0: {
                  block: {
                    type: 'snakie_format_places',
                    fields: { PLACES: 2 },
                    inputs: { VALUE: { block: { type: 'math_number', fields: { NUM: 7 } } } }
                  }
                },
                ADD1: {
                  block: {
                    type: 'snakie_fstring',
                    fields: { TEMPLATE: 'inner {}' },
                    extraState: { items: 1 },
                    inputs: { ADD0: { block: { type: 'math_number', fields: { NUM: 1 } } } }
                  }
                }
              }
            }
          ]
        }
      } as never,
      ws
    )
    expect(generateProgram(ws).code).toBe(`print(f"temp {7:.2f} and {f'inner {1}'}")\n`)
  })

  it('the sockets follow the template as it is typed', () => {
    const ws = new Blockly.Workspace()
    const block = ws.newBlock('snakie_fstring')
    expect(block.getInput('ADD0')).not.toBeNull()
    expect(block.getInput('ADD1')).toBeNull()
    block.setFieldValue('{} of {} {{}}', 'TEMPLATE')
    expect(block.getInput('ADD1')).not.toBeNull()
    expect(block.getInput('ADD2')).toBeNull()
    block.setFieldValue('none', 'TEMPLATE')
    expect(block.getInput('ADD0')).toBeNull()
  })

  it('taking a hole out unplugs its block rather than losing it', () => {
    const ws = new Blockly.Workspace()
    const block = ws.newBlock('snakie_fstring')
    const num = ws.newBlock('math_number')
    block.getInput('ADD0')!.connection!.connect(num.outputConnection!)
    block.setFieldValue('no holes', 'TEMPLATE')
    expect(num.isDisposed()).toBe(false)
    expect(ws.getTopBlocks(false)).toContain(num)
  })
})
