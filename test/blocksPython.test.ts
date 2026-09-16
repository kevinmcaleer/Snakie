import { describe, it, expect, beforeEach } from 'vitest'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import { generateProgram } from '../src/renderer/src/lib/blocks/generator'
import { installBlockDefinitions, resetBlockRegistry } from '../src/renderer/src/lib/blocks/registry'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import { pythonProblems } from '../src/renderer/src/lib/blocks/python-warnings'
import { ImportManager } from '../src/renderer/src/lib/blocks/imports'
import { loadCourses } from '../src/renderer/src/lib/courses'

/**
 * THE ESCAPE HATCHES, ALL THE WAY TO MICROPYTHON (#1018, epic #1007).
 * =============================================================================
 *
 * A golden-file suite, like #1010's: a block workspace in, exact MicroPython
 * out. These blocks put a learner's own text into their program, so "roughly
 * right" is not a standard any of them can be held to — the generated line is
 * either the line they typed or it is a bug in the one part of the palette that
 * exists to be trustworthy.
 *
 * The two properties worth stating before the tests say them:
 *
 *  - an import BLOCK and a palette block that needs the same module produce ONE
 *    import line between them, in the right section. That is the whole reason
 *    the import is a block rather than a raw statement saying `import machine`;
 *  - a raw VALUE is parenthesised wherever it is nested, because we cannot know
 *    what the learner's expression binds tighter than, and a missing bracket
 *    there is a wrong answer rather than an untidy one.
 */

/** Build a workspace from serialised JSON and generate it. */
function gen(state: Record<string, unknown>): ReturnType<typeof generateProgram> {
  const ws = new Blockly.Workspace()
  Blockly.serialization.workspaces.load(state, ws)
  return generateProgram(ws)
}

/** A raw-Python statement block holding `code`. */
const stmt = (code: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: 'snakie_python_statement',
  fields: { CODE: code },
  ...extra
})

/** A raw-Python value block holding `code`. */
const value = (code: string): Record<string, unknown> => ({
  type: 'snakie_python_value',
  fields: { CODE: code }
})

beforeEach(() => {
  resetBlockRegistry()
  installCorePalette()
  // Registration and DEFINITION have different lifetimes (see `registry.ts`):
  // the canvas does this at inject time, and a headless workspace has to do it
  // itself before it can hold one of these blocks.
  installBlockDefinitions()
})

describe('the raw Python blocks', () => {
  it('writes a statement verbatim', () => {
    const out = gen({ blocks: { blocks: [stmt('oled.fill(0)')] } })
    expect(out.code).toBe('oled.fill(0)\n')
  })

  it('stacks, one line per block', () => {
    const out = gen({
      blocks: {
        blocks: [stmt('oled.fill(0)', { next: { block: stmt('oled.show()') } })]
      }
    })
    expect(out.code).toBe('oled.fill(0)\noled.show()\n')
  })

  it('generates NOTHING for an empty block, not a blank line', () => {
    // A block somebody dragged out and has not filled in must not put a gap in
    // the middle of their program.
    const out = gen({
      blocks: { blocks: [stmt('a()', { next: { block: stmt('', { next: { block: stmt('b()') } }) } })] }
    })
    expect(out.code).toBe('a()\nb()\n')
  })

  it('plugs a raw value into a generated call', () => {
    const out = gen({
      blocks: {
        blocks: [
          {
            type: 'text_print',
            inputs: { TEXT: { block: value('sensor.read_temperature()') } }
          }
        ]
      }
    })
    expect(out.code).toBe('print(sensor.read_temperature())\n')
  })

  it('parenthesises a raw value wherever it is nested', () => {
    // We have no idea what the learner's expression binds tighter than, and
    // `1 + 2 * 3` is a different number from `(1 + 2) * 3`.
    const out = gen({
      blocks: {
        blocks: [
          {
            type: 'text_print',
            inputs: {
              TEXT: {
                block: {
                  type: 'math_arithmetic',
                  fields: { OP: 'MULTIPLY' },
                  inputs: {
                    A: { block: value('1 + 2') },
                    B: { block: { type: 'math_number', fields: { NUM: 3 } } }
                  }
                }
              }
            }
          }
        ]
      }
    })
    expect(out.code).toBe('print((1 + 2) * 3)\n')
  })

  it('gives an empty value socket `None` rather than a hole', () => {
    const out = gen({
      blocks: { blocks: [{ type: 'text_print', inputs: { TEXT: { block: value('') } } }] }
    })
    expect(out.code).toBe('print(None)\n')
  })

  it('owns exactly its own line in the source map (#1016)', () => {
    const out = gen({
      blocks: { blocks: [stmt('a()', { id: 'one', next: { block: stmt('b()', { id: 'two' }) } })] }
    })
    expect(out.blockLines.get('one')).toEqual([1])
    expect(out.blockLines.get('two')).toEqual([2])
  })
})

describe('the import blocks', () => {
  it('writes each form', () => {
    const out = gen({
      blocks: {
        blocks: [
          {
            type: 'snakie_python_import',
            fields: { MODULE: 'machine' },
            next: {
              block: {
                type: 'snakie_python_import_as',
                fields: { MODULE: 'instruments', ALIAS: 'inst' },
                next: {
                  block: {
                    type: 'snakie_python_from_import',
                    fields: { MODULE: 'machine', NAME: 'Pin' },
                    next: { block: stmt('go()') }
                  }
                }
              }
            }
          }
        ]
      }
    })
    // `machine` before the Snakie libraries, plain imports before from-imports,
    // and BOTH forms of `machine` — a learner who asked for each gets each.
    expect(out.code).toBe(
      [
        'import machine',
        'from machine import Pin',
        '',
        'import instruments as inst',
        '',
        'go()',
        ''
      ].join('\n')
    )
  })

  it('merges with an import a palette block already needed', () => {
    // THE reason this is a block rather than a raw `import machine` statement:
    // one import line between them, in the right section, sorted with the rest.
    const out = gen({
      blocks: {
        blocks: [
          {
            type: 'snakie_python_from_import',
            fields: { MODULE: 'snakie', NAME: 'Pin' },
            next: { block: { type: 'snakie_pin_write', fields: { PIN: '15', STATE: 'HIGH' } } }
          }
        ]
      }
    })
    // One `from snakie import Pin`, not two.
    expect(out.code.match(/from snakie import/g)).toHaveLength(1)
    expect(out.code).toContain('from snakie import Pin')
  })

  it('generates nothing where it stands, and an empty module is ignored', () => {
    const out = gen({
      blocks: { blocks: [{ type: 'snakie_python_import', fields: { MODULE: '  ' } }] }
    })
    expect(out.code).toBe('')
  })

  it('links the import line back to the block that asked (#1016)', () => {
    // A block that generates nothing where it stands has one visible effect —
    // the line at the top — so hovering it has to light that line up, or it
    // looks like a block that did nothing at all.
    const out = gen({
      blocks: {
        blocks: [
          {
            type: 'snakie_python_import',
            id: 'imp',
            fields: { MODULE: 'machine' },
            next: { block: stmt('go()', { id: 'go' }) }
          }
        ]
      }
    })
    expect(out.code).toBe('import machine\n\ngo()\n')
    expect(out.blockLines.get('imp')).toEqual([1])
    expect(out.sourceMap.get(1)).toBe('imp')
    expect(out.blockLines.get('go')).toEqual([3])
  })

  it('leaves a palette block′s own imports unattributed', () => {
    // A hardware block's import is a consequence of what it generates, not
    // something the learner wrote; highlighting it on hover would point at a
    // line nobody chose.
    const out = gen({
      blocks: {
        blocks: [{ type: 'snakie_pin_write', id: 'pin', fields: { PIN: '15', STATE: 'HIGH' } }]
      }
    })
    expect(out.code).toContain('from snakie import Pin')
    expect(out.sourceMap.get(1)).toBeUndefined()
  })
})

describe('ImportManager attribution', () => {
  it('renders plain when no marker is supplied', () => {
    const m = new ImportManager()
    m.need({ module: 'machine', name: 'Pin' }, 'b1')
    expect(m.render()).toBe('from machine import Pin')
  })

  it('hands the marker the claiming block, and undefined for the rest', () => {
    const m = new ImportManager()
    m.need({ module: 'machine', name: 'Pin' }, 'b1')
    m.need({ module: 'time' })
    expect(m.render((line, id) => `[${id ?? '-'}]${line}`)).toBe(
      ['[-]import time', '', '[b1]from machine import Pin'].join('\n')
    )
  })

  it('keeps the FIRST claimant of a line two blocks both asked for', () => {
    const m = new ImportManager()
    m.need({ module: 'machine', name: 'Pin' }, 'first')
    m.need({ module: 'machine', name: 'I2C' }, 'second')
    expect(m.render((line, id) => `[${id}]${line}`)).toBe('[first]from machine import I2C, Pin')
  })
})

describe('the call and attribute blocks', () => {
  const call = (
    method: string,
    obj: Record<string, unknown>,
    args: Record<string, unknown>[] = [],
    type = 'snakie_python_call'
  ): Record<string, unknown> => ({
    type,
    extraState: { args: args.length },
    fields: { METHOD: method },
    inputs: {
      OBJ: { block: obj },
      ...Object.fromEntries(args.map((a, i) => [`ARG${i}`, { block: a }]))
    }
  })

  it('calls a method on any object at all', () => {
    const out = gen({
      blocks: {
        blocks: [call('set_speed', value('motor'), [{ type: 'math_number', fields: { NUM: 120 } }])]
      }
    })
    expect(out.code).toBe('motor.set_speed(120)\n')
  })

  it('writes no arguments when there are none', () => {
    const out = gen({ blocks: { blocks: [call('show', value('oled'))] } })
    expect(out.code).toBe('oled.show()\n')
  })

  it('skips an empty socket rather than passing None', () => {
    // A learner who pressed `+` once too often should get `sensor.read()`, not
    // a TypeError about an argument they cannot see.
    const out = gen({
      blocks: { blocks: [{ ...call('read', value('sensor')), extraState: { args: 2 } }] }
    })
    expect(out.code).toBe('sensor.read()\n')
  })

  it('separates several arguments with commas', () => {
    const out = gen({
      blocks: {
        blocks: [
          call('text', value('oled'), [
            { type: 'text', fields: { TEXT: 'hi' } },
            { type: 'math_number', fields: { NUM: 0 } },
            { type: 'math_number', fields: { NUM: 8 } }
          ])
        ]
      }
    })
    expect(out.code).toBe("oled.text('hi', 0, 8)\n")
  })

  it('has a value shape for a method that gives something back', () => {
    const out = gen({
      blocks: {
        blocks: [
          {
            type: 'text_print',
            inputs: {
              TEXT: { block: call('range', value('tof'), [], 'snakie_python_call_value') }
            }
          }
        ]
      }
    })
    expect(out.code).toBe('print(tof.range())\n')
  })

  it('parenthesises an object that is itself an expression', () => {
    // `(a or b).read()`, not `a or b.read()`.
    const out = gen({ blocks: { blocks: [call('read', value('a or b'))] } })
    expect(out.code).toBe('(a or b).read()\n')
  })

  it('reads and writes an attribute', () => {
    const out = gen({
      blocks: {
        blocks: [
          {
            type: 'snakie_python_attr_set',
            fields: { NAME: 'brightness' },
            inputs: {
              OBJ: { block: value('led') },
              VALUE: { block: { type: 'math_number', fields: { NUM: 0.5 } } }
            },
            next: {
              block: {
                type: 'text_print',
                inputs: {
                  TEXT: {
                    block: {
                      type: 'snakie_python_attr_get',
                      fields: { NAME: 'value' },
                      inputs: { OBJ: { block: value('sensor') } }
                    }
                  }
                }
              }
            }
          }
        ]
      }
    })
    expect(out.code).toBe('led.brightness = 0.5\nprint(sensor.value)\n')
  })

  it('remembers its argument count across a save and reload', () => {
    const ws = new Blockly.Workspace()
    Blockly.serialization.workspaces.load(
      { blocks: { blocks: [call('go', value('robot'), [{ type: 'math_number', fields: { NUM: 1 } }])] } },
      ws
    )
    const saved = Blockly.serialization.workspaces.save(ws)
    const again = new Blockly.Workspace()
    Blockly.serialization.workspaces.load(saved, again)
    expect(generateProgram(again).code).toBe('robot.go(1)\n')
  })
})

describe('the syntax badge', () => {
  it('flags an unclosed bracket on the block that has it', () => {
    const ws = new Blockly.Workspace()
    Blockly.serialization.workspaces.load(
      { blocks: { blocks: [stmt('sensor.read(', { id: 'bad', next: { block: stmt('go()', { id: 'ok' }) } })] } },
      ws
    )
    const problems = pythonProblems(ws)
    expect(problems.get('bad')).toContain('round bracket (')
    expect(problems.has('ok')).toBe(false)
  })

  it('flags a statement plugged into a value socket', () => {
    const ws = new Blockly.Workspace()
    Blockly.serialization.workspaces.load(
      {
        blocks: {
          blocks: [
            { type: 'text_print', inputs: { TEXT: { block: { ...value('x = 1'), id: 'v' } } } }
          ]
        }
      },
      ws
    )
    expect(pythonProblems(ws).get('v')).toContain('needs a value')
  })

  it('says nothing about a block that is merely empty', () => {
    const ws = new Blockly.Workspace()
    Blockly.serialization.workspaces.load({ blocks: { blocks: [stmt('', { id: 'e' })] } }, ws)
    expect(pythonProblems(ws).size).toBe(0)
  })

  it('generates the broken text anyway', () => {
    // The badge is advice. Refusing to generate would mean the mirror stops
    // matching the canvas, which is the one thing it must never do.
    const out = gen({ blocks: { blocks: [stmt('sensor.read(')] } })
    expect(out.code).toBe('sensor.read(\n')
  })
})

describe('the escape-hatch lesson (#1018)', () => {
  it('teaches the two blocks with a program that actually runs', () => {
    // A lesson is data, so nothing else would notice a starter that stopped
    // generating until a child opened it. This one is also the proof that the
    // import block and the raw value block compose with the rest of the palette.
    const course = loadCourses().find((c) => c.id === 'blocks')!
    const lesson = course.lessons.find((l) => /doesn't exist yet/.test(l.title))
    expect(lesson, 'the blocks course should teach the escape hatches').toBeTruthy()

    const ws = new Blockly.Workspace()
    Blockly.serialization.workspaces.load(lesson!.blocks as never, ws)
    const out = generateProgram(ws)
    expect(out.missing).toEqual([])
    expect(out.code).toBe(
      [
        // One `import time`, from the wait block, and the learner's own
        // `import random` merged in beside it rather than fighting it.
        'import random',
        'import time',
        '',
        'while True:',
        '    print(random.randint(1, 6))',
        '    time.sleep_ms(500)',
        ''
      ].join('\n')
    )
  })

  it('comes before the handover, which stays last', () => {
    // Reaching for raw Python is a step ON THE WAY to graduating, not after it.
    const course = loadCourses().find((c) => c.id === 'blocks')!
    const titles = course.lessons.map((l) => l.title)
    expect(titles[titles.length - 1]).toMatch(/Python/)
    expect(titles.findIndex((t) => /doesn't exist yet/.test(t))).toBe(titles.length - 2)
  })
})
