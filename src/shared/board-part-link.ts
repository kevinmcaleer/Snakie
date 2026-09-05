/**
 * WHICH PART IS THIS BOARD (#934).
 * =============================================================================
 *
 * The Board Finder knows 225 boards as MicroPython describes them: a vendor, a
 * product name, a chip, and a list of firmware to flash. The parts library knows
 * 22 boards as HARDWARE: a photograph, a back, sometimes a model, and every pad
 * with its GPIO, its bus and its signal. Neither knows what the other holds, so
 * a Pico's details page could tell you which `.uf2` to write and not one thing
 * about where GP4 is.
 *
 * This is the join, and it is a HAND-WRITTEN TABLE on purpose.
 *
 * WHY NOT MATCH ON THE NAME. It was tried first, and it is not close. Fuzzy
 * matching over vendor+product silently paired `Pimoroni Pico LiPo 2` — an
 * RP2350 board — with upstream's `Pimoroni / Pico LiPo`, which is RP2040. Same
 * maker, same product line, one word apart, different chip and a different
 * pinout. A finder that answers "where is GP4" with another board's pad map is
 * worse than one that says nothing, because the wrong answer still looks like an
 * answer, and the person reading it has a soldering iron in their hand. Every
 * entry below therefore names both ids outright.
 *
 * THE BAR FOR AN ENTRY. The part and the board are the SAME piece of hardware —
 * not the same family, not a close relative, not "near enough for the pinout".
 * `chipsAgree` in the tests holds every pairing to its chip, which is what
 * caught the Pico LiPo. Anything short of certain is left out: 11 of the 22
 * microcontroller parts are linked here, and the other 11 show nothing rather
 * than something plausible.
 *
 * Pure and DOM-free, so the whole table is checked in node.
 */

/** One board, and the part that IS that board. */
export interface BoardPartLink {
  /** The board index id — upstream's, or an overlay's (`board-overlay.ts`). */
  boardId: string
  /** The library holding the part. Bundled Standard parts, for every entry so far. */
  libraryId: string
  /** The part id within that library. */
  partId: string
  /** What makes this the same board, in one line. */
  why: string
}

/** The Standard library, which is where every linked part lives today. */
const STD = 'snakie-standard'

/**
 * The curated set.
 *
 * Ordered by vendor, then by product, so an addition lands somewhere obvious
 * rather than at the end.
 */
export const BOARD_PART_LINKS: readonly BoardPartLink[] = [
  {
    boardId: 'ADAFRUIT_FEATHER_ESP32_V2',
    libraryId: STD,
    partId: 'adafruit-feather-esp32-v2',
    why: 'The overlay board from #902 and the part are the same Feather V2 — the board upstream builds nothing for.'
  },
  {
    boardId: 'ADAFRUIT_FEATHER_ESP32S3',
    libraryId: STD,
    partId: 'adafruit-feather-esp32s3',
    why: 'Adafruit product 5323 on both sides — the 8 MB / no-PSRAM Feather, not the 4 MB / 2 MB one.'
  },
  {
    boardId: 'ADAFRUIT_FEATHER_RP2040',
    libraryId: STD,
    partId: 'adafruit-feather-rp2040',
    why: 'Adafruit product 4884; RP2040 on both sides.'
  },
  {
    boardId: 'FEATHER52',
    libraryId: STD,
    partId: 'adafruit-feather-nrf52840',
    why: 'Upstream files the Feather nRF52840 Express under the older id `FEATHER52`; one board, two names.'
  },
  {
    boardId: 'ADAFRUIT_ITSYBITSY_RP2040',
    libraryId: STD,
    partId: 'adafruit-itsybitsy-rp2040',
    why: 'Adafruit product 4888; RP2040 on both sides.'
  },
  {
    boardId: 'ADAFRUIT_QTPY_RP2040',
    libraryId: STD,
    partId: 'adafruit-qt-py-rp2040',
    why: 'Adafruit product 4900; RP2040 on both sides. The part carries a back photo.'
  },
  {
    boardId: 'ARDUINO_NANO_ESP32',
    libraryId: STD,
    partId: 'arduino-nano-esp32',
    why: 'Arduino ABX00083; ESP32-S3 on both sides. The part carries a back photo.'
  },
  {
    boardId: 'CYTRON_MAKER_PI_RP2040',
    libraryId: STD,
    partId: 'cytron-maker-pi-rp2040',
    why: 'Cytron MAKER-PI-RP2040 on both sides. The part carries a 3-D model.'
  },
  {
    boardId: 'PIMORONI_MOTOR2040',
    libraryId: STD,
    partId: 'motor2040',
    why: 'Pimoroni PIM618; RP2040 on both sides.'
  },
  {
    boardId: 'PIMORONI_PICOLIPO2',
    libraryId: STD,
    partId: 'pimoroni-pico-lipo-2',
    why: 'Pimoroni PIM775; RP2350B on both sides. NOT upstream’s `PIMORONI_PICOLIPO`, which is the RP2040 original.'
  },
  {
    boardId: 'PIMORONI_PICOLIPO2_XL_W',
    libraryId: STD,
    partId: 'pimoroni-pico-lipo-2-xl-w',
    why: 'Pimoroni PIM776; RP2350B with the RM2 radio on both sides — a different board from the plain Pico LiPo 2.'
  },
  {
    boardId: 'PIMORONI_SERVO2040',
    libraryId: STD,
    partId: 'servo2040',
    why: 'Pimoroni PIM613; RP2040 on both sides.'
  },
  {
    boardId: 'PIMORONI_TINY2350',
    libraryId: STD,
    partId: 'tiny2350',
    why: 'Pimoroni PIM721; RP2350A on both sides. NOT upstream’s `PIMORONI_TINY2040`, which is the RP2040 board.'
  },
  {
    boardId: 'RPI_PICO',
    libraryId: STD,
    partId: 'pico',
    why: 'SC0915; RP2040 on both sides.'
  },
  {
    boardId: 'RPI_PICO_W',
    libraryId: STD,
    partId: 'pico-w',
    why: 'SC0918; RP2040 with the CYW43439 on both sides. A DIFFERENT part from the plain Pico, which is why each is linked separately.'
  },
  {
    boardId: 'RPI_PICO2_W',
    libraryId: STD,
    partId: 'pico2w',
    why: 'RP2350 on both sides. Deliberately not linked to `RPI_PICO2`, which is the non-wireless board and a different part.'
  },
  {
    boardId: 'SEEED_XIAO_RP2040',
    libraryId: STD,
    partId: 'seeed-xiao-rp2040',
    why: 'Seeed 102010428; RP2040 on both sides.'
  },
  {
    boardId: 'SEEED_XIAO_RP2350',
    libraryId: STD,
    partId: 'seeed-xiao-rp2350',
    why: 'RP2350 on both sides.'
  }
]

/**
 * The part that IS this board, or null.
 *
 * Null is the ordinary answer — most of the 225 boards have no part — and means
 * "show the board on its own", never "something went wrong".
 */
export function partLinkForBoard(boardId: string): BoardPartLink | null {
  if (!boardId) return null
  return BOARD_PART_LINKS.find((l) => l.boardId === boardId) ?? null
}

/**
 * The part a link points at, from the libraries currently installed.
 *
 * Separate from {@link partLinkForBoard} because the two can disagree: the table
 * is compiled in, the libraries are whatever this machine actually has. A user
 * who deleted the Standard library, or a web build serving only what was bundled,
 * gets null here for a board the table happily links — and the caller shows the
 * board on its own, which is the same thing it does for the 214 boards that were
 * never linked at all.
 */
export function findLinkedPart<P extends { id: string }, L extends { id: string; parts: P[] }>(
  libraries: readonly L[],
  link: BoardPartLink | null
): P | null {
  if (!link) return null
  const lib = libraries.find((l) => l.id === link.libraryId)
  return lib?.parts.find((p) => p.id === link.partId) ?? null
}

/** The board a part stands for, or null. The reverse of {@link partLinkForBoard}. */
export function boardLinkForPart(libraryId: string, partId: string): BoardPartLink | null {
  if (!libraryId || !partId) return null
  return BOARD_PART_LINKS.find((l) => l.libraryId === libraryId && l.partId === partId) ?? null
}
