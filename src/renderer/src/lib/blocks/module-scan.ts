/**
 * SCANNING FOR MODULES (#1048, the button).
 * =============================================================================
 *
 * The Modules drawer fills itself from the program's `import` lines, which is
 * right for a program that already exists and useless for one that does not
 * yet: a learner with a fresh file and a `range_finder.py` on the board has to
 * know the module's name and type the import before a single block appears.
 *
 * The **Scan modules on device and locally** button at the top of the drawer
 * is the other way in. Pressing it lists the `.py` files beside the program
 * and the ones on the board (`/lib`, then `/`), and every one of them gets a
 * drawer as if it had been imported — dragging a block out adds the import,
 * because every module block already carries one.
 *
 * This file is the PURE half: the button's key, the tiny bus that carries a
 * press from the Blockly toolbox (which knows nothing about React) to the hook
 * that registers the blocks, and the rule for which file names are modules.
 */

/** The toolbox button's `callbackkey`. */
export const SCAN_MODULES_BUTTON = 'SNAKIE_SCAN_MODULES'

const listeners = new Set<() => void>()

/** The button was pressed: whoever registers module blocks should look again. */
export function requestModuleScan(): void {
  for (const listener of [...listeners]) listener()
}

/** Be told when a scan is requested. Returns the unsubscribe. */
export function onModuleScan(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * The files an entry point can be called. Never a module anyone imports, and
 * offering a drawer for `main` would be offering the program to itself.
 */
const ENTRY_POINTS = new Set(['main', 'boot', 'code'])

/**
 * Which of these file names are importable modules?
 *
 * `range_finder.py` → `range_finder`; a `.mpy` counts too, because the board
 * can still be asked what is in it. Skipped: anything that is not a legal
 * module name, a `_private` file, the entry points, and whatever the caller
 * excludes — the program's own file, which is the one module it must not
 * import.
 */
export function moduleNamesFrom(files: readonly string[], exclude: readonly string[] = []): string[] {
  const out = new Set<string>()
  const skip = new Set([...ENTRY_POINTS, ...exclude])
  for (const file of files) {
    const m = /^([A-Za-z_]\w*)\.(py|mpy)$/.exec(file.trim())
    if (!m) continue
    const name = m[1]
    if (name.startsWith('_') || skip.has(name)) continue
    out.add(name)
  }
  return [...out].sort()
}

/** The file name out of a path, whichever way its separators go. */
export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}
