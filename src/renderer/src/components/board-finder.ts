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
 * THE MEMORY FILTER SHIPS AND THE STORAGE FILTER DOES NOT (#897). They were
 * held back together while the sizes were unsourced; they part company now that
 * they are not, and for different reasons than coverage.
 *
 * MEMORY: 226 of the 230 boards have a sourced RAM figure, up from 86, and
 * every one of them means the same thing — the chip's own SRAM. It is also
 * worth filtering on, which was not obvious: RAM is NOT a restatement of the
 * processor facet, because over a hundred of those boards sit in a family whose
 * members differ. `stm32f4` alone runs from the F401's 96 KB to the F469's
 * 384 KB, and `mimxrt` from 128 KB to 2 MB. So the control says something the
 * `Processor` dropdown cannot, about all but four boards. See {@link
 * MEMORY_CAVEAT} for the one thing it has to say out loud, and
 * `boardsWithoutRam` for what becomes of those four.
 *
 * STORAGE: no. Not for want of numbers any more — 187 of 230 have a flash
 * figure, up from 10 — but because they are not all the same quantity. 107 are
 * the flash INSIDE the microcontroller, on parts where that is where a program
 * goes; 80 are the flash chip on the module, on parts with none inside. Ranking
 * an STM32H743's 2 MB of internal flash against a Pico's 2 MB of QSPI compares a
 * program's ROM with a filesystem's disk. Narrow it to the one a filesystem can
 * actually use — module flash, or a second flash chip beside the MCU — and it
 * covers 100 of 230, which is thinner than the coverage that stopped this being
 * offered in the first place. And every one of the ten `ESP32_GENERIC*` entries
 * is missing from it, which are the most-flashed boards in the catalogue: their
 * size is a property of whichever module the buyer happens to have.
 *
 * So storage stays a fact. What would change that is not more scraping — it is
 * deciding, per port, which flash a MicroPython filesystem actually lands in,
 * which is knowledge the index does not carry.
 *
 * THE RUNTIME FILTER (#902) ships on the same terms: its data supports it and
 * the one thing it cannot say is sayable out loud. See {@link RUNTIME_CAVEAT}.
 */
import {
  defaultBuild,
  newestBuilds,
  type BoardBuild,
  type BoardFilter,
  type IndexedBoard
} from '../../../shared/board-index'
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

/**
 * Features that are a yes/no upstream publishes, paired with the field that
 * would give the figure.
 *
 * `External Flash` pairs with `externalFlash` and NOT with `flash` — the
 * distinction #897 turned on once boards started carrying both. An Adafruit
 * Feather M0 Express has 256 KB inside the SAMD21 and a 2 MB SPI flash chip
 * beside it; letting the first suppress the note about the second would say the
 * board has 256 KB of flash and nothing else, which is the misreading the whole
 * epic exists to stop.
 */
const SIZELESS_FEATURES: readonly { feature: string; label: string; sized: keyof IndexedBoard }[] =
  [
    { feature: 'External Flash', label: 'External flash', sized: 'externalFlash' },
    { feature: 'External RAM', label: 'External RAM', sized: 'psram' }
  ]

/** What upstream says when asked how big either of those is. */
export const NO_SIZE_PUBLISHED = 'present — size not published'

/**
 * A byte count as people say it: `264 KB`, `8 MB`, `1.5 MB`, `1056 KB`.
 *
 * Binary units, because that is what these parts are sold in — a "2 MB" flash
 * chip is 2 × 1024 × 1024 bytes.
 *
 * MB only where it lands on a whole or a half, and KB otherwise. Rounding to one
 * decimal instead would print an STM32H743's 1056 KB as "1.0 MB" — the same
 * string as a part with 1024 KB, and 32 KB adrift, which on a board with 1 MB of
 * RAM is a real amount of somebody's heap. Sizes like that are common enough in
 * this catalogue (1056, 1376, 2512, 4200 KB) that the awkward-looking number is
 * the accurate one.
 */
export function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  if (mb >= 1 && Number.isInteger(mb * 2)) {
    return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`
  }
  const kb = bytes / 1024
  return `${Number.isInteger(kb) ? kb : kb.toFixed(1)} KB`
}

/**
 * How a figure that is really the CHIP's is said out loud.
 *
 * "The ESP32 has 520 KB" is a fact about every ESP32 board and therefore not
 * much of a fact about this one — and for flash it is the difference between the
 * megabyte on an STM32F405's die and the eight megabytes of SPI flash sitting
 * next to it. The scope goes in the value rather than a tooltip so it is read at
 * the same moment as the number.
 */
const CHIP_SCOPE_NOTE: Record<'flash' | 'ram', string> = {
  flash: ' (the chip’s internal flash)',
  ram: ' (the chip’s SRAM)'
}

/**
 * The facts a board's detail states, in display order.
 *
 * Sizes come first-hand or not at all: each one carries the source that makes it
 * publishable.
 *
 * `External flash` / `External RAM` still appear as the booleans upstream
 * publishes, but only where no sourced size has replaced them — otherwise a
 * board would say "8 MB" and "size not published" in the same list.
 */
export function boardFacts(board: IndexedBoard): BoardFact[] {
  const facts: BoardFact[] = [{ label: 'MCU', value: board.mcu || 'unknown' }]
  if (board.port) facts.push({ label: 'Port', value: board.port })
  if (board.flashOffset) facts.push({ label: FLASH_OFFSET_LABEL, value: board.flashOffset })
  if (board.flash) {
    facts.push({
      label: 'Flash',
      value: `${formatBytes(board.flash.bytes)}${board.flash.scope === 'chip' ? CHIP_SCOPE_NOTE.flash : ''}`,
      source: board.flash.source
    })
  }
  if (board.externalFlash) {
    facts.push({
      label: 'External flash',
      value: formatBytes(board.externalFlash.bytes),
      source: board.externalFlash.source
    })
  }
  if (board.ram) {
    facts.push({
      label: 'RAM',
      value: `${formatBytes(board.ram.bytes)}${board.ram.scope === 'chip' ? CHIP_SCOPE_NOTE.ram : ''}`,
      source: board.ram.source
    })
  }
  if (board.psram) {
    // "External RAM" rather than "PSRAM": upstream's own word for the feature
    // this row replaces, and the right one for the boards whose external RAM is
    // SDRAM rather than SPI PSRAM.
    facts.push({
      label: 'External RAM',
      value: formatBytes(board.psram.bytes),
      source: board.psram.source
    })
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
): { axis: 'vendor' | 'mcu' | 'feature' | 'runtime' | 'memory'; value: string }[] {
  const out: { axis: 'vendor' | 'mcu' | 'feature' | 'runtime' | 'memory'; value: string }[] = []
  for (const v of filter.vendors ?? []) out.push({ axis: 'vendor', value: v })
  for (const m of filter.mcus ?? []) out.push({ axis: 'mcu', value: m })
  if (filter.minRam) out.push({ axis: 'memory', value: memoryThresholdLabel(filter.minRam) })
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

/**
 * Add or remove one value, so the chips toggle rather than only accumulate.
 *
 * One toggle for all three string facets — manufacturer, processor and feature
 * (#919). What differs between them is what a SET of ticked values means, and
 * that lives in `matchesFilter`, not here: OR for the single-valued facets,
 * AND for features.
 */
export function toggleChip(values: readonly string[], value: string): string[] {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value]
}

// ---------------------------------------------------------------------------
// The memory filter (#897)
// ---------------------------------------------------------------------------

/**
 * The steps the memory control offers, in bytes.
 *
 * Chosen where the catalogue actually divides rather than at round powers for
 * their own sake: 32 KB separates the SAMD21 class from everything else, 64 KB
 * is where the smaller nRF52 sits, 264 KB is an RP2040 and 520 KB an ESP32 or
 * an RP2350, so 256 KB and 512 KB are the two thresholds people are really
 * asking about. 1 MB picks out the i.MX RT and STM32H7 boards.
 */
export const MEMORY_THRESHOLDS = [
  32 * 1024,
  64 * 1024,
  128 * 1024,
  256 * 1024,
  512 * 1024,
  1024 * 1024
] as const

/** "≥ 256 KB", for the dropdown and for the removable chip. */
export function memoryThresholdLabel(bytes: number): string {
  return `≥ ${formatBytes(bytes)}`
}

/**
 * The one thing the memory filter cannot say, said on screen.
 *
 * Every figure it filters on is the CHIP's SRAM, so the control is silent about
 * the external PSRAM that is the whole point of several of these boards — an
 * ESP32 Feather V2 has 520 KB of SRAM and 2 MB of PSRAM, and this control sees
 * the first number. Saying so under the control is what makes it honest to
 * offer, exactly as {@link RUNTIME_CAVEAT} is for the runtime chips.
 */
export const MEMORY_CAVEAT =
  'This is the chip’s own SRAM. Boards with external PSRAM have far more than ' +
  'this figure shows — it is listed separately on the board.'

/** "3 boards have no published RAM figure and are not shown." */
export function unsizedNotice(count: number): string | null {
  if (count <= 0) return null
  return `${count} board${count === 1 ? '' : 's'} ${count === 1 ? 'has' : 'have'} no published RAM figure and ${count === 1 ? 'is' : 'are'} not shown.`
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

// ---------------------------------------------------------------------------
// The hover preview (#919)
// ---------------------------------------------------------------------------

/** The label {@link boardFacts} gives the address a board's firmware is written
 *  at — named once, because the preview drops that row by name. */
const FLASH_OFFSET_LABEL = 'Flash offset'

/** How many rows the preview states before it stops being a preview. */
export const PEEK_FACT_LIMIT = 4

/**
 * The facts the hover preview states, out of everything the details page does.
 *
 * The same list minus the flash offset, capped. The offset is an address, and
 * the only question it answers — where does this binary go — is one the flasher
 * answers for you; on a preview it is four hex digits in the way of the MCU and
 * the memory, which are what tell two boards apart at a glance. The cap is what
 * keeps the preview's height roughly known, which is what lets the gallery decide
 * to open it upward or downward without measuring it first.
 *
 * Provenance is deliberately dropped too — a source is for a figure you are about
 * to rely on, and this is a glance. The details page keeps every one of them.
 */
export function peekFacts(board: IndexedBoard): BoardFact[] {
  return boardFacts(board)
    .filter((f) => f.label !== FLASH_OFFSET_LABEL)
    .slice(0, PEEK_FACT_LIMIT)
    .map(({ label, value }) => ({ label, value }))
}

/**
 * The firmware line the hover preview prints, in one string.
 *
 * The preview exists to answer "is this the board I want?" without a click, and
 * the first thing that disqualifies a board is having nothing to flash — so it
 * is said here rather than left to the details page. Variants are COUNTED rather
 * than listed: that a board has a choice to make is the useful signal at a
 * glance, and which one to make is exactly the judgement the details page (and
 * upstream's own descriptions) exist for.
 */
export function firmwareSummary(board: IndexedBoard): string {
  const chosen = defaultBuild(board)
  if (!chosen) return 'No published firmware'
  const variants = newestBuilds(board).length
  const version = `MicroPython ${chosen.version}`
  return variants > 1 ? `${version} · ${variants} builds` : version
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
