import { describe, it, expect, beforeEach } from 'vitest'
import 'blockly/blocks'
import {
  conversionShape,
  sameProgram,
  verifyConversion
} from '../src/renderer/src/lib/blocks/round-trip'
import { installBlockDefinitions, resetBlockRegistry } from '../src/renderer/src/lib/blocks/registry'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import { pythonToBlocks } from '../src/renderer/src/lib/blocks/python-to-blocks'
import type { BlocksWorkspace } from '../src/shared/blocks-doc'

/**
 * THE ROUND-TRIP GATE (#1068, epic #1007).
 * =============================================================================
 *
 * The property `blocksPythonToBlocks.test.ts` is built around, promoted from a
 * test over a corpus to a check that runs before a conversion is allowed to
 * become the program. Two halves, tested apart:
 *
 *  - {@link sameProgram} decides what "the same program" means, and the whole
 *    design is in what it FORGIVES. Too strict and the blocks stop following a
 *    learner who forgot an import; too loose and it lets through the data loss
 *    it exists to catch.
 *  - {@link verifyConversion} runs the real generator over a real workspace, so
 *    its answer is about what would actually be written.
 */

beforeEach(() => {
  resetBlockRegistry()
  installCorePalette()
  installBlockDefinitions()
})

describe('what counts as the same program', () => {
  it('forgives an import the generator added', () => {
    // The commonest real case: they typed the sleep and not the import, and the
    // mirror supplying it is the mirror being useful.
    expect(sameProgram('time.sleep(1)\n', 'import time\n\ntime.sleep(1)\n')).toBe(true)
  })

  it('forgives imports being regrouped and sorted', () => {
    const typed = ['import time', 'from machine import Pin', 'x = 1', ''].join('\n')
    const generated = ['import time', '', 'from machine import Pin', '', 'x = 1', ''].join('\n')
    expect(sameProgram(typed, generated)).toBe(true)
  })

  it('forgives blank lines and a different indent width', () => {
    const typed = ['while True:', '  print(1)', '', '  print(2)', ''].join('\n')
    const generated = ['while True:', '    print(1)', '    print(2)', ''].join('\n')
    expect(sameProgram(typed, generated)).toBe(true)
  })

  it('catches a dropped statement', () => {
    expect(sameProgram('print(1)\nprint(2)\n', 'print(1)\n')).toBe(false)
  })

  it('catches a rewritten statement', () => {
    expect(sameProgram('x == 5\n', 'x = = 5\n')).toBe(false)
  })

  it('catches a dropped trailing comment', () => {
    expect(sameProgram('x = 5  # how many\n', 'x = 5\n')).toBe(false)
  })

  it('catches a body that escaped its loop', () => {
    const typed = ['while True:', '    print(1)', ''].join('\n')
    const escaped = ['while True:', '    pass', 'print(1)', ''].join('\n')
    expect(sameProgram(typed, escaped)).toBe(false)
  })

  it('counts depth off an indent stack, not off the character count', () => {
    expect(conversionShape('if x:\n  if y:\n    print(1)\n')).toEqual([
      '0:if x:',
      '1:if y:',
      '2:print(1)'
    ])
  })
})

describe('verifying a real conversion', () => {
  /** Convert, then ask the gate what it thinks — the whole path, as it runs. */
  const check = async (src: string): ReturnType<typeof verifyConversion> =>
    verifyConversion(src, pythonToBlocks(src).workspace)

  it('passes a program that converts faithfully', async () => {
    const src = ['import turtle', '', 'for _ in range(4):', '    turtle.forward(100)', ''].join('\n')
    expect(await check(src)).toEqual({ ok: true })
  })

  it('passes a program that is nothing but raw blocks', async () => {
    // The #1018 guarantee: unrecognised is not unfaithful.
    const src = ['robot.drive(left=1, right=2)', "with open(p, 'rb') as f:", '    blob = f.read()', ''].join('\n')
    expect(await check(src)).toEqual({ ok: true })
  })

  it('passes the loop that used to crash the canvas (#1068)', async () => {
    const src = [
      'import time',
      '',
      'while True:',
      '    if button.value():',
      '        break',
      '    time.sleep(0.1)',
      'led.off()',
      ''
    ].join('\n')
    expect(await check(src)).toEqual({ ok: true })
  })

  it('holds back a workspace Blockly will not load', async () => {
    // Exactly the shape #1068 was: a chain hung off a block with no next
    // connection. The gate answers before it can reach the canvas and throw.
    const workspace: BlocksWorkspace = {
      blocks: {
        languageVersion: 0,
        blocks: [
          {
            type: 'snakie_forever',
            inputs: { DO: { block: { type: 'text_print', inputs: {} } } },
            next: { block: { type: 'text_print', inputs: {} } }
          }
        ]
      }
    }
    expect(await verifyConversion('while True:\n    pass\n', workspace)).toEqual({
      ok: false,
      reason: 'unloadable'
    })
  })

  it('holds back a workspace that regenerates a different program', async () => {
    // A workspace that says something the code does not.
    const workspace = pythonToBlocks('print(1)\n').workspace
    expect(await verifyConversion('print(1)\nprint(2)\n', workspace)).toEqual({
      ok: false,
      reason: 'lossy'
    })
  })

  it('holds back a workspace holding a block with no emitter', () => {
    // A core Blockly block the Snakie palette never registers: Blockly renders
    // it, the generator has nothing to emit for it, and the program is a step
    // short however similar the text looks. This is the shape a part block takes
    // when its part is unwired mid-session.
    const workspace: BlocksWorkspace = {
      blocks: { languageVersion: 0, blocks: [{ type: 'text_append', fields: { VAR: 'x' } }] }
    }
    return expect(verifyConversion('', workspace)).resolves.toEqual({
      ok: false,
      reason: 'lossy'
    })
  })
})

/**
 * NOT ONE SHIPPED FILE MAY BE UNLOADABLE (#1071).
 * =============================================================================
 *
 * The floor #1071's finding 3 asked for, pinned over the real corpus — every
 * `.py` this repository ships, `micropython/` and `examples/`.
 *
 * `unloadable` is the verdict that costs the most: Blockly refuses the whole
 * workspace, so a single mistyped socket somewhere in a 400-line driver takes
 * every block in it. Six files were in that state, all for the same reason, and
 * this is the test that says never again — it is deliberately about `ok` vs
 * `unloadable` and says nothing about `lossy`, which is a question about how
 * MUCH became real blocks rather than whether the program survived.
 */
describe('no shipped .py converts to a workspace Blockly refuses (#1071)', () => {
  it('holds for every .py in micropython/ and examples/', async () => {
    const { readFileSync } = await import('node:fs')
    const { execSync } = await import('node:child_process')
    const files = execSync("find micropython examples -name '*.py' -not -path '*__pycache__*'", {
      encoding: 'utf8'
    })
      .trim()
      .split('\n')
      .filter(Boolean)

    // A corpus that shrank to nothing would make this test pass by saying
    // nothing, which is the failure mode a floor test exists to avoid.
    expect(files.length).toBeGreaterThan(40)

    const unloadable: string[] = []
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      const { workspace } = pythonToBlocks(source)
      const verdict = await verifyConversion(source, workspace)
      if (!verdict.ok && verdict.reason === 'unloadable') unloadable.push(file)
    }
    expect(unloadable).toEqual([])
  }, 120_000)
})
