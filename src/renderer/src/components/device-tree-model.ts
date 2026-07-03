/**
 * DEVICE FILE TREE MODEL (#219) — pure helpers behind the device-files panel's
 * multi-select + drag-to-folder file management. The tree's listings live in a
 * flat `path → entries` map (lifted out of the row components so range
 * selection and full refresh can see the whole visible tree); these functions
 * flatten it into visible rows, compute click-selection transitions
 * (single / ctrl-toggle / shift-range) and validate folder moves. DOM-free.
 */
import type { DirEntry } from '../../../preload/index.d'

export const DEVICE_ROOT = '/'

/** One visible row of the flattened tree (depth drives the indent). */
export interface FlatRow {
  path: string
  entry: DirEntry
  depth: number
}

/** Join a device dir + name (the root is `/`, never doubled). */
export function joinDevicePath(dir: string, name: string): string {
  return dir === DEVICE_ROOT ? `/${name}` : `${dir}/${name}`
}

/** The parent directory of a device path (`/lib/x.py` → `/lib`, `/x` → `/`). */
export function parentDevicePath(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx <= 0 ? DEVICE_ROOT : path.slice(0, idx)
}

/**
 * Flatten the loaded tree into its VISIBLE rows, walking depth-first from the
 * root: an expanded directory contributes its (loaded) children right below it.
 */
export function flattenTree(
  dirs: ReadonlyMap<string, DirEntry[]>,
  expanded: ReadonlySet<string>
): FlatRow[] {
  const out: FlatRow[] = []
  const walk = (dir: string, depth: number): void => {
    for (const entry of dirs.get(dir) ?? []) {
      const path = joinDevicePath(dir, entry.name)
      out.push({ path, entry, depth })
      if (entry.isDir && expanded.has(path)) walk(path, depth + 1)
    }
  }
  walk(DEVICE_ROOT, 0)
  return out
}

/** Selection transition for a row click (#219). */
export function nextSelection(
  current: ReadonlySet<string>,
  anchor: string | null,
  rows: FlatRow[],
  path: string,
  mode: 'single' | 'toggle' | 'range'
): { selection: Set<string>; anchor: string | null } {
  if (mode === 'toggle') {
    const selection = new Set(current)
    if (selection.has(path)) selection.delete(path)
    else selection.add(path)
    return { selection, anchor: path }
  }
  if (mode === 'range' && anchor) {
    const order = rows.map((r) => r.path)
    const a = order.indexOf(anchor)
    const b = order.indexOf(path)
    if (a !== -1 && b !== -1) {
      const [lo, hi] = a <= b ? [a, b] : [b, a]
      return { selection: new Set(order.slice(lo, hi + 1)), anchor }
    }
  }
  return { selection: new Set([path]), anchor: path }
}

/** Is `child` inside `parent` (or equal)? Guards moving a folder into itself. */
export function isSameOrDescendant(parent: string, child: string): boolean {
  return child === parent || child.startsWith(`${parent}/`)
}

/**
 * Plan moving `sources` into `destDir`: one from→to rename per source, skipping
 * no-ops (already in `destDir`) and ILLEGAL moves (a folder into itself or a
 * descendant). Nested-redundant sources (a child of another selected source)
 * are dropped — moving the parent carries them.
 */
export function planMove(
  sources: string[],
  destDir: string
): { from: string; to: string }[] {
  const roots = sources.filter((s) => !sources.some((o) => o !== s && isSameOrDescendant(o, s)))
  const plan: { from: string; to: string }[] = []
  for (const src of roots) {
    if (parentDevicePath(src) === destDir) continue // already there
    if (isSameOrDescendant(src, destDir)) continue // folder into itself/child
    plan.push({ from: src, to: joinDevicePath(destDir, src.split('/').pop() ?? '') })
  }
  return plan
}

/**
 * Reduce a delete selection to its top-level paths (deleting a folder already
 * removes everything under it).
 */
export function pruneNested(paths: string[]): string[] {
  return paths.filter((p) => !paths.some((o) => o !== p && isSameOrDescendant(o, p)))
}
