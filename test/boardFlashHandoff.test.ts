import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  flashRequestFor,
  flasherSelectionFor,
  type BoardFlashRequest
} from '../src/renderer/src/components/board-finder-bus'
import type { IndexedBoard } from '../src/shared/board-index'

/**
 * Board Finder → flasher (#893).
 *
 * The offset is the dangerous part. It is per CHIP and not a simple "the
 * original ESP32 versus the rest" — the S2 shares the original's `0x1000` while
 * the S3 and every RISC-V part are `0x0`. Getting it wrong flashes cleanly and
 * leaves a dead board, which is a failure with no error message attached to it.
 */

const board = (over: Partial<IndexedBoard> = {}): IndexedBoard => ({
  id: 'ESP32_GENERIC',
  port: 'esp32',
  vendor: 'Espressif',
  product: 'ESP32 / WROOM',
  mcu: 'esp32',
  features: [],
  notes: [],
  url: null,
  variants: {},
  flashOffset: '0x1000',
  image: null,
  thumb: null,
  builds: [
    {
      build: 'ESP32_GENERIC',
      variant: null,
      version: '1.29.0',
      date: '20260824',
      url: 'https://micropython.org/resources/firmware/ESP32_GENERIC-20260824-v1.29.0.bin'
    }
  ],
  flash: null,
  ram: null,
  psram: null,
  runtimes: ['micropython'],
  circuitPythonBoardId: null,
  origin: 'micropython',
  substitute: null,
  ...over
})

describe('what gets handed over', () => {
  it('carries enough to act without the index in hand', () => {
    const req = flashRequestFor(board())
    expect(req).toMatchObject({ boardId: 'ESP32_GENERIC', port: 'esp32', mcu: 'esp32' })
    expect(req?.build.url).toContain('ESP32_GENERIC-20260824')
  })

  it('refuses for a board with no published firmware', () => {
    // Three of the 225 publish none. Dispatching for one would open the flasher
    // on an empty selection, which reads as the flasher being broken rather
    // than the board having no build.
    expect(flashRequestFor(board({ builds: [] }))).toBeNull()
  })
})

describe('the offset, which is the part that can kill a board', () => {
  const reqFor = (over: Partial<IndexedBoard>): BoardFlashRequest =>
    flashRequestFor(board(over)) as BoardFlashRequest

  it('prefers the figure the board itself publishes', () => {
    // `deploy_options.flash_offset` is upstream's own answer for THIS board and
    // beats anything inferred from a chip family.
    expect(flasherSelectionFor(reqFor({ flashOffset: '0x1000' })).offset).toBe('0x1000')
  })

  it('falls back to the chip family only when upstream is silent', () => {
    const s = flasherSelectionFor(reqFor({ flashOffset: null, mcu: 'esp32s3' }))
    expect(s.offset).toBe('0x0')
    expect(s.board).toBe('esp32')
  })

  it('keys off the CHIP, not the port — one port covers several offsets', () => {
    // The `esp32` port holds the S2, S3, C3, C6 and P4, which do not agree.
    const s2 = flasherSelectionFor(reqFor({ flashOffset: null, mcu: 'esp32s2', port: 'esp32' }))
    const s3 = flasherSelectionFor(reqFor({ flashOffset: null, mcu: 'esp32s3', port: 'esp32' }))
    expect(s2.offset).not.toBe(s3.offset)
  })

  it('routes a UF2 board to the drive copy, not esptool', () => {
    const s = flasherSelectionFor(reqFor({ port: 'rp2', mcu: 'rp2040', flashOffset: null }))
    expect(s.board).toBe('rp2040')
  })
})

describe('both ends are wired', () => {
  const flasher = readFileSync('src/renderer/src/components/FirmwareFlasher.tsx', 'utf8')

  it('the gallery opens from beside Detect board, inside the dialog', () => {
    // "Which board is this?" is a question you have while the flasher is open.
    // Answering it there means the pick lands in the dialog you are already
    // looking at rather than opening a second one.
    expect(flasher).toContain('firmware-detect-row')
    expect(flasher).toContain('Board Finder')
  })

  it('the flasher itself listens, since it is the thing that is mounted', () => {
    expect(flasher).toContain('FLASH_BOARD_EVENT')
    expect(flasher).toContain('flasherSelectionFor(')
  })

  it('the status bar no longer owns any of it', () => {
    // It was there first; leaving a second entry point behind would give two
    // ways in that disagree about where the pick lands.
    const bar = readFileSync('src/renderer/src/components/StatusBar.tsx', 'utf8')
    expect(bar).not.toContain('BoardFinder')
    expect(bar).not.toContain('FLASH_BOARD_EVENT')
  })

  it('the gallery is a sibling of the modal, not a child of its backdrop', () => {
    // Nested in the backdrop it would be clipped by it and would inherit its
    // click-anywhere-to-dismiss.
    const i = flasher.indexOf('{finderOpen && (')
    expect(i).toBeGreaterThan(flasher.indexOf('</div>\n  )'))
  })

  it('a pick closes the gallery outright rather than animating back', () => {
    expect(flasher).toContain('dropFinder()')
  })
})
