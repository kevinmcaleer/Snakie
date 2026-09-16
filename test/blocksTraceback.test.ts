import { describe, it, expect, beforeAll } from 'vitest'
import * as Blockly from 'blockly/core'
import { generateProgram } from '../src/renderer/src/lib/blocks/generator'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import { installBlockDefinitions } from '../src/renderer/src/lib/blocks/registry'
import {
  blockForLine,
  friendlyError,
  isRealError,
  parseTraceback,
  TracebackWatcher
} from '../src/renderer/src/lib/blocks/traceback'

/**
 * TRACEBACKS THAT LAND ON A BLOCK (#1015, epic #1007).
 * =============================================================================
 *
 * The thing this has to get right is WHICH LINE, and the answer is not "the
 * innermost frame": a program that calls into `instruments.py` and fails in
 * there has its innermost frame in a file nobody dragged. Every case below is
 * one a learner actually produces.
 */

beforeAll(() => {
  installCorePalette()
  installBlockDefinitions()
})

const TB = (body: string): string => `Traceback (most recent call last):\n${body}`

describe('parsing a traceback (#1015)', () => {
  it('reads the line and the error out of the simplest one', () => {
    const parsed = parseTraceback(
      TB('  File "<stdin>", line 7, in <module>\nZeroDivisionError: divide by zero')
    )
    expect(parsed).toMatchObject({
      line: 7,
      error: 'ZeroDivisionError',
      message: 'divide by zero'
    })
  })

  it('takes the LAST <stdin> frame when the error is inside a function', () => {
    // The learner defined `blink` and called it from the top level. The failing
    // line is inside the function — line 3 — and that is the block to point at,
    // not the call on line 9.
    const parsed = parseTraceback(
      TB(
        [
          '  File "<stdin>", line 9, in <module>',
          '  File "<stdin>", line 3, in blink',
          "AttributeError: 'Pin' object has no attribute 'flash'"
        ].join('\n')
      )
    )
    expect(parsed?.line).toBe(3)
  })

  it('takes the last frame that is the LEARNER S program, not a library frame', () => {
    // The innermost frame is `instruments.py`, which nobody dragged and which
    // has no line in the generated program at all. The call they made is the
    // last `<stdin>` frame, and that is the block that is theirs to fix.
    const parsed = parseTraceback(
      TB(
        [
          '  File "<stdin>", line 12, in <module>',
          '  File "instruments.py", line 402, in read_adc',
          'AttributeError: no attribute read_u16'
        ].join('\n')
      )
    )
    expect(parsed?.line).toBe(12)
  })

  it('returns a traceback with NO line rather than guessing one', () => {
    // Every frame is inside a library: the program is not on the stack, so there
    // is no honest block to blame.
    const parsed = parseTraceback(
      TB('  File "instruments.py", line 402, in read_adc\nOSError: [Errno 19] ENODEV')
    )
    expect(parsed?.line).toBeNull()
    expect(parsed?.error).toBe('OSError')
  })

  it('ignores a half-arrived traceback', () => {
    // Serial arrives in chunks. A traceback without its verdict line would make
    // us point at whichever frame happened to have streamed in so far.
    expect(parseTraceback(TB('  File "<stdin>", line 7, in <module>'))).toBeNull()
    expect(parseTraceback('Traceback (most recent')).toBeNull()
  })

  it('finds the LAST traceback when a loop printed several', () => {
    const two =
      TB('  File "<stdin>", line 2, in <module>\nValueError: first\n') +
      TB('  File "<stdin>", line 9, in <module>\nValueError: second')
    expect(parseTraceback(two)).toMatchObject({ line: 9, message: 'second' })
  })

  it('keeps the board s own words verbatim', () => {
    // Nothing is hidden: the raw text is what the console shows and what the
    // learner is graduating to.
    const raw = TB('  File "<stdin>", line 4, in <module>\nNameError: name \'x\' is not defined')
    expect(parseTraceback(raw)?.raw).toBe(raw)
  })
})

describe('a traceback line to a block (#1015)', () => {
  /** Generate a small program and hand back its map. */
  const program = (blocks: unknown[]): ReturnType<typeof generateProgram> => {
    const ws = new Blockly.Workspace()
    Blockly.serialization.workspaces.load({ blocks: { languageVersion: 0, blocks } }, ws)
    return generateProgram(ws)
  }

  it('maps a failing line onto the block that wrote it', () => {
    const out = program([
      {
        type: 'text_print',
        id: 'first',
        inputs: { TEXT: { shadow: { type: 'text', fields: { TEXT: 'hi' } } } },
        next: {
          block: {
            type: 'text_print',
            id: 'second',
            inputs: { TEXT: { shadow: { type: 'text', fields: { TEXT: 'there' } } } }
          }
        }
      }
    ])
    const lines = out.code.split('\n')
    const secondLine = lines.findIndex((l) => l.includes('there')) + 1
    expect(blockForLine(out.sourceMap, secondLine)).toBe('second')
  })

  it('maps a line INSIDE a loop onto the block in the loop, not the loop', () => {
    // #1010's map gives every line an owner, including the ones a `for` wraps —
    // otherwise an error in a loop body would blame the loop.
    const out = program([
      {
        type: 'controls_repeat_ext',
        id: 'loop',
        inputs: {
          TIMES: { shadow: { type: 'math_number', fields: { NUM: 3 } } },
          DO: {
            block: {
              type: 'text_print',
              id: 'inner',
              inputs: { TEXT: { shadow: { type: 'text', fields: { TEXT: 'x' } } } }
            }
          }
        }
      }
    ])
    const lines = out.code.split('\n')
    expect(blockForLine(out.sourceMap, lines.findIndex((l) => l.startsWith('for')) + 1)).toBe('loop')
    expect(blockForLine(out.sourceMap, lines.findIndex((l) => l.includes('print')) + 1)).toBe(
      'inner'
    )
  })

  it('gives NO block for an import line', () => {
    // The issue's "one with no mappable line". No block wrote `import turtle`,
    // and inventing an owner for it would put a red badge on an innocent block.
    const out = program([
      { type: 'snakie_turtle_forward', id: 'f', inputs: { STEPS: { shadow: { type: 'math_number', fields: { NUM: 10 } } } } }
    ])
    expect(out.code.split('\n')[0]).toBe('import turtle')
    expect(blockForLine(out.sourceMap, 1)).toBeNull()
  })

  it('gives no block for a line past the end, or for no line at all', () => {
    const out = program([{ type: 'snakie_turtle_home', id: 'h' }])
    expect(blockForLine(out.sourceMap, 9999)).toBeNull()
    expect(blockForLine(out.sourceMap, null)).toBeNull()
  })
})

describe('errors in words a beginner can act on (#1015)', () => {
  const friendly = (error: string, message: string): ReturnType<typeof friendlyError> =>
    friendlyError({ line: 1, error, message, raw: '' })

  it('offers the install when a Snakie library is missing', () => {
    expect(friendly('ImportError', "no module named 'instruments'")).toEqual({
      text: "This board hasn't got Snakie's instruments library yet.",
      install: 'instruments'
    })
    expect(friendly('ImportError', 'no module named turtle')?.install).toBe('turtle')
    // `snakie.py` is installed by the same banner as `instruments.py`.
    expect(friendly('ImportError', "no module named 'snakie'")?.install).toBe('instruments')
  })

  it('names a library it does not ship without offering to install it', () => {
    // Offering a one-click install of something we have no copy of would be a
    // button that cannot work.
    const out = friendly('ImportError', "no module named 'bme280'")
    expect(out?.text).toContain('bme280')
    expect(out?.install).toBeUndefined()
  })

  it('reads an old library on the board as what it is', () => {
    expect(friendly('AttributeError', "'module' object has no attribute 'read_pwm'")).toEqual({
      text: 'The library on this board is older than this block needs — it has no read_pwm.',
      install: 'instruments'
    })
  })

  it('explains the pin failures', () => {
    expect(friendly('OSError', '[Errno 19] ENODEV')?.text).toContain("can't do that on this board")
    expect(friendly('ValueError', 'invalid pin')?.text).toContain("can't do that on this board")
  })

  it('explains the everyday ones', () => {
    expect(friendly('ZeroDivisionError', 'divide by zero')?.text).toBe(
      'Something was divided by zero.'
    )
    expect(friendly('NameError', "name 'score' is not defined")?.text).toBe(
      'Nothing has been put in score yet.'
    )
    expect(friendly('IndexError', 'list index out of range')?.text).toBe(
      "That position isn't in the list."
    )
    expect(friendly('TypeError', 'function takes 2 positional arguments but 3 were given')?.text).toBe(
      'A block was given 3 things when it wanted 2.'
    )
  })

  it('says NOTHING for an error it does not know', () => {
    // A vague paraphrase of an error nobody anticipated is worse than the
    // board's own words, which the console has either way.
    expect(friendly('RuntimeError', 'maximum recursion depth exceeded')).toBeNull()
    expect(friendly('UnicodeError', 'whatever')).toBeNull()
  })

  it('does not treat pressing Stop as the program being broken', () => {
    // Stop raises KeyboardInterrupt wherever the program had got to. Badging
    // that block would tell a child they broke something when they pressed the
    // button that says stop.
    expect(isRealError({ line: 4, error: 'KeyboardInterrupt', message: '', raw: '' })).toBe(false)
    expect(isRealError({ line: 4, error: 'ValueError', message: '', raw: '' })).toBe(true)
  })
})

describe('watching the stream (#1015)', () => {
  it('reports a traceback split across chunks, once', () => {
    const watcher = new TracebackWatcher()
    expect(watcher.feed('Traceback (most rec')).toBeNull()
    expect(watcher.feed('ent call last):\n  File "<stdin>", line 5, in <mo')).toBeNull()
    expect(watcher.feed('dule>\nValueError: nope\n')).toMatchObject({ line: 5, error: 'ValueError' })
    // The same tail is still in the buffer; the next chunk of ordinary output
    // must not report it again and re-badge a block the learner has moved on from.
    expect(watcher.feed('hello\n')).toBeNull()
  })

  it('reports a SECOND, different traceback in the same run', () => {
    const watcher = new TracebackWatcher()
    watcher.feed(TB('  File "<stdin>", line 2, in <module>\nValueError: one\n'))
    expect(watcher.feed(TB('  File "<stdin>", line 8, in <module>\nValueError: two\n'))).toMatchObject(
      { line: 8, message: 'two' }
    )
  })

  it('forgets everything on reset, so a new run starts clean', () => {
    const watcher = new TracebackWatcher()
    const one = TB('  File "<stdin>", line 2, in <module>\nValueError: one\n')
    watcher.feed(one)
    watcher.reset()
    // The identical traceback from a NEW run is news again.
    expect(watcher.feed(one)).toMatchObject({ line: 2 })
  })

  it('does not grow without bound while a program prints in a loop', () => {
    const watcher = new TracebackWatcher()
    for (let i = 0; i < 500; i++) watcher.feed('x'.repeat(100))
    // Still finds a traceback arriving after all that.
    expect(watcher.feed(TB('  File "<stdin>", line 3, in <module>\nOSError: nope\n'))).toMatchObject(
      { line: 3 }
    )
  })
})
