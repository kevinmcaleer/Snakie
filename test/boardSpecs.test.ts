import { describe, expect, it } from 'vitest'
// @ts-ignore — a plain .mjs beside the generator that uses it; the tables
// are the thing under test, so they are imported rather than re-typed.
import {
  CURATED_BOARDS,
  MCU_SRAM,
  circuitPythonIdFor,
  circuitPythonIndex,
  runtimesForBoard,
  specsForBoard
} from '../scripts/board-specs.mjs'

/**
 * Where the board index's figures come from (#897, #902).
 *
 * `board.json` publishes no flash size and no RAM size, so every number in the
 * index was put there by this module. These tests are about the two ways that
 * goes wrong: publishing a number nobody can check, and publishing a number that
 * is right for the family and wrong for the part.
 */

const board = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'X',
  vendor: 'V',
  product: 'P',
  mcu: 'esp32',
  builds: [],
  ...over
})

describe('SRAM derived from the chip', () => {
  it('gives every RP2040 its 264 KB, marked as the chip’s figure', () => {
    const { ram } = specsForBoard(board({ id: 'ANY_RP2040_BOARD', mcu: 'rp2040' }))
    expect(ram.bytes).toBe(264 * 1024)
    expect(ram.scope).toBe('chip')
    expect(ram.source).toMatch(/RP2040/)
  })

  it('says nothing for a family whose SRAM is not fixed', () => {
    // stm32f4 is 43 boards spanning 96 KB (F401) to 256 KB (F439); nrf52 spans
    // the 64 KB nRF52832 and the 256 KB nRF52840. A wrong number here would be
    // the single most misleading thing in the catalogue, because it looks exact.
    for (const mcu of ['stm32f4', 'stm32h7', 'nrf52', 'nrf51', 'samd21', 'samd51', 'mimxrt']) {
      expect(specsForBoard(board({ mcu })).ram, mcu).toBeNull()
    }
  })

  it('never derives flash from the chip, because flash is not on the chip', () => {
    // The distinction #897 turns on: RP2040 boards ship with 2 MB to 16 MB of
    // flash and all of them have exactly 264 KB of SRAM.
    for (const mcu of Object.keys(MCU_SRAM)) {
      const { flash } = specsForBoard(board({ id: 'NOT_CURATED', mcu }))
      expect(flash, mcu).toBeNull()
    }
  })

  it('names a source for every family it does claim', () => {
    for (const [mcu, entry] of Object.entries(MCU_SRAM) as [string, { bytes: number; source: string }][]) {
      expect(entry.bytes, mcu).toBeGreaterThan(0)
      expect(entry.source.trim(), mcu).not.toBe('')
    }
  })
})

describe('curated boards', () => {
  it('states a Pico’s 2 MB as the board’s figure, not the chip’s', () => {
    const { flash, ram } = specsForBoard(board({ id: 'RPI_PICO', mcu: 'rp2040' }))
    expect(flash.bytes).toBe(2 * 1024 * 1024)
    expect(flash.scope).toBe('board')
    expect(ram.scope).toBe('chip')
  })

  it('names a source for every figure it states', () => {
    for (const [id, entry] of Object.entries(CURATED_BOARDS) as [
      string,
      { flash?: { source: string }; psram?: { source: string } }
    ][]) {
      for (const key of ['flash', 'psram'] as const) {
        const size = entry[key]
        if (!size) continue
        expect(size.source.trim(), `${id}.${key}`).not.toBe('')
      }
    }
  })
})

describe('confirming a CircuitPython build', () => {
  const catalog = [
    [
      { vendor: 'Raspberry Pi', model: 'Pico W', info_url: 'https://circuitpython.org/board/raspberry_pi_pico_w/' },
      { vendor: 'Seeed', model: 'XIAO ESP32S3', info_url: 'https://circuitpython.org/board/seeed_xiao_esp32s3/' },
      { vendor: 'Twins', model: 'Same Name', info_url: 'https://circuitpython.org/board/twin_a/' },
      { vendor: 'Twins', model: 'Same Name', info_url: 'https://circuitpython.org/board/twin_b/' }
    ]
  ]
  const index = circuitPythonIndex(catalog)

  it('matches an id that is literally the same string', () => {
    expect(circuitPythonIdFor(board({ id: 'SEEED_XIAO_ESP32S3', vendor: 'Seeed Studio', product: 'XIAO ESP32S3' }), index)).toBe(
      'seeed_xiao_esp32s3'
    )
  })

  it('matches the same maker and the same product, across naming styles', () => {
    expect(circuitPythonIdFor(board({ id: 'RPI_PICO_W', vendor: 'Raspberry Pi', product: 'Pico W' }), index)).toBe(
      'raspberry_pi_pico_w'
    )
  })

  it('says nothing when a name resolves to more than one board', () => {
    // Flashing the wrong `.uf2` leaves a board that needs re-flashing before it
    // will talk again, so an ambiguous match is a reason to stay quiet.
    expect(circuitPythonIdFor(board({ id: 'TWIN', vendor: 'Twins', product: 'Same Name' }), index)).toBeNull()
  })

  it('never guesses from the chip or a near-miss name', () => {
    expect(circuitPythonIdFor(board({ id: 'RPI_PICO2_W', vendor: 'Raspberry Pi', product: 'Pico 2 W' }), index)).toBeNull()
    expect(circuitPythonIdFor(board({ id: 'SOME_ESP32S3', vendor: 'Nobody', product: 'Thing' }), index)).toBeNull()
  })
})

describe('which runtimes a board claims', () => {
  it('claims MicroPython only when something is actually published', () => {
    expect(runtimesForBoard(board({ builds: [] }), null)).toEqual([])
    expect(runtimesForBoard(board({ builds: [{}] }), null)).toEqual(['micropython'])
  })

  it('claims CircuitPython only with a confirmed board id', () => {
    expect(runtimesForBoard(board({ builds: [{}] }), 'raspberry_pi_pico')).toEqual([
      'micropython',
      'circuitpython'
    ])
  })
})
