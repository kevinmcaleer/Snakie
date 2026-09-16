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
import { blocksDocumentFor } from '../src/renderer/src/lib/blocks/document'
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
    // Two-space indent, and the depths still come out 0/1/2. The lines are token
    // SHAPES rather than text — names, numbers and strings as placeholders — so
    // the comparison survives the generator's own house style.
    expect(conversionShape('if x:\n  if y:\n    print(1)\n')).toEqual([
      '0:if n :',
      '1:if n :',
      '2:n ( # )'
    ])
  })

  it('forgives the house style the generator renders in', () => {
    // Measured against the .py files this repo ships: comparing rendered text
    // rejected two files in three on nothing but these.
    expect(sameProgram('x = "hi"\n', "x = 'hi'\n")).toBe(true) // quote style
    expect(sameProgram('duty +=1\n', 'duty += 1\n')).toBe(true) // spacing
    expect(sameProgram('id = 0\n', 'id_ = 0\n')).toBe(true) // a protected builtin
    // And the hoisting, which is why the bag is not a sequence.
    expect(sameProgram('go()\ndef go():\n    pass\n', 'def go():\n    pass\n\ngo()\n')).toBe(
      true
    )
  })

  it('still catches a comment dropped from a line it recognised', () => {
    // The token shape alone cannot see a comment — the lexer stops at the `#` —
    // so the signature carries it separately, for exactly this case.
    expect(sameProgram('x = 5  # how many\n', 'x = 5\n')).toBe(false)
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
 * THE GATE, AGAINST REAL FILES (#1068).
 * ---------------------------------------------------------------------------
 *
 * The unit tests above say what the comparison is meant to forgive. This one
 * says whether it actually does, over the `.py` files this repository ships —
 * drivers, examples, the on-device library — which is the only way to find out
 * that a rule reads well and rejects two files in three.
 *
 * It is a FLOOR, not a target. The files it still holds are ones where the
 * converter genuinely changes the program (chained comparisons flattened,
 * `+=` on a string read as arithmetic), each of which is its own fix; the
 * number goes up as those land. What this test is here to catch is the number
 * going DOWN, which would mean the gate has started refusing programs it used
 * to accept — the failure mode that makes the blocks stop following anybody.
 */
describe('the gate against the files this repo ships (#1068)', () => {
  it('accepts the great majority of them', async () => {
    const { readdirSync, readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const files: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) walk(path)
        else if (entry.name.endsWith('.py')) files.push(path)
      }
    }
    for (const root of ['micropython', 'examples']) {
      try {
        walk(root)
      } catch {
        /* not checked out — the assertion below still holds on an empty list */
      }
    }

    let accepted = 0
    for (const path of files) {
      const doc = blocksDocumentFor(readFileSync(path, 'utf8'))
      if (!doc) continue
      if ((await verifyConversion(doc.code, doc.workspace)).ok) accepted += 1
    }
    // 43 of 56 when this was written. The margin is for files being added, not
    // for the gate getting stricter.
    expect(accepted / Math.max(files.length, 1)).toBeGreaterThan(0.7)
  })
})
