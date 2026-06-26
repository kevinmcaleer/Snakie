/**
 * Parts Library disk layer (#129) — the main process owns all filesystem access
 * (the renderer has no `fs`). A library is a folder of parts, each part in its
 * own sub-folder with a human-readable `parts.yml` + its image/footprint assets,
 * exactly as the epic specifies (modelled on Fusion 360's electronics libraries):
 *
 *   <userData>/parts/
 *     <libraryId>/
 *       library.yml              # { id, name, description, author, version }
 *       <partId>/
 *         parts.yml              # the PartDefinition (sans the inlined image)
 *         image.png|jpg|svg      # optional board image asset
 *
 * On READ, the part's `image` filename is resolved + inlined into the runtime
 * `imageData` data URL so the renderer can draw it. On WRITE, the editor's
 * `imageData` data URL is decoded back out to a file and `image` set to the
 * filename — so `parts.yml` stays small, diff-friendly and portable.
 *
 * All exported IO is best-effort + defensive: a malformed `parts.yml` is skipped
 * (the rest of the library still loads), and writers return a serialisable
 * `{ ok, error }` rather than throwing across IPC.
 */

import { app } from 'electron'
import { basename, join, resolve, sep } from 'path'
import { existsSync, promises as fsp } from 'fs'
import {
  libraryFromYaml,
  libraryToYaml,
  partFromYaml,
  partToYaml
} from '../../shared/part-yaml'
import type { PartDefinition, PartLibrary, PartLibraryWithParts } from '../../shared/part'

/** Absolute path to the user's parts folder (`<userData>/parts`). */
export function partsDir(): string {
  return join(app.getPath('userData'), 'parts')
}

/** The id of the auto-created library that holds the user's own authored parts. */
export const LOCAL_LIBRARY_ID = 'my-parts'

/** The bundled "Standard Boards" library seeded on first run (#52). */
export const STANDARD_LIBRARY_ID = 'snakie-standard'

/** Resolve the bundled Standard Boards library (packaged resources vs dev repo),
 *  mirroring how the plugin host resolves its bundled dirs. */
function bundledStandardLibraryDir(): string {
  const packaged = join(process.resourcesPath, 'examples', 'parts', STANDARD_LIBRARY_ID)
  if (app.isPackaged && existsSync(packaged)) return packaged
  // Dev: __dirname is out/main, so the repo root is two levels up.
  return join(__dirname, '..', '..', 'examples', 'parts', STANDARD_LIBRARY_ID)
}

/** In-flight seed, so concurrent `listLibraries` calls don't race the copy. */
let seedInFlight: Promise<void> | null = null

/**
 * Seed the bundled "Standard Boards" library (Pico / Pico 2 W / ESP32 DevKit) into
 * `<userData>/parts` on first run, so the board selector has a canonical board set
 * out of the box. Idempotent + best-effort: it never overwrites an existing copy
 * (user edits survive) and a failure just falls back to the built-in boards. Runs
 * at most once concurrently (a single copy even if several callers race it).
 */
export function seedStandardLibrary(): Promise<void> {
  if (!seedInFlight) seedInFlight = doSeedStandardLibrary()
  return seedInFlight
}

async function doSeedStandardLibrary(): Promise<void> {
  const dest = join(partsDir(), STANDARD_LIBRARY_ID)
  if (existsSync(dest)) return
  const src = bundledStandardLibraryDir()
  if (!existsSync(src)) return
  // Copy into a temp dir first, then rename — so an interrupted copy can't leave a
  // half-written library that the existsSync guard would then skip.
  const tmp = `${dest}.seeding-${process.pid}`
  try {
    await fsp.mkdir(partsDir(), { recursive: true })
    await fsp.rm(tmp, { recursive: true, force: true })
    await fsp.cp(src, tmp, { recursive: true })
    await fsp.rename(tmp, dest)
  } catch {
    // best-effort — the built-in board fallback covers a failed seed
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Sanitise an id into a safe path segment (no traversal): lower-case, keep only
 * `[a-z0-9-_]`, collapse the rest to `-`, trim. MUST match `sanitisePartId` in
 * the renderer so the editor's filename preview agrees with what's written.
 */
export function sanitiseId(id: string): string {
  return String(id ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'svg', 'gif', 'webp'] as const

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  svg: 'image/svg+xml',
  gif: 'image/gif',
  webp: 'image/webp'
}

/** Decode a `data:<mime>;base64,<data>` (or `data:image/svg+xml,<text>`) URL. */
function decodeDataUrl(dataUrl: string): { ext: string; buf: Buffer } | null {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl)
  if (!m) return null
  const mime = m[1].toLowerCase()
  const isBase64 = !!m[2]
  const data = m[3]
  const ext =
    Object.entries(MIME_BY_EXT).find(([, v]) => v === mime)?.[0] ??
    (mime.includes('svg') ? 'svg' : 'png')
  const buf = isBase64
    ? Buffer.from(data, 'base64')
    : Buffer.from(decodeURIComponent(data), 'utf-8')
  return { ext, buf }
}

/**
 * True if `filename` is a safe bare file inside `dir` — no path separators, no
 * `..` traversal. A `parts.yml` is attacker-authorable (community libraries are
 * cloned verbatim), so its `image` field must never escape the part folder.
 */
function isContainedFile(dir: string, filename: string): boolean {
  if (!filename || filename !== basename(filename) || filename === '..') return false
  const full = resolve(dir, filename)
  return full === resolve(dir, basename(filename)) && full.startsWith(resolve(dir) + sep)
}

/** Read a part's image asset off disk and inline it as a data URL. */
async function inlineImage(partDir: string, filename: string): Promise<string | undefined> {
  // Guard against path traversal via a crafted `image:` value (e.g. `../../x.png`).
  if (!isContainedFile(partDir, filename)) {
    console.warn(`[parts] ignoring unsafe image path: ${filename}`)
    return undefined
  }
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  const mime = MIME_BY_EXT[ext]
  if (!mime) return undefined
  try {
    const buf = await fsp.readFile(join(partDir, filename))
    if (mime === 'image/svg+xml') {
      return `data:${mime},${encodeURIComponent(buf.toString('utf-8'))}`
    }
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch {
    return undefined
  }
}

/** Delete every `image.<ext>` asset in a part folder (clean slate before write). */
async function removeImageAssets(partDir: string): Promise<void> {
  await Promise.all(
    IMAGE_EXTS.map((ext) => fsp.unlink(join(partDir, `image.${ext}`)).catch(() => undefined))
  )
}

/** Read + parse one part folder. Returns null if it has no valid `parts.yml`. */
async function readPart(libDir: string, partId: string): Promise<PartDefinition | null> {
  const partDir = join(libDir, partId)
  let raw: string
  try {
    raw = await fsp.readFile(join(partDir, 'parts.yml'), 'utf-8')
  } catch {
    return null
  }
  let part: PartDefinition
  try {
    part = partFromYaml(raw)
  } catch (err) {
    console.warn(`[parts] skipping ${partId}/parts.yml: ${(err as Error).message}`)
    return null
  }
  if (!part.id) part.id = partId
  if (!Array.isArray(part.headers)) part.headers = []
  if (part.image) {
    const data = await inlineImage(partDir, part.image)
    if (data) part.imageData = data
  }
  return part
}

/** Read one library folder (manifest + every part), or null if not a library. */
async function readLibrary(libId: string): Promise<PartLibraryWithParts | null> {
  const libDir = join(partsDir(), libId)
  let stat: Awaited<ReturnType<typeof fsp.stat>>
  try {
    stat = await fsp.stat(libDir)
  } catch {
    return null
  }
  if (!stat.isDirectory()) return null

  // Manifest (optional — a folder with parts but no manifest still loads).
  let manifest: PartLibrary = { id: libId, name: libId }
  try {
    manifest = libraryFromYaml(await fsp.readFile(join(libDir, 'library.yml'), 'utf-8'))
    if (!manifest.id) manifest.id = libId
  } catch {
    // No manifest → synthesise one from the folder name.
  }

  let entries: string[]
  try {
    entries = await fsp.readdir(libDir)
  } catch {
    entries = []
  }
  const parts: PartDefinition[] = []
  for (const name of entries) {
    if (name.startsWith('.')) continue
    let isDir = false
    try {
      isDir = (await fsp.stat(join(libDir, name))).isDirectory()
    } catch {
      isDir = false
    }
    if (!isDir) continue
    const part = await readPart(libDir, name)
    if (part) parts.push(part)
  }
  parts.sort((a, b) => a.name.localeCompare(b.name))
  return { ...manifest, parts }
}

/** Read every installed library + its parts. Skips bad files; never throws. */
export async function readLibraries(): Promise<PartLibraryWithParts[]> {
  const dir = partsDir()
  let names: string[]
  try {
    names = await fsp.readdir(dir)
  } catch {
    return []
  }
  const libs: PartLibraryWithParts[] = []
  for (const name of names) {
    if (name.startsWith('.')) continue
    const lib = await readLibrary(name)
    if (lib) libs.push(lib)
  }
  libs.sort((a, b) => a.name.localeCompare(b.name))
  return libs
}

/** Result of a write operation (never throws across IPC). */
export interface WriteResult {
  ok: boolean
  error?: string
  /** The sanitised id actually written (so the renderer can re-select it). */
  id?: string
  /** The library the part was written to. */
  libraryId?: string
}

/**
 * Ensure a library folder + manifest exists, creating it (with sane defaults)
 * when absent. Used to auto-provision the local "my-parts" library on first save.
 */
export async function ensureLibrary(meta: PartLibrary): Promise<WriteResult> {
  const id = sanitiseId(meta.id)
  if (!id) return { ok: false, error: 'Library id is empty after sanitising.' }
  const libDir = join(partsDir(), id)
  try {
    await fsp.mkdir(libDir, { recursive: true })
    const manifestPath = join(libDir, 'library.yml')
    // Don't clobber an existing manifest (preserve user/registry metadata).
    try {
      await fsp.access(manifestPath)
    } catch {
      await fsp.writeFile(manifestPath, libraryToYaml({ ...meta, id }), 'utf-8')
    }
    return { ok: true, id }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/**
 * Write a part to `<parts>/<libraryId>/<partId>/parts.yml` (+ image asset).
 * Auto-creates the library folder. The part's `imageData` (a data URL) is
 * written out to `image.<ext>` and `parts.yml`'s `image` set to the filename;
 * if `imageData` is absent any existing image asset is removed.
 */
export async function writePart(libraryId: string, part: PartDefinition): Promise<WriteResult> {
  try {
    const libId = sanitiseId(libraryId) || LOCAL_LIBRARY_ID
    const partId = sanitiseId(part.id)
    if (!partId) return { ok: false, error: 'Part id is empty after sanitising.' }
    if (!Array.isArray(part.headers) || part.headers.length === 0) {
      return { ok: false, error: 'A part needs at least one header with pins.' }
    }

    const partDir = join(partsDir(), libId, partId)
    await fsp.mkdir(partDir, { recursive: true })

    // Persist the image asset from the runtime data URL, if any.
    const toWrite: PartDefinition = { ...part, id: partId }
    delete toWrite.imageData
    // Remove the previously-referenced asset too (community/hand-authored parts
    // may name it e.g. `board.jpg`, which removeImageAssets wouldn't catch).
    try {
      const prev = partFromYaml(await fsp.readFile(join(partDir, 'parts.yml'), 'utf-8'))
      if (prev.image && isContainedFile(partDir, prev.image)) {
        await fsp.unlink(join(partDir, prev.image)).catch(() => undefined)
      }
    } catch {
      // No existing part / unreadable → nothing to clean up.
    }
    await removeImageAssets(partDir)
    if (part.imageData) {
      const decoded = decodeDataUrl(part.imageData)
      if (decoded) {
        const filename = `image.${decoded.ext}`
        await fsp.writeFile(join(partDir, filename), decoded.buf)
        toWrite.image = filename
      } else {
        delete toWrite.image
      }
    } else {
      // No image supplied → drop the reference.
      delete toWrite.image
    }

    await fsp.writeFile(join(partDir, 'parts.yml'), partToYaml(toWrite), 'utf-8')
    return { ok: true, id: partId, libraryId: libId }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/**
 * DEV workflow (#52/issue-3): promote a microcontroller board part into the
 * "Standard Boards" library so it becomes a shipped default. Writes it into the
 * runtime `<userData>/parts/snakie-standard` (so it shows immediately) AND, when
 * running unpackaged (dev), mirrors it into the bundled repo copy so it commits +
 * ships. Re-promoting an existing id is an UPDATE (overwrites). Returns whether the
 * repo copy was written (`shipped`).
 */
export async function promoteToStandard(
  sourceLibraryId: string,
  partId: string
): Promise<WriteResult & { shipped?: boolean }> {
  const srcLib = sanitiseId(sourceLibraryId) || LOCAL_LIBRARY_ID
  const part = await readPart(join(partsDir(), srcLib), sanitiseId(partId))
  if (!part) return { ok: false, error: 'Source part not found.' }
  if ((part.family ?? '').trim().toLowerCase() !== 'microcontroller') {
    return { ok: false, error: 'Only Microcontroller-family parts can be promoted to a board.' }
  }
  // 1) Runtime copy (shows in the board selector immediately).
  const res = await writePart(STANDARD_LIBRARY_ID, part)
  if (!res.ok) return res
  // 2) Dev only: mirror into the bundled repo library so it's committed + shipped.
  let shipped = false
  if (!app.isPackaged) {
    try {
      const repoDir = bundledStandardLibraryDir()
      const id = sanitiseId(part.id)
      await fsp.mkdir(repoDir, { recursive: true })
      const manifest = join(repoDir, 'library.yml')
      if (!existsSync(manifest)) {
        const runtimeManifest = join(partsDir(), STANDARD_LIBRARY_ID, 'library.yml')
        if (existsSync(runtimeManifest)) await fsp.copyFile(runtimeManifest, manifest)
      }
      const repoPartDir = join(repoDir, id)
      await fsp.rm(repoPartDir, { recursive: true, force: true })
      await fsp.cp(join(partsDir(), STANDARD_LIBRARY_ID, id), repoPartDir, { recursive: true })
      shipped = true
    } catch {
      // Repo not writable → the runtime promote still succeeded.
    }
  }
  return { ...res, shipped }
}

/** Delete a part folder (and its assets). A missing folder is a success. */
export async function deletePart(libraryId: string, partId: string): Promise<WriteResult> {
  try {
    const libId = sanitiseId(libraryId)
    const id = sanitiseId(partId)
    if (!libId || !id) return { ok: false, error: 'Bad library or part id.' }
    await fsp.rm(join(partsDir(), libId, id), { recursive: true, force: true })
    return { ok: true, id, libraryId: libId }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/** Create a new (empty) library from its manifest. */
export async function createLibrary(meta: PartLibrary): Promise<WriteResult> {
  const res = await ensureLibrary(meta)
  return res
}

/** Delete a whole library folder. A missing folder is a success. */
export async function deleteLibrary(libraryId: string): Promise<WriteResult> {
  try {
    const id = sanitiseId(libraryId)
    if (!id) return { ok: false, error: 'Bad library id.' }
    await fsp.rm(join(partsDir(), id), { recursive: true, force: true })
    return { ok: true, id }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/** Read just the installed library manifests (no parts) — for update checks. */
export async function readLibraryManifests(): Promise<PartLibrary[]> {
  const libs = await readLibraries()
  // Strip `parts` (and its inlined images) — update checks only need the meta.
  return libs.map((lib): PartLibrary => {
    const manifest: PartLibrary = { id: lib.id, name: lib.name }
    if (lib.description) manifest.description = lib.description
    if (lib.author) manifest.author = lib.author
    if (lib.homepage) manifest.homepage = lib.homepage
    if (lib.version) manifest.version = lib.version
    if (lib.source) manifest.source = lib.source
    return manifest
  })
}
