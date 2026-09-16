/**
 * GRADUATING TO PYTHON (#1016, epic #1007).
 * =============================================================================
 *
 * The door at the end of the on-ramp. A blocks program is a `.py` with the
 * workspace in a footer comment (#1008); graduating drops the footer and leaves
 * an ordinary Python file. That is the whole mechanism, and everything
 * interesting about this is what surrounds it.
 *
 * IT IS ONE-WAY, AND THAT IS THE POINT. Blocks → Python is generation; Python →
 * blocks is decompilation, which is #1019's spike and may never land. So the
 * step has to be safe rather than reversible: **the blocks are saved beside the
 * file** as `name.blocks.py`, a complete blocks program of its own that opens on
 * the canvas exactly as it did before. Nothing is lost, so nothing has to be
 * warned about.
 *
 * AND IT IS CELEBRATED. The obvious implementation is a confirm dialog with the
 * word "irreversible" in it, which tells a ten-year-old that the thing they are
 * about to do is dangerous. It isn't: they have been writing Python for an hour
 * and the pane next door has been showing it to them. The right sentence is
 * *"you wrote 47 lines of Python"*, because it is true, and because it names
 * what actually happened.
 *
 * Pure: the plan is computed here and carried out by the caller, so the naming,
 * the line count and the untitled-buffer case are unit tests rather than things
 * you find out by graduating a real file.
 */

/** What graduating a given file will do. */
export interface GraduationPlan {
  /** The Python that stays in the buffer — the footer removed, nothing else. */
  python: string
  /**
   * How many lines of Python they wrote: non-blank lines of the generated code.
   *
   * Blanks excluded because the generator puts them between its sections, and
   * counting them would inflate the number the celebration is built on. A
   * sentence a learner can check by looking is worth more than a bigger one.
   */
  lines: number
  /** The filename the blocks are kept under, e.g. `square.blocks.py`. */
  blocksName: string
  /**
   * Where to write it, or `null` for a buffer that has never been saved.
   *
   * An untitled buffer has nowhere to put a sibling, so the blocks are kept as a
   * SECOND UNSAVED BUFFER instead — still nothing lost, still nothing written
   * anywhere the user did not choose. Silently picking a folder for them would
   * be worse than the mild oddity of two unsaved tabs.
   */
  blocksPath: string | null
  /** The blocks program to keep: the file exactly as it was, footer and all. */
  blocksContent: string
}

/**
 * The sibling name for a blocks file: `square.py` → `square.blocks.py`.
 *
 * Idempotent, because a file ALREADY called `square.blocks.py` can be opened,
 * edited and graduated like any other — and `square.blocks.blocks.py` is a name
 * nobody would choose.
 */
export function blocksSiblingName(name: string): string {
  const base = name.replace(/\.py$/i, '')
  if (/\.blocks$/i.test(base)) return `${base}.py`
  return `${base}.blocks.py`
}

/** The same, for a full path — the directory is untouched. */
export function blocksSiblingPath(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  if (cut < 0) return blocksSiblingName(path)
  return path.slice(0, cut + 1) + blocksSiblingName(path.slice(cut + 1))
}

/** The lines of Python a learner can point at: non-blank, footer excluded. */
export function countPythonLines(code: string): number {
  return code.split('\n').filter((line) => line.trim() !== '').length
}

/**
 * Plan the graduation of `file`, or `null` when there is nothing to graduate.
 *
 * `null` for a file with no footer: it is already Python, and "graduating" it
 * would write a `.blocks.py` sibling holding no blocks.
 */
export function planGraduation(
  file: { name: string; path: string; content: string },
  stripFooter: (content: string) => string,
  hasFooter: (content: string) => boolean
): GraduationPlan | null {
  if (!hasFooter(file.content)) return null
  const python = stripFooter(file.content)
  return {
    python,
    lines: countPythonLines(python),
    blocksName: blocksSiblingName(file.name),
    blocksPath: file.path ? blocksSiblingPath(file.path) : null,
    blocksContent: file.content
  }
}

/**
 * The sentence shown when it is done.
 *
 * Names the number, because the number is the achievement and it is one they can
 * verify by scrolling. The plural is handled rather than written `line(s)`,
 * which is the kind of detail a child notices and an adult has stopped seeing.
 */
export function graduationMessage(plan: GraduationPlan): string {
  const lines = plan.lines === 1 ? '1 line' : `${plan.lines} lines`
  return `You wrote ${lines} of Python.`
}
