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
 * NO FLASH OR RAM SIZE. Upstream does not publish either — `features` has
 * `External Flash` and `External RAM` as booleans and nothing more. So they are
 * absent here, shown as facts where a profile happens to know them, and NOT
 * offered as filters: a filter that silently omits most of the catalogue is
 * worse than no filter.
 *
 * Pure — parsing, filtering and picking, no IO — so all of it unit-tests in node.
 */

/** The document shape this module understands. A newer one is refused. */
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
      builds: Array.isArray(b.builds)
        ? b.builds.map(parseBuild).filter((x): x is BoardBuild => x !== null)
        : []
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
  vendor?: string
  mcu?: string
  /** Every one of these must be present — filters narrow, they do not widen. */
  features?: string[]
  /** Hide boards with no published firmware. */
  flashableOnly?: boolean
}

/** Case- and separator-insensitive, so "esp32 s3" finds `esp32s3`. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[\s_-]+/g, '')
}

export function matchesFilter(board: IndexedBoard, filter: BoardFilter): boolean {
  if (filter.flashableOnly && board.builds.length === 0) return false
  if (filter.vendor && board.vendor !== filter.vendor) return false
  if (filter.mcu && board.mcu !== filter.mcu) return false
  for (const f of filter.features ?? []) {
    if (!board.features.includes(f)) return false
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

/** Distinct vendors present, sorted — the vendor filter's options. */
export function vendorsOf(boards: readonly IndexedBoard[]): string[] {
  return [...new Set(boards.map((b) => b.vendor).filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

/** Distinct chip families present, sorted. */
export function mcusOf(boards: readonly IndexedBoard[]): string[] {
  return [...new Set(boards.map((b) => b.mcu).filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

/**
 * Feature chips, commonest first.
 *
 * Ordered by how many boards have them so the useful filters — WiFi, BLE — lead,
 * rather than an alphabetical list headed by `Audio Codec`.
 */
export function featuresOf(boards: readonly IndexedBoard[]): string[] {
  const count = new Map<string, number>()
  for (const b of boards) for (const f of b.features) count.set(f, (count.get(f) ?? 0) + 1)
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([f]) => f)
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
