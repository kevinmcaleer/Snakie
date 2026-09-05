import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  BOARD_INDEX_SCHEMA,
  defaultBuild,
  featureOptions,
  filterBoards,
  matchesFilter,
  mcuOptions,
  newerIndex,
  newestBuilds,
  parseBoardIndex,
  vendorOptions,
  type BoardIndex,
  type IndexedBoard
} from '../src/shared/board-index'

/**
 * The board index (#893).
 *
 * The bug this exists to prevent, stated once: the firmware picker showed
 * Thonny's catalogue, which has no Adafruit boards and no ESP32 variants. An
 * Adafruit ESP32 Feather V2 owner opened the model list, did not find their
 * board, picked "ESP32 / WROOM", and flashed a build without SPIRAM — on a
 * board whose 2 MB of PSRAM only the SPIRAM build turns on. So the tests that
 * matter most here are the ones about variants surviving, and about the parser
 * refusing rather than degrading.
 *
 * Asserted against the REAL generated seed as well as hand-built fixtures,
 * because a generator that silently starts emitting nothing would otherwise
 * pass every unit test in this file.
 */

const board = (over: Partial<IndexedBoard> = {}): IndexedBoard => ({
  id: 'ESP32_GENERIC',
  port: 'esp32',
  vendor: 'Espressif',
  product: 'ESP32 / WROOM',
  mcu: 'esp32',
  features: ['BLE', 'WiFi'],
  notes: [],
  url: null,
  variants: {},
  flashOffset: '0x1000',
  image: null,
  thumb: null,
  builds: [],
  flash: null,
  ram: null,
  psram: null,
  runtimes: ['micropython'],
  circuitPythonBoardId: null,
  origin: 'micropython',
  substitute: null,
  ...over
})

const build = (variant: string | null, date: string, version = '1.29.0'): IndexedBoard['builds'][number] => ({
  build: variant ? `ESP32_GENERIC-${variant}` : 'ESP32_GENERIC',
  variant,
  version,
  date,
  url: `https://micropython.org/resources/firmware/ESP32_GENERIC${variant ? `-${variant}` : ''}-${date}-v${version}.bin`
})

describe('parsing a document', () => {
  it('refuses a schema from the future rather than degrading', () => {
    // Half-understanding a newer document would give the user a picker missing
    // boards, with no sign anything was wrong. Refusing keeps the last good copy.
    expect(parseBoardIndex({ schema: BOARD_INDEX_SCHEMA + 1, boards: [] })).toBeNull()
  })

  it('refuses anything that is not a document', () => {
    for (const junk of [null, undefined, 42, 'nope', [], {}, { schema: 1 }]) {
      expect(parseBoardIndex(junk)).toBeNull()
    }
  })

  it('drops a board with no id rather than inventing one', () => {
    const doc = parseBoardIndex({ schema: 1, boards: [{ vendor: 'Nobody' }, { id: 'REAL' }] })
    expect(doc?.boards.map((b) => b.id)).toEqual(['REAL'])
  })

  it('drops a build with no URL, because it cannot be flashed', () => {
    const doc = parseBoardIndex({
      schema: 1,
      boards: [{ id: 'X', builds: [{ build: 'X', version: '1' }, { build: 'X', url: 'https://e/x.bin' }] }]
    })
    expect(doc?.boards[0].builds).toHaveLength(1)
  })

  it('falls back to the id when a product name is missing', () => {
    expect(parseBoardIndex({ schema: 1, boards: [{ id: 'ESP32_GENERIC' }] })?.boards[0].product).toBe(
      'ESP32_GENERIC'
    )
  })

  it('drops a size with no source, because an unattributed number is not worth publishing', () => {
    // #897's rule, enforced at the door. A wrong flash size sends someone to a
    // board that cannot hold their program, so "8 MB, says who?" is not shippable.
    const doc = parseBoardIndex({
      schema: 1,
      boards: [
        {
          id: 'X',
          flash: { bytes: 8388608 },
          ram: { bytes: 264 * 1024, source: 'RP2040 datasheet', scope: 'chip' },
          psram: { bytes: 0, source: 'somewhere' }
        }
      ]
    })
    expect(doc?.boards[0].flash).toBeNull()
    expect(doc?.boards[0].psram).toBeNull()
    expect(doc?.boards[0].ram).toEqual({ bytes: 270336, source: 'RP2040 datasheet', scope: 'chip' })
  })

  it('treats an unrecognised scope as the board’s, never as the chip’s', () => {
    // The wrong way round would be worse: "the chip's SRAM" is a caveat, and
    // silently attaching it to a curated board figure would weaken a good number.
    const doc = parseBoardIndex({
      schema: 1,
      boards: [{ id: 'X', flash: { bytes: 4096, source: 'a page', scope: 'nonsense' } }]
    })
    expect(doc?.boards[0].flash?.scope).toBe('board')
  })

  it('derives runtimes for a document written before the field existed', () => {
    // Every schema-1 document published before #902 lacks `runtimes`. Defaulting
    // to nothing would empty the runtime filter for the whole catalogue; the
    // derivation is a definition, not a guess — this IS MicroPython's index.
    const doc = parseBoardIndex({
      schema: 1,
      boards: [
        { id: 'HAS', builds: [{ build: 'HAS', url: 'https://e/x.bin' }] },
        { id: 'NONE', builds: [] }
      ]
    })
    expect(doc?.boards[0].runtimes).toEqual(['micropython'])
    expect(doc?.boards[1].runtimes).toEqual([])
  })

  it('keeps only runtimes it understands', () => {
    const doc = parseBoardIndex({
      schema: 1,
      boards: [{ id: 'X', runtimes: ['micropython', 'pythonish', 42] }]
    })
    expect(doc?.boards[0].runtimes).toEqual(['micropython'])
  })
})

describe('choosing which document to keep', () => {
  const at = (generated: string): BoardIndex => ({ schema: 1, micropython: 'v1', generated, boards: [] })

  it('takes the newer one', () => {
    expect(newerIndex(at('2026-01-01'), at('2026-06-01'))?.generated).toBe('2026-06-01')
  })

  it('keeps what it has when the fetched one is older or absent', () => {
    expect(newerIndex(at('2026-06-01'), at('2026-01-01'))?.generated).toBe('2026-06-01')
    expect(newerIndex(at('2026-06-01'), null)?.generated).toBe('2026-06-01')
  })

  it('takes the fetched one when there is no seed at all', () => {
    expect(newerIndex(null, at('2026-01-01'))?.generated).toBe('2026-01-01')
  })
})

describe('filtering', () => {
  const boards = [
    board({ id: 'A', vendor: 'Adafruit', mcu: 'rp2040', features: ['WiFi', 'Feather'] }),
    board({ id: 'B', vendor: 'Espressif', mcu: 'esp32', features: ['WiFi', 'BLE'] }),
    board({ id: 'C', vendor: 'Espressif', mcu: 'esp32s3', features: ['BLE'], builds: [] }),
    board({ id: 'D', vendor: 'LILYGO', mcu: 'esp32', features: ['LoRa', 'WiFi'], builds: [build(null, '20260824')] })
  ]

  it('narrows on every feature given, never widens', () => {
    // Two chips ticked means "both", which is what a filter is for.
    expect(filterBoards(boards, { features: ['WiFi', 'BLE'] }).map((b) => b.id)).toEqual(['B'])
  })

  it('widens on manufacturer, because a board has only one (#919)', () => {
    // The opposite of features, and the whole reason the two facets are not the
    // same control underneath. Intersecting two makers is empty by
    // construction, so "Adafruit AND LILYGO" could only ever return nothing —
    // a chip pair that can only disappoint. Ticking both means both.
    expect(filterBoards(boards, { vendors: ['Adafruit', 'LILYGO'] }).map((b) => b.id)).toEqual([
      'A',
      'D'
    ])
    expect(filterBoards(boards, { vendors: ['Adafruit'] }).map((b) => b.id)).toEqual(['A'])
  })

  it('widens on processor for the same reason', () => {
    expect(filterBoards(boards, { mcus: ['rp2040', 'esp32s3'] }).map((b) => b.id)).toEqual([
      'A',
      'C'
    ])
  })

  it('still narrows ACROSS facets, so a maker and a feature compound', () => {
    // OR inside a facet, AND between them: LILYGO or Espressif, and of those
    // only the ones with LoRa.
    expect(
      filterBoards(boards, { vendors: ['LILYGO', 'Espressif'], features: ['LoRa'] }).map(
        (b) => b.id
      )
    ).toEqual(['D'])
  })

  it('treats an empty facet as no opinion rather than as no boards', () => {
    expect(filterBoards(boards, { vendors: [], mcus: [] })).toHaveLength(4)
  })

  it('matches text across vendor, product, id and mcu', () => {
    expect(filterBoards(boards, { text: 'lilygo' }).map((b) => b.id)).toEqual(['D'])
    expect(filterBoards(boards, { text: 'esp32s3' }).map((b) => b.id)).toEqual(['C'])
  })

  it('ignores spacing and separators, so "esp32 s3" finds esp32s3', () => {
    expect(filterBoards(boards, { text: 'esp32 s3' }).map((b) => b.id)).toEqual(['C'])
  })

  it('requires every search word, so two words narrow', () => {
    expect(filterBoards(boards, { text: 'espressif esp32s3' }).map((b) => b.id)).toEqual(['C'])
    expect(filterBoards(boards, { text: 'espressif lilygo' })).toEqual([])
  })

  it('can hide boards with no published firmware', () => {
    expect(filterBoards(boards, { flashableOnly: true }).map((b) => b.id)).toEqual(['D'])
  })

  it('narrows on runtime, and both ticked means both', () => {
    const rt = [
      board({ id: 'MP', runtimes: ['micropython'] }),
      board({ id: 'BOTH', runtimes: ['micropython', 'circuitpython'] }),
      board({ id: 'NEITHER', runtimes: [] })
    ]
    expect(filterBoards(rt, { runtimes: ['circuitpython'] }).map((b) => b.id)).toEqual(['BOTH'])
    expect(
      filterBoards(rt, { runtimes: ['micropython', 'circuitpython'] }).map((b) => b.id)
    ).toEqual(['BOTH'])
    expect(filterBoards(rt, { runtimes: ['micropython'] }).map((b) => b.id)).toEqual(['MP', 'BOTH'])
  })

  it('an empty filter keeps everything', () => {
    expect(filterBoards(boards, {})).toHaveLength(4)
    expect(matchesFilter(boards[0], {})).toBe(true)
  })
})

describe('the filter options', () => {
  const boards = [
    board({ vendor: 'Espressif', mcu: 'esp32', features: ['WiFi', 'BLE'] }),
    board({ vendor: 'Adafruit', mcu: 'rp2040', features: ['WiFi'] }),
    board({ vendor: 'Espressif', mcu: 'esp32', features: ['WiFi', 'Camera'] })
  ]

  it('lists each vendor and chip once, commonest first with its count (#919)', () => {
    // Commonest-first is what makes a collapsed list of ten useful: the head is
    // most people's board, where the first ten alphabetically are curiosities.
    // The count travels with it because it is what makes that order legible.
    expect(vendorOptions(boards)).toEqual([
      { value: 'Espressif', count: 2 },
      { value: 'Adafruit', count: 1 }
    ])
    expect(mcuOptions(boards)).toEqual([
      { value: 'esp32', count: 2 },
      { value: 'rp2040', count: 1 }
    ])
  })

  it('breaks a tie alphabetically, so the order is stable between renders', () => {
    const tied = [board({ vendor: 'Pimoroni' }), board({ vendor: 'Arduino' })]
    expect(vendorOptions(tied).map((o) => o.value)).toEqual(['Arduino', 'Pimoroni'])
  })

  it('orders features commonest first, so the useful ones lead', () => {
    // Alphabetical would head the list with `Audio Codec` and bury WiFi.
    expect(featureOptions(boards)).toEqual([
      { value: 'WiFi', count: 3 },
      { value: 'BLE', count: 1 },
      { value: 'Camera', count: 1 }
    ])
  })
})

describe('picking a build', () => {
  const b = board({
    // Variants FIRST, deliberately: with the plain build listed first, a
    // "newest wins" reduce keeps it on a tie and the test passes whether or not
    // the plain-build preference exists at all.
    builds: [
      build('SPIRAM', '20260824'),
      build('UNICORE', '20260824'),
      build(null, '20260824'),
      build(null, '20260406', '1.28.0'),
      build('SPIRAM', '20260406', '1.28.0')
    ]
  })

  it('defaults to the newest version, plain rather than a variant', () => {
    // Which variant a board needs is `board-profiles.ts`'s judgement — it knows
    // the board is a Feather V2 and says why. The index cannot see the hardware,
    // so guessing a variant here would be guessing.
    const d = defaultBuild(b)
    expect(d?.date).toBe('20260824')
    expect(d?.variant).toBeNull()
  })

  it('offers every variant of the newest version, plain first', () => {
    expect(newestBuilds(b).map((x) => x.variant)).toEqual([null, 'SPIRAM', 'UNICORE'])
  })

  it('says nothing for a board with no published firmware', () => {
    expect(defaultBuild(board({ builds: [] }))).toBeNull()
    expect(newestBuilds(board({ builds: [] }))).toEqual([])
  })
})

describe('the generated seed that actually ships', () => {
  const doc = parseBoardIndex(
    JSON.parse(readFileSync('src/renderer/public/boards/boards.json', 'utf8'))
  )

  it('parses, and is not empty', () => {
    // A generator that quietly starts emitting nothing would pass every test
    // above. This is the one that notices.
    expect(doc).not.toBeNull()
    expect(doc!.boards.length).toBeGreaterThan(200)
  })

  it('carries the boards Thonny’s catalogue does not', () => {
    const vendors = vendorOptions(doc!.boards).map((o) => o.value)
    expect(vendors).toContain('Adafruit')
    expect(vendors.length).toBeGreaterThan(40)
  })

  it('carries the SPIRAM build that started all this', () => {
    // The exact file that would have saved a week: ESP32_GENERIC-SPIRAM, named,
    // flashable, and sitting beside the plain build rather than invisible.
    const esp = doc!.boards.find((b) => b.id === 'ESP32_GENERIC')
    expect(esp).toBeDefined()
    expect(esp!.variants.SPIRAM).toContain('SPIRAM')
    const spiram = newestBuilds(esp!).find((b) => b.variant === 'SPIRAM')
    expect(spiram?.url).toMatch(/ESP32_GENERIC-SPIRAM-\d{8}-v[\d.]+\.bin$/)
  })

  it('keeps every build URL absolute and on micropython.org', () => {
    for (const b of doc!.boards) {
      for (const x of b.builds) {
        expect(x.url, `${b.id} ${x.build}`).toMatch(/^https:\/\/micropython\.org\/resources\/firmware\//)
      }
    }
  })

  it('offers no preview builds', () => {
    // A preview is not what someone picking their board off a gallery wants.
    const previews = doc!.boards.flatMap((b) => b.builds.filter((x) => x.version.includes('preview')))
    expect(previews).toEqual([])
  })

  /**
   * This used to assert that NO flash or RAM figure appeared at all, on the
   * grounds that upstream publishes none and anything that showed up must have
   * come from somewhere unnamed. #897 answered that by naming the somewhere, so
   * the tripwire moves rather than goes: the rule is no longer "no figures", it
   * is "no figure without a source".
   */
  describe('the sizes it publishes, and their provenance (#897)', () => {
    it('names a source for every figure, and never publishes a bare number', () => {
      const raw = JSON.parse(readFileSync('src/renderer/public/boards/boards.json', 'utf8'))
      for (const b of raw.boards) {
        for (const key of ['flash', 'ram', 'psram'] as const) {
          const size = b[key]
          if (size === null || size === undefined) continue
          expect(typeof size.bytes, `${b.id}.${key}`).toBe('number')
          expect(size.bytes, `${b.id}.${key}`).toBeGreaterThan(0)
          expect(String(size.source).trim(), `${b.id}.${key} source`).not.toBe('')
          expect(['board', 'chip'], `${b.id}.${key} scope`).toContain(size.scope)
        }
      }
    })

    it('marks every MCU-derived RAM figure as the chip’s, not the board’s', () => {
      // The distinction #897 asks for. "Every RP2040 has 264 KB" is a fact about
      // the chip; presented as the board's it would imply the module was
      // measured, and the module is where flash lives.
      const pico = doc!.boards.find((b) => b.id === 'RPI_PICO')!
      expect(pico.ram?.scope).toBe('chip')
      expect(pico.ram?.bytes).toBe(264 * 1024)
      // …while its flash IS the board's, from Raspberry Pi's own documentation.
      expect(pico.flash?.scope).toBe('board')
      expect(pico.flash?.bytes).toBe(2 * 1024 * 1024)
    })

    it('says nothing about chip families whose SRAM is not fixed', () => {
      // stm32f4 spans 96 KB to 256 KB; nrf52 spans 64 KB to 256 KB. A plausible
      // average would never get checked, which is what makes it dangerous.
      for (const b of doc!.boards) {
        if (['stm32f4', 'nrf52', 'samd21', 'samd51', 'mimxrt'].includes(b.mcu)) {
          expect(b.ram, `${b.id} (${b.mcu})`).toBeNull()
        }
      }
    })
  })

  it('confirms CircuitPython per board rather than per chip (#902)', () => {
    // Per BOARD is the whole point: `raspberry_pi_pico` and
    // `raspberry_pi_pico_w` are different files on the same chip, and flashing
    // one to the other is a board that boots with the wrong pins.
    const pico = doc!.boards.find((b) => b.id === 'RPI_PICO')!
    const picoW = doc!.boards.find((b) => b.id === 'RPI_PICO_W')!
    expect(pico.circuitPythonBoardId).toBe('raspberry_pi_pico')
    expect(picoW.circuitPythonBoardId).toBe('raspberry_pi_pico_w')
    expect(pico.runtimes).toContain('circuitpython')
  })

  it('claims no runtime for a board with nothing published', () => {
    // Three of the 225 are in upstream's tree with no download page at all.
    for (const b of doc!.boards) {
      if (b.builds.length === 0) expect(b.runtimes, b.id).not.toContain('micropython')
    }
  })
})
