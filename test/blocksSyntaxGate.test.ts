import { describe, it, expect } from 'vitest'
import {
  lintOk,
  readSyntaxProbe,
  syntaxOk,
  syntaxProbe
} from '../src/renderer/src/lib/blocks/syntax-gate'

/**
 * THE PARSE GATE (#1037, epic #1007).
 * =============================================================================
 *
 * #1034 reconverts on a debounce alone, so half-written code churns the canvas.
 * This gates the reconversion on "does it parse", with the board's own
 * `compile()` where there is a board and #1018's lint where there is not.
 *
 * The asymmetry the suite is built around: **a false "not ok" is much worse
 * than a false "ok"**. Saying yes to something broken costs one churned canvas
 * and self-corrects on the next keystroke; saying no to something valid freezes
 * the blocks with no way for the learner to get out of it. So the valid-program
 * cases below are the ones that matter.
 */

const VALID = [
  ['a blink loop', 'import time\n\nwhile True:\n    print(1)\n    time.sleep(0.5)\n'],
  ['a def with a return', 'def add(a, b):\n    return a + b\n\nprint(add(1, 2))\n'],
  ['an if/elif/else', 'x = 3\nif x > 2:\n    print(1)\nelif x > 1:\n    print(2)\nelse:\n    print(3)\n'],
  ['a for-each over a list', "for name in ['a', 'b']:\n    print(name)\n"],
  ['a call split across lines', 'print(\n    1,\n    2\n)\n'],
  ['a dict and a comprehension', 'd = {1: 2}\nxs = [i * 2 for i in range(3)]\nprint(d, xs)\n'],
  ['an f-string', "x = 2\nprint(f'x is {x}')\n"],
  ['a comment above a suite', '# draw it\nwhile True:\n    pass\n'],
  ['from-imports and aliases', 'from machine import Pin\nimport time as t\n\nt.sleep(1)\n']
] as const

describe('the lint says yes to valid programs (#1037)', () => {
  // The one that must never regress: each of these is a program a learner can
  // legitimately have on screen, and blocking any of them strands their canvas.
  for (const [what, source] of VALID) {
    it(`does not block ${what}`, () => {
      expect(lintOk(source)).toBe(true)
    })
  }
})

describe('the lint catches mid-sentence text (#1037)', () => {
  it('an unclosed bracket', () => {
    expect(lintOk('print(1\n')).toBe(false)
  })

  it('an unclosed string', () => {
    expect(lintOk("print('hi\n")).toBe(false)
  })

  it('a trailing operator', () => {
    expect(lintOk('x = 1 +\n')).toBe(false)
  })

  it('a suite header with nothing under it yet', () => {
    // The learner typed `while True:` and is about to type the body. Real
    // Python rejects this too, and holding the blocks still for one more
    // keystroke is exactly what the gate is for.
    expect(lintOk('while True:\n')).toBe(false)
    expect(lintOk('x = 1\nif x > 0:\n')).toBe(false)
  })

  it('but a header WITH a body is fine — the case that must not regress', () => {
    // `checkPython` calls a trailing colon an error, because in a block FIELD it
    // is one. In a file it is how you open a suite, and getting this wrong
    // blocks every real program.
    expect(lintOk('while True:\n    pass\n')).toBe(true)
  })
})

describe('the device probe (#1037)', () => {
  it('carries the source base64-encoded, not as a literal', () => {
    // A triple-quoted literal breaks the moment the learner's own code contains
    // the delimiter — which is exactly what somebody exploring strings types.
    const nasty = 'print("""not a delimiter""")\n'
    const probe = syntaxProbe(nasty)
    expect(probe).not.toContain('"""')
    expect(probe).toContain('a2b_base64')
  })

  it('survives characters btoa alone would throw on', () => {
    expect(() => syntaxProbe('print("°C 🐍")\n')).not.toThrow()
  })

  it('unbinds its scratch names even when it raises', () => {
    const probe = syntaxProbe('x = 1\n')
    expect(probe).toContain('finally:')
    expect(probe).toContain('_snk_')
  })

  it('reads ok and bad out of a noisy stream', () => {
    // The learner's own prints and SNK telemetry share this stream.
    expect(readSyntaxProbe('SNK TURT POS 0 0 0\nSNKSYN ok\n')).toBe(true)
    expect(readSyntaxProbe('hello\nSNKSYN bad\n')).toBe(false)
  })

  it('says "I do not know" when the board said nothing it recognises', () => {
    expect(readSyntaxProbe('')).toBe(null)
    expect(readSyntaxProbe('some traceback\n')).toBe(null)
  })

  it('takes the LAST answer, not the first', () => {
    expect(readSyntaxProbe('SNKSYN bad\nSNKSYN ok\n')).toBe(true)
  })
})

describe('which answer is used, and what happens when it fails (#1037)', () => {
  const ok = { stdout: 'SNKSYN ok\n', stderr: '' }

  it('asks the board when there is one', async () => {
    expect(await syntaxOk('print(1)\n', { exec: async () => ok })).toEqual({
      ok: true,
      source: 'device'
    })
  })

  it('believes the board over the lint', async () => {
    // A comprehension the lexer might not love, which the interpreter accepts.
    const verdict = await syntaxOk('xs = [i for i in range(3)]\n', {
      exec: async () => ({ stdout: 'SNKSYN bad\n', stderr: '' })
    })
    expect(verdict).toEqual({ ok: false, source: 'device' })
  })

  it('falls back to the lint with no board — the Chromebook case (#267)', async () => {
    expect(await syntaxOk('print(1)\n', { exec: null })).toEqual({ ok: true, source: 'lint' })
    expect(await syntaxOk('print(1\n', { exec: null })).toEqual({ ok: false, source: 'lint' })
  })

  it('falls back when the board rejects', async () => {
    const verdict = await syntaxOk('print(1)\n', {
      exec: async () => {
        throw new Error('board went away mid-probe')
      }
    })
    expect(verdict).toEqual({ ok: true, source: 'lint' })
  })

  it('falls back when the board answers with nonsense', async () => {
    const verdict = await syntaxOk('print(1)\n', {
      exec: async () => ({ stdout: 'Traceback (most recent call last):\n', stderr: '' })
    })
    expect(verdict).toEqual({ ok: true, source: 'lint' })
  })

  it('falls back rather than stalling when the board never answers', async () => {
    // A gate that can hang the canvas is worse than a gate that guesses.
    const verdict = await syntaxOk('print(1)\n', {
      exec: () => new Promise(() => {}),
      timeoutMs: 20
    })
    expect(verdict).toEqual({ ok: true, source: 'lint' })
  })

  it('an empty program parses, so deleting everything clears the blocks', async () => {
    // Otherwise the last blocks would be stranded on a canvas whose code is gone.
    expect((await syntaxOk('', { exec: null })).ok).toBe(true)
    expect((await syntaxOk('   \n\n', { exec: null })).ok).toBe(true)
  })
})
