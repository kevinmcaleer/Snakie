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
