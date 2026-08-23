/**
 * Rule 63 — **Cross-compile this to `.mpy`** (epic #634 §3.7).
 *
 * ```python
 * # A 600-line module, imported on every boot…
 * import robot_control     # parsed and compiled to bytecode, every single time
 *
 * # …ships as robot_control.mpy instead: already compiled, smaller, faster to import.
 * ```
 *
 * Why it matters: when MicroPython imports a `.py` it *compiles* it — tokenise,
 * parse, build a bytecode object — on the board, at boot, every boot. The parser
 * needs heap while it runs, and on a large module that transient peak is often
 * the largest allocation your program ever makes. It is a common and very
 * confusing cause of a `MemoryError` that happens during `import`, before any of
 * your own code has run.
 *
 * `mpy-cross` does that compilation on your laptop instead and produces a `.mpy`
 * file. The board loads it directly: no parsing, no parser heap, a noticeably
 * faster boot, and less flash used. Import it exactly as before — the name is
 * unchanged, and `import robot_control` finds `robot_control.mpy` happily.
 *
 * Two things to know before you reach for it. First, `.mpy` files are tied to a
 * **bytecode version**: one built for MicroPython 1.24 will not load on 1.19, so
 * the file has to be rebuilt when you update firmware. Second, you lose the
 * ability to read and edit the code on the board, which is exactly the thing
 * that makes MicroPython pleasant to learn with — so this belongs on stable
 * library modules, not on the file you are actively working in.
 *
 * Snakie only points. Actually running `mpy-cross` is a build-pipeline feature
 * rather than a refactoring, and it deserves to be one in its own right.
 */
import type { Stmt } from '../ast'
import type { TextEdit } from '../text'
import { defineRule } from '../types'
import type { RefactorContext, RefactorMatch } from '../types'

interface CrossCompileMatch {
  lines: number
  statements: number
}

/**
 * Lines above which on-board compilation is worth mentioning. Deliberately
 * generous: a beginner's `main.py` should never see this, and the point is
 * library modules that have grown.
 */
const BIG_MODULE_LINES = 400

export const crossCompileMpyRule = defineRule<CrossCompileMatch>({
  id: 'cross-compile-mpy',
  title: 'Cross-compile this module to .mpy',
  message: 'A module this size is parsed on the board at every boot',
  catalogue: 63,
  category: 'board',
  kind: 'refactor',
  severity: 'hint',
  helpArticle: 'refactor-cross-compile-mpy',
  safe: false,
  hintOnly: true,
  // On-device advice: only when a board is actually attached.
  requires: () => true,

  detect(ctx: RefactorContext): RefactorMatch<CrossCompileMatch>[] {
    const lines = ctx.lines.lineCount
    if (lines < BIG_MODULE_LINES) return []

    // `main.py` is the file you edit and re-run constantly; freezing it would
    // take away the thing that makes the board pleasant to work with.
    const name = (ctx.fileName ?? '').toLowerCase()
    if (name === 'main.py' || name === 'boot.py' || name === 'code.py') return []

    // Count real statements so a file that is mostly a docstring or a comment
    // banner does not trip it — parsing cost tracks code, not prose.
    const statements = (ctx.module.body as Stmt[]).length
    if (statements < 10) return []

    const tight = ctx.capabilities && ctx.capabilities.memFree > 0 && ctx.capabilities.memFree < 64 * 1024
    const heapNote = tight
      ? ` With only ${Math.round((ctx.capabilities!.memFree ?? 0) / 1024)} KB free, the parser's own working memory is a real risk.`
      : ''

    return [
      {
        ruleId: 'cross-compile-mpy',
        start: 0,
        end: Math.min(ctx.src.length, 1),
        message:
          `This module is ${lines} lines and the board recompiles it on every import.${heapNote} ` +
          'mpy-cross would do that on your laptop instead',
        data: { lines, statements }
      }
    ]
  },

  apply(): TextEdit[] | null {
    return null
  }
})
