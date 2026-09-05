import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { newestBuilds, parseBoardIndex, type IndexedBoard } from '../src/shared/board-index'
import { OVERLAY_BOARDS, overlayEntries, withOverlay } from '../src/shared/board-overlay'
import { BOARD_PROFILES } from '../src/shared/board-profiles'
import { boardFacts, formatBytes } from '../src/renderer/src/components/board-finder'
import {
  flashRequestFor,
  flasherSelectionFor
} from '../src/renderer/src/components/board-finder-bus'

/**
 * The boards upstream does not build for (#902).
 *
 * The bug, once: MicroPython publishes no firmware under the name "Adafruit
 * ESP32 Feather V2" — there is no download page for it and there never was. Its
 * owner opened the model list, did not find the board, picked "ESP32 / WROOM",
 * and flashed a build without SPIRAM onto a board whose 2 MB of PSRAM only the
 * SPIRAM build initialises. So the tests that matter are: the board is FINDABLE,
 * it hands the flasher the SPIRAM build specifically, it says on its face that
 * the build belongs to another board, and it steps aside if upstream ever
 * publishes the real thing.
 */

const seed = parseBoardIndex(
  JSON.parse(readFileSync('src/renderer/public/boards/boards.json', 'utf8'))
)!

const board = (over: Partial<IndexedBoard> = {}): IndexedBoard => ({
  id: 'X',
  port: 'esp32',
  vendor: 'V',
  product: 'P',
  mcu: 'esp32',
  features: [],
  notes: [],
  url: null,
  variants: {},
  flashOffset: null,
  image: null,
  thumb: null,
  builds: [],
  flash: null,
  externalFlash: null,
  ram: null,
  psram: null,
  runtimes: [],
  circuitPythonBoardId: null,
  origin: 'micropython',
  substitute: null,
  ...over
})

describe('the board that started the epic', () => {
  const all = withOverlay(seed.boards)
  const feather = all.find((b) => b.id === 'ADAFRUIT_FEATHER_ESP32_V2')

  it('is nowhere in upstream’s catalogue', () => {
    // If this ever fails, upstream added it — and the overlay entry should go.
    expect(seed.boards.find((b) => b.id === 'ADAFRUIT_FEATHER_ESP32_V2')).toBeUndefined()
    expect(seed.boards.some((b) => b.vendor === 'Adafruit' && b.mcu.startsWith('esp32'))).toBe(false)
  })

  it('is in the gallery, as an Adafruit ESP32 board', () => {
    expect(feather).toBeDefined()
    expect(feather!.vendor).toBe('Adafruit')
    expect(feather!.mcu).toBe('esp32')
    expect(feather!.origin).toBe('snakie')
  })

  it('offers the SPIRAM build, and only that one', () => {
    // The whole week of ENOMEM in one assertion.
    expect(feather!.builds.map((b) => b.build)).toEqual(['ESP32_GENERIC-SPIRAM'])
    expect(feather!.builds[0].url).toMatch(/ESP32_GENERIC-SPIRAM-\d{8}-v[\d.]+\.bin$/)
  })

  it('reaches the flasher with 0x1000 and the SPIRAM binary', () => {
    // The end of the seam, not just the middle of it. The offset is per CHIP
    // and this is the one that is not 0x0: get it wrong and esptool reports
    // success, the ROM finds no bootloader where it looks, and the board never
    // comes back — a failure with no error message attached to it.
    const req = flashRequestFor(feather!)!
    const sel = flasherSelectionFor(req)
    expect(sel.offset).toBe('0x1000')
    expect(sel.family).toBe('esp32')
    expect(sel.url).toMatch(/ESP32_GENERIC-SPIRAM-/)
  })

  it('says whose build that is, rather than substituting it quietly', () => {
    expect(feather!.substitute?.boardId).toBe('ESP32_GENERIC')
    expect(feather!.substitute?.build).toBe('ESP32_GENERIC-SPIRAM')
    expect(feather!.substitute?.why).toMatch(/PSRAM/)
  })

  it('states the 8 MB / 2 MB that a size-less catalogue could not', () => {
    expect(feather!.flash?.bytes).toBe(8 * 1024 * 1024)
    expect(feather!.psram?.bytes).toBe(2 * 1024 * 1024)
    const facts = boardFacts(feather!)
    expect(facts.find((f) => f.label === 'Flash')?.value).toBe('8 MB')
    expect(facts.find((f) => f.label === 'External RAM')?.value).toBe('2 MB')
  })
})

describe('standing aside', () => {
  it('drops an overlay board the moment upstream publishes it', () => {
    // The overlay is a stopgap for a hole in someone else's catalogue. When the
    // hole closes, a hand-written entry is strictly worse than a generated one —
    // and two entries for one board is a bug report.
    const upstreamAddedIt = [...seed.boards, board({ id: 'ADAFRUIT_FEATHER_ESP32_V2' })]
    expect(overlayEntries(upstreamAddedIt).map((b) => b.id)).not.toContain(
      'ADAFRUIT_FEATHER_ESP32_V2'
    )
    expect(withOverlay(upstreamAddedIt).filter((b) => b.id === 'ADAFRUIT_FEATHER_ESP32_V2')).toHaveLength(1)
  })

  it('offers no build at all when the donor stops publishing that variant', () => {
    // Matched by exact build NAME, so a donor that drops the variant yields an
    // empty build list and a card that says so. Falling back to the plain build
    // would be the original mistake, made automatically.
    const donorWithoutSpiram = seed.boards.map((b) =>
      b.id === 'ESP32_GENERIC' ? { ...b, builds: b.builds.filter((x) => x.variant !== 'SPIRAM') } : b
    )
    const feather = overlayEntries(donorWithoutSpiram).find(
      (b) => b.id === 'ADAFRUIT_FEATHER_ESP32_V2'
    )!
    expect(feather.builds).toEqual([])
    expect(feather.runtimes).not.toContain('micropython')
  })

  it('adds nothing when there is no catalogue to overlay', () => {
    // Every entry borrows a build; with no upstream there is nothing to borrow,
    // and a gallery of unflashable cards is not a useful failure mode.
    expect(overlayEntries([]).every((b) => b.builds.length === 0)).toBe(true)
  })
})

describe('every overlay entry', () => {
  it('names a source for every size it states', () => {
    for (const e of OVERLAY_BOARDS) {
      for (const [key, size] of Object.entries({ flash: e.flash, ram: e.ram, psram: e.psram })) {
        if (!size) continue
        expect(size.bytes, `${e.id}.${key}`).toBeGreaterThan(0)
        expect(size.source.trim(), `${e.id}.${key}`).not.toBe('')
      }
    }
  })

  it('borrows a build that upstream actually publishes', () => {
    // A donor id or build name with a typo in it produces a board that looks
    // flashable in the source and is not in the app.
    for (const e of OVERLAY_BOARDS) {
      if (!e.donorBoardId) continue
      const donor = seed.boards.find((b) => b.id === e.donorBoardId)
      expect(donor, `${e.id} donor ${e.donorBoardId}`).toBeDefined()
      expect(
        newestBuilds(donor!).map((b) => b.build),
        `${e.id} build ${e.donorBuild}`
      ).toContain(e.donorBuild)
    }
  })

  it('explains itself, because a borrowed build needs a reason', () => {
    for (const e of OVERLAY_BOARDS) expect(e.why.length, e.id).toBeGreaterThan(40)
  })

  it('points at a board profile that exists, where it names one', () => {
    for (const e of OVERLAY_BOARDS) {
      if (!e.profileId) continue
      expect(BOARD_PROFILES.map((p) => p.id), e.id).toContain(e.profileId)
    }
  })

  it('claims CircuitPython only with a board id to back it', () => {
    for (const e of OVERLAY_BOARDS) {
      const entry = overlayEntries(seed.boards).find((b) => b.id === e.id)
      if (!entry) continue
      expect(entry.runtimes.includes('circuitpython'), e.id).toBe(Boolean(e.circuitPythonBoardId))
    }
  })
})

describe('the micro:bit the gallery was missing', () => {
  const all = withOverlay(seed.boards)

  it('shows a v2 next to upstream’s v1', () => {
    // Upstream has MICROBIT — the nRF51 v1 — and nothing else. A gallery that
    // offers only that is worse than one offering neither: it is the wrong board
    // for almost everyone holding a micro:bit, and its firmware will not run.
    expect(seed.boards.find((b) => b.id === 'MICROBIT')?.mcu).toBe('nrf51')
    expect(all.find((b) => b.id === 'MICROBIT_V2')?.mcu).toBe('nrf52')
  })

  it('offers no firmware rather than the wrong firmware', () => {
    const v2 = all.find((b) => b.id === 'MICROBIT_V2')!
    expect(v2.builds).toEqual([])
    expect(v2.substitute?.why).toMatch(/micro:bit Foundation/)
  })
})

describe('formatting a size', () => {
  it('reads the way the part is sold', () => {
    expect(formatBytes(264 * 1024)).toBe('264 KB')
    expect(formatBytes(2 * 1024 * 1024)).toBe('2 MB')
    expect(formatBytes(8 * 1024 * 1024)).toBe('8 MB')
  })

  it('keeps one decimal for a size that is half a megabyte off', () => {
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB')
    expect(formatBytes(5.5 * 1024 * 1024)).toBe('5.5 MB')
  })

  it('stays in KB rather than rounding a real difference away', () => {
    // An STM32H743 has 1056 KB. Printed as "1.0 MB" it would be indistinguishable
    // from a part with 1024 KB, and 32 KB short — which on a board with a
    // megabyte of RAM is a noticeable piece of somebody's heap. These sizes are
    // not rare here: 1056, 1376, 2512 and 4200 KB all occur.
    expect(formatBytes(1056 * 1024)).toBe('1056 KB')
    expect(formatBytes(1376 * 1024)).toBe('1376 KB')
    expect(formatBytes(4200 * 1024)).toBe('4200 KB')
    expect(formatBytes(1024 * 1024)).toBe('1 MB')
  })
})

describe('what a board’s details say about its sizes', () => {
  it('marks a chip-derived RAM figure as the chip’s', () => {
    const facts = boardFacts(
      board({ ram: { bytes: 264 * 1024, source: 'RP2040 datasheet', scope: 'chip' } })
    )
    expect(facts.find((f) => f.label === 'RAM')?.value).toBe('264 KB (the chip’s SRAM)')
  })

  it('carries the source through to the screen', () => {
    const facts = boardFacts(
      board({ flash: { bytes: 4 * 1024 * 1024, source: 'adafruit.com/product/3405', scope: 'board' } })
    )
    expect(facts.find((f) => f.label === 'Flash')?.source).toBe('adafruit.com/product/3405')
  })

  it('does not say “size not published” beside a published size', () => {
    // Upstream's `External RAM` boolean is still worth stating — but only where
    // nothing better has replaced it, or the board contradicts itself.
    const withSize = boardFacts(
      board({
        features: ['External RAM'],
        psram: { bytes: 2 * 1024 * 1024, source: 'a page', scope: 'board' }
      })
    )
    expect(withSize.find((f) => f.label === 'External RAM')?.value).toBe('2 MB')
    const without = boardFacts(board({ features: ['External RAM'] }))
    expect(without.find((f) => f.label === 'External RAM')?.value).toMatch(/not published/)
  })

  it('marks a chip-derived FLASH figure as the chip’s, and states the board’s beside it', () => {
    // An Adafruit Feather M0 Express: 256 KB inside the SAMD21, 2 MB next to it.
    // Both, labelled, because either alone answers a different question from the
    // one the reader asked.
    const facts = boardFacts(
      board({
        features: ['External Flash'],
        flash: { bytes: 256 * 1024, source: 'Microchip SAM D21 datasheet', scope: 'chip' },
        externalFlash: { bytes: 2 * 1024 * 1024, source: 'adafruit.com/product/3403', scope: 'board' }
      })
    )
    expect(facts.find((f) => f.label === 'Flash')?.value).toBe('256 KB (the chip’s internal flash)')
    expect(facts.find((f) => f.label === 'External flash')?.value).toBe('2 MB')
    expect(facts.find((f) => f.label === 'External flash')?.source).toBe('adafruit.com/product/3403')
  })

  it('still says the external flash size is unknown when only the chip’s is known', () => {
    // The bug this pairing exists to stop: before `externalFlash`, a chip-scope
    // flash figure suppressed the note about a SEPARATE flash chip, so a board
    // with 2 MB of SPI flash beside a 256 KB SAMD21 said "256 KB" and no more.
    const facts = boardFacts(
      board({
        features: ['External Flash'],
        flash: { bytes: 256 * 1024, source: 'Microchip SAM D21 datasheet', scope: 'chip' }
      })
    )
    expect(facts.find((f) => f.label === 'External flash')?.value).toMatch(/not published/)
  })

  it('does not claim an external flash chip on a board that has no such feature', () => {
    const facts = boardFacts(
      board({ flash: { bytes: 2 * 1024 * 1024, source: 'raspberrypi.com', scope: 'board' } })
    )
    expect(facts.find((f) => f.label === 'Flash')?.value).toBe('2 MB')
    expect(facts.map((f) => f.label)).not.toContain('External flash')
  })
})

/**
 * The second batch (#936) — the boards upstream builds nothing for, beyond the
 * Adafruit ESP32 family that #902 curated first.
 *
 * These are mostly RP2040/RP2350 boards, and they bring a hazard the first batch
 * did not have: a generic Pico build RUNS on nearly all of them. Running is not
 * the same as being right, and "it booted, so it was the correct firmware" is
 * precisely the reasoning that cost a week on the Feather V2.
 */
describe('the RP2 boards upstream does not build for', () => {
  const all = withOverlay(seed.boards)
  const find = (id: string): IndexedBoard => all.find((b) => b.id === id)!

  it('does not hand a Pico 2 build to a board with PSRAM', () => {
    // The Feather V2 story, one chip family across. A Pico LiPo 2 is an RP2350B
    // with 16 MB of flash and 8 MB of PSRAM; the Pico 2 build is an RP2350A with
    // 4 MB and no PSRAM. It would boot, and leave most of the board switched off.
    const lipo = find('PIMORONI_PICOLIPO2')
    expect(lipo.substitute?.boardId).toBeNull()
    expect(lipo.builds).toEqual([])
    expect(lipo.psram?.bytes).toBe(8 * 1024 * 1024)
    expect(lipo.substitute?.why).toMatch(/RP2350B/)
  })

  it('says where the firmware actually is, when it is not here', () => {
    // A board with no build must still leave the reader somewhere to go, or the
    // entry is just a dead end with a photograph.
    for (const id of [
      'PIMORONI_TINY2350',
      'PIMORONI_SERVO2040',
      'PIMORONI_MOTOR2040',
      'PIMORONI_PICOLIPO2',
      'PIMORONI_PICOLIPO2_XL_W'
    ]) {
      const b = find(id)
      expect(b.builds, id).toEqual([])
      expect(b.substitute?.why, id).toMatch(/github\.com\/pimoroni/)
    }
  })

  it('borrows a Pico build only where the maker says the board IS a Pico', () => {
    // Cytron's own page states the same RP2040, RAM and flash as a Pico. That is
    // the endorsement; without one, an entry gets no donor.
    const cytron = find('CYTRON_MAKER_PI_RP2040')
    expect(cytron.substitute?.build).toBe('RPI_PICO')
    expect(cytron.builds.length).toBeGreaterThan(0)
  })

  it('writes no esptool offset for a board that is flashed by drag-and-drop', () => {
    // An RP2 board takes a .uf2 onto its bootloader drive. An offset here would
    // be a number the flasher could act on for a board that has no such step.
    for (const id of [
      'PIMORONI_TINY2350',
      'PIMORONI_SERVO2040',
      'PIMORONI_MOTOR2040',
      'PIMORONI_PICOLIPO2',
      'PIMORONI_PICOLIPO2_XL_W',
      'CYTRON_MAKER_PI_RP2040'
    ]) {
      expect(find(id).flashOffset, id).toBeNull()
    }
  })

  it('keeps the ESP32-S3 Feather off the PSRAM build it has no PSRAM for', () => {
    // Adafruit sells three ESP32-S3 Feathers and they do not take the same
    // build. This entry is the 8 MB / no-PSRAM one, so the SPIRAM_OCT variant
    // would print an initialisation error at every boot.
    const f = find('ADAFRUIT_FEATHER_ESP32S3')
    expect(f.substitute?.build).toBe('ESP32_GENERIC_S3')
    expect(f.psram).toBeNull()
    expect(f.builds.every((b) => !b.build.includes('SPIRAM'))).toBe(true)
  })
})

describe('an overlay entry does not invent a filter chip', () => {
  /**
   * The facets are built from these strings. A near-miss — `USB C`, `Dual Core`,
   * `RGB Led` — does not fail anything; it quietly splits one filter into two,
   * which is #928 by another route. So every feature an overlay states must be
   * one upstream already uses.
   */
  it('uses only feature names upstream already publishes', () => {
    const known = new Set(seed.boards.flatMap((b) => [...b.features, ...b.notes]))
    for (const e of OVERLAY_BOARDS) {
      for (const f of e.features) {
        expect(known.has(f), `${e.id} states a feature upstream never uses: ${f}`).toBe(true)
      }
    }
  })
})
