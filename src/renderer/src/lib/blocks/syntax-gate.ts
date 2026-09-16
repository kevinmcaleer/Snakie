import { scratchBlock, scratchName } from '../../../../shared/device-scratch'
import { checkPython } from './python-check'
import { isSuiteHeader, logicalLines } from './python-tokens'

/**
 * THE PARSE GATE (#1037, epic #1007).
 * =============================================================================
 *
 * #1034 turns the code pane's text back into blocks every time the learner
 * pauses typing. Half-written code is still code, and it converts into
 * something very different from the finished line — `if x` with no colon yet is
 * not a condition, it is a raw Python block, and it becomes an `if` again a
 * keystroke later. The canvas churns under their hands while they type.
 *
 * The debounce makes that rarer. This makes it correct: **reconvert only when
 * the text parses**, and leave the blocks they already have on screen while it
 * does not. Nothing is shown, nothing is warned about — a program mid-sentence
 * is not an error, it is a program mid-sentence.
 *
 * WHERE THE ANSWER COMES FROM, in order of how much it is worth:
 *
 *  1. **The board's own `compile()`.** The #1019 spike went looking for a Python
 *     AST and found none worth the megabyte — but it found this on the way, and
 *     wrote it down in `docs/blockly-epic.md` §5. `compile()` returns an opaque
 *     object we cannot walk, which is why it was no use as a parser; "did that
 *     raise a SyntaxError?" is the one question it answers perfectly, and it is
 *     answered by the very Python the learner's code will run on.
 *  2. **#1018's lint** (`checkPython`), when there is no board to ask. A lexer
 *     guessing at unclosed brackets is weaker than an interpreter, but the
 *     Blocks workspace is explicitly meant to work on a Chromebook with nothing
 *     plugged in (epic #267), so the gate must have an answer there too.
 *
 * WHEN WE DO NOT ASK THE BOARD, and these matter more than the feature does:
 *
 *  - **A program is running.** `exec` goes through the raw REPL, which
 *    interrupts whatever the board is doing. Asking every 450ms while a
 *    learner's blink loop runs would kill their program over and over, to
 *    tidy up a canvas. Never worth it.
 *  - **Nothing is connected**, or the board takes too long to answer. A gate
 *    that can stall the canvas is worse than a gate that guesses, so the
 *    device path is on a short timeout and failure means "fall back", never
 *    "block".
 *
 * Dependency-injected rather than reaching for `window.api` itself, so the
 * decision table above is a unit test rather than something you find out by
 * plugging a board in.
 */

/** How long the board gets to answer before we stop waiting and use the lint. */
export const SYNTAX_PROBE_TIMEOUT_MS = 1500

/** Where a verdict came from — for tests, and for anyone debugging a churn. */
export type SyntaxSource = 'device' | 'lint'

export interface SyntaxVerdict {
  /** Does this text parse? Reconvert only when true. */
  ok: boolean
  source: SyntaxSource
}

/** Run code on the board. The shape of `window.api.device.exec`. */
export type DeviceExec = (code: string) => Promise<{ stdout: string; stderr: string }>

export interface SyntaxGateDeps {
  /**
   * The board, when there is one worth asking — `null` when nothing is
   * connected OR a program is running. The caller decides, because the caller
   * is the one with the status subscription.
   */
  exec: DeviceExec | null
  /** Overridable so a test does not wait a second and a half. */
  timeoutMs?: number
}

/** The sentinel the probe prints, chosen so no learner's output collides. */
const MARK = 'SNKSYN'

/**
 * Ask a board whether `source` parses.
 *
 * The source crosses the wire **base64-encoded**. The obvious alternative — a
 * triple-quoted literal — breaks the moment the learner's own code contains the
 * delimiter, which is exactly the kind of text somebody types while exploring
 * strings. Base64 has no delimiter to collide with.
 *
 * `compile()` is the whole point, and note what is NOT caught: a `SyntaxError`
 * fails the gate, and any other exception passes it. A `MemoryError` compiling
 * a large program means the board could not answer, not that the program is
 * wrong, and refusing to reconvert on that would freeze the canvas for the
 * rest of the session.
 */
export function syntaxProbe(source: string): string {
  const src = scratchName('src')
  const err = scratchName('err')
  const b64 = base64(source)
  return scratchBlock(
    [
      'import binascii',
      `${src} = binascii.a2b_base64('${b64}').decode()`,
      'try:',
      `    compile(${src}, '<blocks>', 'exec')`,
      `    print('${MARK} ok')`,
      `except SyntaxError as ${err}:`,
      `    print('${MARK} bad')`,
      'except Exception:',
      // Not a syntax problem — a board that ran out of memory compiling is not
      // a learner who typed something wrong.
      `    print('${MARK} ok')`
    ],
    src,
    err
  )
}

/** Read the probe's answer. `null` when the board said nothing we understand. */
export function readSyntaxProbe(stdout: string): boolean | null {
  // Last wins: telemetry and a learner's own prints share this stream, and the
  // probe's line is the most recent thing on it.
  const lines = stdout.split('\n').filter((l) => l.includes(MARK))
  const last = lines[lines.length - 1]
  if (!last) return null
  if (last.includes(`${MARK} ok`)) return true
  if (last.includes(`${MARK} bad`)) return false
  return null
}

/**
 * Does `source` parse?
 *
 * Never throws and never leaves the caller waiting: every failure of the device
 * path — no board, a timeout, a garbled answer, a rejected promise — falls
 * through to the lint, which is synchronous and always has an opinion.
 */
export async function syntaxOk(source: string, deps: SyntaxGateDeps): Promise<SyntaxVerdict> {
  // Empty is not "unparseable", it is an empty program, and it converts to an
  // empty canvas perfectly well. Short-circuited so deleting everything still
  // clears the blocks rather than leaving the last ones stranded.
  if (source.trim() === '') return { ok: true, source: 'lint' }
  if (deps.exec) {
    try {
      const answer = await withTimeout(
        deps.exec(syntaxProbe(source)),
        deps.timeoutMs ?? SYNTAX_PROBE_TIMEOUT_MS
      )
      const verdict = answer ? readSyntaxProbe(answer.stdout) : null
      if (verdict !== null) return { ok: verdict, source: 'device' }
    } catch {
      // A board that errored, disconnected mid-probe or sent nonsense is a
      // board we stop asking about THIS keystroke, not a reason to refuse.
    }
  }
  return { ok: lintOk(source), source: 'lint' }
}

/**
 * The no-board answer: #1018's per-line lint, run over the whole program.
 *
 * `logicalLines` already joins a line continued across brackets, so an unclosed
 * `(` swallows the rest of the file and comes back as the one problem it is —
 * which is the commonest mid-sentence state there is.
 *
 * **THE COLON IS THE CATCH**, and it is worth stating because getting it wrong
 * blocks every real program. `checkPython` was written for ONE FIELD of one
 * block, where a trailing `:` genuinely is an error: the block holds a single
 * statement and its body is the block's own socket. In a *file*, a trailing `:`
 * is how you open a suite, and `while True:` is not half a line. So a suite
 * header is linted without it.
 *
 * Deliberately WEAKER than the interpreter, and deliberately biased towards
 * saying yes: a false "ok" costs one churned canvas and self-corrects on the
 * next keystroke, while a false "not ok" freezes the blocks until the learner
 * happens to type something the lexer likes. Only the second is a hole they
 * cannot get out of.
 */
export function lintOk(source: string): boolean {
  const lines = logicalLines(source)
  const last = lines[lines.length - 1]
  // A header with nothing under it yet — the learner typed `while True:` and is
  // about to type the body. Real Python rejects it too (an indented block is
  // expected), and holding the blocks still for one more keystroke is precisely
  // the churn this gate exists to stop.
  if (last && isSuiteHeader(last.text)) return false
  return lines.every((line) => {
    const text = isSuiteHeader(line.text) ? line.text.replace(/:\s*$/, '') : line.text
    return checkPython(text, 'statement') === null
  })
}

/** Resolve to `null` rather than rejecting when the wait runs out. */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * UTF-8 → base64, without assuming `Buffer`.
 *
 * `btoa` is bytes-only and throws on anything above U+00FF, and a learner's
 * program can hold an emoji in a string or a `°` in a comment. `TextEncoder`
 * is in every browser this ships to and in node, which is where the tests run.
 */
function base64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}
