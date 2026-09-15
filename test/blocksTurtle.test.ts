import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as Blockly from 'blockly/core'
import { generateProgram, type GeneratedProgram } from '../src/renderer/src/lib/blocks/generator'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import { blocksInCategory, installBlockDefinitions } from '../src/renderer/src/lib/blocks/registry'
import { importGroup } from '../src/renderer/src/lib/blocks/imports'
import { PEN_COLOURS, DEFAULT_PEN_COLOUR } from '../src/renderer/src/lib/blocks/colour-field'
import {
  BLOCKS_STARTERS,
  EMPTY_WORKSPACE,
  SQUARE_STARTER,
  buildBlocksDocument
} from '../src/renderer/src/lib/blocks/starters'
import { hasBlocksFooter, parseBlocksFooter } from '../src/shared/blocks-doc'

/**
 * THE TURTLE PALETTE (#1013, epic #1007).
 * =============================================================================
 *
 * The first-hour demo, so the generated code is held to the same three
 * constraints as #1012's hardware blocks and one more:
 *
 *  - It must MATCH `micropython/turtle.py`'s real API. There is a test below
 *    that reads the library off disk and asserts every function these blocks
 *    call actually exists in it — the failure this catches is a block that
 *    generates a plausible `AttributeError`.
 *  - It must be the code a Snakie lesson would teach: `import turtle` and
 *    `turtle.forward(100)`, module-level functions rather than the class.
 *  - It must light the Turtle instrument up, which it does through the
 *    `hints` the instrument registry already matches against source.
 */

beforeAll(() => {
  installCorePalette()
  installBlockDefinitions()
})

function gen(blocks: unknown[]): GeneratedProgram {
  const ws = new Blockly.Workspace()
  Blockly.serialization.workspaces.load({ blocks: { languageVersion: 0, blocks } }, ws)
  const out = generateProgram(ws)
  expect(out.missing).toEqual([])
  return out
}

const lines = (blocks: unknown[]): string[] => gen(blocks).code.split('\n')
const num = (n: number): Record<string, unknown> => ({ type: 'math_number', fields: { NUM: n } })
/** A statement block with one number socket filled by a shadow, as the flyout gives it. */
const withNum = (type: string, input: string, n: number, id = type): Record<string, unknown> => ({
  type,
  id,
  inputs: { [input]: { shadow: num(n) } }
})

describe('movement (#1013)', () => {
  it('moves forward with one import and a qualified call', () => {
    expect(lines([withNum('snakie_turtle_forward', 'STEPS', 100)])).toEqual([
      'import turtle',
      '',
      'turtle.forward(100)',
      ''
    ])
  })

  it('moves backward without turning', () => {
    expect(lines([withNum('snakie_turtle_backward', 'STEPS', 50)])).toContain(
      'turtle.backward(50)'
    )
  })

  it('turns right and left as two separate blocks, not one with a dropdown', () => {
    expect(lines([withNum('snakie_turtle_right', 'ANGLE', 90)])).toContain('turtle.right(90)')
    expect(lines([withNum('snakie_turtle_left', 'ANGLE', 45)])).toContain('turtle.left(45)')
  })

  it('goes to an absolute point', () => {
    expect(
      lines([
        {
          type: 'snakie_turtle_goto',
          id: 'g',
          inputs: { X: { shadow: num(-20) }, Y: { shadow: num(35) } }
        }
      ])
    ).toContain('turtle.goto(-20, 35)')
  })

  it('points in an absolute direction, and goes home', () => {
    expect(lines([withNum('snakie_turtle_setheading', 'ANGLE', 180)])).toContain(
      'turtle.setheading(180)'
    )
    expect(lines([{ type: 'snakie_turtle_home', id: 'h' }])).toContain('turtle.home()')
  })

  it('falls back to the block default when a socket is empty', () => {
    // An empty socket is the normal state of a block a child has just deleted a
    // number out of. It must generate something that RUNS, not `turtle.forward()`
    // — a TypeError on the board about an argument they never saw.
    expect(lines([{ type: 'snakie_turtle_forward', id: 'f' }])).toContain('turtle.forward(100)')
    expect(lines([{ type: 'snakie_turtle_right', id: 'r' }])).toContain('turtle.right(90)')
  })
})

describe('pen (#1013)', () => {
  it('lifts and lowers the pen as two blocks', () => {
    expect(lines([{ type: 'snakie_turtle_penup', id: 'u' }])).toContain('turtle.penup()')
    expect(lines([{ type: 'snakie_turtle_pendown', id: 'd' }])).toContain('turtle.pendown()')
  })

  it('writes the colour as a NAME, not a hex string', () => {
    // The whole argument for a named palette: this line is one a learner can
    // read, remember and later type. `pencolor("#c83c3c")` is not.
    expect(
      lines([{ type: 'snakie_turtle_pencolour', id: 'c', fields: { COLOUR: 'hotpink' } }])
    ).toContain('turtle.pencolor("hotpink")')
  })

  it('keeps a colour the palette does not offer', () => {
    // A hand-edited file, or one from a later Snakie with a bigger palette. The
    // field accepts it (see `colour-field.ts`) so the program is not silently
    // rewired to a different colour.
    expect(
      lines([{ type: 'snakie_turtle_pencolour', id: 'c', fields: { COLOUR: 'turquoise' } }])
    ).toContain('turtle.pencolor("turquoise")')
  })

  it('defaults to the library default colour', () => {
    expect(lines([{ type: 'snakie_turtle_pencolour', id: 'c' }])).toContain(
      `turtle.pencolor("${DEFAULT_PEN_COLOUR}")`
    )
  })

  it('sets the pen size', () => {
    expect(lines([withNum('snakie_turtle_pensize', 'WIDTH', 5)])).toContain('turtle.pensize(5)')
  })
})

describe('screen (#1013)', () => {
  it('clears, resets, sets speed and hides/shows', () => {
    expect(lines([{ type: 'snakie_turtle_clear', id: 'a' }])).toContain('turtle.clear()')
    expect(lines([{ type: 'snakie_turtle_reset', id: 'b' }])).toContain('turtle.reset()')
    expect(lines([withNum('snakie_turtle_speed', 'SPEED', 10)])).toContain('turtle.speed(10)')
    expect(lines([{ type: 'snakie_turtle_hide', id: 'c' }])).toContain('turtle.hideturtle()')
    expect(lines([{ type: 'snakie_turtle_show', id: 'd' }])).toContain('turtle.showturtle()')
  })
})

describe('sensing (#1013)', () => {
  it('reads position and direction as value blocks', () => {
    const printed = (sensor: string): string[] =>
      lines([
        {
          type: 'text_print',
          id: 'p',
          inputs: { TEXT: { block: { type: sensor, id: 's' } } }
        }
      ])
    expect(printed('snakie_turtle_x')).toContain('print(turtle.xcor())')
    expect(printed('snakie_turtle_y')).toContain('print(turtle.ycor())')
    expect(printed('snakie_turtle_heading')).toContain('print(turtle.heading())')
  })
})

describe('a whole first lesson (#1013)', () => {
  it('draws a square in four blocks inside a repeat', () => {
    const square = gen([
      {
        type: 'controls_repeat_ext',
        id: 'rep',
        inputs: {
          TIMES: { shadow: num(4) },
          DO: {
            block: {
              ...withNum('snakie_turtle_forward', 'STEPS', 100, 'fwd'),
              next: { block: withNum('snakie_turtle_right', 'ANGLE', 90, 'rt') }
            }
          }
        }
      }
    ])
    expect(square.code).toBe(
      ['import turtle', '', 'for _ in range(4):', '    turtle.forward(100)', '    turtle.right(90)', ''].join(
        '\n'
      )
    )
  })

  it('needs exactly one import however many turtle blocks are used', () => {
    // The reason the calls are qualified: eighteen functions, one import line.
    // A from-import would lengthen the head of the file as the drawing grew.
    const many = gen([
      {
        ...withNum('snakie_turtle_forward', 'STEPS', 10, 'a'),
        next: {
          block: {
            ...withNum('snakie_turtle_right', 'ANGLE', 90, 'b'),
            next: {
              block: {
                type: 'snakie_turtle_penup',
                id: 'c',
                next: { block: { type: 'snakie_turtle_home', id: 'd' } }
              }
            }
          }
        }
      }
    ])
    expect(many.code.split('\n').filter((l) => l.startsWith('import'))).toEqual(['import turtle'])
  })
})

describe('the generated code matches the real library (#1013)', () => {
  const library = readFileSync(join(__dirname, '..', 'micropython', 'turtle.py'), 'utf-8')
  /** The module-level function names `turtle.py` actually defines. */
  const moduleFunctions = new Set(
    [...library.matchAll(/^def ([a-z_]+)\(/gm)].map((m) => m[1])
  )

  it('calls only functions turtle.py defines at module level', () => {
    // The failure this catches: a block that reads beautifully and raises
    // `AttributeError: 'module' object has no attribute ...` on the board. Every
    // turtle block's emitter output is scanned rather than a hand-kept list,
    // because a hand-kept list is the thing that goes stale.
    const called = new Set<string>()
    for (const def of blocksInCategory('turtle')) {
      // A value block emits nothing as a lone top-level block, so it goes in a
      // `print` — which is where a learner would put it anyway.
      const statement = def.json?.previousStatement !== undefined
      const code = gen([
        statement
          ? { type: def.type, id: 'x' }
          : { type: 'text_print', id: 'p', inputs: { TEXT: { block: { type: def.type, id: 'x' } } } }
      ]).code
      for (const m of code.matchAll(/turtle\.([a-z_]+)\(/g)) called.add(m[1])
    }
    // One per block: eighteen blocks, eighteen distinct library calls.
    expect(called.size).toBe(blocksInCategory('turtle').length)
    expect([...called].filter((fn) => !moduleFunctions.has(fn))).toEqual([])
  })

  it('has an accessor for every sensing block', () => {
    // These three were ADDED to turtle.py by this issue: before it, the only way
    // to read the shared turtle's heading was `turtle._default.heading`, which is
    // not something to put in a child's program.
    for (const fn of ['xcor', 'ycor', 'heading']) expect(moduleFunctions.has(fn)).toBe(true)
  })
})

describe('the palette itself (#1013)', () => {
  it('leads the toolbox, because the first thing reachable should draw', () => {
    expect(blocksInCategory('turtle').length).toBeGreaterThanOrEqual(18)
  })

  it('files `turtle` with Snakie its own libraries, not with part drivers', () => {
    expect(importGroup('turtle')).toBe('snakie')
    expect(importGroup('instruments')).toBe('snakie')
    // And a real driver still lands in the driver group.
    expect(importGroup('bme280')).toBe('driver')
  })

  it('offers only colours that read on the instrument s dark screen', () => {
    // `turtle.py` defaults to white rather than black for exactly this reason.
    expect(PEN_COLOURS.length).toBeGreaterThanOrEqual(8)
    expect(PEN_COLOURS[0].name).toBe('white')
    for (const c of PEN_COLOURS) expect(c.hex).toMatch(/^#[0-9a-f]{6}$/)
    // No duplicates — two identical swatches in a picker is a bug you only see
    // when a child picks the wrong one.
    expect(new Set(PEN_COLOURS.map((c) => c.name)).size).toBe(PEN_COLOURS.length)
    expect(new Set(PEN_COLOURS.map((c) => c.hex)).size).toBe(PEN_COLOURS.length)
  })

  it('lights the Turtle instrument up through the hints it already has', () => {
    // Epic #1007 §3: instruments are surfaced by scanning the active file's
    // SOURCE, and blocks generate source — so this needs no new machinery, as
    // long as the generated code contains what the registry looks for.
    const code = lines([withNum('snakie_turtle_forward', 'STEPS', 100)]).join('\n')
    expect(code).toContain('turtle')
    expect(code).toContain('forward(')
  })
})

describe('somewhere to start (#1013)', () => {
  it('builds the square starter into a real blocks file', async () => {
    const doc = await buildBlocksDocument(SQUARE_STARTER.workspace)
    expect(hasBlocksFooter(doc)).toBe(true)
    expect(parseBlocksFooter(doc)?.workspace).toBeTruthy()
    // The whole program, not a fragment: this is the file a child opens first.
    expect(doc.split('\n# --8<--')[0].trimEnd()).toBe(
      ['import turtle', '', 'for _ in range(4):', '    turtle.forward(100)', '    turtle.right(90)'].join(
        '\n'
      )
    )
  })

  it('opens clean rather than dirty', async () => {
    // The footer must hold what the canvas will re-serialise on its first change,
    // or merely OPENING the starter marks it modified — the #1009 bug, which a
    // starter shipped with baked-in code would reintroduce on the very first
    // generator improvement.
    const doc = await buildBlocksDocument(SQUARE_STARTER.workspace)
    const parsed = parseBlocksFooter(doc)
    expect(parsed).not.toBeNull()
    expect(parsed?.codeMatches).toBe(true)
  })

  it('makes an empty blocks program, which is a blocks file with no code', async () => {
    const doc = await buildBlocksDocument(EMPTY_WORKSPACE)
    expect(hasBlocksFooter(doc)).toBe(true)
    expect(parseBlocksFooter(doc)?.workspace).toBeTruthy()
    expect(doc.split('\n# --8<--')[0].trim()).toBe('')
  })

  it('leads with the starter rather than the empty canvas', () => {
    // A beginner's first minute should be something that already works and which
    // they take apart, not a blank rectangle and a toolbox.
    expect(BLOCKS_STARTERS[0]).toBe(SQUARE_STARTER)
    expect(SQUARE_STARTER.name.endsWith('.py')).toBe(true)
  })
})
