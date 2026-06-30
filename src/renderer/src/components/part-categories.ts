/**
 * PART CATEGORIES (#193, epic #191)
 * =================================
 *
 * The parts library groups parts under **category** section headers (Inputs,
 * Outputs, ICs, Power, Microcontrollers, Computers, …). The category is the
 * part's existing `family` field — we keep `family` as the on-disk/schema term
 * (so `parts.yml` and {@link isBoardPart} are unchanged) and present it as a
 * "Category" with a canonical order here.
 *
 * Pure + DOM-free so the grouping/ordering is unit-tested.
 */

/** Canonical categories, in display order. A part whose `family` matches one of
 *  these (case-insensitively) sorts here; unrecognised families get their own
 *  section after these (alphabetically), and parts with no family fall under
 *  {@link OTHER_CATEGORY}, shown last. */
export const PART_CATEGORIES = [
  'Microcontroller',
  'Computer',
  'Sensor',
  'Input',
  'Output',
  'Motor',
  'Display',
  'Communication',
  'Power',
  'IC'
] as const

/** Section for parts with no family set. */
export const OTHER_CATEGORY = 'Other'

const CANONICAL_RANK = new Map(PART_CATEGORIES.map((c, i) => [c.toLowerCase(), i]))
const UNKNOWN_RANK = 1000 // unrecognised families: after canonical, before Other
const OTHER_RANK = 1_000_000

/** The category a part belongs to: its trimmed `family`, or `Other` when unset. */
export function partCategory(part: { family?: string | null }): string {
  return (part.family ?? '').trim() || OTHER_CATEGORY
}

/**
 * Sort rank for a category: canonical categories in {@link PART_CATEGORIES}
 * order, then unrecognised families (tie-broken by name), then `Other` last.
 */
export function categoryRank(category: string): number {
  const canonical = CANONICAL_RANK.get(category.trim().toLowerCase())
  if (canonical !== undefined) return canonical
  return category === OTHER_CATEGORY ? OTHER_RANK : UNKNOWN_RANK
}

export interface CategoryGroup<T> {
  category: string
  items: T[]
}

/**
 * Group parts into category sections, ordered by {@link categoryRank} (then
 * category name), with each section's parts sorted by name.
 */
export function groupByCategory<T extends { family?: string | null; name?: string }>(
  parts: T[]
): CategoryGroup<T>[] {
  const byCat = new Map<string, T[]>()
  for (const p of parts) {
    const cat = partCategory(p)
    const arr = byCat.get(cat)
    if (arr) arr.push(p)
    else byCat.set(cat, [p])
  }
  return [...byCat.entries()]
    .map(([category, items]) => ({
      category,
      items: items.slice().sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
    }))
    .sort(
      (a, b) => categoryRank(a.category) - categoryRank(b.category) || a.category.localeCompare(b.category)
    )
}
