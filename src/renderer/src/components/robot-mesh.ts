/**
 * ROBOT MESH PATH HELPERS (#319, epic #309) — pure string utilities used by the
 * Robot View's `loadMeshCb` to resolve + classify URDF mesh references. Kept free
 * of three.js so they're cheap to unit-test. The heavy STL/DAE parsers live in
 * RobotView (code-split behind the lazy Robot View chunk).
 */

/** The directory portion of a path (POSIX or Windows separators), '' at root. */
export function dirname(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i < 0 ? '' : p.slice(0, i)
}

/** The final path segment (file name incl. extension). */
export function baseName(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i < 0 ? p : p.slice(i + 1)
}

/**
 * The supported mesh kind for a path, or `null` for anything we can't render
 * (`.obj`, `.glb`, …) — the caller shows a placeholder + a note for those.
 * Tolerant of a trailing `?query`/`#frag` on the reference.
 */
export function meshKind(path: string): 'stl' | 'dae' | null {
  const m = /\.(stl|dae)(?:$|[?#])/i.exec(path)
  return m ? (m[1].toLowerCase() as 'stl' | 'dae') : null
}

/** Whether a path is absolute — POSIX `/`, a Windows drive `C:\`/`C:/`, or a UNC
 *  `\\server` — as opposed to a project-relative reference. */
export function isAbsolutePath(p: string): boolean {
  return /^(\/|[A-Za-z]:[/\\]|[/\\]{2})/.test(p)
}

/** Split off a path's absolute root marker (POSIX `/`, Windows `C:/`, UNC `//`),
 *  returning the root and the remainder. An empty root means a relative path. */
function splitRoot(p: string): { root: string; rest: string } {
  if (/^[A-Za-z]:[/\\]/.test(p)) return { root: `${p.slice(0, 2)}/`, rest: p.slice(3) }
  if (/^[/\\]{2}/.test(p)) return { root: '//', rest: p.slice(2) }
  if (/^\//.test(p)) return { root: '/', rest: p.slice(1) }
  return { root: '', rest: p }
}

/**
 * Resolve a mesh reference against the URDF's folder into a normalised path
 * (POSIX separators, `.`/`..` segments collapsed). An absolute ref resolves to
 * itself; a relative one is joined onto `baseDir`. Any `?query`/`#frag` suffix is
 * dropped. Pure string logic (no node `path`), so it runs in the renderer bundle
 * and in unit tests alike.
 */
export function resolveMeshPath(baseDir: string, ref: string): string {
  const clean = ref.replace(/[?#].*$/, '')
  const combined = isAbsolutePath(clean) ? clean : `${baseDir}/${clean}`
  const { root, rest } = splitRoot(combined)
  const out: string[] = []
  for (const seg of rest.split(/[/\\]+/)) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop()
      else if (!root) out.push('..') // a relative path may keep leading `..`
    } else out.push(seg)
  }
  return root + out.join('/')
}

/**
 * Whether a mesh ref is "external" to the URDF's folder — its resolved path lands
 * OUTSIDE that folder's subtree (an absolute path elsewhere, or a relative one that
 * escapes via `..`). Such refs go missing when the project is moved/shared. In-folder
 * relatives, `package://` refs, and kinds we can't render (`.obj`/`.glb`) are NOT
 * external (left untouched). Needs a known `baseDir`; returns false without one.
 */
export function isExternalMeshRef(ref: string, baseDir: string): boolean {
  if (/^package:\/\//i.test(ref)) return false
  if (!meshKind(ref)) return false
  if (!baseDir) return false
  const base = resolveMeshPath(baseDir, '.')
  const resolved = resolveMeshPath(baseDir, ref)
  return !isInSubtree(resolved, base)
}

/** Whether `p` is `base` or lives under it. Accepts a case-insensitive match too,
 *  since Windows + the default macOS filesystem are case-insensitive (so an absolute
 *  in-folder ref written in a different case still counts as in-folder, not external).
 *  This only ever widens "in-folder", so it can never trigger a spurious copy. */
function isInSubtree(p: string, base: string): boolean {
  if (p === base || p.startsWith(`${base}/`)) return true
  const pl = p.toLowerCase()
  const bl = base.toLowerCase()
  return pl === bl || pl.startsWith(`${bl}/`)
}
