/**
 * Pure registry + version logic for the community Parts Library (#129).
 *
 * The "master list of approved community libraries" is a JSON document in a
 * GitHub repo (see {@link DEFAULT_REGISTRY_URL}); administration is just PRs
 * against that repo. The main process fetches it; everything HERE is pure
 * data-in/data-out (no fetch, no fs) so it is fully unit-testable:
 *
 *  - {@link parseRegistry}  — validate + normalise a fetched registry document.
 *  - {@link compareVersions}/{@link isNewer} — SemVer-ish ordering.
 *  - {@link diffInstalled}  — which installed libraries have a newer version.
 *  - {@link availableToInstall} — registry entries not yet installed.
 */

import type {
  LibraryUpdate,
  PartLibrary,
  PartRegistry,
  RegistryEntry
} from './part'

/**
 * Compare two pre-release strings per SemVer §11: dot-separated identifiers,
 * numeric identifiers compared numerically (`rc.2 < rc.10`), non-numeric
 * lexically, a numeric identifier always lower than a non-numeric one, and a
 * shorter run of identifiers lower when the common prefix is equal. `''` (no
 * pre-release = a release) sorts **above** any pre-release.
 */
function comparePre(a: string, b: string): -1 | 0 | 1 {
  if (!a && !b) return 0
  if (!a) return 1 // a is a release → higher
  if (!b) return -1
  const as = a.split('.')
  const bs = b.split('.')
  const n = Math.max(as.length, bs.length)
  for (let i = 0; i < n; i++) {
    const x = as[i]
    const y = bs[i]
    if (x === undefined) return -1 // a is shorter → lower
    if (y === undefined) return 1
    const xn = /^\d+$/.test(x)
    const yn = /^\d+$/.test(y)
    if (xn && yn) {
      const d = parseInt(x, 10) - parseInt(y, 10)
      if (d !== 0) return d < 0 ? -1 : 1
    } else if (xn) {
      return -1 // numeric < non-numeric
    } else if (yn) {
      return 1
    } else if (x < y) {
      return -1
    } else if (x > y) {
      return 1
    }
  }
  return 0
}

/**
 * Compare two `MAJOR.MINOR.PATCH` strings. Returns `-1` if `a < b`, `1` if
 * `a > b`, `0` if equal. Missing components count as `0` (`"1.2"` == `"1.2.0"`);
 * a leading `v` is tolerated; `+build` metadata is ignored; a pre-release suffix
 * (`-beta`, `-rc.2`) makes an otherwise-equal version compare as **lower**
 * (`1.0.0-beta < 1.0.0`) and pre-releases order per SemVer (`rc.2 < rc.10`).
 * Non-numeric / empty input sorts as `0.0.0`.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const part = (v: string): { nums: number[]; pre: string } => {
    // Strip a leading `v` and any `+build` metadata, then split core / pre-release.
    const cleaned = String(v ?? '').trim().replace(/^v/i, '').split('+')[0]
    const [core, ...preParts] = cleaned.split('-')
    const nums = core.split('.').map((n) => {
      const x = parseInt(n, 10)
      return Number.isFinite(x) ? x : 0
    })
    return { nums, pre: preParts.join('-') }
  }
  const pa = part(a)
  const pb = part(b)
  const len = Math.max(pa.nums.length, pb.nums.length, 3)
  for (let i = 0; i < len; i++) {
    const na = pa.nums[i] ?? 0
    const nb = pb.nums[i] ?? 0
    if (na < nb) return -1
    if (na > nb) return 1
  }
  return comparePre(pa.pre, pb.pre)
}

/** True when `available` is strictly newer than `installed` (null ⇒ always). */
export function isNewer(available: string, installed: string | null): boolean {
  if (!available) return false
  if (installed === null || installed === undefined || installed === '') return true
  return compareVersions(available, installed) > 0
}

/**
 * Increment the PATCH of a `MAJOR.MINOR.PATCH` version so an edit produces a new,
 * detectable version (#172). Tolerates a leading `v`, drops any `-pre`/`+build`
 * suffix, and treats missing/garbage input as `0.1.0` (so a first bump → `0.1.1`).
 */
export function bumpPatch(version: string | undefined): string {
  const core = String(version ?? '').trim().replace(/^v/i, '').split('+')[0].split('-')[0]
  const [maj, min, pat] = core.split('.').map((n) => {
    const x = parseInt(n, 10)
    return Number.isFinite(x) ? x : NaN
  })
  // No usable numeric component at all (undefined/garbage) ⇒ treat as 0.1.0 → 0.1.1;
  // otherwise a present major with missing minor/patch defaults those to 0.
  if (!Number.isFinite(maj) && !Number.isFinite(min) && !Number.isFinite(pat)) return '0.1.1'
  const major = Number.isFinite(maj) ? maj : 0
  const minor = Number.isFinite(min) ? min : 0
  const patch = Number.isFinite(pat) ? pat : 0
  return `${major}.${minor}.${patch + 1}`
}

/**
 * Validate + normalise a fetched registry document (already JSON-parsed, or a
 * raw string). Drops malformed entries (an entry needs at least an `id`, `name`
 * and `repo`); defaults `version` to `"0.0.0"`. Never throws on a structurally
 * odd document — returns an empty library list instead.
 */
export function parseRegistry(input: unknown): PartRegistry {
  let doc: unknown = input
  if (typeof input === 'string') {
    try {
      doc = JSON.parse(input)
    } catch {
      return { libraries: [] }
    }
  }
  const obj = (doc ?? {}) as Record<string, unknown>
  const list = Array.isArray(obj.libraries) ? obj.libraries : []
  const libraries: RegistryEntry[] = []
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const id = typeof r.id === 'string' ? r.id.trim() : ''
    const name = typeof r.name === 'string' ? r.name.trim() : ''
    const repo = typeof r.repo === 'string' ? r.repo.trim() : ''
    if (!id || !name || !repo) continue
    const entry: RegistryEntry = {
      id,
      name,
      repo,
      version: typeof r.version === 'string' && r.version.trim() ? r.version.trim() : '0.0.0'
    }
    if (typeof r.description === 'string' && r.description.trim()) {
      entry.description = r.description.trim()
    }
    if (typeof r.author === 'string' && r.author.trim()) entry.author = r.author.trim()
    if (Array.isArray(r.tags)) {
      const tags = r.tags.map((t) => String(t).trim()).filter((t) => t !== '')
      if (tags.length) entry.tags = tags
    }
    libraries.push(entry)
  }
  const out: PartRegistry = { libraries }
  if (typeof obj.schema === 'number') out.schema = obj.schema
  return out
}

/**
 * For each INSTALLED library that also appears in the registry, compute its
 * update status. Libraries not in the registry (the user's own local ones) are
 * omitted. Matched by id (case-insensitive).
 */
export function diffInstalled(
  installed: PartLibrary[],
  registry: PartRegistry
): LibraryUpdate[] {
  const byId = new Map<string, RegistryEntry>()
  for (const e of registry.libraries) byId.set(e.id.toLowerCase(), e)
  const out: LibraryUpdate[] = []
  for (const lib of installed) {
    const entry = byId.get(String(lib.id ?? '').toLowerCase())
    if (!entry) continue
    const installedVer = lib.version ?? null
    out.push({
      id: lib.id,
      name: lib.name,
      installed: installedVer,
      available: entry.version,
      updateAvailable: isNewer(entry.version, installedVer)
    })
  }
  return out
}

/**
 * Registry entries NOT yet installed (so the panel can offer "Add library").
 * Matched by id (case-insensitive).
 */
export function availableToInstall(
  installed: PartLibrary[],
  registry: PartRegistry
): RegistryEntry[] {
  const have = new Set(installed.map((l) => String(l.id ?? '').toLowerCase()))
  return registry.libraries.filter((e) => !have.has(e.id.toLowerCase()))
}
