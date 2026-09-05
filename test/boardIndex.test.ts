import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  BOARD_INDEX_SCHEMA,
  defaultBuild,
  featuresOf,
  filterBoards,
  matchesFilter,
  mcusOf,
  newerIndex,
  newestBuilds,
  parseBoardIndex,
  vendorsOf,
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

  it('lists each vendor and chip once, sorted', () => {
    expect(vendorsOf(boards)).toEqual(['Adafruit', 'Espressif'])
    expect(mcusOf(boards)).toEqual(['esp32', 'rp2040'])
  })

  it('orders features commonest first, so the useful ones lead', () => {
    // Alphabetical would head the list with `Audio Codec` and bury WiFi.
    expect(featuresOf(boards)).toEqual(['WiFi', 'BLE', 'Camera'])
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
    const vendors = vendorsOf(doc!.boards)
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

  it('publishes no flash or RAM figures, because upstream does not', () => {
    // If these ever appear, they came from somewhere that has to be named — see
    // the follow-on issue about sourcing them from manufacturer product pages.
    const raw = JSON.parse(readFileSync('src/renderer/public/boards/boards.json', 'utf8'))
    expect(JSON.stringify(raw)).not.toContain('flashBytes')
    expect(JSON.stringify(raw)).not.toContain('ramBytes')
  })
})
