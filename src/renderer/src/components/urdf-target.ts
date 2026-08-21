/**
 * WHERE A ROBOT DOCUMENT IS ALLOWED TO LAND (#782).
 *
 * A generated URDF is a whole-document write: it REPLACES whatever is at the
 * target path. #782 was that write landing on a user's `.py` — the Build
 * workspace's 3-D builder edits the *project* URDF (handed to it as text) but
 * persisted through `activeFile`, i.e. whatever tab happened to be focused, and
 * the only guard was "is it a saved local file". A `main.py` passes that.
 *
 * So the target is decided HERE, from data, before any write:
 *
 *  - the document knows which file it came from (`documentPath`), or it IS the
 *    active buffer (no `documentPath`) — never "whatever is active" by default;
 *  - the resolved path must end in `.urdf`.
 *
 * Anything else RESOLVES TO A REFUSAL, with a reason to show the user. It does
 * NOT fall back to a plausible-looking file: a fallback is exactly how the
 * wrong file gets destroyed, and a robot document has no safe second choice.
 *
 * Pure + DOM-free so the rule is unit-testable on its own.
 */

/** The one extension a generated robot document may be written to. */
const URDF_RE = /\.urdf$/i

/**
 * Whether `path` may receive a robot document. `.urdf` only — deliberately NOT
 * `.xacro` (a macro file the editor can't open or round-trip anyway) and
 * emphatically not "any file the user had open".
 */
export function isUrdfPath(path: string | null | undefined): boolean {
  return !!path && URDF_RE.test(path.trim())
}

/** The minimum an open editor buffer has to expose to be a write target. */
export interface UrdfTargetFile {
  id: string
  source: string
  path: string
}

/** Where a robot-document write is allowed to go — or why it may not happen. */
export type UrdfWriteTarget =
  | { kind: 'buffer'; id: string; path: string }
  | { kind: 'file'; path: string }
  | { kind: 'refuse'; reason: string }

/** `a/b/c.py` → `c.py` (both separators), for a refusal the user can act on. */
function baseName(path: string): string {
  return path.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || path
}

/**
 * Decide where the robot document being edited must be written.
 *
 * `documentPath` is the file the DOCUMENT came from — set whenever the view was
 * handed its text (the Build workspace reads the project URDF off disk), `null`
 * when the document simply IS the active buffer (opening a `.urdf` in the
 * editor). The two cases never mix: a handed-in document is never written to
 * the active buffer, because the active buffer is a different file.
 *
 * Returns a `refuse` (never a fallback) when there is no `.urdf` to write to.
 */
export function resolveUrdfWriteTarget(
  documentPath: string | null | undefined,
  activeFile: UrdfTargetFile | null | undefined
): UrdfWriteTarget {
  if (documentPath != null && documentPath !== '') {
    return isUrdfPath(documentPath)
      ? { kind: 'file', path: documentPath }
      : {
          kind: 'refuse',
          reason: `refusing to write a robot model to "${baseName(documentPath)}" — it isn't a .urdf`
        }
  }
  // No document path ⇒ the document is the open buffer. It still has to BE a
  // `.urdf` on disk: an unsaved buffer has nowhere to go, and a `.py` is the
  // #782 file-destroying case.
  if (!activeFile || activeFile.source !== 'local' || !activeFile.path) {
    return { kind: 'refuse', reason: 'refusing to write a robot model — no .urdf file is open' }
  }
  if (!isUrdfPath(activeFile.path)) {
    return {
      kind: 'refuse',
      reason: `refusing to write a robot model to "${baseName(activeFile.path)}" — it isn't a .urdf`
    }
  }
  return { kind: 'buffer', id: activeFile.id, path: activeFile.path }
}
