/**
 * REMOVABLE VOLUMES — where a board's drive shows up, per platform.
 * =============================================================================
 *
 * Several boards present themselves to Snakie as a mounted FAT volume rather
 * than (or as well as) a serial port:
 *
 *  - an **RP2040 in BOOTSEL** mounts as `RPI-RP2`, carrying `INFO_UF2.TXT`
 *  - a **BBC micro:bit** mounts as `MICROBIT` / `MAINTENANCE`, with `DETAILS.TXT`
 *  - a board **running CircuitPython** mounts as `CIRCUITPY`, with `boot_out.txt`
 *    (#753) — and unlike the first two this one is not a flashing mode at all,
 *    it is the board's own filesystem
 *
 * Finding them is the same job every time — the platforms differ, the boards
 * don't — so it lives here once instead of once per board. `firmware/detect.ts`
 * grew the first two copies of it; this is that machinery, extracted.
 *
 * Everything is read-only (`readdir` + `readFile`) and nothing throws for the
 * caller, so it is safe to call repeatedly and safe to call on a path that
 * turns out not to exist — which is the normal case for most of the roots.
 */
import { promises as fs } from 'fs'
import { homedir, platform } from 'os'
import { join } from 'path'

/** A mounted volume that might be a board. */
export interface Volume {
  /** Absolute path the volume is mounted at. */
  mountPath: string
  /**
   * The volume's LABEL, when the platform puts it in the path — `CIRCUITPY`,
   * `RPI-RP2`. Empty on Windows, where a volume is a bare drive letter and the
   * label lives in metadata we don't read; callers there must fall back to
   * probing for a marker file.
   */
  name: string
  /**
   * Whether it is worth READING this volume to see what it is, as opposed to
   * trusting its label.
   *
   * True for anything under a real mount root, where every entry genuinely is a
   * mounted volume. False for the home directory, which is in the root list for
   * unusual mount setups but whose entries are overwhelmingly just the user's
   * folders — probing each of those means a `readdir` per folder in `$HOME`,
   * every time the port list refreshes. A board mounted there is still found by
   * its label; only the content probe is skipped.
   */
  probeContents: boolean
}

/**
 * Where to look for mounted volumes, per platform.
 *
 * Windows has no mount-point directory — removable drives are letters — so
 * every letter is a candidate and the non-existent ones fail their `readdir`
 * harmlessly. POSIX auto-mounters put volumes under a small set of roots, and
 * the `$USER` variants matter: Fedora and friends mount at
 * `/run/media/<user>/CIRCUITPY`, so scanning `/run/media` alone would find the
 * user's *name*, not the volume.
 */
export function volumeSearchRoots(): string[] {
  const os = platform()
  if (os === 'win32') {
    return Array.from({ length: 26 }, (_, i) => `${String.fromCharCode(65 + i)}:\\`)
  }
  if (os === 'darwin') return ['/Volumes']
  // With no $USER the `join`s collapse onto their parents; `listVolumes`
  // de-duplicates by mount path, so the repeat costs one extra `readdir`.
  const user = process.env.USER ?? ''
  return ['/media', join('/media', user), '/run/media', join('/run/media', user), homedir()]
}

/**
 * Enumerate the volumes currently mounted under `roots`.
 *
 * On Windows each root IS a volume (a drive letter). On POSIX each root is a
 * directory OF volumes, so its children are the volumes. Roots that don't exist
 * simply contribute nothing.
 *
 * `roots` is injectable so this can be tested against a temp directory — the
 * platform roots are not something a test can create.
 */
export async function listVolumes(roots: string[] = volumeSearchRoots()): Promise<Volume[]> {
  const out: Volume[] = []
  const seen = new Set<string>()
  const push = (mountPath: string, name: string, probeContents: boolean): void => {
    const existing = seen.has(mountPath)
    if (existing) return
    seen.add(mountPath)
    out.push({ mountPath, name, probeContents })
  }

  if (platform() === 'win32') {
    // 26 drive letters, most of which don't exist — cheap to probe, and there is
    // no label in the path to go on.
    for (const root of roots) if (root) push(root, '', true)
    return out
  }

  const home = homedir()
  for (const root of roots) {
    if (!root) continue
    let names: string[]
    try {
      names = await fs.readdir(root)
    } catch {
      continue // root doesn't exist / isn't readable — the normal case
    }
    const probeContents = root !== home
    for (const name of names) push(join(root, name), name, probeContents)
  }
  return out
}

/**
 * Does `dir` contain any of `names` (case-insensitively)? The marker-file test
 * every board detector runs — a vfat volume can surface `DETAILS.TXT` as
 * `details.txt` depending on how it was mounted, so the comparison can't be
 * exact.
 */
export async function volumeHasFile(dir: string, names: string[]): Promise<boolean> {
  return (await resolveVolumeFile(dir, names)) !== null
}

/** The real, on-disk name of the first of `names` present in `dir`, or null. */
export async function resolveVolumeFile(dir: string, names: string[]): Promise<string | null> {
  const wanted = names.map((n) => n.toLowerCase())
  try {
    const entries = await fs.readdir(dir)
    return entries.find((e) => wanted.includes(e.toLowerCase())) ?? null
  } catch {
    return null
  }
}

/** Read a marker file from a volume, resolving its name case-insensitively.
 *  Returns null when it isn't there or can't be read. */
export async function readVolumeFile(dir: string, name: string): Promise<string | null> {
  const file = await resolveVolumeFile(dir, [name])
  if (!file) return null
  try {
    return await fs.readFile(join(dir, file), 'utf8')
  } catch {
    return null
  }
}
