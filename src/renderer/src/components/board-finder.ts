/**
 * BOARD FINDER — the gallery's own decisions (#893, epic #884).
 * =============================================================================
 *
 * `shared/board-index.ts` owns the index: parsing, filtering, and picking a
 * build. This module owns what the GALLERY does with it — how boards are shelved,
 * what a card shows when it has no photo, and which of upstream's fields are
 * stated as facts. The request that reaches the firmware flasher is next door in
 * `board-finder-bus.ts`, so a listener can import it without the gallery.
 *
 * Separate from the component, and DOM-free, so every one of those decisions is
 * a unit test in node rather than an assertion about JSX.
 *
 * WHY THERE IS NO STORAGE OR MEMORY FILTER. The issue asks for one and upstream
 * makes it impossible: `board.json` publishes `External Flash` and `External RAM`
 * as booleans in `features` and no figure anywhere. Those two stay where upstream
 * put them — ordinary feature chips, which is an honest question ("has external
 * flash?") the data can answer — and {@link boardFacts} states them again on the
 * board itself, alongside a plain admission that the SIZE is not published. A
 * "≥ 4 MB" control would have had to quietly drop most of the catalogue to draw
 * itself, which is worse than not offering it.
 */
import type { BoardBuild, BoardFilter, IndexedBoard } from '../../../shared/board-index'

// ---------------------------------------------------------------------------
// Shelving
// ---------------------------------------------------------------------------

/** One vendor's boards, the gallery's browsing unit. */
export interface VendorShelf {
  vendor: string
  boards: IndexedBoard[]
}

/** Shelf heading for a board whose vendor upstream left blank. */
export const UNKNOWN_VENDOR = 'Other'

/**
 * Group boards into vendor shelves — the Parts Catalog's category shelves, for a
 * catalogue whose natural sections are makers.
 *
 * Vendors alphabetically, `Other` last; boards within a shelf by product name so
 * a vendor's range reads in order rather than in upstream's file order.
 */
export function shelvesByVendor(boards: readonly IndexedBoard[]): VendorShelf[] {
  const byVendor = new Map<string, IndexedBoard[]>()
  for (const b of boards) {
    const vendor = b.vendor.trim() || UNKNOWN_VENDOR
    const shelf = byVendor.get(vendor)
    if (shelf) shelf.push(b)
    else byVendor.set(vendor, [b])
  }
  return [...byVendor.entries()]
    .sort(([a], [b]) => {
      // `Other` is a bucket, not a maker, so it sorts below the real ones
      // wherever its name would otherwise land.
      if (a === UNKNOWN_VENDOR) return 1
      if (b === UNKNOWN_VENDOR) return -1
      return a.localeCompare(b)
    })
    .map(([vendor, list]) => ({
      vendor,
      boards: [...list].sort((x, y) => x.product.localeCompare(y.product))
    }))
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

/**
 * The two letters a photo-less board shows instead (8 of the 225 have no thumb).
 *
 * Initials of the first two words, so `Feather RP2350` reads `FR` rather than
 * `FE` — a vendor's range is mostly one-word-apart, and the second word is what
 * tells two of them apart. Falls back to the board id, which is never empty.
 */
export function boardInitials(board: IndexedBoard): string {
  const words = board.product.trim().split(/\s+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  const source = words[0] || board.id
  return source.slice(0, 2).toUpperCase()
}

/**
 * What a build is called in the variant list.
 *
 * A null variant is upstream's plain build; calling it "Standard" rather than
 * leaving it blank matters, because it sits in a list beside named variants and
 * an unlabelled row reads as a rendering fault.
 */
export const PLAIN_BUILD_LABEL = 'Standard'

export function buildLabel(build: BoardBuild): string {
  return build.variant ?? PLAIN_BUILD_LABEL
}

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

/** One stated fact on a board's detail. */
export interface BoardFact {
  label: string
  value: string
}

/** Features that are a yes/no upstream publishes but no figure to go with it. */
const SIZELESS_FEATURES: readonly { feature: string; label: string }[] = [
  { feature: 'External Flash', label: 'External flash' },
  { feature: 'External RAM', label: 'External RAM' }
]

/** What upstream says when asked how big either of those is. */
export const NO_SIZE_PUBLISHED = 'present — size not published'

/**
 * The facts a board's detail states, in display order.
 *
 * Only what upstream actually publishes. `External flash` / `External RAM`
 * appear here as the booleans they are, saying outright that the size is not
 * published — the alternative was to omit them, which invites the reader to
 * assume the board has neither.
 */
export function boardFacts(board: IndexedBoard): BoardFact[] {
  const facts: BoardFact[] = [{ label: 'MCU', value: board.mcu || 'unknown' }]
  if (board.port) facts.push({ label: 'Port', value: board.port })
  if (board.flashOffset) facts.push({ label: 'Flash offset', value: board.flashOffset })
  for (const { feature, label } of SIZELESS_FEATURES) {
    if (board.features.includes(feature)) facts.push({ label, value: NO_SIZE_PUBLISHED })
  }
  return facts
}

/** Upstream's variants as an ordered list — plain first is the BUILD list's job;
 *  this is the descriptions, by variant id, so the order is stable between renders. */
export function variantList(board: IndexedBoard): { variant: string; description: string }[] {
  return Object.entries(board.variants)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([variant, description]) => ({ variant, description }))
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

/**
 * The filter's active selections, for the "clear" affordance and the chip row.
 *
 * Free text is deliberately NOT a chip: it has its own visible input with its own
 * clear, and echoing it as a removable chip gives one value two controls that can
 * disagree.
 */
export function activeFilterChips(
  filter: BoardFilter
): { axis: 'vendor' | 'mcu' | 'feature'; value: string }[] {
  const out: { axis: 'vendor' | 'mcu' | 'feature'; value: string }[] = []
  if (filter.vendor) out.push({ axis: 'vendor', value: filter.vendor })
  if (filter.mcu) out.push({ axis: 'mcu', value: filter.mcu })
  for (const f of filter.features ?? []) out.push({ axis: 'feature', value: f })
  return out
}

/** Whether anything is narrowing the catalogue — including the search box. */
export function isFiltering(filter: BoardFilter): boolean {
  return (
    activeFilterChips(filter).length > 0 ||
    (filter.text ?? '').trim().length > 0 ||
    filter.flashableOnly === true
  )
}

/** Add or remove one feature, so the chips toggle rather than only accumulate. */
export function toggleFeature(features: readonly string[], feature: string): string[] {
  return features.includes(feature)
    ? features.filter((f) => f !== feature)
    : [...features, feature]
}
