/**
 * THE ADAFRUIT CIRCUITPYTHON LIBRARY BUNDLE (#758, epic #209) — `circup`'s job.
 * =============================================================================
 *
 * CircuitPython has no `mip`, and no on-device package manager of any kind. Its
 * equivalent is `circup`, which runs on the COMPUTER and copies libraries out of
 * the Adafruit CircuitPython Library Bundle into `CIRCUITPY/lib`. That is the
 * same shape Snakie's installs already have since #776 — resolve on the host,
 * write files to the board — so this module is a second SOURCE for that one
 * path, not a second path. `mip-resolve.ts` is its MicroPython sibling and the
 * model for its structure: pure, DOM-free, every network call injected.
 *
 * ## What the bundle actually is (verified against the release itself)
 *
 * `adafruit/Adafruit_CircuitPython_Bundle` publishes a dated release — tag
 * `20260820`, rebuilt daily — carrying, among others:
 *
 *   - `adafruit-circuitpython-bundle-<tag>.json`  — the INDEX: every library in
 *     the bundle, with its repo, its pinned version, whether it is a single file
 *     or a folder, and its bundle-internal `dependencies`.
 *   - `adafruit-circuitpython-bundle-9.x-mpy-<tag>.zip`
 *   - `adafruit-circuitpython-bundle-10.x-mpy-<tag>.zip`
 *
 * The `<major>.x` in those names is the load-bearing part: `.mpy` bytecode is
 * tied to a CircuitPython MAJOR version, and a 10.x `.mpy` on a 9.x board does
 * not import. Which majors exist is read from the release's own asset list
 * rather than hardcoded, because Adafruit drops a major from the daily bundle
 * once it is out of support — so the honest answer to "can I install this on
 * CircuitPython 8?" changes over time and must come from the release.
 *
 * ## Why per-LIBRARY archives rather than the whole bundle
 *
 * `circup` downloads the entire ~17 MB bundle zip and caches it. Snakie asks the
 * same release what version each library is pinned at, then fetches THAT
 * library's own release archive — `adafruit-circuitpython-hcsr04-9.x-mpy-
 * 0.4.25.zip`, about 3 KB. Same publisher, same CI, same build tools, same
 * version, same `.mpy`; three thousand bytes instead of seventeen million to put
 * one driver on a board. Installing a driver over a classroom's network should
 * not be a 17 MB download, and the index (~150 KB, cached daily) is the only
 * large-ish thing left.
 *
 * ## Dependencies
 *
 * The index's `dependencies` are bundle-internal library names, and they are
 * resolved transitively — `adafruit_mpu6050` needs `adafruit_bus_device` and
 * `adafruit_register`, and installing it without them puts a driver on the board
 * that imports and then fails. `external_dependencies` are PyPI names
 * (`adafruit-circuitpython-typing`) for type checking on a desktop; they are not
 * device code and are deliberately ignored, exactly as `circup` ignores them.
 *
 * ## `.mpy` is BYTES, and stays bytes
 *
 * `mip-resolve.ts` refuses `.mpy` outright, because it fetches as TEXT and a
 * `.mpy` decoded as UTF-8 is silently corrupt. That refusal is right for its
 * route and wrong for this one: the bundle is predominantly `.mpy`, so this
 * resolver fetches BINARY and hands back `Uint8Array`s, which both device write
 * paths already accept — `driveWriteFile` writes a Buffer to CIRCUITPY, and the
 * raw REPL hex-encodes its chunks precisely so arbitrary bytes survive. Nothing
 * in this module ever converts a library to a string.
 *
 * ## Not the Community bundle (yet)
 *
 * `adafruit/CircuitPython_Community_Bundle` has the same shape and would fit
 * here as a second index. It is deferred on purpose: it is a separate release
 * cadence with its own version skew, none of Snakie's instruments need a library
 * from it, and adding it doubles the "which bundle is this module from?" surface
 * for zero present benefit. When something does need it, this file grows a
 * second {@link BUNDLE_RELEASE_API} and nothing else changes.
 */
import { joinDevicePath, type MipFailureKind } from './mip-resolve'
import { readZipFiles, ZipReadError, type Inflate } from './zip-read'
import type { RuntimeInfo } from './dialect'

/** The GitHub API endpoint for the bundle's newest daily release. */
export const BUNDLE_RELEASE_API =
  'https://api.github.com/repos/adafruit/Adafruit_CircuitPython_Bundle/releases/latest'

/** Where CircuitPython imports libraries from. Not configurable on the board. */
export const BUNDLE_LIB_DIR = '/lib'

/** How a bundle resolution failed. Shares `mip`'s kinds so both routes read the
 *  same in `install-messages.ts` — one vocabulary for one install path. */
export class BundleResolveError extends Error {
  readonly kind: MipFailureKind
  /** The URL being fetched when it failed, when there was one. */
  readonly url?: string

  constructor(kind: MipFailureKind, message: string, url?: string) {
    super(message)
    this.name = 'BundleResolveError'
    this.kind = kind
    this.url = url
  }
}

/** One library, as the bundle's index describes it. */
export interface BundleEntry {
  /** Other BUNDLE library names this one imports. Resolved transitively. */
  dependencies: string[]
  /** True ⇒ a folder of modules; false ⇒ a single `<name>.mpy`. */
  package: boolean
  /** The library's own GitHub repository. */
  repo: string
  /** The version the bundle pins — also that repo's release tag. */
  version: string
  /** The PyPI distribution name, which is also its release-asset stem. */
  pypiName: string
  /** One-line description, when the index carries one. */
  description?: string
}

/** The bundle index: library name → what it is. */
export type BundleIndex = Record<string, BundleEntry>

/** The newest bundle release, reduced to the three facts an install needs. */
export interface BundleRelease {
  /** The release tag, which is its build date: `'20260820'`. */
  tag: string
  /** The CircuitPython MAJOR versions this release ships `.mpy` libraries for. */
  majors: number[]
  /** The URL of its JSON index asset. */
  indexUrl: string
}

/** The shape of a GitHub release, reduced to what {@link parseBundleRelease} reads. */
interface ReleaseJson {
  tag_name?: unknown
  assets?: unknown
}

/** `adafruit-circuitpython-bundle-9.x-mpy-20260820.zip` → major 9. */
const BUNDLE_ZIP_RE = /^adafruit-circuitpython-bundle-(\d+)\.x-mpy-.+\.zip$/i
/** `adafruit-circuitpython-bundle-20260820.json` — the index, and only the index.
 *  Anchored on the date so it can never match an examples/py asset. */
const BUNDLE_INDEX_RE = /^adafruit-circuitpython-bundle-\d{6,}\.json$/i

/**
 * Reduce GitHub's release JSON to a {@link BundleRelease}.
 *
 * The majors come from the asset NAMES rather than a constant: which
 * CircuitPython versions the bundle still builds for is Adafruit's decision,
 * changes without notice, and is the whole basis for telling a user their board
 * is too old. Reading it from the release means Snakie can never claim to
 * support a major that no longer ships.
 */
export function parseBundleRelease(json: unknown): BundleRelease {
  const release = (json ?? {}) as ReleaseJson
  const tag = typeof release.tag_name === 'string' ? release.tag_name.trim() : ''
  const assets = Array.isArray(release.assets) ? release.assets : []
  if (!tag || assets.length === 0) {
    throw new BundleResolveError(
      'malformed',
      "the Adafruit bundle's release listing didn't name a release"
    )
  }
  const majors: number[] = []
  let indexUrl = ''
  for (const raw of assets) {
    const asset = (raw ?? {}) as { name?: unknown; browser_download_url?: unknown }
    const name = typeof asset.name === 'string' ? asset.name : ''
    const url = typeof asset.browser_download_url === 'string' ? asset.browser_download_url : ''
    if (!name || !url) continue
    const zip = BUNDLE_ZIP_RE.exec(name)
    if (zip) {
      const major = Number(zip[1])
      if (Number.isFinite(major) && !majors.includes(major)) majors.push(major)
      continue
    }
    if (!indexUrl && BUNDLE_INDEX_RE.test(name)) indexUrl = url
  }
  if (!indexUrl) {
    throw new BundleResolveError(
      'malformed',
      `the Adafruit bundle release ${tag} carries no library index`
    )
  }
  majors.sort((a, b) => a - b)
  return { tag, majors, indexUrl }
}

/** `'20260820'` → `'2026-08-20'`; anything else passes through unchanged. */
export function bundleReleaseDate(tag: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(tag.trim())
  return m ? `${m[1]}-${m[2]}-${m[3]}` : tag
}

/** The raw JSON shape of one index entry, before it is narrowed. */
interface IndexEntryJson {
  dependencies?: unknown
  package?: unknown
  repo?: unknown
  version?: unknown
  pypi_name?: unknown
  pypi_description?: unknown
}

/**
 * Parse the bundle's JSON index.
 *
 * Entries missing a repo, a version or a PyPI name are DROPPED rather than kept
 * as half-records: those three are exactly what an asset URL is built from, so a
 * record without them could only fail later, further from the cause.
 */
export function parseBundleIndex(text: string): BundleIndex {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new BundleResolveError('malformed', "the Adafruit bundle's index is not JSON")
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new BundleResolveError('malformed', "the Adafruit bundle's index is not a JSON object")
  }
  const index: BundleIndex = {}
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    const entry = (value ?? {}) as IndexEntryJson
    const repo = typeof entry.repo === 'string' ? entry.repo.replace(/\/+$/, '') : ''
    const version = typeof entry.version === 'string' ? entry.version.trim() : ''
    const pypiName = typeof entry.pypi_name === 'string' ? entry.pypi_name.trim() : ''
    if (!repo || !version || !pypiName) continue
    index[name] = {
      dependencies: Array.isArray(entry.dependencies)
        ? entry.dependencies.filter((d): d is string => typeof d === 'string')
        : [],
      package: entry.package === true,
      repo,
      version,
      pypiName,
      ...(typeof entry.pypi_description === 'string' && entry.pypi_description
        ? { description: entry.pypi_description }
        : {})
    }
  }
  if (Object.keys(index).length === 0) {
    throw new BundleResolveError('malformed', "the Adafruit bundle's index lists no libraries")
  }
  return index
}

/**
 * The CircuitPython MAJOR version a board is running, or `null` when there
 * isn't one to read.
 *
 * `null` for a MicroPython board (the bundle is not for it), and `null` for a
 * version string that isn't a number — #776 recorded builds whose reported
 * version is a BRANCH NAME (`feature/psram-and-wifi`), and `parseInt` would
 * cheerfully turn something like that into a major it isn't.
 */
export function circuitPythonMajor(info: RuntimeInfo | null | undefined): number | null {
  if (!info || info.dialect !== 'circuitpython') return null
  const m = /^(\d+)(?:\.|$)/.exec((info.version ?? '').trim())
  if (!m) return null
  const major = Number(m[1])
  return Number.isFinite(major) ? major : null
}

/**
 * Pick the bundle major to install from, or refuse with the reason.
 *
 * There is no nearest-match rule and there must not be one: `.mpy` bytecode is
 * versioned, so "close enough" is a file that fails to import on the board with
 * an error that says nothing about bundles. An exact major or nothing.
 */
export function selectBundleMajor(release: BundleRelease, boardMajor: number | null): number {
  if (boardMajor === null) {
    throw new BundleResolveError(
      'unsupported',
      'Snakie could not read a CircuitPython version from the board, and the Adafruit bundle ' +
        'is published per CircuitPython version'
    )
  }
  if (!release.majors.includes(boardMajor)) {
    const offered =
      release.majors.length > 0
        ? release.majors.join(' and ')
        : 'no CircuitPython version at all'
    throw new BundleResolveError(
      'unsupported',
      `the Adafruit bundle released ${bundleReleaseDate(release.tag)} ships libraries for ` +
        `CircuitPython ${offered}, and this board runs CircuitPython ${boardMajor}`
    )
  }
  return boardMajor
}

/** Refuse a chain that has clearly gone wrong rather than fetching for ever. */
const DEFAULT_MAX_MODULES = 24
const DEFAULT_MAX_FILES = 96

/**
 * `name` and everything it needs, DEPENDENCIES FIRST.
 *
 * Depth-first with a visited set, so a dependency cycle terminates rather than
 * recursing — the index is remote data and nothing guarantees it is acyclic.
 * An unknown dependency is an error, not a shrug: quietly skipping it would
 * install a library that imports something absent.
 */
export function bundleInstallOrder(
  index: BundleIndex,
  name: string,
  maxModules = DEFAULT_MAX_MODULES
): string[] {
  const order: string[] = []
  const seen = new Set<string>()
  const visit = (current: string, from: string | null): void => {
    if (seen.has(current)) return
    seen.add(current)
    const entry = index[current]
    if (!entry) {
      throw new BundleResolveError(
        'not-found',
        from
          ? `${from} needs ${current}, which is not in the Adafruit bundle`
          : `${current} is not in the Adafruit bundle`
      )
    }
    for (const dep of entry.dependencies) visit(dep, current)
    if (order.length >= maxModules) {
      throw new BundleResolveError(
        'too-big',
        `it pulls in more than ${maxModules} bundle libraries`
      )
    }
    order.push(current)
  }
  visit(name, null)
  return order
}

/**
 * The URL of one library's own `<major>.x-mpy` release archive.
 *
 * Every part is read from the index rather than guessed: the repo, the version
 * (which is also that repo's release tag) and the PyPI name (which is also the
 * asset's stem). So the archive fetched is exactly the build the bundle pins.
 */
export function libraryArchiveUrl(entry: BundleEntry, major: number): string {
  return (
    `${entry.repo}/releases/download/${entry.version}/` +
    `${entry.pypiName}-${major}.x-mpy-${entry.version}.zip`
  )
}

/** One file to write to the board, as bytes. */
export interface BundleResolvedFile {
  /** Absolute on-device path, e.g. `/lib/adafruit_bus_device/i2c_device.mpy`. */
  path: string
  /** The file's bytes. `.mpy` is bytecode and is never turned into text. */
  bytes: Uint8Array
  /** The archive it came out of — kept for the install log / provenance note. */
  url: string
  /** The bundle library it belongs to. */
  module: string
}

/** What a bundle resolution produced. */
export interface BundleResolution {
  /** Every file to write, dependencies before the library that needs them. */
  files: BundleResolvedFile[]
  /** Every bundle library resolved, in install order. */
  modules: string[]
  /** The CircuitPython major the archives were taken from. */
  major: number
}

/** Options for {@link resolveBundleModule}. */
export interface BundleResolveOptions {
  /** The parsed bundle index (fetched and cached by the host). */
  index: BundleIndex
  /** The CircuitPython major to install for — from {@link selectBundleMajor}. */
  major: number
  /** Fetch a URL as BYTES. Injected, so this resolver never touches a network. */
  fetchBinary: (url: string) => Promise<Uint8Array>
  /** Raw-deflate decompression, injected (node `zlib`, the browser, or a test). */
  inflate: Inflate
  /** On-device install directory. Defaults to {@link BUNDLE_LIB_DIR}. */
  target?: string
  /** Refuse a library that would write more than this many files. */
  maxFiles?: number
  /** Refuse a dependency set larger than this. */
  maxModules?: number
}

/**
 * The `lib/` subtree of a library archive, and only that.
 *
 * A per-library archive is laid out as `<stem>/lib/…` beside `<stem>/examples/…`
 * and `<stem>/requirements/…`. Only `lib/` is device code; the rest is
 * documentation and desktop packaging metadata that would waste a board's flash.
 * The first path segment is the archive's own stem and is dropped, so what is
 * installed is exactly what would sit in `CIRCUITPY/lib`.
 */
function libRelativePath(archivePath: string): string | null {
  const parts = archivePath.split('/').filter((p) => p !== '')
  // `<stem>/lib/<rest…>` — at least three segments, with `lib` in the middle.
  if (parts.length < 3 || parts[1] !== 'lib') return null
  return parts.slice(2).join('/')
}

/**
 * Resolve a bundle library into the files that install it, on the HOST.
 *
 * Throws {@link BundleResolveError} — never a bare transport or archive error —
 * so the caller always has a `kind` to turn into copy. Files come back
 * dependencies-first; write them with `deviceDirsFor` from `mip-resolve.ts`
 * first, exactly as a `mip` resolution is written.
 */
export async function resolveBundleModule(
  name: string,
  options: BundleResolveOptions
): Promise<BundleResolution> {
  const target = options.target ?? BUNDLE_LIB_DIR
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES
  const modules = bundleInstallOrder(options.index, name, options.maxModules)

  const files: BundleResolvedFile[] = []
  const claimed = new Set<string>()
  for (const module of modules) {
    const entry = options.index[module]
    const url = libraryArchiveUrl(entry, options.major)
    const archive = await options.fetchBinary(url)

    let extracted: { name: string; bytes: Uint8Array }[]
    try {
      extracted = await readZipFiles(archive, options.inflate, (e) =>
        libRelativePath(e.name) !== null
      )
    } catch (err) {
      const detail = err instanceof ZipReadError ? err.message : String(err)
      throw new BundleResolveError('malformed', `${module}'s bundle archive is unreadable: ${detail}`, url)
    }
    if (extracted.length === 0) {
      throw new BundleResolveError('malformed', `${module}'s bundle archive contains no library`, url)
    }
    for (const file of extracted) {
      const relative = libRelativePath(file.name)
      if (relative === null) continue
      let path: string
      try {
        path = joinDevicePath(target, relative)
      } catch {
        throw new BundleResolveError('malformed', `${module} names an unusable path: ${relative}`, url)
      }
      // First writer wins, matching how `mip` treats a repeated path: a shared
      // dependency pulled in twice must not be fetched and written twice.
      if (claimed.has(path)) continue
      if (files.length >= maxFiles) {
        throw new BundleResolveError('too-big', `it installs more than ${maxFiles} files`, url)
      }
      claimed.add(path)
      files.push({ path, bytes: file.bytes, url, module })
    }
  }
  return { files, modules, major: options.major }
}

/**
 * A binary fetcher over the platform `fetch`, with a timeout and every failure
 * normalised to a {@link BundleResolveError} — the byte-oriented twin of
 * `httpMipFetch`. Used by the Electron main process; unit tests inject their own.
 */
export function httpBundleFetch(timeoutMs = 30_000): (url: string) => Promise<Uint8Array> {
  return async (url: string): Promise<Uint8Array> => {
    let res: Response
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      throw new BundleResolveError('network', `couldn't reach ${url} (${reason})`, url)
    }
    if (res.status === 404) {
      throw new BundleResolveError('not-found', `${url} does not exist (HTTP 404)`, url)
    }
    if (!res.ok) {
      throw new BundleResolveError('network', `${url} answered HTTP ${res.status}`, url)
    }
    try {
      return new Uint8Array(await res.arrayBuffer())
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      throw new BundleResolveError('network', `the download of ${url} broke off (${reason})`, url)
    }
  }
}
