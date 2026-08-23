import { app } from 'electron'
import { join } from 'path'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { inflateRaw } from 'zlib'
import {
  BUNDLE_RELEASE_API,
  BundleResolveError,
  httpBundleFetch,
  parseBundleIndex,
  parseBundleRelease,
  type BundleIndex,
  type BundleRelease
} from '../../shared/circuitpy-bundle'
import type { Inflate } from '../../shared/zip-read'

/**
 * THE HOST HALF OF A CIRCUITPYTHON INSTALL (#758, epic #209).
 * =============================================================================
 *
 * `src/shared/circuitpy-bundle.ts` knows what the Adafruit bundle IS and how to
 * turn a library name into files. It knows nothing about networks, disks or
 * Electron, which is what makes it testable. This file supplies the three
 * things it needs from a real host and nothing else:
 *
 *   1. **Decompression** — node's `zlib.inflateRaw`, so the ZIP reader needs no
 *      dependency of its own.
 *   2. **Binary downloads** — the bundle is `.mpy` bytecode, so bytes, not text.
 *   3. **The index, cached** — the bundle rebuilds DAILY, and its index is
 *      ~150 KB. Re-downloading that per install would be wasteful and would
 *      burn through GitHub's unauthenticated rate limit (60 requests an hour per
 *      IP) in a classroom behind one NAT. Cached for a day on disk, it costs one
 *      request.
 *
 * The cache falls back to a STALE copy when the network fails, rather than
 * failing the install at its first step: an index a day or two old still names
 * the right libraries, and the per-library download that follows will produce
 * the honest network error if the connection really is gone.
 */

/** Node's raw-deflate, as the ZIP reader's injected {@link Inflate}. */
export const nodeInflate: Inflate = (deflated, uncompressedSize) =>
  new Promise((resolve, reject) => {
    inflateRaw(deflated, { maxOutputLength: Math.max(uncompressedSize, 1) }, (err, out) =>
      err ? reject(err) : resolve(new Uint8Array(out.buffer, out.byteOffset, out.byteLength))
    )
  })

/** Everything the shared resolver needs from a real host. Injected in tests. */
export interface BundleHost {
  /** The newest bundle release — tag, the majors it ships, its index URL. */
  release(): Promise<BundleRelease>
  /** The parsed bundle index for that release. */
  index(): Promise<BundleIndex>
  /** Download a URL as bytes. */
  fetchBinary(url: string): Promise<Uint8Array>
  /** Raw-deflate decompression. */
  inflate: Inflate
}

/** What is written to disk between runs. */
interface CachedBundle {
  /** Epoch ms the release + index were fetched. */
  fetchedAt: number
  /** GitHub's release JSON, unparsed — so a parser fix applies to old caches. */
  release: unknown
  /** The index asset's text, unparsed, for the same reason. */
  index: string
}

/** The bundle is rebuilt daily, so a day is exactly how long a copy is fresh. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

function cachePath(): string {
  return join(app.getPath('userData'), 'circuitpython-bundle', 'bundle-cache.json')
}

/** In-process copy, so several installs in one session share one fetch. */
let memo: CachedBundle | null = null

async function readCache(): Promise<CachedBundle | null> {
  if (memo) return memo
  try {
    const parsed = JSON.parse(await readFile(cachePath(), 'utf-8')) as CachedBundle
    if (!parsed || typeof parsed.index !== 'string' || !parsed.index) return null
    memo = parsed
    return parsed
  } catch {
    return null
  }
}

async function writeCache(entry: CachedBundle): Promise<void> {
  memo = entry
  try {
    const path = cachePath()
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, JSON.stringify(entry), 'utf-8')
  } catch {
    // A cache that can't be written is a slower app, not a broken one.
  }
}

/** Fetch a URL as UTF-8 text, with bundle-shaped errors. */
async function fetchText(url: string, timeoutMs = 20_000): Promise<string> {
  let res: Response
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      // GitHub's API answers HTML to a browser-ish Accept; be explicit.
      headers: { Accept: 'application/json' }
    })
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
  return res.text()
}

/** Download the release listing and its index, and remember them. */
async function refresh(): Promise<CachedBundle> {
  const releaseText = await fetchText(BUNDLE_RELEASE_API)
  let release: unknown
  try {
    release = JSON.parse(releaseText)
  } catch {
    throw new BundleResolveError(
      'malformed',
      "the Adafruit bundle's release listing is not JSON",
      BUNDLE_RELEASE_API
    )
  }
  // Parsed here purely to learn the index URL — and so a malformed release is
  // never cached as if it were good.
  const parsed = parseBundleRelease(release)
  const index = await fetchText(parsed.indexUrl, 60_000)
  parseBundleIndex(index)
  const entry: CachedBundle = { fetchedAt: Date.now(), release, index }
  await writeCache(entry)
  return entry
}

/**
 * The release + index, fresh if possible and stale rather than nothing.
 *
 * A cache younger than a day is used outright. Older, or absent, and it is
 * refreshed — but if that refresh fails and there IS an old copy, the old copy
 * wins: the alternative is refusing to install a library whose name and version
 * we already know, over a listing that changes once a day.
 */
async function current(): Promise<CachedBundle> {
  const cached = await readCache()
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached
  try {
    return await refresh()
  } catch (err) {
    if (cached) return cached
    throw err
  }
}

/** The real host: node's zlib, the platform `fetch`, and a day-long cache. */
export function createBundleHost(): BundleHost {
  return {
    release: async () => parseBundleRelease((await current()).release),
    index: async () => parseBundleIndex((await current()).index),
    fetchBinary: httpBundleFetch(),
    inflate: nodeInflate
  }
}
