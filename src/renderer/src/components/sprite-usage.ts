/**
 * "USED IN" — which files reference the sprite you are editing (#792, the last
 * phase of epic #789).
 * =============================================================================
 *
 * Phases 1 and 2 take you from code to sprite. This is the way back: while a
 * `.spr` is open in the Sprite editor, say which Python files name it — and,
 * when none do, say THAT, plainly. An empty area reads as "not loaded yet"; a
 * sentence reads as an answer, and "nothing references this" is the answer that
 * tells you a sprite is safe to delete.
 *
 * Nothing here imports React or touches the DOM, and the filesystem arrives as
 * a parameter ({@link ScanFs}), so the walk is unit-testable against an
 * in-memory tree.
 *
 * ── The reference rule is NOT restated here ─────────────────────────────────
 * Which text names a sprite, and which file that name means, is `sprite-refs.ts`
 * — settled once in phase 1 and imported by all three phases. This module only
 * answers the reverse question: given a sprite path, which of the sources I was
 * handed resolve TO it.
 *
 * ── What the scan covers ────────────────────────────────────────────────────
 * Every `.py` file under the open project folder, plus every open LOCAL `.py`
 * buffer. Not "open files only": a sprite goes stale in the file you closed
 * three weeks ago, which is exactly the file an open-files-only answer would
 * miss, and an "unused" verdict that only looked at what is on screen would be
 * worse than no verdict at all.
 *
 * DEVICE buffers are excluded. A `main.py` opened off the board resolves its
 * `eyes.spr` in the board's flash, which is not this filesystem — the same
 * reason phase 1 refuses to call a board file's reference broken.
 *
 * ── Buffers beat disk ───────────────────────────────────────────────────────
 * {@link mergeUsageSources} lets an open buffer's text replace the disk copy at
 * the same path, so a reference you just typed and have not saved COUNTS, and
 * one you just deleted stops counting. The alternative — read only what is on
 * disk — silently misses what you just typed, and the most likely way to arrive
 * in this editor at all is clicking an inline thumbnail in a buffer you were
 * mid-edit.
 *
 * ── Shadowing ───────────────────────────────────────────────────────────────
 * A relative name resolves against the file's own folder FIRST, then the project
 * root. So `sprites/play.py` naming `"eyes.spr"` means `sprites/eyes.spr` when
 * that exists, and only otherwise the root's copy. The walk already sees every
 * `.spr` on its way past, so honouring that order costs no extra I/O: a nearer
 * candidate that exists shadows a farther one, and the root's `eyes.spr` does
 * not collect uses that belong to its namesake.
 *
 * Paths are compared EXACTLY, after the lexical normalising `sprite-refs.ts`
 * does. A case-only difference (`"Eyes.spr"` for `eyes.spr`) resolves on a
 * case-insensitive filesystem but is not counted here — deliberately, because
 * counting it would make the answer depend on which OS you opened the project
 * on, and an over-count is what turns "nothing references it" into a lie.
 */
import type { FsEntry } from '../../../main/fs/types'
import { SPRITE_EXT, findSpriteRefs, normalisePath, resolveSpriteRef } from './sprite-refs'

/** Most `.py` files read in one scan. A MicroPython project is a handful; the
 *  cap is here so a project folder that happens to sit above a huge tree can't
 *  turn one answer into thousands of IPC round-trips. */
export const MAX_SCAN_FILES = 500

/** How deep the walk goes below the project folder before it stops descending. */
export const MAX_SCAN_DEPTH = 8

/** Files read per `Promise.all` batch — enough parallelism to be quick, not so
 *  much that a big project floods the IPC channel in one go. */
const READ_BATCH = 8

/**
 * Directory names the walk never enters. Dependency and cache trees hold
 * thousands of `.py` files that are not your project, and none of them will ever
 * name your sprite. Any dot-directory is skipped too (see {@link isSkippedDir}).
 */
export const SKIPPED_DIRS = new Set([
  'node_modules',
  '__pycache__',
  'venv',
  'env',
  'site-packages',
  'dist',
  'build',
  'out',
  'coverage'
])

/** True for a directory the walk should not enter. */
export function isSkippedDir(name: string): boolean {
  return name.startsWith('.') || SKIPPED_DIRS.has(name.toLowerCase())
}

/** True for a file the reference scanner understands — Python source, only. */
export function isPythonFile(name: string): boolean {
  return name.toLowerCase().endsWith('.py')
}

/** Base name of a path, for both separators. */
export function baseNameOf(path: string): string {
  return path.split(/[/\\]/).pop() || path
}

/**
 * The folder a file's relative references resolve against, or null when the
 * path has no folder at all (an unsaved untitled buffer).
 *
 * A file sitting AT a root (`/main.py`, `C:\main.py`) keeps its separator: the
 * bare head would otherwise be `''` or `C:`, which joins the wrong way.
 */
export function sourceDir(path: string): string | null {
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  if (idx < 0) return null
  const head = path.slice(0, idx)
  return normalisePath(/^([A-Za-z]:)?$/.test(head) ? path.slice(0, idx + 1) : head)
}

/** One file the scan can read: an open buffer's text, or a file read from disk. */
export interface UsageSource {
  /** Absolute path, or `''` for an unsaved untitled buffer. */
  path: string
  /** Base name, for display. */
  name: string
  /** Folder its relative references resolve against (null for an untitled buffer). */
  dir: string | null
  /** The Python source to scan. */
  text: string
  /** True when this text is an open buffer with unsaved edits. */
  dirty?: boolean
  /** Workspace id when the source is an open buffer, so a click can activate it. */
  id?: string
}

/** One reference to the sprite, with everything a click needs. */
export interface SpriteUse {
  /** Absolute path of the referencing file (`''` for an untitled buffer). */
  path: string
  /** Base name, for the chip label. */
  name: string
  /** 1-based line the reference sits on. */
  line: number
  /** 1-based column of the literal's opening quote. */
  column: number
  /** The literal exactly as it was written — `"eyes.spr"` vs `"art/eyes.spr"`. */
  text: string
  /** True when the reference is in an open buffer with unsaved edits. */
  dirty: boolean
  /** Workspace id when the source was an open buffer. */
  id?: string
}

/** Where relative names are looked for, and what exists to shadow what. */
export interface UsageScope {
  /** The open project folder — the second place a relative name is looked for. */
  projectRoot?: string | null
  /** Every `.spr` the walk saw, so a nearer sprite can shadow a farther one. */
  spritesOnDisk?: Iterable<string>
}

/**
 * Every reference to `target` among `sources`, sorted by file then line and
 * deduped per line (two identical literals on one line are one place to jump).
 *
 * An empty `target` returns nothing: a sprite that has never been saved has no
 * path for anything to name, and guessing from its NAME field would invent uses.
 */
export function findSpriteUses(
  target: string,
  sources: readonly UsageSource[],
  scope: UsageScope = {}
): SpriteUse[] {
  if (!target) return []
  const want = normalisePath(target)
  const present = new Set<string>()
  for (const path of scope.spritesOnDisk ?? []) present.add(normalisePath(path))
  // The sprite being edited exists whatever the walk managed to see.
  present.add(want)

  const uses: SpriteUse[] = []
  const seen = new Set<string>()
  for (const source of sources) {
    for (const ref of findSpriteRefs(source.text)) {
      const candidates = resolveSpriteRef(ref.text, {
        fileDir: source.dir,
        projectRoot: scope.projectRoot
      })
      const index = candidates.indexOf(want)
      if (index < 0) continue
      // A nearer candidate that EXISTS wins — this reference means that file,
      // not ours, and counting it here would over-claim.
      if (candidates.slice(0, index).some((path) => present.has(path))) continue
      const key = `${source.path || source.id || source.name}\u0000${ref.line}`
      if (seen.has(key)) continue
      seen.add(key)
      uses.push({
        path: source.path,
        name: source.name,
        line: ref.line,
        column: ref.startColumn,
        text: ref.text,
        dirty: source.dirty === true,
        ...(source.id ? { id: source.id } : {})
      })
    }
  }
  uses.sort((a, b) => (a.path || a.name).localeCompare(b.path || b.name) || a.line - b.line)
  return uses
}

/** The subset of an open workspace file this module needs (structurally an `OpenFile`). */
export interface OpenBuffer {
  id: string
  source: string
  path: string
  name: string
  content: string
  dirty: boolean
}

/**
 * The open editor buffers worth scanning: LOCAL Python ones, text taken from the
 * buffer rather than the disk. Device buffers are dropped — their sprites live
 * in the board's flash, not on this filesystem.
 */
export function bufferSources(files: readonly OpenBuffer[]): UsageSource[] {
  const out: UsageSource[] = []
  for (const file of files) {
    if (file.source !== 'local' || !isPythonFile(file.name)) continue
    out.push({
      path: file.path ? normalisePath(file.path) : '',
      name: file.name,
      dir: file.path ? sourceDir(file.path) : null,
      text: file.content,
      dirty: file.dirty,
      id: file.id
    })
  }
  return out
}

/**
 * Disk sources with the open buffers laid over them: a buffer replaces the disk
 * copy of the same file in place (so the answer reflects unsaved edits without
 * the file jumping around the list), and a buffer with no file on disk yet is
 * appended.
 */
export function mergeUsageSources(
  disk: readonly UsageSource[],
  buffers: readonly UsageSource[]
): UsageSource[] {
  const byPath = new Map<string, UsageSource>()
  for (const buffer of buffers) if (buffer.path) byPath.set(buffer.path, buffer)
  const used = new Set<string>()
  const out: UsageSource[] = []
  for (const source of disk) {
    const buffer = source.path ? byPath.get(source.path) : undefined
    if (buffer) used.add(source.path)
    out.push(buffer ?? source)
  }
  for (const buffer of buffers) if (!buffer.path || !used.has(buffer.path)) out.push(buffer)
  return out
}

// ── The answer, as a sentence ───────────────────────────────────────────────

/** What the "used in" line is currently able to say. */
export type UsageStatus = 'no-file' | 'searching' | 'nowhere' | 'unused' | 'used'

export interface UsageReport {
  status: UsageStatus
  /** The plain sentence shown beside the results. */
  message: string
}

/** `1 file` / `2 files`. */
function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * Turn the scan's state into something to SAY. Every branch produces a sentence
 * — there is no state in which the line is blank, because a blank line is read
 * as "still working" no matter how long it has been there.
 */
export function usageReport(input: {
  /** The `.spr` being edited, or null when this document is not a file yet. */
  spritePath: string | null
  /** True while the project walk is still running. */
  searching: boolean
  /** How many Python files the answer is based on (disk + open buffers). */
  scanned: number
  /** The open project folder, if any — it decides WHY nothing could be read. */
  projectRoot?: string | null
  /** True when the walk stopped at {@link MAX_SCAN_FILES}. */
  truncated?: boolean
  uses: readonly SpriteUse[]
}): UsageReport {
  const { spritePath, searching, scanned, uses } = input
  if (!spritePath) {
    return {
      status: 'no-file',
      message: 'Save this sprite to a .spr file to see which code uses it.'
    }
  }
  const name = baseNameOf(spritePath)
  if (searching) return { status: 'searching', message: `Looking for uses of ${name}…` }
  if (uses.length) {
    const files = new Set(uses.map((use) => use.path || use.id || use.name)).size
    const where = count(files, 'file')
    const refs = uses.length === files ? '' : ` (${count(uses.length, 'reference')})`
    return { status: 'used', message: `${name} is used in ${where}${refs}:` }
  }
  if (scanned === 0) {
    // "I found no uses" and "I could not look" are different answers, and only
    // one of them means the sprite is safe to delete.
    return {
      status: 'nowhere',
      message: input.projectRoot
        ? 'No Python files in this project to search.'
        : 'No Python files to search — open the folder your code is in.'
    }
  }
  const searched = `searched ${count(scanned, 'Python file')}`
  const capped = input.truncated ? `, stopped at ${MAX_SCAN_FILES}` : ''
  return {
    status: 'unused',
    message: `Nothing references ${name} — ${searched}${capped}.`
  }
}

// ── The walk ────────────────────────────────────────────────────────────────

/** The filesystem the walk needs — a parameter, so tests hand it a fake tree. */
export interface ScanFs {
  readDir: (path: string) => Promise<FsEntry[]>
  readFile: (path: string) => Promise<string>
}

export interface ProjectScan {
  /** Every `.py` file read, with its text. */
  sources: readonly UsageSource[]
  /** Every `.spr` seen on the way past (for shadowing — see the header). */
  sprites: readonly string[]
  /** True when the walk stopped at the file cap rather than running out of tree. */
  truncated: boolean
}

/** The result of scanning nothing — a real answer, not a missing one. Frozen so
 *  a shared "empty" can't be filled in by one caller on behalf of the rest. */
export const EMPTY_SCAN: ProjectScan = Object.freeze({
  sources: Object.freeze([]),
  sprites: Object.freeze([]),
  truncated: false
})

/**
 * Walk `root` for Python sources (and note the sprites on the way).
 *
 * Breadth-first so the files nearest the project root — the ones most likely to
 * be yours — are read first if the cap cuts the walk short. An unreadable folder
 * or file is SKIPPED, never fatal: half an answer beats an error where the
 * answer should be.
 *
 * This is I/O, and it is deliberately not on any keystroke path: the Sprite
 * editor is a full-screen overlay with no code in it, so the scan runs when the
 * overlay opens and when a file is saved beneath it, never per edit.
 */
export async function scanProjectFiles(
  root: string,
  fs: ScanFs,
  opts: { maxFiles?: number; maxDepth?: number } = {}
): Promise<ProjectScan> {
  const maxFiles = opts.maxFiles ?? MAX_SCAN_FILES
  const maxDepth = opts.maxDepth ?? MAX_SCAN_DEPTH
  if (!root || maxFiles <= 0) return { sources: [], sprites: [], truncated: false }

  const pyPaths: string[] = []
  const sprites: string[] = []
  let truncated = false
  const queue: { path: string; depth: number }[] = [{ path: normalisePath(root), depth: 0 }]

  while (queue.length && !truncated) {
    const next = queue.shift()
    if (!next) break
    let entries: FsEntry[]
    try {
      entries = await fs.readDir(next.path)
    } catch {
      continue // unreadable folder — skip it, keep the rest of the answer
    }
    for (const entry of entries) {
      if (entry.isDir) {
        if (next.depth < maxDepth && !isSkippedDir(entry.name)) {
          queue.push({ path: entry.path, depth: next.depth + 1 })
        }
        continue
      }
      if (entry.name.toLowerCase().endsWith(SPRITE_EXT)) {
        sprites.push(normalisePath(entry.path))
        continue
      }
      if (!isPythonFile(entry.name)) continue
      if (pyPaths.length >= maxFiles) {
        truncated = true
        break
      }
      pyPaths.push(entry.path)
    }
  }

  const sources: UsageSource[] = []
  for (let i = 0; i < pyPaths.length; i += READ_BATCH) {
    const batch = pyPaths.slice(i, i + READ_BATCH)
    const texts = await Promise.all(batch.map((path) => fs.readFile(path).catch(() => null)))
    batch.forEach((path, j) => {
      const text = texts[j]
      if (text === null) return // unreadable file — skip it, keep the rest
      sources.push({
        path: normalisePath(path),
        name: baseNameOf(path),
        dir: sourceDir(path),
        text
      })
    })
  }
  return { sources, sprites, truncated }
}
