/**
 * THE BOARD INDEX (#893, epic #884) — every board MicroPython builds for.
 * =============================================================================
 *
 * Snakie's firmware picker has always shown Thonny's catalogue, which carries
 * no Adafruit boards at all and no ESP32 variants. That is how an Adafruit ESP32
 * Feather V2 owner opened the model list, did not find their board, picked
 * "ESP32 / WROOM" as the nearest thing, and flashed a build without SPIRAM — on
 * a board whose 2 MB of PSRAM only the SPIRAM build initialises. It cost a week
 * of `ENOMEM`, mDNS allocation failures and an eventual ESP-IDF `abort()`.
 *
 * Upstream publishes all of it, per board, in `board.json`. This module is the
 * shape that document takes once `scripts/build-board-index.mjs` has gathered it
 * — 225 boards, 54 vendors, with each board's variants named and described.
 *
 * DETACHED FROM THE BUILD. The index is fetched at runtime, not compiled in: a
 * board added upstream on Tuesday should be in the picker on Wednesday, on the
 * copy of Snakie people already have, rather than waiting for the next release.
 * Three layers, and they must stay distinct:
 *
 *   1. the BUNDLED seed — shipped in the app, so a fresh install and the offline
 *      classroom build (#267) work with no network;
 *   2. the FETCHED document — refreshed in the background, cached, newest wins,
 *      and a failure silently keeps the last good copy;
 *   3. Snakie's own `board-profiles.ts` — which stays IN the app, because it
 *      holds judgement upstream does not publish, and because it is the only
 *      thing that knows about boards upstream does not name at all. There is no
 *      Feather V2 in these 225. Fold the overlay into the fetched document and
 *      that board disappears again.
 *
 * FLASH AND RAM (#897). Upstream publishes neither — `features` has `External
 * Flash` and `External RAM` as booleans and nothing more. So every figure here
 * comes from somewhere else, and every figure therefore carries a {@link
 * BoardSize.source} naming it. A number with no provenance is not worth
 * publishing: a wrong flash size sends someone to a board that cannot hold their
 * program. Whether they are offered as FILTERS is a separate question, decided
 * on coverage — see `board-finder.ts`.
 *
 * Pure — parsing, filtering and picking, no IO — so all of it unit-tests in node.
 */
import type { FirmwareRuntime } from './firmware-runtime'

/**
 * The document shape this module understands. A newer one is refused.
 *
 * Deliberately NOT bumped by #897/#902, which only ADD optional fields: an older
 * Snakie reading a newer document ignores what it does not know and still gets a
 * complete picker, whereas a bump would make it refuse the document outright and
 * fall back to a seed that ages with the install.
 */
export const BOARD_INDEX_SCHEMA = 1

/** Where the published index lives, once the repo carrying it exists. */
export const BOARD_INDEX_URL =
  'https://raw.githubusercontent.com/kevinmcaleer/snakie-parts/main/boards.json'

/** One flashable firmware build. */
export interface BoardBuild {
  /** The build name, e.g. `ESP32_GENERIC-SPIRAM`. */
  build: string
  /** The variant suffix, or null for the board's plain build. */
  variant: string | null
  /** MicroPython version, e.g. `1.29.0`. */
  version: string
  /** Build date, `YYYYMMDD` — what actually orders these. */
  date: string
  /** Absolute URL of the binary. */
  url: string
}

/**
 * A memory or storage size, with the provenance that makes it publishable (#897).
 *
 * `source` is never optional and never empty. Upstream publishes no sizes at
 * all, so every one of these was put here by somebody — and the reader has to be
 * able to see by whom before trusting it enough to buy a board on.
 */
export interface BoardSize {
  bytes: number
  /** Where the figure came from: a URL, a datasheet, or who curated it. */
  source: string
  /**
   * Whose figure this is.
   *
   * `chip` means it is the MCU's own — true of every part in that family and
   * derived from `mcu` alone. That is exactly right for built-in SRAM and
   * exactly wrong for flash, which lives on the module: every RP2040 has 264 KB
   * of SRAM, and RP2040 boards ship with anywhere from 2 MB to 16 MB of flash.
   * `board` means the figure is about this board specifically.
   */
  scope: 'board' | 'chip'
}

/**
 * Where an entry came from (#902).
 *
 * `micropython` — upstream's own `board.json`, which is all 225 of them.
 * `snakie` — Snakie's overlay in `board-overlay.ts`, for boards MicroPython
 * builds no firmware under the name of at all. Set by the overlay, never by the
 * document: the whole point of the overlay is that it stays in the app.
 */
export type BoardOrigin = 'micropython' | 'snakie'

/**
 * What an overlay board flashes, given upstream has no build of its own (#902).
 *
 * The Feather V2's answer is `ESP32_GENERIC-SPIRAM` — a build for a board that
 * is not this one, and the correct thing to flash. That has to be said out loud
 * on the card rather than quietly substituted, because "this is another board's
 * firmware" is the kind of thing someone needs to know before they wonder why
 * their board reports itself as a generic ESP32.
 */
export interface BoardSubstitute {
  /** The upstream board whose build this one borrows, or null when none fits. */
  boardId: string | null
  /** The exact upstream build, e.g. `ESP32_GENERIC-SPIRAM`. */
  build: string | null
  /** Why that is the right build, in the reader's terms. Shown on the card. */
  why: string
}

/** One board. */
export interface IndexedBoard {
  /** Upstream's board id, e.g. `ESP32_GENERIC`. */
  id: string
  /** The MicroPython port, e.g. `esp32`. */
  port: string
  vendor: string
  product: string
  /** Chip family, e.g. `esp32s3`, `rp2040`. */
  mcu: string
  /** Filterable attributes, as upstream classifies them. */
  features: string[]
  /** Attributes upstream marks as NOT worth filtering on. */
  notes: string[]
  /** The vendor's own product page. */
  url: string | null
  /** Variant id → upstream's description, e.g. `SPIRAM` → "Support for SPIRAM / WROVER". */
  variants: Record<string, string>
  /** Where this board's firmware is written, e.g. `0x1000`. */
  flashOffset: string | null
  /** The full-size photo on micropython.org. */
  image: string | null
  /** Bundled thumbnail filename, or null where none could be made. */
  thumb: string | null
  builds: BoardBuild[]
  /**
   * The flash a program is written into (#897).
   *
   * `chip` scope where the microcontroller has its own — an STM32F405's 1 MB is
   * on the die and true of every board carrying one. `board` scope on the parts
   * with NO internal flash at all, where it is entirely a property of the
   * module: RP2040, RP2350, ESP32 and i.MX RT.
   */
  flash: BoardSize | null
  /**
   * A SEPARATE flash chip the board adds, when its size is sourced (#897).
   *
   * Distinct from {@link flash} because on half the catalogue they are both real
   * and different: the Feather M0 Express has 256 KB inside the SAMD21 and 2 MB
   * of SPI flash beside it, and answering "how much flash?" with either number
   * alone is answering a different question from the one that was asked. Null on
   * boards with no second chip AND on boards that have one whose size nobody
   * publishes — `features` still carries `External Flash` for the latter, and the
   * card says the size is unknown rather than implying there is none.
   */
  externalFlash: BoardSize | null
  /** Built-in SRAM (#897). Usually `chip` scope — it follows from `mcu`. */
  ram: BoardSize | null
  /**
   * External RAM — SPI PSRAM on the ESP32 and RP2350 boards, SDRAM on the bigger
   * i.MX RT and STM32H7 ones. One field, because it answers one question.
   */
  psram: BoardSize | null
  /**
   * The runtimes with a published, flashable build for THIS board (#902).
   *
   * `micropython` iff `builds` is non-empty — three of the 225 are in upstream's
   * tree with nothing published. `circuitpython` only where a CircuitPython
   * board id was CONFIRMED against the published catalogue; its absence means
   * "not confirmed", which is not the same as "does not exist", and the gallery
   * says so rather than letting a filter imply otherwise.
   */
  runtimes: FirmwareRuntime[]
  /**
   * CircuitPython's own per-board key — the string `boot_out.txt` prints and the
   * one its downloads are filed under (#756). Null when no build was confirmed.
   *
   * Never guessed. Flashing another board's `.uf2` leaves a board that needs
   * re-flashing before it will talk again, so a wrong id here is worse than none.
   */
  circuitPythonBoardId: string | null
  /** Upstream's catalogue, or Snakie's overlay (#902). */
  origin: BoardOrigin
  /** For an overlay board: whose firmware it flashes, and why. Null otherwise. */
  substitute: BoardSubstitute | null
}

export interface BoardIndex {
  schema: number
  /** The MicroPython release this was gathered from, e.g. `v1.29.0`. */
  micropython: string
  /** `YYYY-MM-DD`. */
  generated: string
  boards: IndexedBoard[]
}

/** An empty index — what every failure path resolves to. */
export const EMPTY_INDEX: BoardIndex = {
  schema: BOARD_INDEX_SCHEMA,
  micropython: '',
  generated: '',
  boards: []
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []

/**
 * A size, or null.
 *
 * A figure with no `source`, or a non-positive one, is DROPPED rather than shown
 * unattributed — the rule #897 asks for, enforced at the door so no later layer
 * has to remember it.
 */
function parseSize(raw: unknown): BoardSize | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const bytes = typeof r.bytes === 'number' && r.bytes > 0 ? r.bytes : 0
  const source = str(r.source).trim()
  if (!bytes || !source) return null
  return { bytes, source, scope: r.scope === 'chip' ? 'chip' : 'board' }
}

function parseBuild(raw: unknown): BoardBuild | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const url = str(r.url)
  // A build with no URL cannot be flashed, so it is not a build.
  if (!url) return null
  return {
    build: str(r.build),
    variant: strOrNull(r.variant),
    version: str(r.version),
    date: str(r.date),
    url
  }
}

/**
 * Parse a fetched or bundled document.
 *
 * Returns null rather than throwing, and null for a schema this build does not
 * understand — the caller then keeps the copy it already had. Degrading to an
 * EMPTY picker because a newer document arrived would be worse than being a
 * release behind.
 */
export function parseBoardIndex(raw: unknown): BoardIndex | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.schema !== 'number' || r.schema > BOARD_INDEX_SCHEMA) return null
  if (!Array.isArray(r.boards)) return null
  const boards: IndexedBoard[] = []
  for (const entry of r.boards) {
    if (!entry || typeof entry !== 'object') continue
    const b = entry as Record<string, unknown>
    const id = str(b.id)
    if (!id) continue
    const builds = Array.isArray(b.builds)
      ? b.builds.map(parseBuild).filter((x): x is BoardBuild => x !== null)
      : []
    const circuitPythonBoardId = strOrNull(b.circuitPythonBoardId)
    boards.push({
      id,
      port: str(b.port),
      vendor: str(b.vendor),
      product: str(b.product) || id,
      mcu: str(b.mcu),
      features: strList(b.features),
      notes: strList(b.notes),
      url: strOrNull(b.url),
      variants:
        b.variants && typeof b.variants === 'object'
          ? Object.fromEntries(
              Object.entries(b.variants as Record<string, unknown>).map(([k, v]) => [k, str(v)])
            )
          : {},
      flashOffset: strOrNull(b.flashOffset),
      image: strOrNull(b.image),
      thumb: strOrNull(b.thumb),
      builds,
      flash: parseSize(b.flash),
      externalFlash: parseSize(b.externalFlash),
      ram: parseSize(b.ram),
      psram: parseSize(b.psram),
      // DERIVED, not read, when the document does not say — which is what a
      // schema-1 document written before #902 looks like. It is a definition
      // rather than a guess: this is MicroPython's index, so a board with a
      // published build here runs MicroPython by construction.
      runtimes: Array.isArray(b.runtimes)
        ? (strList(b.runtimes).filter(
            (r) => r === 'micropython' || r === 'circuitpython'
          ) as FirmwareRuntime[])
        : builds.length > 0
          ? ['micropython']
          : [],
      circuitPythonBoardId,
      // The document never carries these; the overlay is the only producer.
      origin: 'micropython',
      substitute: null
    })
  }
  return {
    schema: r.schema,
    micropython: str(r.micropython),
    generated: str(r.generated),
    boards
  }
}

/** Which of two documents to keep. Later `generated` wins; ties keep `a`. */
export function newerIndex(a: BoardIndex | null, b: BoardIndex | null): BoardIndex | null {
  if (!a) return b
  if (!b) return a
  return b.generated > a.generated ? b : a
}

// ---------------------------------------------------------------------------
// The gallery's filters
// ---------------------------------------------------------------------------

export interface BoardFilter {
  /** Free text over vendor, product, id and mcu. */
  text?: string
  /**
   * Makers to keep — ANY of them, not all (#919).
   *
   * This is the opposite of {@link features}, and deliberately so. A board has
   * exactly ONE vendor, so intersecting two of them is empty by construction: an
   * "Adafruit AND Pimoroni" chip pair could only ever return nothing, which is
   * not a filter but a trap. A board's features are a SET, so "WiFi and BLE" is
   * a question with answers. Same rule for {@link mcus}.
   *
   * So: OR within a facet whose value is single, AND across facets — ticking
   * Adafruit and Pimoroni shows both makers, and adding WiFi then narrows that.
   */
  vendors?: string[]
  /** Chip families to keep — ANY of them, for the same reason as {@link vendors}. */
  mcus?: string[]
  /** Every one of these must be present — filters narrow, they do not widen. */
  features?: string[]
  /**
   * Keep only boards with a confirmed build for every runtime listed (#902).
   *
   * Narrowing, like `features`: both ticked means "runs both", which is the
   * question someone switching a class from one to the other actually has.
   */
  runtimes?: FirmwareRuntime[]
  /**
   * Keep only boards with at least this much on-chip RAM, in bytes (#897).
   *
   * A board with NO published RAM figure does not match — there is no honest
   * way to include it — so the gallery counts those separately and says how
   * many it dropped for want of a figure. See {@link boardsWithoutRam}.
   *
   * There is deliberately no `minFlash` beside this. See `board-finder.ts`.
   */
  minRam?: number
  /** Hide boards with no published firmware. */
  flashableOnly?: boolean
}

/** Case- and separator-insensitive, so "esp32 s3" finds `esp32s3`. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[\s_-]+/g, '')
}

export function matchesFilter(board: IndexedBoard, filter: BoardFilter): boolean {
  if (filter.flashableOnly && board.builds.length === 0) return false
  // Empty means "no opinion", not "match nothing" — a facet with nothing ticked
  // must not hide the catalogue.
  if (filter.vendors?.length && !filter.vendors.includes(board.vendor)) return false
  if (filter.mcus?.length && !filter.mcus.includes(board.mcu)) return false
  // A size threshold is a different shape from a facet: one comparable number,
  // not a set of values, so it narrows on its own terms (#897).
  if (filter.minRam && (board.ram === null || board.ram.bytes < filter.minRam)) return false
  for (const f of filter.features ?? []) {
    if (!board.features.includes(f)) return false
  }
  for (const r of filter.runtimes ?? []) {
    if (!board.runtimes.includes(r)) return false
  }
  const text = filter.text?.trim()
  if (text) {
    const hay = norm(`${board.vendor} ${board.product} ${board.id} ${board.mcu}`)
    // Every word must appear, so "adafruit feather" narrows rather than widening.
    for (const word of text.split(/\s+/)) {
      if (!hay.includes(norm(word))) return false
    }
  }
  return true
}

export function filterBoards(boards: readonly IndexedBoard[], filter: BoardFilter): IndexedBoard[] {
  return boards.filter((b) => matchesFilter(b, filter))
}

/**
 * Boards with no published RAM figure, among those the OTHER filters keep.
 *
 * The whole design of #897 is that a missing figure is stated rather than
 * hidden, and a size filter is the one place that promise is easy to break: a
 * board with no number silently drops out of the list and nobody is told. This
 * is what the gallery prints instead — "4 boards have no published RAM figure
 * and are not shown" — so the gap stays visible at the moment it bites.
 *
 * `minRam` is ignored when counting, on purpose: the answer must not depend on
 * where the threshold happens to sit.
 */
export function boardsWithoutRam(
  boards: readonly IndexedBoard[],
  filter: BoardFilter
): IndexedBoard[] {
  const rest = { ...filter, minRam: undefined }
  return boards.filter((b) => b.ram === null && matchesFilter(b, rest))
}

/** One choice on a chip facet: the value, and how many boards carry it. */
export interface FacetOption {
  value: string
  count: number
}

/**
 * Distinct values, COMMONEST FIRST, ties alphabetical.
 *
 * One order for every chip facet, because every one of them is now shown a few
 * at a time with the rest behind a disclosure (#919) — and a collapsed head that
 * is the first ten alphabetically is a list of curiosities, where a collapsed
 * head that is the ten commonest is most people's board. It is the same argument
 * that already ordered the feature chips: alphabetical would lead with `Audio
 * Codec` and bury WiFi.
 *
 * The count travels with the value because it is what makes that order legible:
 * without "43" beside ST Microelectronics, leading the list is arbitrary.
 */
function rankOptions(values: Iterable<string>): FacetOption[] {
  const count = new Map<string, number>()
  for (const v of values) if (v) count.set(v, (count.get(v) ?? 0) + 1)
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value, n]) => ({ value, count: n }))
}

/** The manufacturer chips — 54 of them, so most are behind "show more". */
export function vendorOptions(boards: readonly IndexedBoard[]): FacetOption[] {
  return rankOptions(boards.map((b) => b.vendor))
}

/** The processor chips. 41 chip families, and the top ten are two thirds of them. */
export function mcuOptions(boards: readonly IndexedBoard[]): FacetOption[] {
  return rankOptions(boards.map((b) => b.mcu))
}

/** The feature chips. */
export function featureOptions(boards: readonly IndexedBoard[]): FacetOption[] {
  return rankOptions(boards.flatMap((b) => b.features))
}

/**
 * How many boards each runtime has a confirmed build for.
 *
 * The count is the whole reason the runtime facet can be offered honestly: it is
 * printed beside the chip, so "CircuitPython 49" says plainly that this is 49
 * confirmed boards out of the catalogue rather than a complete answer. See
 * `board-finder.ts` for what the gallery does with it.
 */
export function runtimeCounts(
  boards: readonly IndexedBoard[]
): Record<FirmwareRuntime, number> {
  const counts: Record<FirmwareRuntime, number> = { micropython: 0, circuitpython: 0 }
  for (const b of boards) for (const r of b.runtimes) counts[r] += 1
  return counts
}

// ---------------------------------------------------------------------------
// Choosing a build
// ---------------------------------------------------------------------------

/**
 * The build to offer for a board by default: the newest version, and within it
 * the PLAIN build rather than a variant.
 *
 * Plain is the right default even for a board whose variant is usually wanted —
 * the SPIRAM decision belongs to `board-profiles.ts`, which knows the board is a
 * Feather V2 and says why. Guessing a variant from the index alone would be
 * guessing at hardware it cannot see.
 */
export function defaultBuild(board: IndexedBoard): BoardBuild | null {
  if (board.builds.length === 0) return null
  const newest = board.builds.reduce((a, b) => (b.date > a.date ? b : a))
  const plain = board.builds.find((b) => b.date === newest.date && b.variant === null)
  return plain ?? newest
}

/** Every build of the newest version, plain first then variants by name. */
export function newestBuilds(board: IndexedBoard): BoardBuild[] {
  if (board.builds.length === 0) return []
  const newest = board.builds.reduce((a, b) => (b.date > a.date ? b : a))
  return board.builds
    .filter((b) => b.date === newest.date)
    .sort((a, b) => {
      if (a.variant === null) return -1
      if (b.variant === null) return 1
      return a.variant.localeCompare(b.variant)
    })
}
