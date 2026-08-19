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

import { connectablePinCount } from '../../shared/part'
import { app } from 'electron'
import { basename, join, resolve, sep } from 'path'
import { createHash } from 'crypto'
import { existsSync, promises as fsp, type Dirent } from 'fs'
import { simpleGit } from 'simple-git'
import {
  libraryFromYaml,
  libraryToYaml,
  partFromYaml,
  partToYaml
} from '../../shared/part-yaml'
import {
  backfillTopLevel,
  planPartStatus,
  planPartSync,
  type BundledPartStatus,
  type SeedManifest
} from '../../shared/bundled-seed'
import { bumpPatch } from '../../shared/part-registry'
import { reporter } from '../report-error'
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

/** The seed manifest file (a dot-file, so the library reader skips it). Records
 *  the bundled `version` last synced to + a hash of each part as we wrote it, so a
 *  later sync can tell an untouched part (safe to refresh) from a user-edited one. */
const SEED_MANIFEST_FILE = '.snakie-seed.json'

function hashText(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

async function readTextOrNull(p: string): Promise<string | null> {
  try {
    return await fsp.readFile(p, 'utf-8')
  } catch {
    return null
  }
}

/** The bundled library's declared version (drives the refresh gate), or undefined. */
async function readBundleVersion(src: string): Promise<string | undefined> {
  const txt = await readTextOrNull(join(src, 'library.yml'))
  if (!txt) return undefined
  try {
    return libraryFromYaml(txt).version
  } catch {
    return undefined
  }
}

async function readSeedManifest(dest: string): Promise<SeedManifest | null> {
  const txt = await readTextOrNull(join(dest, SEED_MANIFEST_FILE))
  if (!txt) return null
  try {
    const obj = JSON.parse(txt) as Partial<SeedManifest>
    if (typeof obj?.version === 'string' && obj.parts && typeof obj.parts === 'object') {
      return { version: obj.version, parts: obj.parts as Record<string, string> }
    }
  } catch {
    // corrupt manifest → treat as absent (a full re-sync rebuilds it)
  }
  return null
}

async function writeSeedManifest(dest: string, m: SeedManifest): Promise<void> {
  await fsp
    .writeFile(join(dest, SEED_MANIFEST_FILE), JSON.stringify(m), 'utf-8')
    .catch(reporter('parts: seed manifest write'))
}

/** Hash every installed part's `parts.yml` — the manifest baseline after a copy. */
async function hashInstalledParts(dir: string): Promise<Record<string, string>> {
  const parts: Record<string, string> = {}
  let entries: Dirent[] = []
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return parts
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const yml = await readTextOrNull(join(dir, e.name, 'parts.yml'))
    if (yml !== null) parts[e.name] = hashText(yml)
  }
  return parts
}

/**
 * Sync an ALREADY-SEEDED bundled library with the app's current bundle (#166).
 * New parts are copied in; parts untouched since we seeded them are refreshed to
 * the newer bundle; user-edited (or unknown-origin) parts keep their content but
 * gain any top-level fields the bundle added (e.g. a board's `footprint`) — so
 * board seating works for installs that predate those fields. Gated on the bundled
 * `library.yml` version so the per-part hashing only runs when the bundle changes.
 */
async function syncBundledLibrary(src: string, dest: string): Promise<void> {
  const bundleVersion = await readBundleVersion(src)
  const manifest = await readSeedManifest(dest)
  // Fast path: this install already tracks the current bundle version — only pull
  // in wholly-new part folders (matches the historical additive behaviour).
  const upToDate = !!bundleVersion && manifest?.version === bundleVersion

  let entries: Dirent[]
  try {
    entries = await fsp.readdir(src, { withFileTypes: true })
  } catch {
    return
  }

  const hashes: Record<string, string> = { ...(manifest?.parts ?? {}) }
  let dirty = manifest === null

  for (const e of entries) {
    if (!e.isDirectory()) continue
    const folder = e.name
    const srcPart = join(src, folder)
    const bundleYml = await readTextOrNull(join(srcPart, 'parts.yml'))
    if (bundleYml === null) continue // not a part folder
    const destPart = join(dest, folder)
    const localYml = existsSync(destPart) ? await readTextOrNull(join(destPart, 'parts.yml')) : null

    if (upToDate) {
      if (localYml === null && !existsSync(destPart)) {
        await fsp.cp(srcPart, destPart, { recursive: true }).catch(reporter('parts: seed copy-new'))
        hashes[folder] = hashText(bundleYml)
        dirty = true
      }
      continue
    }

    const action = planPartSync({
      existsLocal: localYml !== null,
      localHash: localYml !== null ? hashText(localYml) : undefined,
      bundleHash: hashText(bundleYml),
      seededHash: manifest?.parts?.[folder]
    })
    if (action === 'copy-new') {
      await fsp.cp(srcPart, destPart, { recursive: true }).catch(reporter('parts: seed copy-new'))
      hashes[folder] = hashText(bundleYml)
      dirty = true
    } else if (action === 'refresh') {
      // Untouched since seeded → adopt the newer bundle wholesale.
      await fsp.rm(destPart, { recursive: true, force: true }).catch(reporter('parts: seed refresh rm'))
      await fsp.cp(srcPart, destPart, { recursive: true }).catch(reporter('parts: seed refresh cp'))
      hashes[folder] = hashText(bundleYml)
      dirty = true
    } else if (action === 'backfill' && localYml !== null) {
      const { text, changed } = backfillTopLevel(bundleYml, localYml)
      if (changed) {
        await fsp
          .writeFile(join(destPart, 'parts.yml'), text, 'utf-8')
          .catch(reporter('parts: seed backfill write'))
        dirty = true
      }
      hashes[folder] = hashText(changed ? text : localYml)
    } else if (localYml !== null) {
      // skip — already identical; record the baseline hash.
      hashes[folder] = hashText(localYml)
    }
  }

  if (bundleVersion && dirty) {
    await writeSeedManifest(dest, { version: bundleVersion, parts: hashes })
  }
}

async function doSeedStandardLibrary(): Promise<void> {
  const dest = join(partsDir(), STANDARD_LIBRARY_ID)
  const src = bundledStandardLibraryDir()
  if (!existsSync(src)) return

  // Already seeded: reconcile with the current bundle — new parts in, untouched
  // parts refreshed, user edits preserved (only missing fields backfilled). See
  // syncBundledLibrary; this replaced a copy-new-folders-only pass that left parts
  // seeded before a field existed (e.g. `footprint`) stuck without it (#166).
  if (existsSync(dest)) {
    await syncBundledLibrary(src, dest).catch(reporter('parts: bundled library sync'))
    return
  }

  // First run: full copy into a temp dir then rename — so an interrupted copy
  // can't leave a half-written library that the existsSync guard would then skip.
  const tmp = `${dest}.seeding-${process.pid}`
  try {
    await fsp.mkdir(partsDir(), { recursive: true })
    await fsp.rm(tmp, { recursive: true, force: true })
    await fsp.cp(src, tmp, { recursive: true })
    await fsp.rename(tmp, dest)
    // Stamp the manifest so later syncs can tell untouched parts from user edits.
    const version = await readBundleVersion(src)
    if (version) await writeSeedManifest(dest, { version, parts: await hashInstalledParts(dest) })
  } catch {
    // best-effort — the built-in board fallback covers a failed seed
    await fsp.rm(tmp, { recursive: true, force: true }).catch(reporter('parts: seed temp cleanup'))
  }
}

/** Read just the `version` + `name` out of a `parts.yml`, tolerating a bad file. */
function partMeta(yml: string | null): { name?: string; version?: string } {
  if (yml === null) return {}
  try {
    const p = partFromYaml(yml)
    return { name: p.name, version: p.version }
  } catch {
    return {}
  }
}

/**
 * Compare every bundled part with its installed copy (#643), so the Parts panel can
 * say "the bundled version is newer than yours" — and offer the way back.
 *
 * Only parts that exist in the BUNDLE are reported (a user's own parts have nothing
 * to compare against). Best-effort: an unreadable file just yields a status with the
 * fields it could determine, never an exception.
 */
export async function bundledPartStatuses(): Promise<BundledPartStatus[]> {
  const src = bundledStandardLibraryDir()
  const dest = join(partsDir(), STANDARD_LIBRARY_ID)
  if (!existsSync(src)) return []
  // Wait for any first-run seed/sync: mid-copy, parts look uninstalled and every
  // one of them would read as "behind" the bundle.
  await seedStandardLibrary().catch(() => undefined)
  const manifest = await readSeedManifest(dest)

  let entries: Dirent[]
  try {
    entries = await fsp.readdir(src, { withFileTypes: true })
  } catch {
    return []
  }

  const out: BundledPartStatus[] = []
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue
    const bundleYml = await readTextOrNull(join(src, e.name, 'parts.yml'))
    if (bundleYml === null) continue // not a part folder
    const localYml = await readTextOrNull(join(dest, e.name, 'parts.yml'))
    // Not installed at all ⇒ not "behind", just absent (the seeder copies it in).
    // Reporting it would badge parts the user cannot even select.
    if (localYml === null) continue
    const bundleMeta = partMeta(bundleYml)
    const localMeta = partMeta(localYml)
    const { edited, behind } = planPartStatus({
      localHash: localYml !== null ? hashText(localYml) : undefined,
      bundleHash: hashText(bundleYml),
      seededHash: manifest?.parts?.[e.name],
      localVersion: localMeta.version,
      bundledVersion: bundleMeta.version
    })
    out.push({
      id: e.name,
      name: localMeta.name ?? bundleMeta.name,
      localVersion: localMeta.version,
      bundledVersion: bundleMeta.version,
      edited,
      behind
    })
  }
  return out
}

/** Where {@link resetPartToBundled} stashes the copy it replaces. Dot-prefixed so
 *  `readLibrary` skips it — a backup must never show up as a duplicate part. */
const SEED_BACKUP_DIR = '.backups'

/**
 * Restore one bundled part to the version shipped in this app (#643).
 *
 * The seeder deliberately never overwrites an edited part, which leaves it stranded
 * on an old schema with no way back — this is that way back. The current folder is
 * moved to `<library>/.backups/<id>/` FIRST (so a custom image or help file survives,
 * not just the YAML), then the bundle is copied in and the seed manifest is stamped
 * with the bundle's hash — which re-marks the part as untouched, so ordinary
 * `refresh` syncs pick it up again from here on.
 *
 * Equivalent to deleting the folder and letting the seeder re-copy it, minus the
 * restart and the data loss.
 */
export async function resetPartToBundled(partId: string): Promise<WriteResult> {
  const id = sanitiseId(partId)
  if (!id) return { ok: false, error: 'No part id given.' }
  const srcPart = join(bundledStandardLibraryDir(), id)
  if (!existsSync(join(srcPart, 'parts.yml'))) {
    return { ok: false, error: `"${id}" is not a bundled part — there is nothing to reset it to.` }
  }
  const dest = join(partsDir(), STANDARD_LIBRARY_ID)
  const destPart = join(dest, id)

  try {
    // 1) Preserve the current copy whole, replacing any previous backup of it.
    if (existsSync(destPart)) {
      const backup = join(dest, SEED_BACKUP_DIR, id)
      await fsp.mkdir(join(dest, SEED_BACKUP_DIR), { recursive: true })
      await fsp.rm(backup, { recursive: true, force: true })
      await fsp.cp(destPart, backup, { recursive: true })
      await fsp.rm(destPart, { recursive: true, force: true })
    }
    // 2) Take the bundle wholesale.
    await fsp.cp(srcPart, destPart, { recursive: true })
  } catch (err) {
    return { ok: false, error: `Could not reset "${id}": ${(err as Error).message}` }
  }

  // 3) Re-baseline the manifest so the part counts as untouched again and future
  //    releases can `refresh` it normally instead of falling back to backfill.
  //
  //    ONLY when a manifest already exists, and never advancing its `version`.
  //    Writing a fresh manifest stamped with the CURRENT bundle version would make
  //    the next `syncBundledLibrary` take its up-to-date fast path — which only
  //    copies wholly-new folders — and so silently skip the reconcile every OTHER
  //    stale part in the install is still waiting for. An install with no manifest
  //    needs that full pass more than it needs this one hash: the reset part is now
  //    byte-identical to the bundle, so the next sync classifies it `skip` and
  //    records its hash correctly anyway.
  const manifest = await readSeedManifest(dest)
  const bundleYml = await readTextOrNull(join(srcPart, 'parts.yml'))
  if (manifest && bundleYml !== null) {
    await writeSeedManifest(dest, {
      version: manifest.version,
      parts: { ...manifest.parts, [id]: hashText(bundleYml) }
    })
  }
  return { ok: true, id, libraryId: STANDARD_LIBRARY_ID }
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

/** Read a part's bundled help document (markdown) off disk as raw text. */
async function inlineHelp(partDir: string, filename: string): Promise<string | undefined> {
  // Guard against path traversal via a crafted `help:` value (e.g. `../../x.md`).
  if (!isContainedFile(partDir, filename)) {
    console.warn(`[parts] ignoring unsafe help path: ${filename}`)
    return undefined
  }
  try {
    return await fsp.readFile(join(partDir, filename), 'utf-8')
  } catch {
    return undefined
  }
}

/** Delete every `image.<ext>` asset in a part folder (clean slate before write). */
async function removeImageAssets(partDir: string, base = 'image'): Promise<void> {
  await Promise.all(
    IMAGE_EXTS.map((ext) => fsp.unlink(join(partDir, `${base}.${ext}`)).catch(() => undefined))
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
  // The REAR photo (#636) — inlined exactly like the front, or a part authored
  // with a back face loads with the pins but no picture.
  if (part.rear?.image) {
    const data = await inlineImage(partDir, part.rear.image)
    if (data) part.rear = { ...part.rear, imageData: data }
  }
  if (part.help) {
    const text = await inlineHelp(partDir, part.help)
    if (text !== undefined) part.helpText = text
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

/** Unlink a file that may already be gone. An absent file IS the desired end state,
 *  so `ENOENT` is silent (not the noisy error we were logging on every help-less
 *  save); any other failure is reported but never thrown — a save shouldn't fail
 *  because a stale asset couldn't be cleaned up. */
async function unlinkQuietly(path: string, label: string): Promise<void> {
  await fsp.unlink(path).catch((err: NodeJS.ErrnoException) => {
    if (err?.code !== 'ENOENT') reporter(label)(err)
  })
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
    // A part needs SOMEWHERE to connect — but that need not be a header. A Grove
    // or QWIIC module's only electrical interface is its socket, and it has no
    // broken-out header at all. This guard used to ask only that `headers` be
    // non-empty, so such a part passed the editor's own check and was then
    // rejected here, naming a thing it correctly does not have. Both callers now
    // share one rule (#130).
    if (connectablePinCount(part) === 0) {
      return { ok: false, error: 'A part needs at least one pin — on a header or a connector.' }
    }

    const partDir = join(partsDir(), libId, partId)
    await fsp.mkdir(partDir, { recursive: true })

    // Persist the image asset from the runtime data URL, if any.
    const toWrite: PartDefinition = { ...part, id: partId }
    delete toWrite.imageData
    delete toWrite.helpText
    // Remove the previously-referenced assets too (community/hand-authored parts
    // may name them e.g. `board.jpg`, which removeImageAssets wouldn't catch).
    try {
      const prev = partFromYaml(await fsp.readFile(join(partDir, 'parts.yml'), 'utf-8'))
      if (prev.image && isContainedFile(partDir, prev.image)) {
        await unlinkQuietly(join(partDir, prev.image), 'parts: remove old image')
      }
      if (prev.rear?.image && isContainedFile(partDir, prev.rear.image)) {
        await unlinkQuietly(join(partDir, prev.rear.image), 'parts: remove old rear image')
      }
      if (prev.help && isContainedFile(partDir, prev.help)) {
        await unlinkQuietly(join(partDir, prev.help), 'parts: remove old help')
      }
    } catch {
      // No existing part / unreadable → nothing to clean up.
    }
    await removeImageAssets(partDir)
    await removeImageAssets(partDir, 'rear')
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

    // The REAR photo, under its own basename so the two faces never overwrite
    // each other. Without this a rear image uploaded in the editor was simply
    // discarded on save — the picture appeared, then vanished.
    if (part.rear?.imageData) {
      const decoded = decodeDataUrl(part.rear.imageData)
      const rear = { ...part.rear }
      delete rear.imageData
      if (decoded) {
        const filename = `rear.${decoded.ext}`
        await fsp.writeFile(join(partDir, filename), decoded.buf)
        rear.image = filename
      } else {
        delete rear.image
      }
      toWrite.rear = Object.keys(rear).length ? rear : undefined
    } else if (toWrite.rear) {
      const rear = { ...toWrite.rear }
      delete rear.imageData
      delete rear.image
      toWrite.rear = Object.keys(rear).length ? rear : undefined
    }

    // Persist the bundled help markdown, if any (empty ⇒ drop the reference).
    const helpText = typeof part.helpText === 'string' ? part.helpText : undefined
    if (helpText && helpText.trim()) {
      await fsp.writeFile(join(partDir, 'help.md'), helpText, 'utf-8')
      toWrite.help = 'help.md'
    } else {
      await unlinkQuietly(join(partDir, 'help.md'), 'parts: remove help')
      delete toWrite.help
    }

    await fsp.writeFile(join(partDir, 'parts.yml'), partToYaml(toWrite), 'utf-8')
    return { ok: true, id: partId, libraryId: libId }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/** Result of reading a part driver file's source (never throws across IPC). */
export interface DriverSourceResult {
  ok: boolean
  /** The driver file's UTF-8 contents, when `ok`. */
  contents?: string
  error?: string
}

/**
 * Read a part driver file's contents so the renderer can copy it onto the board
 * (#184). `source` is either a bare filename shipped inside the part's own folder
 * (`<parts>/<lib>/<part>/<source>`, path-traversal guarded) or an `http(s)://`
 * URL fetched HERE in main (the renderer's CSP forbids outbound requests, exactly
 * like the parts registry fetch). Returns the text; never throws across IPC.
 */
export async function readDriverSource(
  libraryId: string,
  partId: string,
  source: string
): Promise<DriverSourceResult> {
  const src = String(source ?? '').trim()
  if (!src) return { ok: false, error: 'Driver source is empty.' }
  try {
    if (/^https?:\/\//i.test(src)) {
      const res = await fetch(src, { signal: AbortSignal.timeout(15_000) })
      if (!res.ok) return { ok: false, error: `Fetch ${src} → HTTP ${res.status}` }
      return { ok: true, contents: await res.text() }
    }
    // Otherwise a bundled file inside the part folder. Guard path traversal.
    const libId = sanitiseId(libraryId)
    const pId = sanitiseId(partId)
    if (!libId || !pId) return { ok: false, error: 'Unknown part for driver source.' }
    const partDir = join(partsDir(), libId, pId)
    if (!isContainedFile(partDir, src)) {
      return { ok: false, error: `Unsafe driver path: ${src}` }
    }
    const contents = await fsp.readFile(join(partDir, src), 'utf-8')
    return { ok: true, contents }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/**
 * The driver-candidate files shipped inside a part's folder (#655): the `.py` /
 * `.mpy` basenames beside `parts.yml`, sorted. Lets the Part Editor OFFER what
 * actually ships instead of a free-typed filename, and warn when a bundled
 * driver names a file that isn't there (which installs nothing, discoverable
 * today only on hardware). Returns `[]` for an unknown part or a folder that
 * doesn't exist yet — never throws across IPC.
 */
export async function listPartDriverFiles(libraryId: string, partId: string): Promise<string[]> {
  const libId = sanitiseId(libraryId)
  const pId = sanitiseId(partId)
  if (!libId || !pId) return []
  try {
    const entries = await fsp.readdir(join(partsDir(), libId, pId), { withFileTypes: true })
    return entries
      .filter((e) => e.isFile() && /\.(py|mpy)$/i.test(e.name))
      .map((e) => e.name)
      .sort()
  } catch {
    return []
  }
}

/**
 * Resolve the absolute path to a bundled file inside a part folder
 * (`<parts>/<lib>/<part>/<filename>`), path-traversal guarded like the driver/image
 * readers. Returns null for an unsafe or unknown ref. Used to copy a part's linked
 * mesh into a project URDF's `meshes/` folder (#406).
 */
export function resolvePartAsset(libraryId: string, partId: string, filename: string): string | null {
  const libId = sanitiseId(libraryId)
  const pId = sanitiseId(partId)
  const file = String(filename ?? '').trim()
  if (!libId || !pId || !file) return null
  const partDir = join(partsDir(), libId, pId)
  if (!isContainedFile(partDir, file)) return null
  return join(partDir, file)
}

/**
 * DEV workflow (#52/issue-3, #192): promote ANY part into the Standard library so
 * it becomes a shipped default — not just microcontrollers, so the standard
 * library can also hold sensors, ICs, power parts, displays, etc. Writes it into
 * the runtime `<userData>/parts/snakie-standard` (so it shows immediately) AND,
 * when running unpackaged (dev), mirrors it into the bundled repo copy so it
 * commits + ships. Re-promoting an existing id is an UPDATE (overwrites). Returns
 * whether the repo copy was written (`shipped`).
 */
export async function promoteToStandard(
  sourceLibraryId: string,
  partId: string
): Promise<WriteResult & { shipped?: boolean }> {
  const srcLib = sanitiseId(sourceLibraryId) || LOCAL_LIBRARY_ID
  const part = await readPart(join(partsDir(), srcLib), sanitiseId(partId))
  if (!part) return { ok: false, error: 'Source part not found.' }
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

/**
 * DEV workflow (#197): publish the runtime Standard library to GitHub. Bumps its
 * `library.yml` PATCH version, then commits + pushes the library's git checkout —
 * so editing parts in the app and clicking Publish ships a newer version users
 * pick up via the update check (#194/#196).
 *
 * Requires the Standard library to be a **git checkout** (i.e. installed from the
 * registry, which clones the snakie-parts repo) with a push remote configured.
 * Returns the new version on success, or a guiding error. Never throws.
 */
export async function publishStandardLibrary(
  message?: string
): Promise<WriteResult & { version?: string }> {
  try {
    const dir = join(partsDir(), STANDARD_LIBRARY_ID)
    if (!existsSync(join(dir, '.git'))) {
      return {
        ok: false,
        error:
          "The Standard library isn't a git checkout. Install it from the registry first (so it clones the snakie-parts repo), then Publish."
      }
    }
    // Bump the manifest PATCH version so the update check sees the new release.
    const manifestPath = join(dir, 'library.yml')
    const manifest = libraryFromYaml(await fsp.readFile(manifestPath, 'utf-8'))
    const version = bumpPatch(manifest.version)
    await fsp.writeFile(manifestPath, libraryToYaml({ ...manifest, version }), 'utf-8')

    const git = simpleGit(dir)
    await git.add('.')
    await git.commit(message?.trim() || `Publish ${STANDARD_LIBRARY_ID} v${version}`)
    await git.push()
    return { ok: true, id: STANDARD_LIBRARY_ID, version }
  } catch (err) {
    return { ok: false, error: `Publish failed: ${(err as Error).message}` }
  }
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
