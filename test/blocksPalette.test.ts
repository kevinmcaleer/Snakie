import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, beforeAll } from 'vitest'
import * as Blockly from 'blockly/core'
import { generateProgram, type GeneratedProgram } from '../src/renderer/src/lib/blocks/generator'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import {
  blockDefinition,
  blocksInCategory,
  installBlockDefinitions,
  registeredBlocks
} from '../src/renderer/src/lib/blocks/registry'
import { BLOCK_CATEGORIES } from '../src/renderer/src/lib/blocks/theme'

/**
 * THE CORE PALETTE, GOLDEN-FILE (#1011, epic #1007).
 * =============================================================================
 *
 * A block workspace in, the exact MicroPython out — for every category. The
 * point of writing the expected program out in full is that a generator
 * regression is a diff a maintainer can read, not a bug report from a
 * ten-year-old whose square came out a triangle.
 *
 * These also pin the DECISIONS, which is the half of this issue that isn't
 * mechanical: that `join` emits an f-string rather than the `str(a) + ' ' + …`
 * the app's own refactor hints tell people to stop writing; that list indices
 * are 1-based on the block and `- 1` in the code, visibly; that `repeat` uses
 * `_` for a counter nobody reads. Someone changing one of those should have to
 * change a test that says why.
 */

beforeAll(() => {
  installCorePalette()
  installBlockDefinitions()
})

/** Build a workspace from serialised JSON and generate it. */
function gen(blocks: unknown[], variables?: unknown[]): GeneratedProgram {
  const ws = new Blockly.Workspace()
  Blockly.serialization.workspaces.load(
    { blocks: { languageVersion: 0, blocks }, ...(variables ? { variables } : {}) },
    ws
  )
  const out = generateProgram(ws)
  // Every fixture here must be fully generatable; a `missing` entry means the
  // test is exercising a block the palette forgot to register an emitter for.
  expect(out.missing).toEqual([])
  return out
}

/** The code for one statement stack, as lines. */
const lines = (blocks: unknown[], variables?: unknown[]): string[] =>
  gen(blocks, variables).code.split('\n')

const num = (n: number, id = `n${n}`): Record<string, unknown> => ({
  type: 'math_number',
  id,
  fields: { NUM: n }
})
const text = (t: string, id = `t_${t}`): Record<string, unknown> => ({
  type: 'text',
  id,
  fields: { TEXT: t }
})

describe('the palette covers what the issue asks for (#1011)', () => {
  it('registers every category the issue lists, and nothing lives in a category that does not exist', () => {
    const ids = new Set(BLOCK_CATEGORIES.map((c) => c.id))
    for (const def of registeredBlocks()) expect(ids.has(def.category)).toBe(true)
    for (const c of ['wait', 'control', 'logic', 'math', 'text', 'lists', 'variables', 'functions'])
      expect(blocksInCategory(c as never).length).toBeGreaterThan(0)
  })

  it('gives every block a plain-English tooltip and an in-app help article', () => {
    for (const def of registeredBlocks()) {
      // Blockly's stock blocks bring their own tooltips; ours have to be written.
      if (def.json) expect(typeof def.json.tooltip).toBe('string')
      expect(def.help, `${def.type} has no help article`).toBeTruthy()
    }
  })

  it('points help at articles the help library actually has', () => {
    // Checked against the REAL library on disk, not a list copied into this
    // test: a copy goes stale the first time a palette adds a block, and the
    // failure it then reports is about the copy rather than about the app. A
    // help link to an article that does not exist is worse than no link at all
    // — the child clicks it once, gets nothing, and never clicks again.
    const dir = resolve(__dirname, '../src/renderer/src/components/help')
    const articles = new Set(
      readdirSync(dir)
        .filter((f) => f.endsWith('.md'))
        .map((f) => f.replace(/\.md$/, ''))
    )
    for (const def of registeredBlocks()) {
      expect(articles.has(def.help as string), `${def.type} -> ${def.help}`).toBe(true)
    }
  })

  it('leaves the blocks it deliberately trimmed unreachable', () => {
    // Blockly defines these; the palette does not register them, so they appear
    // in no category and no flyout. A palette is a curriculum.
    for (const trimmed of [
      'math_trig',
      'math_constant',
      'math_atan2',
      'math_number_property',
      'math_on_list',
      'logic_ternary',
      'text_prompt',
      'text_changeCase',
      'text_getSubstring',
      'lists_sort',
      'lists_split'
    ]) {
      expect(Blockly.Blocks[trimmed], `${trimmed} should still exist in Blockly`).toBeTruthy()
      expect(blockDefinition(trimmed), `${trimmed} should not be in the palette`).toBeUndefined()
    }
  })
})

describe('wait (#1011)', () => {
  it('has a category of its own, not a corner of Control', () => {
    expect(blocksInCategory('wait').map((b) => b.type)).toEqual([
      'snakie_wait_seconds',
      'snakie_wait_ms'
    ])
  })

  it('generates the two different MicroPython calls, not one with a unit', () => {
    expect(
      lines([{ type: 'snakie_wait_seconds', id: 'w', inputs: { SECS: { block: num(0.5) } } }])
    ).toEqual(['import time', '', 'time.sleep(0.5)', ''])
    expect(
      lines([{ type: 'snakie_wait_ms', id: 'w', inputs: { MS: { block: num(250) } } }])
    ).toEqual(['import time', '', 'time.sleep_ms(250)', ''])
  })

  it('imports `time` once however many waits there are', () => {
    const code = gen([
      {
        type: 'snakie_wait_seconds',
        id: 'a',
        inputs: { SECS: { block: num(1, 'x') } },
        next: { block: { type: 'snakie_wait_ms', id: 'b', inputs: { MS: { block: num(2, 'y') } } } }
      }
    ]).code
    expect(code.match(/^import time$/gm)).toHaveLength(1)
  })
})

describe('control (#1011)', () => {
  it('forever is `while True:`', () => {
    expect(
      lines([
        {
          type: 'snakie_forever',
          id: 'f',
          inputs: {
            DO: { block: { type: 'text_print', id: 'p', inputs: { TEXT: { block: text('hi') } } } }
          }
        }
      ])
    ).toEqual(['while True:', "    print('hi')", ''])
  })

  it('forever refuses a next connection — nothing can run after it', () => {
    const ws = new Blockly.Workspace()
    Blockly.serialization.workspaces.load(
      { blocks: { languageVersion: 0, blocks: [{ type: 'snakie_forever', id: 'f' }] } },
      ws
    )
    expect(ws.getBlockById('f')!.nextConnection).toBeNull()
  })

  it('repeat N times uses `_` for the counter nobody reads', () => {
    expect(
      lines([
        {
          type: 'controls_repeat_ext',
          id: 'r',
          inputs: {
            TIMES: { block: num(4) },
            DO: { block: { type: 'text_print', id: 'p', inputs: { TEXT: { block: text('x') } } } }
          }
        }
      ])
    ).toEqual(['for _ in range(4):', "    print('x')", ''])
  })

  it('an empty loop body is `pass`, not a syntax error', () => {
    expect(
      lines([{ type: 'controls_repeat_ext', id: 'r', inputs: { TIMES: { block: num(2) } } }])
    ).toEqual(['for _ in range(2):', '    pass', ''])
  })

  it('repeat while / until', () => {
    const cond = {
      type: 'logic_compare',
      id: 'c',
      fields: { OP: 'LT' },
      inputs: { A: { block: num(1, 'a') }, B: { block: num(5, 'b') } }
    }
    expect(
      lines([
        {
          type: 'controls_whileUntil',
          id: 'w',
          fields: { MODE: 'WHILE' },
          inputs: { BOOL: { block: cond } }
        }
      ])
    ).toEqual(['while 1 < 5:', '    pass', ''])
    // `until x` is `while not x`, with NO brackets: `not` binds looser than `<`
    // in Python, so `not 1 < 5` already means `not (1 < 5)`. Adding brackets
    // would be a small lie about how Python reads.
    expect(
      lines([
        {
          type: 'controls_whileUntil',
          id: 'w',
          fields: { MODE: 'UNTIL' },
          inputs: { BOOL: { block: cond } }
        }
      ])
    ).toEqual(['while not 1 < 5:', '    pass', ''])
  })

  it('if / else if / else, however many arms the mutator made', () => {
    expect(
      lines([
        {
          type: 'controls_if',
          id: 'i',
          extraState: { elseIfCount: 1, hasElse: true },
          inputs: {
            IF0: { block: { type: 'logic_boolean', id: 'b1', fields: { BOOL: 'TRUE' } } },
            DO0: {
              block: { type: 'text_print', id: 'p1', inputs: { TEXT: { block: text('a') } } }
            },
            IF1: { block: { type: 'logic_boolean', id: 'b2', fields: { BOOL: 'FALSE' } } },
            DO1: {
              block: { type: 'text_print', id: 'p2', inputs: { TEXT: { block: text('b') } } }
            },
            ELSE: {
              block: { type: 'text_print', id: 'p3', inputs: { TEXT: { block: text('c') } } }
            }
          }
        }
      ])
    ).toEqual([
      'if True:',
      "    print('a')",
      'elif False:',
      "    print('b')",
      'else:',
      "    print('c')",
      ''
    ])
  })

  it('count-with makes the off-by-one visible rather than hiding it', () => {
    // Blockly counts inclusively and `range` stops short, so "from 1 to 10"
    // must become `range(1, 11)`. A literal is folded; anything else keeps the
    // `+ 1` where a learner can see it beside the block that caused it.
    expect(
      lines(
        [
          {
            type: 'controls_for',
            id: 'f',
            fields: { VAR: { id: 'vi', name: 'i' } },
            inputs: {
              FROM: { block: num(1, 'a') },
              TO: { block: num(10, 'b') },
              BY: { block: num(1, 'c') }
            }
          }
        ],
        [{ name: 'i', id: 'vi' }]
      )
    ).toEqual(['for i in range(1, 11):', '    pass', ''])
  })

  it('count-with keeps a step when there is one', () => {
    expect(
      lines(
        [
          {
            type: 'controls_for',
            id: 'f',
            fields: { VAR: { id: 'vi', name: 'i' } },
            inputs: {
              FROM: { block: num(0, 'a') },
              TO: { block: num(10, 'b') },
              BY: { block: num(2, 'c') }
            }
          }
        ],
        [{ name: 'i', id: 'vi' }]
      )
    ).toEqual(['for i in range(0, 11, 2):', '    pass', ''])
  })

  it('for each item in list', () => {
    expect(
      lines(
        [
          {
            type: 'controls_forEach',
            id: 'e',
            fields: { VAR: { id: 'vp', name: 'pin' } },
            inputs: {
              LIST: {
                block: {
                  type: 'lists_create_with',
                  id: 'l',
                  extraState: { itemCount: 2 },
                  inputs: { ADD0: { block: num(1, 'a') }, ADD1: { block: num(2, 'b') } }
                }
              }
            }
          }
        ],
        [{ name: 'pin', id: 'vp' }]
      )
    ).toEqual(['for pin in [1, 2]:', '    pass', ''])
  })

  it('break and continue', () => {
    expect(
      lines([
        {
          type: 'controls_repeat_ext',
          id: 'r',
          inputs: {
            TIMES: { block: num(3) },
            DO: { block: { type: 'controls_flow_statements', id: 'b', fields: { FLOW: 'BREAK' } } }
          }
        }
      ])
    ).toEqual(['for _ in range(3):', '    break', ''])
  })
})

describe('logic (#1011)', () => {
  const compare = (op: string): string[] =>
    lines([
      {
        type: 'text_print',
        id: 'p',
        inputs: {
          TEXT: {
            block: {
              type: 'logic_compare',
              id: 'c',
              fields: { OP: op },
              inputs: { A: { block: num(1, 'a') }, B: { block: num(2, 'b') } }
            }
          }
        }
      }
    ])

  it('every comparison', () => {
    expect(compare('EQ')[0]).toBe('print(1 == 2)')
    expect(compare('NEQ')[0]).toBe('print(1 != 2)')
    expect(compare('LT')[0]).toBe('print(1 < 2)')
    expect(compare('LTE')[0]).toBe('print(1 <= 2)')
    expect(compare('GT')[0]).toBe('print(1 > 2)')
    expect(compare('GTE')[0]).toBe('print(1 >= 2)')
  })

  it('and / or / not / True / False / None', () => {
    const wrap = (b: unknown): string =>
      lines([{ type: 'text_print', id: 'p', inputs: { TEXT: { block: b } } }])[0]
    expect(
      wrap({
        type: 'logic_operation',
        id: 'o',
        fields: { OP: 'AND' },
        inputs: {
          A: { block: { type: 'logic_boolean', id: 'b1', fields: { BOOL: 'TRUE' } } },
          B: { block: { type: 'logic_boolean', id: 'b2', fields: { BOOL: 'FALSE' } } }
        }
      })
    ).toBe('print(True and False)')
    expect(
      wrap({
        type: 'logic_negate',
        id: 'n',
        inputs: { BOOL: { block: { type: 'logic_boolean', id: 'b', fields: { BOOL: 'TRUE' } } } }
      })
    ).toBe('print(not True)')
    expect(wrap({ type: 'logic_null', id: 'z' })).toBe('print(None)')
  })

  it('"is nothing" on the block, `is None` in the code', () => {
    // The block says what it MEANS and the mirror shows the translation — which
    // is the whole job of having a mirror.
    expect(
      lines([
        {
          type: 'text_print',
          id: 'p',
          inputs: {
            TEXT: {
              block: { type: 'snakie_is_none', id: 'q', inputs: { VALUE: { block: num(1) } } }
            }
          }
        }
      ])[0]
    ).toBe('print(1 is None)')
    expect(blockDefinition('snakie_is_none')!.json!.message0).toBe('%1 is nothing')
  })
})

describe('maths (#1011)', () => {
  const value = (b: unknown): string =>
    lines([{ type: 'text_print', id: 'p', inputs: { TEXT: { block: b } } }])[0]

  it('arithmetic, with brackets only where Python needs them', () => {
    const add = {
      type: 'math_arithmetic',
      id: 'a',
      fields: { OP: 'ADD' },
      inputs: { A: { block: num(1, 'x') }, B: { block: num(2, 'y') } }
    }
    expect(
      value({
        type: 'math_arithmetic',
        id: 'm',
        fields: { OP: 'MULTIPLY' },
        inputs: { A: { block: add }, B: { block: num(3, 'z') } }
      })
    ).toBe('print((1 + 2) * 3)')
  })

  it('remainder, rounding and random', () => {
    expect(
      value({
        type: 'math_modulo',
        id: 'm',
        inputs: { DIVIDEND: { block: num(64, 'a') }, DIVISOR: { block: num(10, 'b') } }
      })
    ).toBe('print(64 % 10)')
    expect(
      value({
        type: 'math_round',
        id: 'r',
        fields: { OP: 'ROUND' },
        inputs: { NUM: { block: num(3.7) } }
      })
    ).toBe('print(round(3.7))')
    expect(
      gen([
        {
          type: 'text_print',
          id: 'p',
          inputs: {
            TEXT: {
              block: {
                type: 'math_round',
                id: 'r',
                fields: { OP: 'ROUNDUP' },
                inputs: { NUM: { block: num(3.2) } }
              }
            }
          }
        }
      ]).code
    ).toBe('import math\n\nprint(math.ceil(3.2))\n')
    expect(
      gen([
        {
          type: 'text_print',
          id: 'p',
          inputs: {
            TEXT: {
              block: {
                type: 'math_random_int',
                id: 'r',
                inputs: { FROM: { block: num(1, 'a') }, TO: { block: num(6, 'b') } }
              }
            }
          }
        }
      ]).code
    ).toBe('import random\n\nprint(random.randint(1, 6))\n')
  })

  it('size, smallest and largest', () => {
    expect(value({ type: 'snakie_math_abs', id: 'a', inputs: { NUM: { block: num(-7) } } })).toBe(
      'print(abs(-7))'
    )
    expect(
      value({
        type: 'snakie_math_min_max',
        id: 'm',
        fields: { OP: 'MAX' },
        inputs: { A: { block: num(3, 'a') }, B: { block: num(9, 'b') } }
      })
    ).toBe('print(max(3, 9))')
  })

  it('map-a-range writes the arithmetic out, because reading it IS the lesson', () => {
    // A `_map_range()` helper in a setup section they never open would teach
    // nothing; this line is the one every analogue lesson needs.
    expect(
      value({
        type: 'snakie_map_range',
        id: 'm',
        inputs: {
          VALUE: { block: num(32767, 'v') },
          IN_MIN: { block: num(0, 'a') },
          IN_MAX: { block: num(65535, 'b') },
          OUT_MIN: { block: num(0, 'c') },
          OUT_MAX: { block: num(180, 'd') }
        }
      })
    ).toBe('print((32767 - 0) * (180 - 0) / (65535 - 0) + 0)')
  })
})

describe('text (#1011)', () => {
  it('a literal is single-quoted, like ruff prefers', () => {
    expect(
      lines([{ type: 'text_print', id: 'p', inputs: { TEXT: { block: text('hello') } } }])[0]
    ).toBe("print('hello')")
  })

  it('escapes a quote rather than producing a broken line', () => {
    expect(
      lines([{ type: 'text_print', id: 'p', inputs: { TEXT: { block: text("it's") } } }])[0]
    ).toBe("print('it\\'s')")
  })

  it('join makes an f-string, NOT the str() + concatenation we tell people to stop writing', () => {
    // `refactor-use-fstring` is an existing app hint. Generating the thing the
    // app then advises against would send a learner to text with a habit Snakie
    // immediately corrects.
    expect(
      lines(
        [
          {
            type: 'text_print',
            id: 'p',
            inputs: {
              TEXT: {
                block: {
                  type: 'text_join',
                  id: 'j',
                  extraState: { itemCount: 2 },
                  inputs: {
                    ADD0: { block: text('score: ') },
                    ADD1: {
                      block: {
                        type: 'variables_get',
                        id: 'g',
                        fields: { VAR: { id: 'vs', name: 'score' } }
                      }
                    }
                  }
                }
              }
            }
          }
        ],
        [{ name: 'score', id: 'vs' }]
      )[0]
    ).toBe('print(f"score: {score}")')
  })

  it('length', () => {
    expect(
      lines([
        {
          type: 'text_print',
          id: 'p',
          inputs: {
            TEXT: {
              block: { type: 'text_length', id: 'l', inputs: { VALUE: { block: text('abc') } } }
            }
          }
        }
      ])[0]
    ).toBe("print(len('abc'))")
  })
})

describe('lists (#1011)', () => {
  const listVar = {
    type: 'variables_get',
    id: 'g',
    fields: { VAR: { id: 'vl', name: 'readings' } }
  }
  const vars = [{ name: 'readings', id: 'vl' }]

  it('create, with the items in order', () => {
    expect(
      lines([
        {
          type: 'text_print',
          id: 'p',
          inputs: {
            TEXT: {
              block: {
                type: 'lists_create_with',
                id: 'l',
                extraState: { itemCount: 3 },
                inputs: {
                  ADD0: { block: num(1, 'a') },
                  ADD1: { block: num(2, 'b') },
                  ADD2: { block: num(3, 'c') }
                }
              }
            }
          }
        }
      ])[0]
    ).toBe('print([1, 2, 3])')
  })

  it('add, get, set — with the 1-based index folded when it is a literal', () => {
    expect(
      lines(
        [
          {
            type: 'snakie_list_append',
            id: 'a',
            inputs: { ITEM: { block: num(5) }, LIST: { block: listVar } }
          }
        ],
        vars
      )[0]
    ).toBe('readings.append(5)')
    expect(
      lines(
        [
          {
            type: 'text_print',
            id: 'p',
            inputs: {
              TEXT: {
                block: {
                  type: 'snakie_list_get',
                  id: 'g2',
                  inputs: { INDEX: { block: num(1) }, LIST: { block: listVar } }
                }
              }
            }
          }
        ],
        vars
      )[0]
    ).toBe('print(readings[0])')
    expect(
      lines(
        [
          {
            type: 'snakie_list_set',
            id: 's',
            inputs: {
              INDEX: { block: num(2) },
              LIST: { block: listVar },
              VALUE: { block: num(9, 'v') }
            }
          }
        ],
        vars
      )[0]
    ).toBe('readings[1] = 9')
  })

  it('a computed index keeps the `- 1` where the learner can see it', () => {
    expect(
      lines(
        [
          {
            type: 'text_print',
            id: 'p',
            inputs: {
              TEXT: {
                block: {
                  type: 'snakie_list_get',
                  id: 'g2',
                  inputs: {
                    INDEX: {
                      block: {
                        type: 'variables_get',
                        id: 'gi',
                        fields: { VAR: { id: 'vi', name: 'i' } }
                      }
                    },
                    LIST: { block: listVar }
                  }
                }
              }
            }
          }
        ],
        [...vars, { name: 'i', id: 'vi' }]
      )[0]
    ).toBe('print(readings[i - 1])')
  })

  it('length and `in`', () => {
    expect(
      lines(
        [
          {
            type: 'text_print',
            id: 'p',
            inputs: {
              TEXT: {
                block: { type: 'lists_length', id: 'l', inputs: { VALUE: { block: listVar } } }
              }
            }
          }
        ],
        vars
      )[0]
    ).toBe('print(len(readings))')
    expect(
      lines(
        [
          {
            type: 'text_print',
            id: 'p',
            inputs: {
              TEXT: {
                block: {
                  type: 'snakie_list_contains',
                  id: 'c',
                  inputs: { ITEM: { block: num(5) }, LIST: { block: listVar } }
                }
              }
            }
          }
        ],
        vars
      )[0]
    ).toBe('print(5 in readings)')
  })
})

describe('variables (#1011)', () => {
  it('set, get and change by', () => {
    expect(
      lines(
        [
          {
            type: 'variables_set',
            id: 's',
            fields: { VAR: { id: 'v', name: 'score' } },
            inputs: { VALUE: { block: num(0) } },
            next: {
              block: {
                type: 'math_change',
                id: 'c',
                fields: { VAR: { id: 'v', name: 'score' } },
                inputs: { DELTA: { block: num(1, 'd') } }
              }
            }
          }
        ],
        [{ name: 'score', id: 'v' }]
      )
    ).toEqual(['score = 0', 'score += 1', ''])
  })

  it('sanitises a name a child typed, everywhere it appears', () => {
    expect(
      lines(
        [
          {
            type: 'variables_set',
            id: 's',
            fields: { VAR: { id: 'v', name: 'my score' } },
            inputs: { VALUE: { block: num(1) } },
            next: {
              block: {
                type: 'text_print',
                id: 'p',
                inputs: {
                  TEXT: {
                    block: {
                      type: 'variables_get',
                      id: 'g',
                      fields: { VAR: { id: 'v', name: 'my score' } }
                    }
                  }
                }
              }
            }
          }
        ],
        [{ name: 'my score', id: 'v' }]
      )
    ).toEqual(['my_score = 1', 'print(my_score)', ''])
  })
})

describe('functions (#1011)', () => {
  it('a definition is HOISTED above the code that calls it', () => {
    // On the canvas the `def` is below the call, because that is where there was
    // room. Emitted in place, the call would die with a NameError about
    // something the learner did nothing wrong to cause.
    expect(
      lines([
        {
          type: 'procedures_callnoreturn',
          id: 'c',
          x: 0,
          y: 0,
          extraState: { name: 'blink', params: [] }
        },
        {
          type: 'procedures_defnoreturn',
          id: 'd',
          x: 0,
          y: 300,
          fields: { NAME: 'blink' },
          inputs: {
            STACK: {
              block: { type: 'text_print', id: 'p', inputs: { TEXT: { block: text('on') } } }
            }
          }
        }
      ])
    ).toEqual(['def blink():', "    print('on')", '', 'blink()', ''])
  })

  it('a function with an answer, and arguments', () => {
    expect(
      lines(
        [
          {
            type: 'procedures_defreturn',
            id: 'd',
            fields: { NAME: 'double' },
            extraState: { params: [{ name: 'n', id: 'pn' }] },
            inputs: {
              RETURN: {
                block: {
                  type: 'math_arithmetic',
                  id: 'm',
                  fields: { OP: 'MULTIPLY' },
                  inputs: {
                    A: {
                      block: {
                        type: 'variables_get',
                        id: 'g',
                        fields: { VAR: { id: 'pn', name: 'n' } }
                      }
                    },
                    B: { block: num(2) }
                  }
                }
              }
            }
          }
        ],
        [{ name: 'n', id: 'pn' }]
      )
    ).toEqual(['def double(n):', '    return n * 2', ''])
  })

  it('an empty definition is `pass`, not a syntax error', () => {
    expect(lines([{ type: 'procedures_defnoreturn', id: 'd', fields: { NAME: 'todo' } }])).toEqual([
      'def todo():',
      '    pass',
      ''
    ])
  })

  it('a function name a child typed becomes a legal identifier', () => {
    expect(
      lines([{ type: 'procedures_defnoreturn', id: 'd', fields: { NAME: 'do a thing!' } }])[0]
    ).toBe('def do_a_thing():')
  })
})

describe('a whole first program (#1011)', () => {
  it('blinks a counter, and reads like a person wrote it', () => {
    const { code } = gen(
      [
        {
          type: 'variables_set',
          id: 'init',
          x: 0,
          y: 0,
          fields: { VAR: { id: 'v', name: 'count' } },
          inputs: { VALUE: { block: num(0) } },
          next: {
            block: {
              type: 'snakie_forever',
              id: 'f',
              inputs: {
                DO: {
                  block: {
                    type: 'text_print',
                    id: 'p',
                    inputs: {
                      TEXT: {
                        block: {
                          type: 'text_join',
                          id: 'j',
                          extraState: { itemCount: 2 },
                          inputs: {
                            ADD0: { block: text('tick ') },
                            ADD1: {
                              block: {
                                type: 'variables_get',
                                id: 'g',
                                fields: { VAR: { id: 'v', name: 'count' } }
                              }
                            }
                          }
                        }
                      }
                    },
                    next: {
                      block: {
                        type: 'math_change',
                        id: 'c',
                        fields: { VAR: { id: 'v', name: 'count' } },
                        inputs: { DELTA: { block: num(1, 'd') } },
                        next: {
                          block: {
                            type: 'snakie_wait_seconds',
                            id: 'w',
                            inputs: { SECS: { block: num(0.5, 'h') } }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      ],
      [{ name: 'count', id: 'v' }]
    )
    expect(code).toBe(
      [
        'import time',
        '',
        'count = 0',
        'while True:',
        '    print(f"tick {count}")',
        '    count += 1',
        '    time.sleep(0.5)',
        ''
      ].join('\n')
    )
  })
})

describe('waiting, on either runtime (#1041)', () => {
  const cp = (blocks: unknown[]): string => {
    const ws = new Blockly.Workspace()
    Blockly.serialization.workspaces.load({ blocks: { languageVersion: 0, blocks } }, ws)
    return generateProgram(ws, 'circuitpython').code
  }
  const waitMs = (value: unknown): unknown[] => [
    { type: 'snakie_wait_ms', id: 'w', inputs: { MS: { block: value } } }
  ]
  const number = (n: number): unknown => ({ type: 'math_number', id: 'n', fields: { NUM: n } })

  it('keeps the MicroPython idiom on MicroPython', () => {
    // `sleep_ms` is what every tutorial writes, and the mirror is meant to show
    // the code a learner will meet elsewhere.
    expect(gen(waitMs(number(500))).code).toContain('time.sleep_ms(500)')
  })

  it('converts a literal to seconds on CircuitPython, which has no sleep_ms', () => {
    // `time.sleep(0.5)` is what a CircuitPython tutorial writes;
    // `time.sleep(500 / 1000)` is arithmetic nobody would type.
    expect(cp(waitMs(number(500)))).toContain('time.sleep(0.5)')
    expect(cp(waitMs(number(1)))).toContain('time.sleep(0.001)')
    expect(cp(waitMs(number(2000)))).toContain('time.sleep(2)')
  })

  it('keeps the division when the value is not a literal', () => {
    // The only form still correct when the value changes.
    const fromVariable = cp(waitMs({ type: 'math_arithmetic', id: 'a', fields: { OP: 'ADD' },
      inputs: { A: { block: number(100) }, B: { block: { ...(number(50) as object), id: 'n2' } } } }))
    expect(fromVariable).toContain('/ 1000')
  })

  it('the seconds block is already right on both', () => {
    const secs = [{ type: 'snakie_wait_seconds', id: 's', inputs: { SECS: { block: number(1) } } }]
    expect(gen(secs).code).toContain('time.sleep(1)')
    expect(cp(secs)).toContain('time.sleep(1)')
  })
})
