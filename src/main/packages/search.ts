import { CURATED_PACKAGES } from './registry'
import type { PackageInfo } from './types'

/**
 * Package search (issue #20).
 *
 * All network access lives in the MAIN process — the renderer's CSP forbids
 * outbound requests, so search must be brokered here. We use PyPI's JSON API
 * (`https://pypi.org/pypi/<name>/json`), which is a stable, key-free, CORS-free
 * endpoint and returns a package's metadata. PyPI has no public free-text
 * search JSON API, so the strategy is:
 *
 *   1. Always include matches from the offline CURATED list (substring match on
 *      name/description) so search works with no network at all.
 *   2. Attempt an exact-name PyPI lookup for the query and, for MicroPython,
 *      common `micropython-<query>` / `<query>` variants. Any that resolve are
 *      merged in with their real description + latest version.
 *
 * Network failures are swallowed — search degrades to the curated subset rather
 * than throwing, so the feature is usable offline and the build never depends
 * on the network.
 */

const PYPI_TIMEOUT_MS = 6000

/** PyPI JSON shape — only the fields we read. */
interface PypiJson {
  info?: {
    name?: string
    summary?: string
    version?: string
  }
}

/** Fetch a single PyPI package's metadata, or null on miss/error/timeout. */
async function fetchPypi(name: string): Promise<PackageInfo | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PYPI_TIMEOUT_MS)
  try {
    const res = await fetch(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    })
    if (!res.ok) return null
    const json = (await res.json()) as PypiJson
    const info = json.info
    if (!info?.name) return null
    return {
      name: info.name,
      description: info.summary ?? '',
      version: info.version,
      source: 'pypi'
    }
  } catch {
    // Network restricted / offline / 404 / abort — degrade gracefully.
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Candidate PyPI names to probe for a free-text query. MicroPython libraries
 * are frequently published as `micropython-<thing>`, so we try a few sensible
 * spellings without making this combinatorial.
 */
function candidateNames(query: string): string[] {
  const q = query.trim()
  const lower = q.toLowerCase()
  const set = new Set<string>()
  if (lower) {
    set.add(lower)
    if (!lower.startsWith('micropython-')) set.add(`micropython-${lower}`)
  }
  return [...set]
}

/**
 * Search for packages matching `query`. Returns curated matches first, then any
 * resolved PyPI hits, de-duplicated by lowercased name. Never throws.
 */
export async function searchPackages(query: string): Promise<PackageInfo[]> {
  const q = query.trim().toLowerCase()
  if (!q) return []

  const results: PackageInfo[] = []
  const seen = new Set<string>()

  // 1) Offline curated matches.
  for (const pkg of CURATED_PACKAGES) {
    if (pkg.name.toLowerCase().includes(q) || pkg.description.toLowerCase().includes(q)) {
      results.push(pkg)
      seen.add(pkg.name.toLowerCase())
    }
  }

  // 2) Best-effort PyPI lookups for candidate names (parallel, fault-tolerant).
  const hits = await Promise.all(candidateNames(query).map((n) => fetchPypi(n)))
  for (const hit of hits) {
    if (hit && !seen.has(hit.name.toLowerCase())) {
      results.push(hit)
      seen.add(hit.name.toLowerCase())
    }
  }

  return results
}
