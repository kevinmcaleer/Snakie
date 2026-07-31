/**
 * THE DEMO PROJECT (#483) — the servo arm, as a project you can open.
 * =============================================================================
 *
 * `examples/servo-arm/` is the one artefact that is the same robot in all three
 * workspaces: wiring in Electronics, the arm in Build, `sweep.py` in Code. Until
 * something opens it, a new user meets a 3-D arm that Electronics knows nothing
 * about — which teaches the opposite of the truth.
 *
 * The files are inlined at build time from `examples/servo-arm/`, so there is ONE
 * copy of the demo rather than a bundled duplicate that drifts from the one the
 * tests guard. It also means this works on the web build, where there are no app
 * resources to copy from — the same install path writes through whichever `fs`
 * implementation is in play.
 */

const raw = import.meta.glob('../../../../examples/servo-arm/*.{yml,urdf,py}', {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>

/** The demo's files, keyed by BASENAME (`robot.yml`, `arm.urdf`, `sweep.py`). */
export const DEMO_FILES: Record<string, string> = Object.fromEntries(
  Object.entries(raw).map(([path, content]) => [path.slice(path.lastIndexOf('/') + 1), content])
)

/** Folder name created inside the chosen destination. */
export const DEMO_FOLDER = 'servo-arm'

/** The file opened in the editor once the project is installed. */
export const DEMO_ENTRY_FILE = 'sweep.py'

/** Join a parent and child with forward slashes, tolerating a trailing slash. */
export function joinPath(parent: string, child: string): string {
  return `${String(parent ?? '').replace(/[/\\]+$/, '')}/${child}`
}

/**
 * The files to write for an install into `dest`, as absolute paths.
 *
 * Returned rather than written here so the caller owns the IO and this stays
 * testable — and so the set can be checked against what is already on disk
 * before anything is overwritten.
 */
export function demoInstallPlan(dest: string): { path: string; content: string }[] {
  const dir = joinPath(dest, DEMO_FOLDER)
  return Object.entries(DEMO_FILES).map(([name, content]) => ({
    path: joinPath(dir, name),
    content
  }))
}
