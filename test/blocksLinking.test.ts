import { describe, it, expect, beforeAll } from 'vitest'
import * as Blockly from 'blockly/core'
import { generateProgram } from '../src/renderer/src/lib/blocks/generator'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import { installBlockDefinitions } from '../src/renderer/src/lib/blocks/registry'
import { coerceBlocks, coerceView, coerceViewMode, loadCourses } from '../src/renderer/src/lib/courses'
import { defaultBlocksViewMode } from '../src/renderer/src/store/layout'

/**
 * THE LINK BETWEEN THE TWO PANES (#1016, epic #1007).
 * =============================================================================
 *
 * Hover a block, its Python lights up; click a line, its block is selected. Both
 * directions come out of #1010's source map, so what is tested here is that the
 * map ANSWERS BOTH QUESTIONS CONSISTENTLY over real programs — a block whose
 * lines do not map back to it would light up the wrong thing, which is worse
 * than lighting up nothing.
 */

beforeAll(() => {
  installCorePalette()
  installBlockDefinitions()
})

const num = (n: number): Record<string, unknown> => ({ type: 'math_number', fields: { NUM: n } })

function program(blocks: unknown[]): ReturnType<typeof generateProgram> {
  const ws = new Blockly.Workspace()
  Blockly.serialization.workspaces.load({ blocks: { languageVersion: 0, blocks } } as never, ws)
  const out = generateProgram(ws)
  expect(out.missing).toEqual([])
  return out
}

/** The square: a loop with two blocks in it — the epic's own worked example. */
const SQUARE = [
  {
    type: 'controls_repeat_ext',
    id: 'rep',
    inputs: {
      TIMES: { shadow: num(4) },
      DO: {
        block: {
          type: 'snakie_turtle_forward',
          id: 'fwd',
          inputs: { STEPS: { shadow: num(100) } },
          next: {
            block: {
              type: 'snakie_turtle_right',
              id: 'right',
              inputs: { ANGLE: { shadow: num(90) } }
            }
          }
        }
      }
    }
  }
]

/** A program with a function, so the map is tested across the hoisted section. */
const WITH_FUNCTION = [
  {
    type: 'procedures_defnoreturn',
    id: 'def',
    extraState: { params: [] },
    fields: { NAME: 'blink' },
    inputs: {
      STACK: {
        block: { type: 'snakie_led_toggle', id: 'toggle', fields: { PIN: '15' } }
      }
    }
  },
  { type: 'procedures_callnoreturn', id: 'call', extraState: { name: 'blink' }, x: 0, y: 200 }
]

describe('both directions agree (#1016)', () => {
  it('round-trips every block through its lines and back', () => {
    // The property that makes the link trustworthy: for every block that owns
    // lines, every one of those lines maps back to THAT block. A map that broke
    // this would light up a block other than the one under the cursor.
    for (const fixture of [SQUARE, WITH_FUNCTION]) {
      const { sourceMap, blockLines } = program(fixture)
      expect(blockLines.size).toBeGreaterThan(0)
      for (const [blockId, lines] of blockLines) {
        expect(lines.length, blockId).toBeGreaterThan(0)
        for (const line of lines) expect(sourceMap.get(line), `line ${line}`).toBe(blockId)
      }
    }
  })

  it('answers for every line of a program, or honestly says no block', () => {
    const { code, sourceMap } = program(SQUARE)
    const lines = code.split('\n')
    lines.forEach((text, i) => {
      const owner = sourceMap.get(i + 1)
      if (text.trim() === '' || text.startsWith('import ') || text.startsWith('from ')) {
        // Imports and blanks belong to no block. Inventing an owner would put a
        // highlight on an innocent block every time somebody clicked line 1.
        expect(owner, text).toBeUndefined()
      } else {
        expect(owner, text).toBeTruthy()
      }
    })
  })

  it('lights up a loop and the blocks inside it separately', () => {
    // Hovering the `repeat` should light its own line, NOT the whole body —
    // otherwise "which bit did this block write?" has the same answer for every
    // block in the program.
    const { code, blockLines } = program(SQUARE)
    const lines = code.split('\n')
    const lineOf = (needle: string): number => lines.findIndex((l) => l.includes(needle)) + 1
    expect(blockLines.get('rep')).toEqual([lineOf('for _ in range')])
    expect(blockLines.get('fwd')).toEqual([lineOf('forward(100)')])
    expect(blockLines.get('right')).toEqual([lineOf('right(90)')])
  })

  it('maps a line inside a hoisted function to the block inside the function', () => {
    // The generator lifts `def` blocks above the program, so the lines a
    // function's body owns are nowhere near where its block sits on the canvas.
    // The map is what makes that invisible to the learner.
    const { code, sourceMap, blockLines } = program(WITH_FUNCTION)
    const lines = code.split('\n')
    const bodyLine = lines.findIndex((l) => l.includes('.toggle()')) + 1
    const setupLine = lines.findIndex((l) => l.includes('= Pin(15')) + 1
    expect(sourceMap.get(bodyLine)).toBe('toggle')
    // BOTH lines, and the second one matters: the hoisted `pin_15 = Pin(...)`
    // sits in the setup section, nowhere near the function it is used in, and
    // #1010 attributes it to the block that ASKED for it. So hovering the toggle
    // lights up the object it needs as well as the call it makes — which is the
    // honest answer to "what did this block write?".
    expect(blockLines.get('toggle')).toEqual([bodyLine, setupLine])
    // …and the call, which is a different block entirely.
    expect(blockLines.get('call')).toEqual([lines.findIndex((l) => l === 'blink()') + 1])

    // AND NO MARKER LEAKED. A `def` generates nothing where it stands, so it
    // gets no marker; before #1016 it got one anyway, which fused with the next
    // block's line and left a NUL byte in the Python that was saved to the file
    // and sent to the board.
    expect(code).not.toContain(String.fromCharCode(0))
  })

  it('has no lines for a block that generates nothing on its own', () => {
    // A value block plugged into nothing. "Show me the Python" says so rather
    // than showing an empty box, which is why it asks the map rather than
    // assuming every block has an answer.
    const { blockLines } = program([{ type: 'snakie_turtle_x', id: 'lonely' }])
    expect(blockLines.get('lonely')).toBeUndefined()
  })
})

describe('what each switcher position opens (#1053, was #1016)', () => {
  it('Blocks means blocks, Code means Python', () => {
    // #1016 made SPLIT the default in Blocks, and gave a good reason: "a
    // canvas-primary default hid that behind a control most people never
    // press, which is the same as not shipping it". That was about
    // DISCOVERABILITY — and the control it worried about did not exist, since
    // #1034 replaced the three buttons with the divider, which is elegant and
    // invisible.
    //
    // #1053 adds the dot between the two segments, so the split is one visible
    // click away. Blocks can go back to meaning blocks.
    expect(defaultBlocksViewMode('blocks')).toBe('blocks')
    expect(defaultBlocksViewMode('code')).toBe('python')
  })

  it('and the dot means both, from whichever side you press it', () => {
    expect(defaultBlocksViewMode('blocks', true)).toBe('split')
    expect(defaultBlocksViewMode('code', true)).toBe('split')
  })

  it('a solo workspace lands on blocks rather than nowhere', () => {
    // Electronics and Build never show the editor, so their answer only matters
    // if somebody switches away with a blocks file open.
    expect(defaultBlocksViewMode('board')).toBe('blocks')
    expect(defaultBlocksViewMode('robot')).toBe('blocks')
  })
})

describe('the blocks lesson track (#1016)', () => {
  const course = loadCourses().find((c) => c.id === 'blocks')

  it('is bundled, and every lesson opens on the canvas', () => {
    expect(course, 'the blocks course should be bundled').toBeTruthy()
    expect(course!.lessons.length).toBeGreaterThanOrEqual(6)
    for (const lesson of course!.lessons) {
      // A blocks lesson hands over a CANVAS. One with only `code` would be a
      // lesson about blocks with no blocks in it.
      expect(lesson.blocks, lesson.title).toBeTruthy()
      expect(lesson.view, lesson.title).toBe('blocks')
      expect(lesson.body.length, lesson.title).toBeGreaterThan(200)
    }
  })

  it('ends with the handover, opening Python-primary', () => {
    // The visual form of the handover: the last lesson is "the same program, in
    // Python", and it opens with the Python big and the blocks peeking.
    const last = course!.lessons[course!.lessons.length - 1]
    expect(last.title).toMatch(/Python/)
    expect(last.viewMode).toBe('python')
    // …and it is the ONLY one that asks, so the rest get the split default.
    const asking = course!.lessons.filter((l) => l.viewMode !== undefined)
    expect(asking).toHaveLength(1)
  })

  it('carries workspaces the canvas can actually read', () => {
    for (const lesson of course!.lessons) {
      const ws = lesson.blocks as { blocks?: { blocks?: unknown[] } }
      expect(ws.blocks?.blocks?.length, lesson.title).toBeGreaterThan(0)
    }
  })

  it('generates a runnable program from every lesson starter', () => {
    // The starters are data, so nothing else would notice a workspace that no
    // longer generates — until a child opened the lesson.
    for (const lesson of course!.lessons) {
      const ws = new Blockly.Workspace()
      Blockly.serialization.workspaces.load(lesson.blocks as never, ws)
      const out = generateProgram(ws)
      expect(out.missing, lesson.title).toEqual([])
      expect(out.code.trim().length, lesson.title).toBeGreaterThan(0)
    }
  })
})

describe('reading a lesson s declarations (#1016)', () => {
  it('accepts the blocks workspace as a workspace', () => {
    expect(coerceView('blocks')).toBe('blocks')
    expect(coerceView('canvas')).toBe('blocks')
  })

  it('refuses a malformed starter rather than letting it reach the canvas', () => {
    // #1009 established that a workspace the deserialiser throws on is the
    // failure that can lose a program. Course YAML is hand-authored.
    expect(coerceBlocks(undefined)).toBeUndefined()
    expect(coerceBlocks('nope')).toBeUndefined()
    expect(coerceBlocks([])).toBeUndefined()
    expect(coerceBlocks({ notBlocks: 1 })).toBeUndefined()
    expect(coerceBlocks({ blocks: { languageVersion: 0, blocks: [] } })).toBeTruthy()
  })

  it('reads a view mode, and shrugs at one it does not know', () => {
    expect(coerceViewMode('python')).toBe('python')
    expect(coerceViewMode('split')).toBe('split')
    expect(coerceViewMode('BLOCKS')).toBe('blocks')
    // Unknown ⇒ use the workspace default, which since #1016 is the split.
    expect(coerceViewMode('sideways')).toBeUndefined()
    expect(coerceViewMode(undefined)).toBeUndefined()
  })
})
