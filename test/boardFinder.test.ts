import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  MEMORY_CAVEAT,
  MEMORY_THRESHOLDS,
  NO_SIZE_PUBLISHED,
  PLAIN_BUILD_LABEL,
  UNKNOWN_VENDOR,
  activeFilterChips,
  boardFacts,
  boardInitials,
  buildLabel,
  firmwareSummary,
  isFiltering,
  memoryThresholdLabel,
  peekFacts,
  shelvesByVendor,
  toggleChip,
  unsizedNotice,
  variantList
} from '../src/renderer/src/components/board-finder'
import {
  FLASH_BOARD_EVENT,
  flashRequestFor,
  requestFlash
} from '../src/renderer/src/components/board-finder-bus'
import {
  boardsWithoutRam,
  filterBoards,
  type BoardBuild,
  type BoardSize,
  type IndexedBoard
} from '../src/shared/board-index'

/**
 * The Board Finder gallery's own decisions (#893) — shelving, the photo-less
 * placeholder, which of upstream's fields are stated as facts, and the request
 * that reaches the firmware flasher.
 *
 * `shared/board-index.ts` owns parsing/filtering/picking; this covers only what
 * the gallery adds on top, which is why it can stay DOM-free and run in node.
 */

const build = (over: Partial<BoardBuild> = {}): BoardBuild => ({
  build: 'RPI_PICO',
  variant: null,
  version: '1.29.0',
  date: '20260824',
  url: 'https://micropython.org/resources/firmware/RPI_PICO-20260824-v1.29.0.uf2',
  ...over
})

const board = (over: Partial<IndexedBoard> = {}): IndexedBoard => ({
  id: 'RPI_PICO',
  port: 'rp2',
  vendor: 'Raspberry Pi',
  product: 'Pico',
  mcu: 'rp2040',
  features: [],
  notes: [],
  url: null,
  variants: {},
  flashOffset: null,
  image: null,
  thumb: null,
  builds: [build()],
  flash: null,
  externalFlash: null,
  ram: null,
  psram: null,
  runtimes: ['micropython'],
  circuitPythonBoardId: null,
  origin: 'micropython',
  substitute: null,
  ...over
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('shelvesByVendor', () => {
  it('groups by vendor, alphabetically, products sorted within a shelf', () => {
    const shelves = shelvesByVendor([
      board({ id: 'B', vendor: 'Pimoroni', product: 'Tiny 2040' }),
      board({ id: 'A', vendor: 'Adafruit', product: 'QT Py' }),
      board({ id: 'C', vendor: 'Pimoroni', product: 'Badger 2040' })
    ])
    expect(shelves.map((s) => s.vendor)).toEqual(['Adafruit', 'Pimoroni'])
    expect(shelves[1].boards.map((b) => b.product)).toEqual(['Badger 2040', 'Tiny 2040'])
  })

  it('buckets a blank vendor under Other, and puts it last despite the alphabet', () => {
    // 'Other' would sort between Adafruit and Pimoroni on name alone — it is a
    // bucket, not a maker, so it belongs below both.
    const shelves = shelvesByVendor([
      board({ id: 'P', vendor: 'Pimoroni' }),
      board({ id: 'X', vendor: '   ' }),
      board({ id: 'A', vendor: 'Adafruit' })
    ])
    expect(shelves.map((s) => s.vendor)).toEqual(['Adafruit', 'Pimoroni', UNKNOWN_VENDOR])
  })
})

describe('boardInitials', () => {
  it('takes one letter from each of the first two words', () => {
    // Not the first two letters: an Adafruit range is mostly "Feather …", so
    // 'FE' would be identical across a dozen boards.
    expect(boardInitials(board({ product: 'Feather RP2350' }))).toBe('FR')
  })

  it('falls back to the first two letters of a single-word product', () => {
    expect(boardInitials(board({ product: 'Pico' }))).toBe('PI')
  })

  it('falls back to the board id when the product name is empty', () => {
    expect(boardInitials(board({ product: '', id: 'ESP32_GENERIC' }))).toBe('ES')
  })
})

describe('buildLabel', () => {
  it('names the plain build rather than leaving the row blank', () => {
    expect(buildLabel(build({ variant: null }))).toBe(PLAIN_BUILD_LABEL)
  })

  it('uses upstream’s variant id when there is one', () => {
    expect(buildLabel(build({ variant: 'SPIRAM' }))).toBe('SPIRAM')
  })
})

describe('boardFacts', () => {
  it('states MCU and port, and the flash offset only when upstream gives one', () => {
    const plain = boardFacts(board())
    expect(plain).toEqual([
      { label: 'MCU', value: 'rp2040' },
      { label: 'Port', value: 'rp2' }
    ])
    const withOffset = boardFacts(board({ flashOffset: '0x1000' }))
    expect(withOffset).toContainEqual({ label: 'Flash offset', value: '0x1000' })
  })

  it('reports external flash/RAM as present with the size explicitly unpublished', () => {
    // The whole storage/memory decision: upstream publishes a boolean and no
    // figure, so the fact says so instead of implying a number exists.
    const facts = boardFacts(board({ features: ['External Flash', 'External RAM', 'WiFi'] }))
    expect(facts).toContainEqual({ label: 'External flash', value: NO_SIZE_PUBLISHED })
    expect(facts).toContainEqual({ label: 'External RAM', value: NO_SIZE_PUBLISHED })
    // …and no fact invents a size for either of them.
    expect(facts.every((f) => !/\d+\s*(MB|KB|GB)/i.test(f.value))).toBe(true)
  })

  it('omits external flash/RAM entirely when the board does not list them', () => {
    expect(boardFacts(board({ features: ['WiFi'] })).map((f) => f.label)).toEqual(['MCU', 'Port'])
  })
})

describe('variantList', () => {
  it('lists upstream’s own descriptions, ordered by variant id', () => {
    const list = variantList(
      board({ variants: { SPIRAM: 'Support for SPIRAM / WROVER', OTA: 'Over-the-air updates' } })
    )
    expect(list).toEqual([
      { variant: 'OTA', description: 'Over-the-air updates' },
      { variant: 'SPIRAM', description: 'Support for SPIRAM / WROVER' }
    ])
  })
})

describe('the filter chips', () => {
  it('lists every vendor, mcu and feature ticked — but never the search text', () => {
    // Free text has its own input with its own clear; a second control for the
    // same value is a control that can disagree with it.
    const chips = activeFilterChips({
      vendors: ['Adafruit', 'Pimoroni'],
      mcus: ['esp32s3'],
      features: ['WiFi', 'BLE'],
      text: 'feather'
    })
    expect(chips).toEqual([
      { axis: 'vendor', value: 'Adafruit' },
      // Both makers, because both are ticked — a chip row that showed only the
      // first would leave a filter nobody can see or take off again (#919).
      { axis: 'vendor', value: 'Pimoroni' },
      { axis: 'mcu', value: 'esp32s3' },
      { axis: 'feature', value: 'WiFi' },
      { axis: 'feature', value: 'BLE' }
    ])
  })

  it('counts search text and the flashable toggle as filtering, though neither is a chip', () => {
    expect(isFiltering({})).toBe(false)
    expect(isFiltering({ vendors: [], mcus: [] })).toBe(false)
    expect(isFiltering({ vendors: ['Adafruit'] })).toBe(true)
    expect(isFiltering({ text: '  ' })).toBe(false)
    expect(isFiltering({ text: 'pico' })).toBe(true)
    expect(isFiltering({ flashableOnly: true })).toBe(true)
    expect(isFiltering({ features: ['WiFi'] })).toBe(true)
  })
})

describe('toggleChip', () => {
  it('adds a value that is off and removes one that is on', () => {
    expect(toggleChip([], 'WiFi')).toEqual(['WiFi'])
    expect(toggleChip(['WiFi', 'BLE'], 'WiFi')).toEqual(['BLE'])
  })

  it('is the same toggle for a manufacturer, since only the MEANING differs', () => {
    expect(toggleChip(['Adafruit'], 'Pimoroni')).toEqual(['Adafruit', 'Pimoroni'])
    expect(toggleChip(['Adafruit', 'Pimoroni'], 'Adafruit')).toEqual(['Pimoroni'])
  })
})

describe('the hover preview (#919)', () => {
  it('says what there is to flash, and counts variants rather than listing them', () => {
    expect(firmwareSummary(board())).toBe('MicroPython 1.29.0')
    expect(
      firmwareSummary(
        board({
          builds: [
            build(),
            build({ build: 'RPI_PICO-RISCV', variant: 'RISCV', version: '1.29.0' })
          ]
        })
      )
    ).toBe('MicroPython 1.29.0 · 2 builds')
  })

  it('says so plainly when there is nothing to flash', () => {
    // The one fact that disqualifies a board, and the reason the preview leads
    // with this line rather than burying it.
    expect(firmwareSummary(board({ builds: [] }))).toBe('No published firmware')
  })

  it('counts only the NEWEST version, not every build ever published', () => {
    const b = board({
      builds: [
        build({ date: '20250101', version: '1.28.0' }),
        build({ date: '20260824', version: '1.29.0' })
      ]
    })
    expect(firmwareSummary(b)).toBe('MicroPython 1.29.0')
  })

  it('drops the flash offset, which is an address rather than a fact about the board', () => {
    const facts = peekFacts(board({ flashOffset: '0x1000', port: 'esp32' }))
    expect(facts.map((f) => f.label)).toEqual(['MCU', 'Port'])
  })

  it('states at most four rows, so the preview has a height the gallery can predict', () => {
    const b = board({
      port: 'esp32',
      flashOffset: '0x1000',
      flash: { bytes: 8 * 1024 * 1024, source: 'Adafruit', scope: 'board' },
      ram: { bytes: 520 * 1024, source: 'Espressif datasheet', scope: 'chip' },
      psram: { bytes: 2 * 1024 * 1024, source: 'Adafruit', scope: 'board' }
    })
    expect(peekFacts(b)).toHaveLength(4)
    // And no provenance: a source is for a figure you are about to rely on.
    expect(peekFacts(b).every((f) => f.source === undefined)).toBe(true)
  })
})

describe('the flasher hand-off', () => {
  it('carries everything the flasher needs and nothing it must look up again', () => {
    const req = flashRequestFor(
      board({ port: 'esp32', mcu: 'esp32s3', flashOffset: '0x0', builds: [build()] })
    )
    expect(req).toEqual({
      boardId: 'RPI_PICO',
      vendor: 'Raspberry Pi',
      product: 'Pico',
      port: 'esp32',
      mcu: 'esp32s3',
      flashOffset: '0x0',
      build: build()
    })
  })

  it('offers the newest version, and its plain build over a variant', () => {
    const req = flashRequestFor(
      board({
        builds: [
          build({ date: '20250101', version: '1.28.0' }),
          build({ date: '20260824', variant: 'SPIRAM' }),
          build({ date: '20260824', variant: null })
        ]
      })
    )
    expect(req?.build.version).toBe('1.29.0')
    expect(req?.build.variant).toBeNull()
  })

  it('refuses a board with no published firmware', () => {
    // Three of the 225 publish none. Dispatching for them would open the flasher
    // on an empty selection, which reads as the flasher being broken.
    expect(flashRequestFor(board({ builds: [] }))).toBeNull()
  })

  it('dispatches the request on the window, and reports false rather than firing an empty one', () => {
    const events: CustomEvent[] = []
    vi.stubGlobal('window', { dispatchEvent: (e: CustomEvent) => (events.push(e), true) })

    expect(requestFlash(board())).toBe(true)
    expect(requestFlash(board({ builds: [] }))).toBe(false)

    expect(events).toHaveLength(1)
    expect(events[0].type).toBe(FLASH_BOARD_EVENT)
    expect((events[0].detail as { boardId: string }).boardId).toBe('RPI_PICO')
  })
})

describe('the memory filter (#897)', () => {
  const sram = (kb: number): BoardSize => ({
    bytes: kb * 1024,
    source: 'a datasheet',
    scope: 'chip'
  })
  const catalogue = [
    board({ id: 'TRINKET_M0', ram: sram(32) }),
    board({ id: 'RPI_PICO', ram: sram(264) }),
    board({ id: 'ESP32_GENERIC', ram: sram(520) }),
    board({ id: 'TEENSY41', ram: sram(1024) }),
    // The boards in the real catalogue with no sourced RAM figure at all.
    board({ id: 'ESP8266_GENERIC', ram: null }),
    board({ id: 'WIPY', ram: null })
  ]

  it('keeps the boards at or above the threshold', () => {
    expect(filterBoards(catalogue, { minRam: 256 * 1024 }).map((b) => b.id)).toEqual([
      'RPI_PICO',
      'ESP32_GENERIC',
      'TEENSY41'
    ])
  })

  it('does not quietly keep a board whose RAM nobody published', () => {
    // Including them would be the more generous answer and the dishonest one:
    // the filter would be saying "this board has at least 32 KB" about a board
    // it knows nothing about.
    expect(filterBoards(catalogue, { minRam: 32 * 1024 }).map((b) => b.id)).not.toContain(
      'ESP8266_GENERIC'
    )
  })

  it('counts the boards it dropped for having no figure, so they can be named', () => {
    // The trap the whole design exists to avoid: a size control that silently
    // loses the undocumented boards. The gallery prints this count.
    const dropped = boardsWithoutRam(catalogue, { minRam: 512 * 1024 })
    expect(dropped.map((b) => b.id)).toEqual(['ESP8266_GENERIC', 'WIPY'])
    expect(unsizedNotice(dropped.length)).toBe(
      '2 boards have no published RAM figure and are not shown.'
    )
  })

  it('counts the same boards whatever the threshold is', () => {
    // The answer is about what is unknown, not about where the threshold sits.
    for (const bytes of MEMORY_THRESHOLDS) {
      expect(boardsWithoutRam(catalogue, { minRam: bytes }).length, String(bytes)).toBe(2)
    }
  })

  it('still respects the other filters when counting them', () => {
    expect(
      boardsWithoutRam(catalogue, { minRam: 512 * 1024, text: 'wipy' }).map((b) => b.id)
    ).toEqual(['WIPY'])
  })

  it('says nothing when nothing was dropped', () => {
    expect(unsizedNotice(0)).toBeNull()
    expect(unsizedNotice(1)).toBe('1 board has no published RAM figure and is not shown.')
  })

  it('shows as a removable chip, and counts as filtering', () => {
    expect(activeFilterChips({ minRam: 256 * 1024 })).toEqual([
      { axis: 'memory', value: '≥ 256 KB' }
    ])
    expect(isFiltering({ minRam: 256 * 1024 })).toBe(true)
    expect(activeFilterChips({})).toEqual([])
  })

  it('labels its thresholds the way sizes are written elsewhere', () => {
    expect(memoryThresholdLabel(256 * 1024)).toBe('≥ 256 KB')
    expect(memoryThresholdLabel(1024 * 1024)).toBe('≥ 1 MB')
  })

  it('says out loud that PSRAM is not in the figure', () => {
    // Without this the control would quietly rank an ESP32 Feather V2 - 520 KB
    // of SRAM and 2 MB of PSRAM - below a board with a megabyte of plain SRAM.
    expect(MEMORY_CAVEAT).toMatch(/PSRAM/)
  })
})
