/**
 * WHERE A LINKED MESH LANDS (#741) — naming and collision rules for copying a
 * chosen STL into a part's own folder.
 *
 * Linking a model has to COPY the file: a part is a folder you can zip, commit
 * or publish, and a `mesh:` pointing at `~/Downloads` travels nowhere. Until
 * this existed the only way to attach one was to copy it by hand and edit two
 * lines of `parts.yml`.
 *
 * The rules below exist because the destination folder is shared ground — the
 * bundled seeder writes there, `git` writes there, and the user writes there.
 * #750 was paid for by a writer that assumed otherwise, so:
 *
 *   **Never overwrite a file this part did not author.** The one file a part may
 *   overwrite is the mesh it *currently references* — replacing your own model
 *   is the whole point of a Replace button. Every other name collision is
 *   side-stepped by taking the next free `name-2.stl`, and a byte-identical file
 *   already sitting there is simply re-used (re-linking the same STL twice must
 *   not litter the folder with copies of it).
 *
 * Pure and DOM-free; `test/partMeshFile.test.ts` holds it. The main process
 * supplies the directory listing and the byte comparison.
 */

/** Mesh kinds a part may link — the same pair `partMeshRef` will open. */
export const MESH_EXTENSIONS = ['stl', 'dae'] as const

export type MeshExtension = (typeof MESH_EXTENSIONS)[number]

/** How many `-N` variants to try before giving up on finding a free name. */
const MAX_VARIANTS = 200

/**
 * The safe in-folder filename for a chosen source path, or `null` when the file
 * is not a mesh Snakie can open.
 *
 * The result is always a bare `name.ext` with no separators, so it can be
 * written into `parts.yml`'s `mesh:` and re-resolved by the existing containment
 * guards. The stem is squeezed to `[a-z0-9-_]` — a picked file is named by the
 * user's filesystem, and `parts.yml` is a portable text file that a Windows box,
 * a zip and a git checkout all have to agree about.
 */
export function meshAssetName(source: string): string | null {
  const base = String(source ?? '')
    .split(/[/\\]/)
    .pop()
    ?.trim()
  if (!base) return null
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return null // no extension, or a dot-file with none
  const ext = base.slice(dot + 1).toLowerCase()
  if (!(MESH_EXTENSIONS as readonly string[]).includes(ext)) return null
  const stem = base
    .slice(0, dot)
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${stem || 'model'}.${ext}`
}

/** The `-N` variant of a filename: `model.stl` + 2 → `model-2.stl`. */
function variant(name: string, n: number): string {
  const dot = name.lastIndexOf('.')
  return n <= 1 ? name : `${name.slice(0, dot)}-${n}${name.slice(dot)}`
}

/** What a mesh import should do with the folder it is copying into. */
export interface MeshTarget {
  /** The filename to record in `parts.yml` (and to write, if `write`). */
  name: string
  /** False when an identical file is already there and nothing need be copied. */
  write: boolean
}

/**
 * Decide the filename a chosen mesh takes inside the part folder.
 *
 * - `desired`   — {@link meshAssetName} of the source file.
 * - `taken`     — every filename already in the part folder.
 * - `identical` — those of `taken` whose bytes match the source.
 * - `replaces`  — the mesh this part currently references, if any. That single
 *                 file may be overwritten; nothing else may.
 *
 * Never returns `{ write: true }` for a name in `taken` unless it is `replaces`
 * — that invariant is the whole module, and the test asserts it directly.
 */
export function resolveMeshTarget(opts: {
  desired: string
  taken?: readonly string[]
  identical?: readonly string[]
  replaces?: string
}): MeshTarget {
  const desired = opts.desired
  const taken = new Set(opts.taken ?? [])
  const identical = new Set(opts.identical ?? [])
  const replaces = opts.replaces?.trim()

  // Replacing this part's own model: same name, new bytes. Authored by this
  // part, so this save may have it — and keeping the name means `parts.yml`
  // doesn't churn a filename on every Replace.
  if (replaces && replaces === desired) return { name: desired, write: !identical.has(desired) }

  for (let n = 1; n <= MAX_VARIANTS; n++) {
    const name = variant(desired, n)
    // The very same file, already here — link it, copy nothing.
    if (identical.has(name)) return { name, write: false }
    if (!taken.has(name)) return { name, write: true }
  }
  // Practically unreachable: 200 differing files sharing one stem.
  return { name: variant(desired, MAX_VARIANTS + 1), write: true }
}
