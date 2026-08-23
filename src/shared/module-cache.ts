/**
 * STALE MODULE CACHE — clearing what the board already imported (#784).
 * =============================================================================
 *
 * Installing a driver for a module the board has **already tried to import**
 * used to leave the board using the old, broken import. The install succeeded,
 * the files on disk were correct, and the import kept failing:
 *
 *     ImportError: can't import name map_value
 *       File "/lib/modulino/__init__.py", line 7
 *
 * The cause is `sys.modules`. The user's FIRST import failed while the package
 * was genuinely incomplete (an earlier install had died), MicroPython cached the
 * half-built module, and every retry afterwards got that cache back instead of
 * re-reading the disk. A soft reset fixed it instantly, which is what makes the
 * bug so expensive: the error names a real symbol in a real file that really
 * contains it, so every instinct is to suspect the installer, the package, the
 * URL, a version mismatch — anything but a cache.
 *
 * And the order of events that gets you there is the NATURAL one: try an import,
 * see it fail, install the driver, try again.
 *
 * ── Why a targeted purge rather than a soft reset ───────────────────────────
 * A soft reset (Ctrl-D) is the sledgehammer the user reached for by hand, and it
 * works — but it throws away the whole REPL session: every variable they were
 * mid-experiment with, and any hardware they had set up. Deleting just the
 * offending keys from `sys.modules` fixes exactly the same thing and keeps all
 * of it, because the next `import` then re-reads the file from disk.
 *
 * It is not a complete undo, and does not pretend to be: a name already bound
 * from the stale module (`from modulino import X`) stays bound to the old
 * object. But that is not the reported flow — the flow is an import that FAILED,
 * so nothing was bound from it — and the alternative costs the user their whole
 * session. Where a purge cannot help, a reset is still one click away.
 *
 * Dependency-free (the same discipline as `control.ts`, `dialect.ts` and
 * `device-scratch.ts`) so main, preload and renderer can all import it, and so
 * the rule is unit-testable without a board.
 */
import { scratchBlock, scratchName } from './device-scratch'

/** Extensions a Python module can arrive as on a board. */
const MODULE_EXTENSIONS = ['.py', '.mpy']

/**
 * The TOP-LEVEL module name a written file belongs to, or `null` when the path
 * names no importable module.
 *
 * Top-level rather than the full dotted name because that is what has to be
 * purged: `sys.modules` holds the package AND each submodule, and dropping
 * `modulino.helpers` while keeping `modulino` leaves the stale package object —
 * the very thing that produced the reported error — still in place. The caller
 * pairs this with a prefix sweep, so one name covers the whole package.
 *
 *   `/lib/modulino/helpers.py`  → `modulino`
 *   `/lib/modulino/__init__.py` → `modulino`
 *   `/lib/ssd1306.py`           → `ssd1306`
 *   `/lib/`                     → null
 */
export function topLevelModuleName(target: string): string | null {
  if (!target) return null
  // A board path is always POSIX, but a hand-typed Windows-style separator
  // should not silently produce a nonsense module name.
  const parts = target.trim().replace(/\\/g, '/').split('/').filter(Boolean)
  // `lib` is the library folder, not part of any module's name.
  if (parts[0] === 'lib') parts.shift()
  const first = parts[0]
  if (!first) return null
  const bare = MODULE_EXTENSIONS.reduce(
    (name, ext) => (name.toLowerCase().endsWith(ext) ? name.slice(0, -ext.length) : name),
    first
  )
  // `__init__` alone means the path was `/lib/__init__.py` — no package to name.
  if (!bare || bare === '__init__') return null
  // Anything that is not a legal identifier cannot be imported, so purging it
  // would be a no-op at best and a malformed snippet at worst.
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(bare)) return null
  return bare
}

/** The distinct top-level module names a set of written paths touches. */
export function modulesTouched(targets: readonly string[]): string[] {
  const seen = new Set<string>()
  for (const t of targets) {
    const name = topLevelModuleName(t)
    if (name) seen.add(name)
  }
  return [...seen]
}

/** Marker the purge snippet prints, so its result can be read back. */
export const PURGE_MARKER = 'SNKPURGED:'

/**
 * Python that drops `name` and every submodule of it from `sys.modules`, then
 * prints `SNKPURGED:<count>`.
 *
 * Three details that are not incidental:
 *
 *  - **The keys are collected before anything is deleted.** Mutating a dict
 *    while iterating it raises on MicroPython just as it does on CPython.
 *  - **`name.` prefix, not `startswith(name)`.** `modulino` must not sweep away
 *    an unrelated `modulinox`.
 *  - **The whole thing is guarded.** A board with no `sys.modules` to speak of,
 *    or a frozen module that refuses deletion, must not turn a SUCCESSFUL
 *    install into a failure — the files are already written and correct. It
 *    prints a count of 0 and the caller says nothing.
 */
export function purgeModuleSnippet(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`purgeModuleSnippet: not an importable module name: ${name}`)
  }
  const n = scratchName('n')
  const keys = scratchName('k')
  const one = scratchName('i')
  return scratchBlock(
    [
      'import sys',
      `${n} = ${JSON.stringify(name)}`,
      // Collected first: deleting while iterating raises.
      `${keys} = [${one} for ${one} in sys.modules if ${one} == ${n} or ${one}.startswith(${n} + ".")]`,
      `for ${one} in ${keys}:`,
      `    try: del sys.modules[${one}]`,
      '    except (KeyError, RuntimeError): pass',
      `print("${PURGE_MARKER}" + str(len(${keys})))`
    ],
    n,
    keys,
    one
  )
}

/** How many modules a {@link purgeModuleSnippet} run reported dropping. */
export function parsePurgeCount(stdout: string): number {
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.startsWith(PURGE_MARKER)) {
      const n = Number.parseInt(trimmed.slice(PURGE_MARKER.length), 10)
      if (Number.isFinite(n) && n >= 0) return n
    }
  }
  return 0
}

/**
 * The sentence the install banner adds when a purge actually dropped something.
 *
 * Only shown when a cached copy really was found, because that is the whole
 * point: on a board that had never imported the module there is nothing to
 * report, and saying so every time would be noise that hides the one case that
 * matters. `undefined` means "say nothing extra".
 */
export function purgeNote(names: readonly string[], purged: number): string | undefined {
  if (purged <= 0 || names.length === 0) return undefined
  const what = names.length === 1 ? names[0] : names.join(', ')
  return (
    `The board had already imported ${what}, so it was still holding the old copy in memory — ` +
    'cleared, so your next import reads the new files. (Names you already imported from it ' +
    'keep pointing at the old copy until you reset the board.)'
  )
}
