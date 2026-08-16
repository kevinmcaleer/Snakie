/**
 * PARTS CATALOG FACETS (#740, under #646).
 *
 * The library filters on three things — type, manufacturer and tags — but they
 * are not three of a kind, and treating them as one flat tag cloud makes the
 * panel noise rather than navigation. Measured over the 40 bundled parts:
 *
 *   families      8   Microcontroller 17 · Sensor 6 · Power 5 · …
 *   manufacturers 10  Generic 9 · Seeed 9 · Adafruit 5 · … · (unset) 2
 *   tags         69   mean 3.8/part — and 51 of them on ≤2 parts
 *
 * So: **type and manufacturer are facets** (every part has exactly one, always
 * shown, always counted) and **tags are a ranked secondary layer**. Two rules
 * keep the tag list useful rather than exhaustive:
 *
 *  - a tag that merely restates a facet is dropped. `power`, `sensor`, `motor`
 *    and `microcontroller` duplicate family names; `adafruit`, `seeed` and
 *    `arduino` duplicate manufacturers. Rendered naively the panel offers
 *    "Seeed Studio (9)" and "seeed (9)" as separate controls for one result.
 *  - the long tail collapses behind a disclosure. A tag on one part narrows 40
 *    to 1 — that is a search result, not a filter, and free-text search already
 *    matches tags.
 *
 * Selection semantics are the standard ones: OR within a facet, AND across
 * facets, AND with the text query. Counts reflect the OTHER active filters, so
 * a value that would return nothing can be shown as the dead end it is.
 *
 * Pure and DOM-free — no index to build or invalidate, just a derivation over
 * the already-loaded libraries.
 */
import type { PartDefinition } from '../../../shared/part'

/** A part paired with the library it came from (what the panel lists). */
export interface CatalogPart {
  libraryId: string
  part: PartDefinition
}

/** The chosen filters. Empty sets mean "no constraint on this axis". */
export interface FacetSelection {
  families: ReadonlySet<string>
  manufacturers: ReadonlySet<string>
  tags: ReadonlySet<string>
}

/** One offered value: what it is, how many parts it would leave, and whether
 *  picking it is currently a dead end. */
export interface FacetValue {
  value: string
  /** Parts matching this value under the OTHER active filters. */
  count: number
  selected: boolean
}

export interface Facets {
  families: FacetValue[]
  manufacturers: FacetValue[]
  /** Ranked by count, facet-restating tags removed, singletons last. */
  tags: FacetValue[]
}

/** The bucket a part with no manufacturer falls in, shown rather than hidden —
 *  two bundled parts have none, and dropping them would quietly shorten the
 *  catalog whenever the facet is used. */
export const UNSET = '—'

export const emptySelection = (): FacetSelection => ({
  families: new Set(),
  manufacturers: new Set(),
  tags: new Set()
})

const familyOf = (p: PartDefinition): string => p.family?.trim() || UNSET
const manufacturerOf = (p: PartDefinition): string => p.manufacturer?.trim() || UNSET
const tagsOf = (p: PartDefinition): string[] =>
  (p.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean)

/** Does a part satisfy the free-text query? Matches the panel's existing
 *  haystack — name, description, manufacturer, family and tags. */
export function matchesQuery(p: PartDefinition, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [p.name, p.description, p.manufacturer, p.family, ...(p.tags ?? [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(q)
}

/**
 * Does a part pass the selection? OR within each facet, AND across them. An
 * `except` axis is ignored, which is what lets a facet count its own values
 * against the other filters rather than against itself.
 */
export function matchesSelection(
  p: PartDefinition,
  sel: FacetSelection,
  except?: keyof FacetSelection
): boolean {
  if (except !== 'families' && sel.families.size && !sel.families.has(familyOf(p))) return false
  if (except !== 'manufacturers' && sel.manufacturers.size && !sel.manufacturers.has(manufacturerOf(p))) {
    return false
  }
  if (except !== 'tags' && sel.tags.size) {
    const t = tagsOf(p)
    // OR within the axis: any chosen tag is enough.
    if (![...sel.tags].some((x) => t.includes(x))) return false
  }
  return true
}

/** The parts left after every filter — what the grid renders. */
export function applyFilters(
  parts: CatalogPart[],
  sel: FacetSelection,
  query = ''
): CatalogPart[] {
  return parts.filter((c) => matchesQuery(c.part, query) && matchesSelection(c.part, sel))
}

/** Count values on one axis against the OTHER filters, so the numbers say what
 *  picking each one would actually leave. */
function countAxis(
  parts: CatalogPart[],
  sel: FacetSelection,
  query: string,
  axis: keyof FacetSelection,
  valuesOf: (p: PartDefinition) => string[]
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const { part } of parts) {
    if (!matchesQuery(part, query) || !matchesSelection(part, sel, axis)) continue
    for (const v of new Set(valuesOf(part))) counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  return counts
}

const toValues = (counts: Map<string, number>, chosen: ReadonlySet<string>): FacetValue[] =>
  [...counts.entries()]
    .map(([value, count]) => ({ value, count, selected: chosen.has(value) }))
    // Commonest first, alphabetical to break ties — a stable order the eye can
    // learn, rather than one that reshuffles as counts change.
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))

/**
 * Tags worth offering: everything the facets don't already say. A tag equal to
 * a family or to any word of a manufacturer is dropped — it would be a second
 * control for the same result set.
 */
export function isRedundantTag(tag: string, families: string[], manufacturers: string[]): boolean {
  const t = tag.toLowerCase()
  if (families.some((f) => f.toLowerCase() === t)) return true
  return manufacturers.some((m) => m.toLowerCase().split(/\s+/).includes(t))
}

/**
 * Build every facet's values for the current selection + query.
 *
 * `tagFloor` is the smallest count a tag needs to be offered up front; anything
 * rarer is still returned (so a disclosure can show it) but sorted after, and a
 * SELECTED tag is always kept visible however rare, or unticking it would mean
 * hunting through the tail.
 */
export function buildFacets(
  parts: CatalogPart[],
  sel: FacetSelection = emptySelection(),
  query = '',
  tagFloor = 2
): Facets {
  const families = countAxis(parts, sel, query, 'families', (p) => [familyOf(p)])
  const manufacturers = countAxis(parts, sel, query, 'manufacturers', (p) => [manufacturerOf(p)])
  const famNames = [...families.keys()]
  const manNames = [...manufacturers.keys()]
  const tags = countAxis(parts, sel, query, 'tags', tagsOf)
  for (const t of [...tags.keys()]) {
    if (!sel.tags.has(t) && isRedundantTag(t, famNames, manNames)) tags.delete(t)
  }
  const tagValues = toValues(tags, sel.tags).sort((a, b) => {
    const aTail = !a.selected && a.count < tagFloor
    const bTail = !b.selected && b.count < tagFloor
    if (aTail !== bTail) return aTail ? 1 : -1
    return b.count - a.count || a.value.localeCompare(b.value)
  })
  return {
    families: toValues(families, sel.families),
    manufacturers: toValues(manufacturers, sel.manufacturers),
    tags: tagValues
  }
}

/** How many tags are offered up front, before the "show all" disclosure. */
export function primaryTagCount(tags: FacetValue[], tagFloor = 2): number {
  return tags.filter((t) => t.selected || t.count >= tagFloor).length
}

/** Toggle one value on an axis (immutably) — the click handler's whole job. */
export function toggleFacet(
  sel: FacetSelection,
  axis: keyof FacetSelection,
  value: string
): FacetSelection {
  const next = new Set(sel[axis])
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return { ...sel, [axis]: next }
}

/** Every active filter as removable chips, so it's always obvious why the grid
 *  is short. */
export function activeChips(sel: FacetSelection): { axis: keyof FacetSelection; value: string }[] {
  const out: { axis: keyof FacetSelection; value: string }[] = []
  for (const axis of ['families', 'manufacturers', 'tags'] as const) {
    for (const value of sel[axis]) out.push({ axis, value })
  }
  return out
}
