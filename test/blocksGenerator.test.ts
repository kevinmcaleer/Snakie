import { describe, it, expect, beforeEach } from 'vitest'
import * as Blockly from 'blockly/core'
import {
  generateProgram,
  blocksWithoutEmitters,
  Order,
  type GeneratedProgram
} from '../src/renderer/src/lib/blocks/generator'
import { defineBlocks, resetBlockRegistry } from '../src/renderer/src/lib/blocks/registry'
import { ImportManager, importGroup } from '../src/renderer/src/lib/blocks/imports'
import { isReservedName, sanitise, toPythonIdentifier } from '../src/renderer/src/lib/blocks/names'

/**
 * THE GOLDEN-FILE SUITE (#1010, epic #1007).
 * =============================================================================
 *
 * A block workspace in, exact MicroPython out. The point of spelling the
 * expected program out in full, rather than asserting that it "contains" things,
 * is that a generator regression should be a failing diff a maintainer can read
 * — not a bug report from a ten-year-old whose square came out a triangle.
 *
 * The blocks here are the SUITE'S OWN. The real palettes are #1011–#1014, and
 * testing the generator through them would make every palette change a
 * generator-test change; these exist to exercise one machine each — imports,
 * hoisting, nesting, values, names — and they are deliberately shaped like the
 * real ones so the fixtures stay honest.
 *
 * Blockly runs headless here: a plain `Blockly.Workspace` needs no DOM, which is
 * what lets the generator be tested in plain node like every other pure module
 * in this repo.
 */

/**
 * The Blockly-side definitions. Registered ONCE, at module scope: Blockly's
 * definition table is global and re-registering the same type warns on every
 * test. The EMITTERS are re-registered per test (below), because those are what
 * a test may legitimately want to change.
 */
Blockly.defineBlocksWithJsonArray([
  {
    type: 'test_led_on',
    message0: 'turn on LED %1',
    args0: [{ type: 'field_number', name: 'PIN', value: 15 }],
    previousStatement: null,
    nextStatement: null
  },
  {
    type: 'test_sleep',
    message0: 'wait %1 seconds',
    args0: [{ type: 'input_value', name: 'SECS' }],
    previousStatement: null,
    nextStatement: null
  },
  {
    type: 'test_repeat',
    message0: 'repeat %1 times %2 %3',
    args0: [
      { type: 'field_number', name: 'TIMES', value: 4 },
      { type: 'input_dummy' },
      { type: 'input_statement', name: 'DO' }
    ],
    previousStatement: null,
    nextStatement: null
  },
  {
    type: 'test_forever',
    message0: 'forever %1 %2',
    args0: [{ type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }],
    previousStatement: null,
    nextStatement: null
  },
  {
    type: 'test_number',
    message0: '%1',
    args0: [{ type: 'field_number', name: 'NUM', value: 0 }],
    output: 'Number'
  },
  {
    type: 'test_sum',
    message0: '%1 + %2',
    args0: [
      { type: 'input_value', name: 'A' },
      { type: 'input_value', name: 'B' }
    ],
    output: 'Number'
  },
  {
    type: 'test_set_var',
    message0: 'set %1 to %2',
    args0: [
      { type: 'field_variable', name: 'VAR', variable: 'count' },
      { type: 'input_value', name: 'VALUE' }
    ],
    previousStatement: null,
    nextStatement: null
  },
  {
    type: 'test_print',
    message0: 'say %1',
    args0: [{ type: 'input_value', name: 'WHAT' }],
    previousStatement: null,
    nextStatement: null
  },
  { type: 'test_unknown', message0: 'mystery', previousStatement: null, nextStatement: null }
])

/** Register the suite's emitters. Re-run per test so nothing leaks between them. */
function defineTestBlocks(): void {
  defineBlocks([
    {
      type: 'test_led_on',
      category: 'hardware',
      json: {},
      imports: [{ module: 'snakie', name: 'Led' }],
      code: (block, gen) => {
        const pin = block.getFieldValue('PIN')
        // Hoisted by PIN, so two blocks on the same pin share one object — and
        // two on different pins do not.
        const name = gen.setup(`led:${pin}`, `led_${pin}`, `Led(${pin})`, block)
        return `${name}.on()\n`
      }
    },
    {
      type: 'test_sleep',
      category: 'control',
      json: {},
      imports: [{ module: 'time' }],
      code: (_block, gen) => `time.sleep(${gen.valueToCode(_block, 'SECS', Order.NONE) || '0'})\n`
    },
    {
      type: 'test_repeat',
      category: 'control',
      json: {},
      code: (block, gen) => {
        const body = gen.statementToCode(block, 'DO') || `${gen.INDENT}pass\n`
        return `for _ in range(${block.getFieldValue('TIMES')}):\n${body}`
      }
    },
    {
      type: 'test_forever',
      category: 'control',
      json: {},
      code: (block, gen) => {
        const body = gen.statementToCode(block, 'DO') || `${gen.INDENT}pass\n`
        return `while True:\n${body}`
      }
    },
    {
      type: 'test_number',
      category: 'math',
      json: {},
      code: (block) => [String(block.getFieldValue('NUM')), Order.ATOMIC]
    },
    {
      type: 'test_sum',
      category: 'math',
      json: {},
      code: (block, gen) => [
        `${gen.valueToCode(block, 'A', Order.ADDITIVE) || '0'} + ${
          gen.valueToCode(block, 'B', Order.ADDITIVE) || '0'
        }`,
        Order.ADDITIVE
      ]
    },
    {
      type: 'test_set_var',
      category: 'variables',
      json: {},
      code: (block, gen) => {
        const name = gen.variableName(block.getFieldValue('VAR'))
        return `${name} = ${gen.valueToCode(block, 'VALUE', Order.NONE) || '0'}\n`
      }
    },
    {
      type: 'test_print',
      category: 'text',
      json: {},
      code: (block, gen) => `print(${gen.valueToCode(block, 'WHAT', Order.NONE) || "''"})\n`
    }
  ])
}

/** Build a workspace from serialised JSON and generate it. */
function gen(state: Record<string, unknown>): GeneratedProgram {
  const ws = new Blockly.Workspace()
  Blockly.serialization.workspaces.load(state, ws)
  return generateProgram(ws)
}

/** One statement block with an id, for brevity in the fixtures below. */
const b = (
  type: string,
  id: string,
  extra: Record<string, unknown> = {}
): Record<string, unknown> => ({ type, id, ...extra })

beforeEach(() => {
  resetBlockRegistry()
  defineTestBlocks()
})

describe('golden files — a workspace in, exact MicroPython out (#1010)', () => {
  it('the blink program, imports and setup and body', () => {
    const { code } = gen({
      blocks: {
        languageVersion: 0,
        blocks: [
          b('test_forever', 'forever', {
            inputs: {
              DO: {
                block: b('test_led_on', 'led', {
                  fields: { PIN: 15 },
                  next: {
                    block: b('test_sleep', 'sleep', {
                      inputs: {
                        SECS: { block: b('test_number', 'half', { fields: { NUM: 0.5 } }) }
                      }
                    })
                  }
                })
              }
            }
          })
        ]
      }
    })
    expect(code).toBe(
      [
        'import time',
        '',
        'from snakie import Led',
        '',
        'led_15 = Led(15)',
        '',
        'while True:',
        '    led_15.on()',
        '    time.sleep(0.5)',
        ''
      ].join('\n')
    )
  })

  it('a program with no imports has no blank line where they would have been', () => {
    const { code } = gen({
      blocks: {
        languageVersion: 0,
        blocks: [
          b('test_repeat', 'r', {
            fields: { TIMES: 3 },
            inputs: {
              DO: {
                block: b('test_print', 'p', {
                  inputs: { WHAT: { block: b('test_number', 'n', { fields: { NUM: 7 } }) } }
                })
              }
            }
          })
        ]
      }
    })
    expect(code).toBe(['for _ in range(3):', '    print(7)', ''].join('\n'))
  })

  it('an empty workspace generates an empty program, not a blank line', () => {
    expect(gen({ blocks: { languageVersion: 0, blocks: [] } }).code).toBe('')
  })

  it('nests two levels without losing the indent', () => {
    const { code } = gen({
      blocks: {
        languageVersion: 0,
        blocks: [
          b('test_forever', 'f', {
            inputs: {
              DO: {
                block: b('test_repeat', 'r', {
                  fields: { TIMES: 2 },
                  inputs: { DO: { block: b('test_led_on', 'l', { fields: { PIN: 2 } }) } }
                })
              }
            }
          })
        ]
      }
    })
    expect(code).toBe(
      [
        'from snakie import Led',
        '',
        'led_2 = Led(2)',
        '',
        'while True:',
        '    for _ in range(2):',
        '        led_2.on()',
        ''
      ].join('\n')
    )
  })

  it('an empty loop body becomes `pass`, not a syntax error', () => {
    const { code } = gen({
      blocks: { languageVersion: 0, blocks: [b('test_repeat', 'r', { fields: { TIMES: 2 } })] }
    })
    expect(code).toBe(['for _ in range(2):', '    pass', ''].join('\n'))
  })

  it('two top-level stacks both make it out, in canvas order', () => {
    const { code } = gen({
      blocks: {
        languageVersion: 0,
        blocks: [
          b('test_led_on', 'a', { x: 0, y: 0, fields: { PIN: 1 } }),
          b('test_led_on', 'c', { x: 0, y: 200, fields: { PIN: 3 } })
        ]
      }
    })
    expect(code).toBe(
      [
        'from snakie import Led',
        '',
        'led_1 = Led(1)',
        'led_3 = Led(3)',
        '',
        'led_1.on()',
        'led_3.on()',
        ''
      ].join('\n')
    )
  })
})

describe('the import manager, through the generator (#1010)', () => {
  it('two blocks needing the same import produce ONE import', () => {
    const { code } = gen({
      blocks: {
        languageVersion: 0,
        blocks: [
          b('test_led_on', 'a', {
            fields: { PIN: 1 },
            next: { block: b('test_led_on', 'b', { fields: { PIN: 2 } }) }
          })
        ]
      }
    })
    expect(code.match(/from snakie import Led/g)).toHaveLength(1)
  })

  it('groups and sorts: stdlib, then machine, then snakie, then drivers', () => {
    const m = new ImportManager()
    m.need({ module: 'bme280', name: 'BME280' })
    m.need({ module: 'snakie', name: 'Led' })
    m.need({ module: 'time' })
    m.need({ module: 'machine', name: 'Pin' })
    m.need({ module: 'snakie', name: 'Button' })
    m.need({ module: 'math' })
    expect(m.render()).toBe(
      [
        'import math',
        'import time',
        '',
        'from machine import Pin',
        '',
        'from snakie import Button, Led',
        '',
        'from bme280 import BME280'
      ].join('\n')
    )
  })

  it('puts plain imports before from-imports inside a group', () => {
    const m = new ImportManager()
    m.need({ module: 'time', name: 'sleep' })
    m.need({ module: 'json' })
    expect(m.render()).toBe(['import json', 'from time import sleep'].join('\n'))
  })

  it('classifies modules the way the sections claim to', () => {
    expect(importGroup('time')).toBe('stdlib')
    expect(importGroup('machine')).toBe('machine')
    expect(importGroup('snakie')).toBe('snakie')
    expect(importGroup('snakie.turtle')).toBe('snakie')
    // A driver that ships with the firmware is still about a component you
    // wired up, which is the distinction the grouping makes visible.
    expect(importGroup('dht')).toBe('driver')
    expect(importGroup('bme280')).toBe('driver')
  })

  it('reports the names it binds, so a variable cannot shadow a module', () => {
    const m = new ImportManager()
    m.need({ module: 'time' })
    m.need({ module: 'snakie', name: 'Led' })
    expect([...m.boundNames()].sort()).toEqual(['Led', 'time'])
  })
})

describe('setup hoisting (#1010)', () => {
  it('constructs once and reuses, even from inside a loop', () => {
    // The reason this matters is hardware: a constructor left in the loop body
    // re-configures the pin thousands of times a second.
    const { code } = gen({
      blocks: {
        languageVersion: 0,
        blocks: [
          b('test_forever', 'f', {
            inputs: {
              DO: {
                block: b('test_led_on', 'a', {
                  fields: { PIN: 15 },
                  next: { block: b('test_led_on', 'b', { fields: { PIN: 15 } }) }
                })
              }
            }
          })
        ]
      }
    })
    expect(code.match(/Led\(15\)/g)).toHaveLength(1)
    expect(code).toBe(
      [
        'from snakie import Led',
        '',
        'led_15 = Led(15)',
        '',
        'while True:',
        '    led_15.on()',
        '    led_15.on()',
        ''
      ].join('\n')
    )
  })

  it('keeps two different pins as two different objects', () => {
    const { code } = gen({
      blocks: {
        languageVersion: 0,
        blocks: [
          b('test_led_on', 'a', {
            fields: { PIN: 15 },
            next: { block: b('test_led_on', 'b', { fields: { PIN: 16 } }) }
          })
        ]
      }
    })
    expect(code).toContain('led_15 = Led(15)')
    expect(code).toContain('led_16 = Led(16)')
  })
})

describe('values and precedence (#1010)', () => {
  it('parenthesises only where Python needs it', () => {
    const sum = (id: string, a: unknown, bb: unknown): Record<string, unknown> =>
      b('test_sum', id, { inputs: { A: { block: a }, B: { block: bb } } })
    const num = (id: string, n: number): Record<string, unknown> =>
      b('test_number', id, { fields: { NUM: n } })
    const { code } = gen({
      blocks: {
        languageVersion: 0,
        blocks: [
          b('test_print', 'p', {
            inputs: {
              WHAT: { block: sum('s1', num('n1', 1), sum('s2', num('n2', 2), num('n3', 3))) }
            }
          })
        ]
      }
    })
    // `1 + (2 + 3)` — the inner sum is at the same precedence on the RIGHT, so
    // Blockly's own ordering rules put brackets round it. Not wrong, just
    // explicit, which is the right default for code a learner is reading.
    expect(code).toBe(['print(1 + (2 + 3))', ''].join('\n'))
  })

  it('an empty socket generates a default rather than `undefined`', () => {
    // The commonest thing on a beginner's canvas is a hole they haven't filled.
    const { code } = gen({
      blocks: { languageVersion: 0, blocks: [b('test_sleep', 's')] }
    })
    expect(code).toBe(['import time', '', 'time.sleep(0)', ''].join('\n'))
    expect(code).not.toContain('undefined')
  })
})

describe('names (#1010)', () => {
  it('makes a legal identifier out of whatever a child typed', () => {
    expect(sanitise('score')).toBe('score')
    expect(sanitise('my score')).toBe('my_score')
    expect(sanitise('3 cats')).toBe('n3_cats')
    expect(sanitise('  lots   of   spaces  ')).toBe('lots_of_spaces')
    expect(sanitise('')).toBe('value')
    expect(sanitise('!!!')).toBe('value')
    // Python 3 allows unicode identifiers, but they are a trap: fine here,
    // broken the moment the file meets an older tool.
    expect(sanitise('turtle')).toBe('turtle')
  })

  it('refuses to shadow a keyword or a builtin worth keeping', () => {
    expect(isReservedName('class')).toBe(true)
    expect(isReservedName('print')).toBe(true)
    expect(isReservedName('score')).toBe(false)
    expect(toPythonIdentifier('class')).toBe('class_')
    expect(toPythonIdentifier('print')).toBe('print_')
  })

  it('counts up on a collision, deterministically', () => {
    const taken = new Set(['score'])
    expect(toPythonIdentifier('score', taken)).toBe('score_')
    expect(toPythonIdentifier('score', new Set(['score', 'score_']))).toBe('score_2')
    expect(toPythonIdentifier('score', new Set(['score', 'score_', 'score_2']))).toBe('score_3')
  })

  it('a variable named after a module loses, so the module stays reachable', () => {
    // Otherwise `time = 5` three lines under `import time` fails at the NEXT
    // `time.sleep`, a long way from the name that caused it.
    const { code } = gen({
      blocks: {
        languageVersion: 0,
        blocks: [
          b('test_sleep', 's', {
            inputs: { SECS: { block: b('test_number', 'n', { fields: { NUM: 1 } }) } },
            next: {
              block: b('test_set_var', 'v', {
                fields: { VAR: { id: 'varTime', name: 'time' } },
                inputs: { VALUE: { block: b('test_number', 'n2', { fields: { NUM: 5 } }) } }
              })
            }
          })
        ]
      },
      variables: [{ name: 'time', id: 'varTime' }]
    })
    expect(code).toContain('import time')
    expect(code).toContain('time_ = 5')
    expect(code).not.toMatch(/^time = 5$/m)
  })

  it('uses the variable a learner named, sanitised', () => {
    const { code } = gen({
      blocks: {
        languageVersion: 0,
        blocks: [
          b('test_set_var', 'v', {
            fields: { VAR: { id: 'v1', name: 'my score' } },
            inputs: { VALUE: { block: b('test_number', 'n', { fields: { NUM: 10 } }) } }
          })
        ]
      },
      variables: [{ name: 'my score', id: 'v1' }]
    })
    expect(code).toBe(['my_score = 10', ''].join('\n'))
  })
})

describe('the block-to-line source map (#1010)', () => {
  const program = (): GeneratedProgram =>
    gen({
      blocks: {
        languageVersion: 0,
        blocks: [
          b('test_forever', 'FOREVER', {
            inputs: {
              DO: {
                block: b('test_led_on', 'LED', {
                  fields: { PIN: 15 },
                  next: {
                    block: b('test_sleep', 'SLEEP', {
                      inputs: { SECS: { block: b('test_number', 'N', { fields: { NUM: 1 } }) } }
                    })
                  }
                })
              }
            }
          })
        ]
      }
    })

  it('points every code line at the block that wrote it', () => {
    const { code, sourceMap } = program()
    const lines = code.split('\n')
    //  1 import time
    //  2
    //  3 from snakie import Led
    //  4
    //  5 led_15 = Led(15)
    //  6
    //  7 while True:
    //  8     led_15.on()
    //  9     time.sleep(1)
    expect(lines[6]).toBe('while True:')
    expect(sourceMap.get(7)).toBe('FOREVER')
    expect(sourceMap.get(8)).toBe('LED')
    expect(sourceMap.get(9)).toBe('SLEEP')
  })

  it('attributes a hoisted setup line to the block that asked for it', () => {
    // So a traceback in `led_15 = Led(15)` highlights the LED block rather than
    // nothing at all.
    const { sourceMap } = program()
    expect(sourceMap.get(5)).toBe('LED')
  })

  it('leaves import lines unattributed — no block wrote them', () => {
    const { sourceMap } = program()
    expect(sourceMap.has(1)).toBe(false)
    expect(sourceMap.has(3)).toBe(false)
  })

  it('has no entry for a blank line', () => {
    const { sourceMap } = program()
    expect(sourceMap.has(2)).toBe(false)
    expect(sourceMap.has(6)).toBe(false)
  })

  it('gives the reverse lookup #1016 highlights from', () => {
    const { blockLines } = program()
    expect(blockLines.get('FOREVER')).toEqual([7])
    expect(blockLines.get('LED')).toEqual([5, 8])
    expect(blockLines.get('SLEEP')).toEqual([9])
    // A value block has no line of its own — it lives inside someone else's.
    expect(blockLines.has('N')).toBe(false)
  })

  it('never leaks a marker into the program', () => {
    const { code } = program()
    expect(code).not.toContain(String.fromCharCode(0))
  })

  it('agrees with the code: every mapped line exists and is not blank', () => {
    const { code, sourceMap } = program()
    const lines = code.split('\n')
    for (const line of sourceMap.keys()) {
      expect(lines[line - 1]).toBeDefined()
      expect(lines[line - 1].trim()).not.toBe('')
    }
  })
})

describe('regeneration is stable (#1010)', () => {
  const build = (pin: number): GeneratedProgram =>
    gen({
      blocks: {
        languageVersion: 0,
        blocks: [
          b('test_led_on', 'a', {
            fields: { PIN: 1 },
            next: {
              block: b('test_led_on', 'b', {
                fields: { PIN: pin },
                next: { block: b('test_print', 'c', {}) }
              })
            }
          })
        ]
      }
    })

  it('the same workspace generates the same bytes every time', () => {
    expect(build(2).code).toBe(build(2).code)
  })

  it('editing one block does not reshuffle the lines around it', () => {
    // A mirror that reshuffles is a mirror nobody reads — and the source map
    // would churn under #1016's highlighting on every keystroke.
    const before = build(2).code.split('\n')
    const after = build(3).code.split('\n')
    expect(before.length).toBe(after.length)
    // Only the two lines that mention the pin may differ.
    const changed = before.map((l, i) => (l === after[i] ? null : i)).filter((i) => i !== null)
    expect(changed).toEqual([3, 6])
  })
})

describe('output shape (#1010)', () => {
  it('is ruff-shaped: 4-space indent, one trailing newline, no trailing spaces', () => {
    const out = gen({
      blocks: {
        languageVersion: 0,
        blocks: [
          b('test_forever', 'f', {
            inputs: { DO: { block: b('test_led_on', 'l', { fields: { PIN: 1 } }) } }
          })
        ]
      }
    }).code
    expect(out.endsWith('\n')).toBe(true)
    expect(out.endsWith('\n\n')).toBe(false)
    expect(out).not.toMatch(/[ \t]+\n/)
    expect(out).toContain('\n    led_1.on()')
    expect(out).not.toContain('\t')
  })
})

describe('a block with no emitter is reported, not silently dropped (#1010)', () => {
  it('names the types this build cannot generate', () => {
    const ws = new Blockly.Workspace()
    Blockly.serialization.workspaces.load(
      { blocks: { languageVersion: 0, blocks: [b('test_unknown', 'u')] } },
      ws
    )
    // A block a child placed that does nothing, with no error anywhere, is the
    // worst outcome — so callers get to say so.
    expect(blocksWithoutEmitters(ws)).toEqual(['test_unknown'])
    const out = generateProgram(ws)
    // Generation does not THROW on it (the mirror would go blank) and it does
    // not pretend either: `missing` is what stops the result being written back
    // over a program it has quietly dropped a step from.
    expect(out.code).toBe('')
    expect(out.missing).toEqual(['test_unknown'])
  })

  it('keeps the stacks it CAN generate when another one is unknown', () => {
    const ws = new Blockly.Workspace()
    Blockly.serialization.workspaces.load(
      {
        blocks: {
          languageVersion: 0,
          blocks: [
            b('test_led_on', 'good', { x: 0, y: 0, fields: { PIN: 1 } }),
            b('test_unknown', 'bad', { x: 0, y: 200 })
          ]
        }
      },
      ws
    )
    const out = generateProgram(ws)
    expect(out.code).toContain('led_1.on()')
    expect(out.missing).toEqual(['test_unknown'])
  })

  it('is empty for a workspace we can generate in full', () => {
    const ws = new Blockly.Workspace()
    Blockly.serialization.workspaces.load(
      { blocks: { languageVersion: 0, blocks: [b('test_led_on', 'l', { fields: { PIN: 1 } })] } },
      ws
    )
    expect(blocksWithoutEmitters(ws)).toEqual([])
  })
})
