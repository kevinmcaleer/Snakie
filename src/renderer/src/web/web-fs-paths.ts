/**
 * Pure path helpers for the web filesystem ({@link ./web-fs}) — kept separate so
 * they're unit-testable (the interactive folder picker can't be automated).
 */

/**
 * Split a renderer path into the segments RELATIVE to the open folder's root, so
 * they can be walked from the root directory handle. The renderer builds paths as
 * `<rootName>/sub/file.py` (root = what `openFolderDialog` returned). Tolerates a
 * leading "/", the bare root path (→ `[]`), and a plain relative path. `.` and
 * `..` segments are normalised here (URDF mesh refs like `./meshes/x.stl` reach
 * us verbatim — urdf-loader does no normalisation, and `getDirectoryHandle('.')`
 * throws); `..` clamps at the picked root, which is also the sandbox boundary.
 */
export function splitRelSegments(rootPath: string, path: string): string[] {
  let p = path.startsWith('/') ? path.slice(1) : path
  if (rootPath) {
    if (p === rootPath) return []
    if (p.startsWith(rootPath + '/')) p = p.slice(rootPath.length + 1)
  }
  const out: string[] = []
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') out.pop()
    else out.push(seg)
  }
  return out
}

/** Join a parent path + child name the way the renderer does (POSIX, no `//`). */
export function childPath(parent: string, name: string): string {
  return parent.endsWith('/') ? parent + name : `${parent}/${name}`
}
