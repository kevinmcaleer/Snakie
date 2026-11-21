/**
 * SHARE PROJECT — the pure rules behind the Share sheet (ShareProjectDialog).
 * =============================================================================
 *
 * The Share sheet sends a project to a kevsrobots project page: the wiring and
 * parts (as Send to kevsrobots always has), plus the robot model Build shows
 * (its URDF and STL meshes) and a cover picture. Code never goes: the page
 * links to it on GitHub. These helpers are pure so the rules are unit-tested;
 * the dialog does the I/O.
 */
import { baseName, dirname, isAbsolutePath, meshKind, resolveMeshPath } from '../components/robot-mesh'

/** Every `<mesh filename="…">` in a URDF, in order, without repeats. */
export function urdfMeshRefs(urdf: string): string[] {
  const out: string[] = []
  const re = /<mesh\b[^>]*?\bfilename\s*=\s*(["'])(.*?)\1/gi
  for (let m = re.exec(urdf); m; m = re.exec(urdf)) {
    const ref = m[2].trim()
    if (ref && !out.includes(ref)) out.push(ref)
  }
  return out
}

/** One file of the robot model on disk, and the name it gets on kevsrobots. */
export interface ModelFile {
  /** Full path on disk (POSIX separators). */
  path: string
  /** The file name the project page finds it by. */
  name: string
}

/**
 * The files that make up the robot model: the URDF itself and each STL mesh it
 * names. `package://pkg/rel` and plain relative paths resolve against the
 * URDF's folder, as Build does. The project page finds meshes by file name, so
 * two meshes with the same name in different folders keep only the first, and
 * meshes Snakie can't send (`.dae`, web links) are counted in `skipped`.
 */
export function modelFiles(
  folder: string,
  urdfRel: string,
  urdf: string
): { files: ModelFile[]; skipped: string[] } {
  const root = folder.replace(/\\/g, '/').replace(/\/+$/, '')
  const urdfPath = isAbsolutePath(urdfRel) ? resolveMeshPath('', urdfRel) : resolveMeshPath(root, urdfRel)
  const base = dirname(urdfPath)
  const files: ModelFile[] = [{ path: urdfPath, name: baseName(urdfPath) }]
  const names = new Set([files[0].name.toLowerCase()])
  const skipped: string[] = []
  for (const ref of urdfMeshRefs(urdf)) {
    if (/^(https?|file):/i.test(ref) || meshKind(ref) !== 'stl') {
      skipped.push(ref)
      continue
    }
    const rel = ref.replace(/^package:\/\/[^/]+\//i, '')
    const path = resolveMeshPath(base, rel)
    const name = baseName(path)
    if (names.has(name.toLowerCase())) continue
    names.add(name.toLowerCase())
    files.push({ path, name })
  }
  return { files, skipped }
}

/** kevsrobots wants a title of 5 to 200 characters. */
export function pageTitle(name: string): string {
  const clean = String(name ?? '').trim().replace(/\s+/g, ' ').slice(0, 200)
  if (clean.length >= 5) return clean
  return clean ? `${clean} robot` : 'My Snakie robot'
}

/** A `data:image/png;base64,…` URL as bytes, or null when it isn't one. */
export function dataUrlBytes(url: string | null | undefined): Uint8Array | null {
  const m = /^data:[^;,]+;base64,(.*)$/.exec(url ?? '')
  if (!m) return null
  try {
    const bin = atob(m[1])
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

const PROJECT_KEY = 'snakie.share.kevsrobots.'

/** The kevsrobots project this folder was last shared to, if any. */
export function rememberedProject(folder: string | null): number | null {
  if (!folder) return null
  try {
    const n = Number(localStorage.getItem(PROJECT_KEY + folder))
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

export function rememberProject(folder: string | null, id: number): void {
  if (!folder) return
  try {
    localStorage.setItem(PROJECT_KEY + folder, String(id))
  } catch {
    // storage blocked: just don't remember
  }
}
