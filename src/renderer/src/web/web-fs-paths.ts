/**
 * Pure path helpers for the web filesystem ({@link ./web-fs}) — kept separate so
 * they're unit-testable (the interactive folder picker can't be automated).
 */

/**
 * Split a renderer path into the segments RELATIVE to the open folder's root, so
 * they can be walked from the root directory handle. The renderer builds paths as
 * `<rootName>/sub/file.py` (root = what `openFolderDialog` returned). Tolerates a
 * leading "/", the bare root path (→ `[]`), and a plain relative path.
 */
export function splitRelSegments(rootPath: string, path: string): string[] {
  let p = path.startsWith('/') ? path.slice(1) : path
  if (rootPath) {
    if (p === rootPath) return []
    if (p.startsWith(rootPath + '/')) p = p.slice(rootPath.length + 1)
  }
  return p.split('/').filter(Boolean)
}

/** Join a parent path + child name the way the renderer does (POSIX, no `//`). */
export function childPath(parent: string, name: string): string {
  return parent.endsWith('/') ? parent + name : `${parent}/${name}`
}
