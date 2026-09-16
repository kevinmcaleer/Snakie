/**
 * WHICH BLOCK BROKE (#1015, epic #1007).
 * =============================================================================
 *
 * Run in block mode is the SAME Run: the generated Python goes to
 * `device.runProgram`, the output streams to the same console, and the
 * auto-connect, real-board preference and simulator fallback all come along
 * unchanged. There is no second device path and this module does not add one.
 *
 * The new work is the other direction. When the board raises, MicroPython prints
 *
 *     Traceback (most recent call last):
 *       File "<stdin>", line 7, in <module>
 *     AttributeError: 'Pin' object has no attribute 'foo'
 *
 * and a beginner is being shown a line number in a file they never wrote. This
 * module turns that text into a LINE, which #1010's source map turns into a
 * BLOCK — so the error lands on the thing they actually dragged, Scratch-style.
 *
 * NOTHING IS HIDDEN. The console keeps printing the real traceback verbatim,
 * because that text is what they are graduating to and a tool that hides it
 * teaches them to fear it. The friendly sentence sits on the block, beside it.
 *
 * Pure and Blockly-free: every rule below is a unit test rather than something
 * you discover by breaking a program on a real board.
 */

/** A traceback, parsed. */
export interface ParsedTraceback {
  /**
   * The 1-based line in the program the learner ran, or `null`.
   *
   * The LAST `<stdin>` frame, not the innermost frame overall: when a program
   * calls into `instruments.py` and the error happens in there, the innermost
   * frame is a line of a library nobody dragged. The last frame that IS the
   * learner's program is the call they made, which is the block to point at.
   */
  line: number | null
  /** The exception class, e.g. `AttributeError`. */
  error: string
  /** The exception's own message, e.g. `'Pin' object has no attribute 'foo'`. */
  message: string
  /** The whole traceback, exactly as the board printed it. */
  raw: string
}

/** The `File "<stdin>", line N` frames, in order. */
const FRAME = /File "([^"]*)", line (\d+)/g
/** The `ErrorType: message` line that ends a traceback. */
const ERROR_LINE = /^([A-Za-z_][A-Za-z0-9_]*(?:Error|Exception|Interrupt|Exit|Warning|Iteration)):?[ \t]*(.*)$/

/**
 * Parse one traceback, or `null` when `text` does not contain a complete one.
 *
 * "Complete" means it has both the header and the closing `ErrorType:` line —
 * a half-arrived traceback must not produce a half-right answer, because the
 * frame it would point at is whichever one happened to have streamed in.
 */
export function parseTraceback(text: string): ParsedTraceback | null {
  const start = text.lastIndexOf('Traceback (most recent call last):')
  if (start < 0) return null
  const body = text.slice(start)
  const lines = body.split(/\r?\n/)

  // The error line is the first NON-INDENTED line after the header: every frame
  // line is indented, so indentation is what separates them from the verdict.
  let errorIndex = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue
    if (/^\s/.test(lines[i])) continue
    errorIndex = i
    break
  }
  if (errorIndex < 0) return null
  const match = ERROR_LINE.exec(lines[errorIndex].trim())
  if (!match) return null

  const frames = [...lines.slice(0, errorIndex).join('\n').matchAll(FRAME)]
  const stdin = frames.filter((f) => f[1] === '<stdin>')
  const last = stdin[stdin.length - 1]

  return {
    line: last ? Number(last[2]) : null,
    error: match[1],
    message: match[2],
    raw: lines.slice(0, errorIndex + 1).join('\n')
  }
}

/**
 * The block a traceback line belongs to, from #1010's map.
 *
 * `null` for a line no block owns — an import line, or a line number past the
 * end of the program, which is what a traceback from inside a library frame
 * can look like when the program has none of its own frames left. A caller must
 * be able to handle that: an error with nowhere to land still belongs in the
 * console, just not on a block.
 */
export function blockForLine(sourceMap: ReadonlyMap<number, string>, line: number | null): string | null {
  if (line === null) return null
  return sourceMap.get(line) ?? null
}

/** A plain-English rendering of an error, and the library it may be asking for. */
export interface FriendlyError {
  /** One sentence, aimed at a ten-year-old. */
  text: string
  /**
   * The Snakie library this error says is missing, if any.
   *
   * The caller offers its one-click install — because `ImportError: no module
   * named 'instruments'` is not a sentence a child can act on, and the fix is
   * one button that already exists.
   */
  install?: 'instruments' | 'turtle'
}

/** The libraries Snakie installs, and the message for each. */
const MISSING_LIBRARY: Record<string, FriendlyError> = {
  instruments: {
    text: "This board hasn't got Snakie's instruments library yet.",
    install: 'instruments'
  },
  snakie: {
    text: "This board hasn't got the Snakie library yet.",
    install: 'instruments'
  },
  turtle: {
    text: "This board hasn't got the turtle drawing library yet.",
    install: 'turtle'
  }
}

/**
 * Say what went wrong in words a beginner can act on — or `null`.
 *
 * `null` MATTERS. Only the handful of errors a learner will actually hit are
 * translated; everything else keeps the board's own words, because a vague
 * paraphrase of an error we didn't anticipate is worse than the real text. The
 * raw traceback is in the console either way.
 */
export function friendlyError(parsed: ParsedTraceback): FriendlyError | null {
  const { error, message } = parsed

  if (error === 'ImportError' || error === 'ModuleNotFoundError') {
    // `no module named 'instruments'` — quoted on some ports, bare on others.
    const named = /no module named '?([A-Za-z0-9_.]+)'?/.exec(message)
    const module = named?.[1]?.split('.')[0]
    if (module && MISSING_LIBRARY[module]) return MISSING_LIBRARY[module]
    return module
      ? { text: `This board hasn't got a library called ${module}.` }
      : { text: "A library this program needs isn't on the board." }
  }

  if (error === 'AttributeError') {
    // The commonest cause by far is an OLD copy of a Snakie library on the
    // board — the block generates a call the installed version predates.
    const on = /'?(module|[A-Za-z_][A-Za-z0-9_]*)'? object has no attribute '?([A-Za-z0-9_]+)'?/.exec(
      message
    )
    if (on?.[1] === 'module') {
      return {
        text: `The library on this board is older than this block needs — it has no ${on[2]}.`,
        install: 'instruments'
      }
    }
    return on
      ? { text: `A ${on[1]} can't do ${on[2]}.` }
      : { text: "Something was asked to do something it can't." }
  }

  if (error === 'NameError') {
    const name = /name '?([A-Za-z0-9_]+)'? (?:isn't|is not) defined/.exec(message)
    return name
      ? { text: `Nothing has been put in ${name[1]} yet.` }
      : { text: 'Something was used before it was given a value.' }
  }

  if (error === 'ZeroDivisionError') return { text: 'Something was divided by zero.' }
  if (error === 'IndexError') return { text: "That position isn't in the list." }
  if (error === 'KeyError') return { text: "That name isn't in the list." }
  if (error === 'MemoryError') return { text: 'The board ran out of memory.' }
  if (error === 'OverflowError') return { text: 'That number is too big for the board.' }

  if (error === 'TypeError') {
    const args = /takes (\d+) positional arguments? but (\d+)/.exec(message)
    if (args) return { text: `A block was given ${args[2]} things when it wanted ${args[1]}.` }
    return { text: 'A block was given the wrong kind of thing.' }
  }

  if (error === 'ValueError' || error === 'OSError') {
    // The pin failures: a pin that can't do the job, or nothing wired to it.
    // `ENODEV` is what a MicroPython port raises for a peripheral that isn't
    // there, and `invalid pin` for one the hardware can't mux that way.
    if (/ENODEV|invalid pin|bad pin|Pin\(/i.test(message)) {
      return { text: "That pin can't do that on this board — check the pin on the block." }
    }
    if (error === 'ValueError') return { text: "A block was given a value it can't use." }
    return { text: 'The board had a problem talking to something wired to it.' }
  }

  return null
}

/**
 * Should this error land on a block at all?
 *
 * Pressing STOP raises `KeyboardInterrupt` wherever the program had got to, and
 * putting a red badge on whichever block was running would tell a child they
 * broke something when all they did was stop it.
 */
export function isRealError(parsed: ParsedTraceback): boolean {
  return parsed.error !== 'KeyboardInterrupt' && parsed.error !== 'SystemExit'
}

/**
 * Watch a streaming REPL for tracebacks.
 *
 * The board's output arrives in whatever chunks the serial layer hands over: a
 * traceback can be split mid-word, and several can arrive in one chunk. This
 * keeps a bounded tail of the stream and reports each COMPLETE traceback once.
 */
export class TracebackWatcher {
  private buffer = ''
  /** The last traceback reported, so a re-read of the same tail can't repeat it. */
  private lastRaw: string | null = null

  /**
   * Feed a decoded chunk. Returns a traceback when one has just completed.
   *
   * The buffer is capped: a program printing megabytes in a loop must not grow
   * this without bound, and a traceback is never more than a few hundred bytes.
   */
  feed(chunk: string): ParsedTraceback | null {
    this.buffer = (this.buffer + chunk).slice(-TAIL)
    const parsed = parseTraceback(this.buffer)
    if (!parsed || parsed.raw === this.lastRaw) return null
    this.lastRaw = parsed.raw
    return parsed
  }

  /** Forget everything — a new run starts with no memory of the last one's error. */
  reset(): void {
    this.buffer = ''
    this.lastRaw = null
  }
}

/** How much of the stream's tail to keep. Generous for a traceback, tiny for a log. */
const TAIL = 4000
