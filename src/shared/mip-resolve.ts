/**
 * HOST-SIDE `mip` RESOLUTION (#776).
 * =============================================================================
 *
 * Snakie's driver installs have always assumed the BOARD can install for
 * itself: a catalog module with a `mip` source becomes a `mip.install(<spec>)`
 * snippet run over the REPL. `mip` is not part of MicroPython — it is a
 * micropython-lib package — so that assumption breaks on CircuitPython (#769)
 * and equally on vendor / feature-branch MicroPython builds that ship without
 * it (#776, confirmed on a Pimoroni Tiny 2350). Either way the user saw a bare
 * `ImportError("no module named 'mip'")`.
 *
 * This module is the other route: resolve the package HERE — on the computer,
 * which has a real network stack and no memory ceiling — and hand back a list
 * of plain files. The caller writes them with `device.writeFile`, which already
 * routes to the CIRCUITPY drive when one is mounted (#754) and over the raw
 * REPL otherwise, so ONE resolution serves both runtimes.
 *
 * It implements `mip`'s own resolution algorithm (micropython-lib
 * `mip/__init__.py`), so the same spec strings the catalog already carries keep
 * meaning exactly what they mean to `mip`:
 *
 *   - `github:owner/repo/path.py` — one file, written to `<target>/path.py`.
 *   - `github:owner/repo`         — a PACKAGE: fetch its `package.json`, write
 *     every entry in `urls` / `hashes`, then resolve `deps` transitively.
 *   - `umqtt.simple`              — an INDEX name: `<index>/package/py/<name>/
 *     <version>.json`, whose `hashes` name content-addressed files under
 *     `<index>/file/<xx>/<hash>`.
 *
 * Deliberately NOT covered (see the module docs / issue #776):
 *   - `.mpy` bytecode installs. `mip` picks a `.mpy` variant when the board's
 *     bytecode version is known; we only ever install SOURCE `.py`, because
 *     Snakie ships no mpy-cross and a `.mpy` fetched as text would corrupt.
 *     A spec that names a `.mpy` fails loudly rather than writing garbage.
 *   - Anything needing the board to participate (its `sys.implementation._mpy`,
 *     its own network stack, its own index credentials).
 *
 * Dependency-free by design — the same discipline as `dialect.ts` — so main,
 * preload, the web build and unit tests can all import it. Network access is
 * INJECTED as {@link MipFetch} rather than reaching for a global, which is what
 * makes the whole resolver testable without a network.
 */

/** MicroPython's official package index — `mip`'s own default. */
export const MIP_DEFAULT_INDEX = 'https://micropython.org/pi/v2'

/** Where `mip` installs by default, on both runtimes. */
export const MIP_DEFAULT_TARGET = '/lib'

/** Why a resolution could not finish. Chooses the wording the user is shown. */
export type MipFailureKind =
  /** The spec asks for something this route deliberately doesn't do (`.mpy`). */
  | 'unsupported'
  /** A fetch threw, timed out, or answered with a server-side status. */
  | 'network'
  /** The server answered 404 — the spec names something that isn't there. */
  | 'not-found'
  /** A `package.json` was unparseable, or not shaped like one. */
  | 'malformed'
  /** A guard tripped: too many files, or a dependency chain too deep. */
  | 'too-big'

/**
 * A resolution failure that knows WHICH kind of failure it is, so the caller
 * can turn it into copy that tells the user what to do next rather than
 * re-surfacing a transport error.
 */
export class MipResolveError extends Error {
  readonly kind: MipFailureKind
  /** The URL being fetched when it failed, when there was one. */
  readonly url?: string

  constructor(kind: MipFailureKind, message: string, url?: string) {
    super(message)
    this.name = 'MipResolveError'
    this.kind = kind
    this.url = url
  }
}

/**
 * Fetch a text resource. Injected so the resolver is testable offline and so
 * each host (Electron main, the browser build) can bring its own timeout and
 * error policy. MUST reject — ideally with a {@link MipResolveError} — for any
 * non-success status.
 */
export type MipFetch = (url: string) => Promise<string>

/** One file the caller should write to the board. */
export interface MipResolvedFile {
  /** Absolute on-device path, e.g. `/lib/modulino/__init__.py`. */
  path: string
  /** The file's source text. */
  contents: string
  /** Where it came from — kept for the install log / provenance note. */
  url: string
}

/** Options for {@link resolveMipSpec}. Only `fetchText` is required. */
export interface MipResolveOptions {
  /** How to fetch a URL as text. */
  fetchText: MipFetch
  /** Package index base URL. Defaults to {@link MIP_DEFAULT_INDEX}. */
  index?: string
  /** On-device install directory. Defaults to {@link MIP_DEFAULT_TARGET}. */
  target?: string
  /** Branch / tag / index version, as `mip`'s `version=` argument. */
  version?: string
  /** Refuse a package that would write more than this many files. */
  maxFiles?: number
  /** Refuse a dependency chain deeper than this. */
  maxDepth?: number
}

/** What a resolution produced. */
export interface MipResolution {
  /** Every file to write, in resolution order (parents of a dir come first). */
  files: MipResolvedFile[]
  /** Every package spec that was resolved, root first — for the install log. */
  packages: string[]
}

/** The subset of a `mip` `package.json` this resolver reads. */
interface MipPackageJson {
  /** `[onDevicePath, sourceUrlOrSpec]` pairs. */
  urls?: [string, string][]
  /** `[onDevicePath, contentHash]` pairs, served by the index. */
  hashes?: [string, string][]
  /** `[packageSpec, version]` pairs, resolved transitively. */
  deps?: ([string, string] | string)[]
  version?: string
}

const DEFAULT_MAX_FILES = 64
const DEFAULT_MAX_DEPTH = 4

/** Is `spec` something fetchable rather than a bare index package name? */
export function isRemoteMipSpec(spec: string): boolean {
  return /^(https?:\/\/|github:|gitlab:)/i.test(spec.trim())
}

/**
 * Split a trailing `@ref` off a `github:` / `gitlab:` spec —
 * `github:robert-hh/SH1106/sh1106.py@v1.2` pins a tag. Only those two schemes
 * are split: an `@` in an http(s) URL is a legitimate character (userinfo,
 * query values) and stripping it there would corrupt the URL.
 */
export function splitMipRef(spec: string): { spec: string; ref?: string } {
  const trimmed = spec.trim()
  if (!/^(github|gitlab):/i.test(trimmed)) return { spec: trimmed }
  const at = trimmed.lastIndexOf('@')
  if (at <= 0) return { spec: trimmed }
  const ref = trimmed.slice(at + 1).trim()
  if (!ref) return { spec: trimmed.slice(0, at) }
  return { spec: trimmed.slice(0, at), ref }
}

/**
 * `mip`'s `_rewrite_url`: turn a `github:` / `gitlab:` short form into the raw
 * URL that serves the file, at `ref` (default `HEAD`, exactly as `mip` does).
 * An `http(s)` URL passes through untouched. Returns `null` for a spec that is
 * neither — an index package NAME, which has no direct URL.
 */
export function rewriteMipUrl(spec: string, ref = 'HEAD'): string | null {
  const trimmed = spec.trim()
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  const m = /^(github|gitlab):(.+)$/i.exec(trimmed)
  if (!m) return null
  const parts = m[2].split('/').filter((p) => p !== '')
  if (parts.length < 2) return null
  const [owner, repo, ...rest] = parts
  const branch = ref || 'HEAD'
  if (m[1].toLowerCase() === 'gitlab') {
    return `https://gitlab.com/${owner}/${repo}/-/raw/${branch}/${rest.join('/')}`
  }
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${rest.join('/')}`
}

/**
 * Join an on-device install directory with a package-relative path, rejecting
 * anything that would escape the target (`..`, an absolute path). A malicious
 * or simply broken `package.json` should never be able to name `/boot.py`.
 */
export function joinDevicePath(target: string, relative: string): string {
  const rel = relative.trim().replace(/\\/g, '/')
  if (!rel || rel.startsWith('/')) {
    throw new MipResolveError('malformed', `package names an unusable path: ${relative}`)
  }
  const segments = rel.split('/').filter((s) => s !== '' && s !== '.')
  if (segments.length === 0 || segments.some((s) => s === '..')) {
    throw new MipResolveError('malformed', `package names an unusable path: ${relative}`)
  }
  const base = target.replace(/\/+$/, '')
  return `${base}/${segments.join('/')}`
}

/**
 * Every directory that must exist before `paths` can be written, parents first
 * and de-duplicated. MicroPython has no recursive `mkdir`, so a package that
 * installs `/lib/modulino/__init__.py` needs `/lib` and `/lib/modulino` created
 * in that order. Pure.
 */
export function deviceDirsFor(paths: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const path of paths) {
    const segments = path.split('/').filter((s) => s !== '')
    // The last segment is the FILE; every prefix before it is a directory.
    let acc = ''
    for (const seg of segments.slice(0, -1)) {
      acc = `${acc}/${seg}`
      if (!seen.has(acc)) {
        seen.add(acc)
        out.push(acc)
      }
    }
  }
  return out
}

/** Mutable state threaded through one resolution. */
interface Ctx {
  fetchText: MipFetch
  index: string
  target: string
  maxFiles: number
  maxDepth: number
  files: MipResolvedFile[]
  packages: string[]
  /** Every package.json URL already resolved — cuts dependency cycles. */
  seenPackages: Set<string>
  /** Every device path already claimed — first writer wins, as `mip` does. */
  seenPaths: Set<string>
}

/** Fetch one file and record it, honouring the file-count guard. */
async function addFile(ctx: Ctx, devicePath: string, url: string): Promise<void> {
  if (ctx.seenPaths.has(devicePath)) return
  if (ctx.files.length >= ctx.maxFiles) {
    throw new MipResolveError(
      'too-big',
      `the package installs more than ${ctx.maxFiles} files`
    )
  }
  if (/\.mpy$/i.test(url)) {
    throw new MipResolveError(
      'unsupported',
      'the package ships pre-compiled .mpy bytecode, which Snakie can only install with mip on the board',
      url
    )
  }
  const contents = await ctx.fetchText(url)
  ctx.seenPaths.add(devicePath)
  ctx.files.push({ path: devicePath, contents, url })
}

/**
 * Resolve one `package.json` (already a fetchable spec) and everything it
 * pulls in: `hashes` (index-served, content-addressed), `urls` (direct), then
 * `deps` transitively.
 */
async function resolveJson(
  ctx: Ctx,
  jsonSpec: string,
  version: string | undefined,
  depth: number
): Promise<void> {
  const url = rewriteMipUrl(jsonSpec, version || 'HEAD')
  if (!url) {
    throw new MipResolveError('malformed', `not a resolvable package spec: ${jsonSpec}`)
  }
  if (ctx.seenPackages.has(url)) return
  ctx.seenPackages.add(url)

  const raw = await ctx.fetchText(url)
  let pkg: MipPackageJson
  try {
    pkg = JSON.parse(raw) as MipPackageJson
  } catch {
    throw new MipResolveError('malformed', 'the package index returned something that is not JSON', url)
  }
  if (!pkg || typeof pkg !== 'object') {
    throw new MipResolveError('malformed', 'the package description is not a JSON object', url)
  }

  // The package.json's own directory — `urls` entries may be relative to it.
  const baseUrl = url.slice(0, url.lastIndexOf('/'))

  for (const entry of pkg.hashes ?? []) {
    if (!Array.isArray(entry) || entry.length < 2) continue
    const [devicePath, hash] = entry
    await addFile(
      ctx,
      joinDevicePath(ctx.target, devicePath),
      `${ctx.index}/file/${String(hash).slice(0, 2)}/${hash}`
    )
  }

  for (const entry of pkg.urls ?? []) {
    if (!Array.isArray(entry) || entry.length < 2) continue
    const [devicePath, source] = entry
    const absolute = isRemoteMipSpec(source) ? source : `${baseUrl}/${source}`
    const fileUrl = rewriteMipUrl(absolute, version || 'HEAD')
    if (!fileUrl) {
      throw new MipResolveError('malformed', `package names an unfetchable url: ${source}`, url)
    }
    await addFile(ctx, joinDevicePath(ctx.target, devicePath), fileUrl)
  }

  for (const dep of pkg.deps ?? []) {
    const [depSpec, depVersion] = Array.isArray(dep) ? dep : [dep, undefined]
    if (!depSpec) continue
    await resolvePackage(ctx, String(depSpec), depVersion, depth + 1)
  }
}

/** `mip`'s `_install_package`, minus the writing: classify, then resolve. */
async function resolvePackage(
  ctx: Ctx,
  rawSpec: string,
  version: string | undefined,
  depth: number
): Promise<void> {
  if (depth > ctx.maxDepth) {
    throw new MipResolveError(
      'too-big',
      `its dependencies nest more than ${ctx.maxDepth} levels deep`
    )
  }
  const { spec, ref } = splitMipRef(rawSpec)
  if (!spec) throw new MipResolveError('malformed', 'empty package spec')
  const effectiveVersion = ref ?? version
  ctx.packages.push(spec)

  if (isRemoteMipSpec(spec)) {
    if (/\.(py|mpy)$/i.test(spec)) {
      // A single file: `mip` writes it as `<target>/<basename>`.
      const url = rewriteMipUrl(spec, effectiveVersion || 'HEAD')
      if (!url) throw new MipResolveError('malformed', `not a resolvable spec: ${spec}`)
      const name = spec.split('/').pop() ?? ''
      await addFile(ctx, joinDevicePath(ctx.target, name), url)
      return
    }
    const jsonSpec = /\.json$/i.test(spec) ? spec : `${spec.replace(/\/+$/, '')}/package.json`
    await resolveJson(ctx, jsonSpec, effectiveVersion, depth)
    return
  }

  // A bare index package name — `mip install umqtt.simple`. Always the SOURCE
  // (`py`) variant: Snakie ships no mpy-cross and cannot pick a bytecode build.
  const indexVersion = effectiveVersion || 'latest'
  await resolveJson(
    ctx,
    `${ctx.index}/package/py/${spec}/${indexVersion}.json`,
    effectiveVersion,
    depth
  )
}

/**
 * Resolve a `mip` spec into the files it would install, on the HOST.
 *
 * Throws {@link MipResolveError} — never a bare transport error — so the caller
 * always has a `kind` to turn into copy. Returns the files in resolution order;
 * write them with {@link deviceDirsFor} first.
 */
export async function resolveMipSpec(
  spec: string,
  options: MipResolveOptions
): Promise<MipResolution> {
  const ctx: Ctx = {
    fetchText: options.fetchText,
    index: (options.index ?? MIP_DEFAULT_INDEX).replace(/\/+$/, ''),
    target: options.target ?? MIP_DEFAULT_TARGET,
    maxFiles: options.maxFiles ?? DEFAULT_MAX_FILES,
    maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
    files: [],
    packages: [],
    seenPackages: new Set(),
    seenPaths: new Set()
  }
  await resolvePackage(ctx, spec, options.version, 0)
  if (ctx.files.length === 0) {
    throw new MipResolveError('malformed', 'the package description lists no files')
  }
  return { files: ctx.files, packages: ctx.packages }
}

/**
 * A {@link MipFetch} over the platform `fetch`, with a timeout and every
 * failure normalised to a {@link MipResolveError}. Used by the Electron main
 * process and the web build; unit tests inject their own instead.
 */
export function httpMipFetch(timeoutMs = 20_000): MipFetch {
  return async (url: string): Promise<string> => {
    let res: Response
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      throw new MipResolveError('network', `couldn't reach ${url} (${reason})`, url)
    }
    if (res.status === 404) {
      throw new MipResolveError('not-found', `${url} does not exist (HTTP 404)`, url)
    }
    if (!res.ok) {
      throw new MipResolveError('network', `${url} answered HTTP ${res.status}`, url)
    }
    try {
      return await res.text()
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      throw new MipResolveError('network', `the download of ${url} broke off (${reason})`, url)
    }
  }
}
