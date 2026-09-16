/**
 * WHERE A MODULE'S SOURCE LIVES (#1048, epic #1007).
 * =============================================================================
 *
 * `module-api.ts` reads a module's API out of its `.py`. This finds that `.py`.
 *
 * THREE PLACES, IN THIS ORDER, and the order is the whole design:
 *
 *  1. **Beside the program.** A driver the learner downloaded into their own
 *    project folder is the one they are editing, and if it differs from the
 *    board's copy, theirs is the one their program will run once they save.
 *  2. **On the board.** `/lib/<name>.py`, then `/<name>.py` — where `mip` and
 *    Snakie's own installer put things, and where a driver flashed months ago
 *    still is. This is the commonest hit for a real program.
 *  3. **Bundled with Snakie.** `micropython/modules/*.py`, the stubs we ship.
 *
 * Nearest first, because the nearest copy is the one that wins at runtime. A
 * board's stale `/lib/ssd1306.py` must not describe the newer file sitting next
 * to the program.
 *
 * EVERY READER MAY FAIL AND THAT IS NORMAL. No folder open, no board connected,
 * no such file — all of it is "not here, try the next one". The whole function
 * resolves to `null` rather than throwing, because a module we cannot read is
 * not an error condition: it is a module whose blocks come from somewhere else
 * (the curated tables, or the board-side `dir()`), or not at all.
 *
 * DEPENDENCY-INJECTED so the ORDER is a unit test rather than something you
 * find out by having three copies of a driver and deleting them one at a time.
 */

/** Read a file, or fail. Every tier is one of these. */
export type ReadFile = (path: string) => Promise<string>

export interface ModuleSourceReaders {
  /** The open project folder, or null when there isn't one. */
  folder?: string | null
  /** Read a file from the host filesystem. */
  readLocal?: ReadFile
  /** Read a file from the connected board. Absent when nothing is connected. */
  readDevice?: ReadFile | null
  /** A module shipped with Snakie, by basename. */
  readBundled?: (file: string) => Promise<string>
}

/** Where a module's source was found — for the drawer's tooltip, and for tests. */
export type ModuleSourceOrigin = 'project' | 'device' | 'bundled'

export interface ModuleSource {
  module: string
  origin: ModuleSourceOrigin
  text: string
}

/** A module name safe to put in a path. Anything else is not a module name. */
function safeName(module: string): string | null {
  return /^[A-Za-z_]\w*$/.test(module) ? module : null
}

/** Try one reader, and treat every failure as "not here". */
async function attempt(read: (() => Promise<string>) | null | undefined): Promise<string | null> {
  if (!read) return null
  try {
    const text = await read()
    return text && text.trim() !== '' ? text : null
  } catch {
    return null
  }
}

/**
 * Find `module`'s source, nearest copy first. `null` when no tier has it.
 *
 * A PACKAGE (`foo/__init__.py`) is deliberately not chased. The drivers this is
 * for are overwhelmingly one file, and walking a package's exports means
 * following its own imports — which is a parser's job in a language that allows
 * `from .x import *`, and a guess in any other.
 */
export async function findModuleSource(
  module: string,
  readers: ModuleSourceReaders
): Promise<ModuleSource | null> {
  const name = safeName(module)
  if (!name) return null
  const file = `${name}.py`

  const project =
    readers.folder && readers.readLocal
      ? await attempt(() => readers.readLocal!(joinPath(readers.folder!, file)))
      : null
  if (project) return { module, origin: 'project', text: project }

  for (const path of [`/lib/${file}`, `/${file}`]) {
    const onBoard = await attempt(readers.readDevice ? () => readers.readDevice!(path) : null)
    if (onBoard) return { module, origin: 'device', text: onBoard }
  }

  const bundled = await attempt(readers.readBundled ? () => readers.readBundled!(file) : null)
  if (bundled) return { module, origin: 'bundled', text: bundled }

  return null
}

/**
 * Join a folder and a file name.
 *
 * Written out rather than imported: this module is pure and runs in the
 * renderer, which has no `path`, and the board's paths are POSIX whatever the
 * host is. A trailing separator on the folder is the only case worth handling.
 */
export function joinPath(folder: string, file: string): string {
  const sep = folder.includes('\\') && !folder.includes('/') ? '\\' : '/'
  return folder.endsWith('/') || folder.endsWith('\\') ? `${folder}${file}` : `${folder}${sep}${file}`
}
