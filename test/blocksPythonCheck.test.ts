import { describe, it, expect } from 'vitest'
import { checkPython } from '../src/renderer/src/lib/blocks/python-check'

/**
 * THE ESCAPE HATCHES ARE CHECKED, NOT TRUSTED (#1018, epic #1007).
 * =============================================================================
 *
 * Two properties, and the second matters more than the first.
 *
 *  1. The mistakes that actually happen when somebody types code into a small
 *     box are CAUGHT, on the block, before Run — an unclosed bracket, a
 *     statement plugged into a value socket, a `for` header with no body.
 *  2. Nothing else is. These blocks exist so that an unknown library is never a
 *     wall; a checker that refused code which would have worked would rebuild
 *     the wall out of good intentions. Every "passes" case below is there to
 *     hold that line.
 */

const code = (text: string, ctx: 'statement' | 'expression' = 'statement'): string | null =>
  checkPython(text, ctx)?.code ?? null

describe('nothing to say', () => {
  it('passes empty text — a block nobody has filled in yet is not an error', () => {
    expect(checkPython('', 'statement')).toBeNull()
    expect(checkPython('   ', 'expression')).toBeNull()
  })

  it('passes ordinary calls, attributes and literals', () => {
    for (const ok of [
      'sensor.read()',
      'oled.text("hi", 0, 0)',
      'print(f"temp: {t:.1f}")',
      'robot.drive(left=100, right=-100)',
      'buf[0] = 3',
      'x += 1',
      'del things[0]',
      'values = [1, 2, 3]',
      'config = {"pin": 15}',
      'time.sleep_ms(200)',
      'i2c.writeto(0x3c, b"\\x00")'
    ]) {
      expect(code(ok), ok).toBeNull()
    }
  })

  it('passes expressions in an expression socket', () => {
    for (const ok of [
      'sensor.read()',
      'a == b',
      'a != b',
      'x <= 3',
      'len(things)',
      'f(x=1)',
      'not ready',
      '[p for p in pins]',
      '(a + b) * 2',
      '"hello"'
    ]) {
      expect(code(ok, 'expression'), ok).toBeNull()
    }
  })

  it('passes a colon that is inside a string or a slice', () => {
    expect(code('print("time: now")')).toBeNull()
    expect(code('x = data[1:4]')).toBeNull()
    expect(code('d = {"a": 1}')).toBeNull()
  })

  it('ignores anything inside a comment', () => {
    expect(code('go()  # what about ( this')).toBeNull()
    expect(code("go()  # don't worry")).toBeNull()
  })

  it('understands escapes and triple quotes', () => {
    expect(code('print("she said \\"hi\\"")')).toBeNull()
    expect(code('doc = """one\ntwo"""')).toBeNull()
  })
})

describe('brackets and quotes', () => {
  it('catches an unclosed bracket', () => {
    expect(code('sensor.read(')).toBe('unclosed-bracket')
    expect(code('values = [1, 2')).toBe('unclosed-bracket')
    expect(code('cfg = {"pin": 15')).toBe('unclosed-bracket')
  })

  it('names the bracket in words a learner can act on', () => {
    expect(checkPython('sensor.read(', 'statement')?.message).toContain('round bracket (')
    expect(checkPython('x = [1', 'statement')?.message).toContain('square bracket [')
  })

  it('catches a closer with nothing to close', () => {
    expect(code('sensor.read())')).toBe('stray-bracket')
  })

  it('catches a mismatched pair, by the bracket that was left open', () => {
    // `f(1]` is two faults at once. Naming the unclosed `(` is the more useful
    // half: it is the one the learner has to go back and finish.
    expect(code('f(1]')).toBe('unclosed-bracket')
    expect(checkPython('f(1]', 'statement')?.message).toContain('round bracket (')
  })

  it('catches an unclosed quote', () => {
    expect(code('print("hello)')).toBe('unclosed-string')
    expect(code("name = 'bob")).toBe('unclosed-string')
  })

  it('does not let a bracket inside a string count', () => {
    expect(code('print("(")')).toBeNull()
    expect(code('print(")")')).toBeNull()
  })
})

describe('a header with no body', () => {
  it('catches a line ending in a colon, and points at the Control blocks', () => {
    expect(code('for i in range(3):')).toBe('dangling-colon')
    expect(code('if ready:')).toBe('dangling-colon')
    expect(code('def go():')).toBe('dangling-colon')
    expect(checkPython('while True:', 'statement')?.message).toMatch(/Control block/)
  })
})

describe('a statement where a value belongs', () => {
  it('catches an assignment in an expression socket', () => {
    expect(code('x = 1', 'expression')).toBe('assignment-in-expression')
  })

  it('leaves the same text alone in a statement block', () => {
    expect(code('x = 1', 'statement')).toBeNull()
  })

  it('does not mistake a keyword argument for an assignment', () => {
    // The depth test is the whole rule: a keyword argument's `=` is always
    // inside the call's brackets.
    expect(code('robot.drive(left=1, right=2)', 'expression')).toBeNull()
    expect(code('dict(a=1)', 'expression')).toBeNull()
  })

  it('does not mistake a comparison for an assignment', () => {
    for (const ok of ['a == b', 'a != b', 'a <= b', 'a >= b']) {
      expect(code(ok, 'expression'), ok).toBeNull()
    }
  })

  it('catches a statement keyword in an expression socket', () => {
    expect(code('import machine', 'expression')).toBe('statement-in-expression')
    expect(code('return 3', 'expression')).toBe('statement-in-expression')
    expect(code('pass', 'expression')).toBe('statement-in-expression')
  })

  it('does not mistake an identifier that merely starts with a keyword', () => {
    expect(code('forward(10)', 'expression')).toBeNull()
    expect(code('is_ready', 'expression')).toBeNull()
    expect(code('importance', 'expression')).toBeNull()
  })
})

describe('half-typed', () => {
  it('catches a trailing operator', () => {
    expect(code('x +')).toBe('trailing-operator')
    expect(code('a and')).toBe('trailing-operator')
    expect(code('f(1),')).toBe('trailing-operator')
  })

  it('leaves a trailing comma INSIDE brackets alone', () => {
    // `f(1,)` is legal Python and a perfectly normal thing to type.
    expect(code('f(1,)')).toBeNull()
  })
})

describe('a string is a term, not a gap (#1062)', () => {
  it('accepts a comparison against a string literal', () => {
    // THE BUG: string literals were blanked to SPACES, so `x in " ."` trimmed
    // to `x in` and read as somebody who stopped typing mid-expression. One
    // such line anywhere in a file made #1037's gate reject the whole file, and
    // the canvas simply stayed empty with nothing to say why.
    expect(checkPython('if x in " ."', 'statement')).toBeNull()
    expect(checkPython("if cell not in ' .'", 'statement')).toBeNull()
    expect(checkPython('if name is "bob"', 'statement')).toBeNull()
    expect(checkPython('x = y and "yes"', 'statement')).toBeNull()
  })

  it('still catches a line that really does stop at an operator', () => {
    // The rule is worth keeping — it just has to count a string as a term.
    expect(checkPython('x +', 'statement')?.code).toBe('trailing-operator')
    expect(checkPython('a and', 'statement')?.code).toBe('trailing-operator')
    expect(checkPython('x = "a" +', 'statement')?.code).toBe('trailing-operator')
    expect(checkPython('if x in', 'statement')?.code).toBe('trailing-operator')
  })

  it('leaves a comment-only line alone', () => {
    // Comments stay blanked to spaces: a comment is not code, and a line that
    // is only a comment should reach no rule at all.
    expect(checkPython('# just a note, ending in a comma,', 'statement')).toBeNull()
  })

  it('does not let a string hide a real problem', () => {
    expect(checkPython('print("hi"', 'statement')?.code).toBe('unclosed-bracket')
    expect(checkPython('print("hi)', 'statement')?.code).toBe('unclosed-string')
  })
})
