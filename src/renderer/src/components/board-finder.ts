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
 * WHY THERE IS STILL NO STORAGE OR MEMORY FILTER (#897). There are sourced sizes
 * now, and they are stated on the board — but 5 of 225 boards have a flash
 * figure and 81 have a RAM one, and 81 of those are the CHIP's SRAM rather than
 * the module's. A "≥ 4 MB" control at that coverage is not a filter, it is a way
 * of hiding 220 boards for being undocumented. It becomes one when the coverage
 * does; until then the sizes are facts, each naming its source, and the missing
 * ones say they are missing instead of quietly vanishing from a filtered list.
 *
 * THE RUNTIME FILTER (#902) does ship, because its data supports it and the one
 * thing it cannot say is sayable out loud. See {@link RUNTIME_CAVEAT}.
 */
import type { BoardBuild, BoardFilter, IndexedBoard } from '../../../shared/board-index'
import type { FirmwareRuntime } from '../../../shared/firmware-runtime'

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
  /**
   * Where the value came from, when it came from anywhere (#897).
   *
   * Shown beside the figure rather than hidden in a tooltip: the reason these
   * numbers can be published at all is that each one can be checked, and a
   * provenance nobody can see is the same as none.
   */
  source?: string
}

/** Features that are a yes/no upstream publishes but no figure to go with it. */
const SIZELESS_FEATURES: readonly { feature: string; label: string; sized: keyof IndexedBoard }[] =
  [
    { feature: 'External Flash', label: 'External flash', sized: 'flash' },
    { feature: 'External RAM', label: 'External RAM', sized: 'psram' }
  ]

/** What upstream says when asked how big either of those is. */
export const NO_SIZE_PUBLISHED = 'present — size not published'

/**
 * A byte count as people say it: `264 KB`, `8 MB`, `1.5 MB`.
 *
 * Binary units, because that is what these parts are sold in — a "2 MB" flash
 * chip is 2 × 1024 × 1024 bytes — and no trailing `.0`, so the common sizes read
 * as round numbers rather than as measurements.
 */
export function formatBytes(bytes: number): string {
  const [unit, size] = bytes >= 1024 * 1024 ? ['MB', 1024 * 1024] : ['KB', 1024]
  const n = bytes / size
  return `${Number.isInteger(n) ? n : n.toFixed(1)} ${unit}`
}

/**
 * The facts a board's detail states, in display order.
 *
 * Sizes come first-hand or not at all: each one carries the source that makes it
 * publishable, and a RAM figure that is really the CHIP's says so, because "the
 * ESP32 has 520 KB" is a fact about every ESP32 board and therefore not much of
 * a fact about this one.
 *
 * `External flash` / `External RAM` still appear as the booleans upstream
 * publishes, but only where no sourced size has replaced them — otherwise a
 * board would say "8 MB" and "size not published" in the same list.
 */
export function boardFacts(board: IndexedBoard): BoardFact[] {
  const facts: BoardFact[] = [{ label: 'MCU', value: board.mcu || 'unknown' }]
  if (board.port) facts.push({ label: 'Port', value: board.port })
  if (board.flashOffset) facts.push({ label: 'Flash offset', value: board.flashOffset })
  if (board.flash) {
    facts.push({ label: 'Flash', value: formatBytes(board.flash.bytes), source: board.flash.source })
  }
  if (board.ram) {
    facts.push({
      label: 'RAM',
      value: `${formatBytes(board.ram.bytes)}${board.ram.scope === 'chip' ? ' (the chip’s SRAM)' : ''}`,
      source: board.ram.source
    })
  }
  if (board.psram) {
    facts.push({ label: 'PSRAM', value: formatBytes(board.psram.bytes), source: board.psram.source })
  }
  for (const { feature, label, sized } of SIZELESS_FEATURES) {
    if (board.features.includes(feature) && !board[sized]) {
      facts.push({ label, value: NO_SIZE_PUBLISHED })
    }
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
): { axis: 'vendor' | 'mcu' | 'feature' | 'runtime'; value: string }[] {
  const out: { axis: 'vendor' | 'mcu' | 'feature' | 'runtime'; value: string }[] = []
  if (filter.vendor) out.push({ axis: 'vendor', value: filter.vendor })
  if (filter.mcu) out.push({ axis: 'mcu', value: filter.mcu })
  for (const f of filter.features ?? []) out.push({ axis: 'feature', value: f })
  for (const r of filter.runtimes ?? []) out.push({ axis: 'runtime', value: r })
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

/** Same toggle, typed for the runtime chips. */
export function toggleRuntime(
  runtimes: readonly FirmwareRuntime[],
  runtime: FirmwareRuntime
): FirmwareRuntime[] {
  return runtimes.includes(runtime)
    ? runtimes.filter((r) => r !== runtime)
    : [...runtimes, runtime]
}

/**
 * The one thing the runtime filter cannot say, said on screen (#902).
 *
 * The gallery is MicroPython's catalogue — that is where every entry comes from
 * — so it is structurally incapable of listing a board that runs CircuitPython
 * and not MicroPython, and there are hundreds of those. On top of that, the two
 * projects name boards independently, so a board's CircuitPython build is only
 * claimed where the id was confirmed; the rest are unknown rather than absent.
 *
 * Both limits are real, and both make a bare "CircuitPython" chip a small lie.
 * Printing them under the chips is what makes the chips honest — and is the
 * whole reason the filter could be shipped where the storage one could not.
 */
export const RUNTIME_CAVEAT =
  'This is MicroPython’s catalogue, so CircuitPython-only boards are not in it. ' +
  'CircuitPython is marked only where the board id was confirmed — the rest are ' +
  'unconfirmed, not unsupported.'
