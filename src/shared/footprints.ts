/**
 * Header-footprint registry (#166) — the shared vocabulary that makes board
 * seating reliable. A *footprint* is a named compatibility tag: a board declares
 * `footprint: xiao`, a carrier declares a mount that ACCEPTS `xiao`, and they seat
 * when the strings match (see {@link ../renderer/src/components/WiringCanvas}). It's
 * free text on disk, which invites typos (`XIAO` ≠ `xiao`), so the Part Editor
 * offers a pick-from-known-list control backed by this registry.
 *
 * Pure + dependency-free (renderer and main both import it): the curated set of
 * well-known standards, plus a collector that harvests every footprint actually in
 * use across the installed libraries, plus the slugifier that normalises a typed
 * value so equivalent spellings converge.
 */

import type { PartLibraryWithParts } from './part'

/** One footprint the picker can offer, with how widely it's used. */
export interface FootprintInfo {
  /** The slug written to `parts.yml` (e.g. `xiao`). */
  id: string
  /** Human label for the dropdown (falls back to the id when uncurated). */
  label: string
  /** How many parts/mounts across the installed libraries reference it. */
  count: number
  /** True for a curated well-known standard (shown even at count 0). */
  common: boolean
}

/**
 * Well-known board/module header footprints, offered even before any installed
 * part uses one — so a new Pico-compatible board can declare the canonical `pico`
 * shape instead of inventing (and misspelling) a name. Ids are the on-disk slugs.
 */
export const COMMON_FOOTPRINTS: { id: string; label: string }[] = [
  { id: 'xiao', label: 'Seeed XIAO' },
  { id: 'pico', label: 'Raspberry Pi Pico / Pico 2' },
  { id: 'feather', label: 'Adafruit Feather' },
  { id: 'qt-py', label: 'Adafruit QT Py' },
  { id: 'itsybitsy', label: 'Adafruit ItsyBitsy' },
  { id: 'nano', label: 'Arduino Nano' },
  { id: 'nano-esp32', label: 'Arduino Nano ESP32' },
  { id: 'microbit', label: 'BBC micro:bit edge' },
  { id: 'esp32-devkit', label: 'ESP32 DevKit' }
]

/**
 * Normalise a typed footprint to its on-disk slug: lower-case, keep only
 * `[a-z0-9-]`, collapse the rest to `-`, trim. So `XIAO`, `xiao ` and `Xiao`
 * all become `xiao` and seat interchangeably. Mirrors the id sanitiser used for
 * part folders. Returns `''` for a value that slugs to nothing.
 */
export function slugifyFootprint(value: string): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Build the footprint option list: the curated standards merged with every
 * footprint actually referenced by a part (`part.footprint`) or a carrier mount
 * (`mount.footprint`) across the installed libraries, with usage counts. Sorted
 * most-used first, then curated standards, then alphabetically — so the shapes a
 * user's own libraries already use surface at the top.
 */
export function collectFootprints(libraries: PartLibraryWithParts[]): FootprintInfo[] {
  const counts = new Map<string, number>()
  for (const lib of libraries ?? []) {
    for (const part of lib.parts ?? []) {
      const fp = slugifyFootprint(part.footprint ?? '')
      if (fp) counts.set(fp, (counts.get(fp) ?? 0) + 1)
      for (const m of part.mounts ?? []) {
        const mf = slugifyFootprint(m.footprint ?? '')
        if (mf) counts.set(mf, (counts.get(mf) ?? 0) + 1)
      }
    }
  }
  const labels = new Map(COMMON_FOOTPRINTS.map((c) => [c.id, c.label]))
  const common = new Set(COMMON_FOOTPRINTS.map((c) => c.id))
  const ids = new Set<string>([...common, ...counts.keys()])
  return [...ids]
    .map((id) => ({ id, label: labels.get(id) ?? id, count: counts.get(id) ?? 0, common: common.has(id) }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        Number(b.common) - Number(a.common) ||
        a.label.localeCompare(b.label)
    )
}
