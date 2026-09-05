import { describe, expect, it } from 'vitest'
// @ts-ignore — a plain .mjs beside the generator that uses it; the tables
// are the thing under test, so they are imported rather than re-typed.
import {
  BOARD_MCU_PART,
  CHIP_MEMORY,
  CURATED_BOARDS,
  MCU_SRAM,
  WITHHELD,
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

  it('never derives flash from the chip FAMILY, because flash is not in the family', () => {
    // The distinction #897 turns on: RP2040 boards ship with 2 MB to 16 MB of
    // flash and all of them have exactly 264 KB of SRAM. An exact PART may well
    // settle the flash — see the CHIP_MEMORY tests below — but `mcu` never does.
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

describe('memory the exact chip settles', () => {
  it('gives a SAMD51 Feather its 512 KB, as the chip’s figure and not the board’s', () => {
    const { flash, ram } = specsForBoard(board({ mcu: 'samd51' }), { part: 'SAMD51J19A' })
    expect(flash.bytes).toBe(512 * 1024)
    expect(flash.scope).toBe('chip')
    expect(flash.source).toMatch(/Microchip/)
    // 192, not 200: Microchip prints "192/8" and the 8 KB is backup RAM in its
    // own power domain. Adding it would be the easiest wrong number in the file.
    expect(ram.bytes).toBe(192 * 1024)
  })

  it('falls back to the build’s name when the board’s is too vague to be a part', () => {
    // The HydraBus calls itself "STM32F4"; its makefile says `STM32F405xx`.
    const { flash } = specsForBoard(board({ mcu: 'stm32f4' }), {
      part: 'STM32F4',
      partAlso: 'STM32F405xx'
    })
    expect(flash?.bytes).toBe(1024 * 1024)
  })

  it('says nothing for a chip name that does not pin the memory down', () => {
    // nRF52832 is the 512 KB/64 KB QFAA and the 256 KB/32 KB QFAB — a factor of
    // two apart on both axes — and nRF51822 is worse at three variants. These
    // are the rows most likely to be "improved" by a plausible number.
    for (const part of ['nrf52832', 'nrf51822']) {
      const { flash, ram } = specsForBoard(board({ mcu: 'nrf52' }), { part })
      expect(flash, part).toBeNull()
      expect(ram, part).toBeNull()
    }
  })

  it('states SRAM alone for a Renesas group that spans several flash sizes', () => {
    // RA6M5 is 1 MB to 2 MB of flash and 512 KB of SRAM throughout, and upstream
    // names the group rather than the part.
    const { flash, ram } = specsForBoard(board({ mcu: 'ra6m5' }), { part: 'RA6M5' })
    expect(flash).toBeNull()
    expect(ram.bytes).toBe(512 * 1024)
  })

  it('lets the board name a part where upstream’s name is too vague', () => {
    // "STM32F407" spans 512 KB and 1 MB; Olimex says STM32F407ZGT6.
    expect(BOARD_MCU_PART.OLIMEX_E407.part).toBe('STM32F407ZG')
    const { flash } = specsForBoard(board({ id: 'OLIMEX_E407', mcu: 'stm32f4' }), {
      part: 'STM32F407'
    })
    expect(flash?.bytes).toBe(1024 * 1024)
  })

  it('names a source for every figure it states', () => {
    for (const [part, entry] of Object.entries(CHIP_MEMORY) as [
      string,
      { flash?: number; sram?: number; source: string }
    ][]) {
      expect(entry.source?.trim(), part).not.toBe('')
      expect(entry.flash ?? entry.sram, part).toBeGreaterThan(0)
    }
  })
})

describe('what upstream states outright', () => {
  it('prefers the board’s own build configuration to the chip’s datasheet', () => {
    // An i.MX RT has no internal flash, so the only true figure is the one the
    // board file gives, and it must not be shadowed by anything.
    const { flash } = specsForBoard(board({ mcu: 'mimxrt' }), {
      part: 'MIMXRT1062',
      flash: 8 * 1024 * 1024,
      flashSource: 'MicroPython ports/mimxrt/boards/TEENSY41/mpconfigboard.mk'
    })
    expect(flash.bytes).toBe(8 * 1024 * 1024)
    expect(flash.scope).toBe('board')
    expect(flash.source).toMatch(/TEENSY41/)
  })

  it('refuses a size with no source, even when it has a number', () => {
    // The rule the whole issue turns on, enforced one layer before the parser.
    const { flash, psram } = specsForBoard(board(), {
      flash: 4 * 1024 * 1024,
      externalRam: 2 * 1024 * 1024
    })
    expect(flash).toBeNull()
    expect(psram).toBeNull()
  })
})

describe('figures deliberately withheld', () => {
  it('blanks a figure two sources disagree about, and says why', () => {
    const spec = specsForBoard(board({ id: 'MACHDYNE_WERKZEUG', mcu: 'rp2040' }), {
      flash: 1024 * 1024,
      flashSource: 'Raspberry Pi pico-sdk src/boards/include/boards/machdyne_werkzeug.h'
    })
    expect(spec.flash).toBeNull()
    expect(WITHHELD.MACHDYNE_WERKZEUG.why).toMatch(/4MB/)
  })

  it('writes down a reason for every one of them', () => {
    for (const [id, entry] of Object.entries(WITHHELD) as [
      string,
      { fields: string[]; why: string }
    ][]) {
      expect(entry.fields.length, id).toBeGreaterThan(0)
      expect(entry.why.trim(), id).not.toBe('')
    }
  })
})

describe('a second flash chip beside the microcontroller', () => {
  it('is published separately from the chip’s own', () => {
    // The Feather M0 Express has 256 KB inside the SAMD21 and 2 MB next to it.
    // Answering "how much flash?" with either alone answers a different question.
    const spec = specsForBoard(board({ id: 'ADAFRUIT_FEATHER_M0_EXPRESS', mcu: 'samd21' }), {
      part: 'SAMD21G18A'
    })
    expect(spec.flash.bytes).toBe(256 * 1024)
    expect(spec.flash.scope).toBe('chip')
    expect(spec.externalFlash.bytes).toBe(2 * 1024 * 1024)
    expect(spec.externalFlash.scope).toBe('board')
  })

  it('reads SparkFun’s "4Mb" as four megaBITs, which is what SparkFun fitted', () => {
    // An AT25SF041. Reading the lower-case b as bytes overstates the board by
    // eight times, which is the worst mistake available anywhere in this file.
    expect(CURATED_BOARDS.SPARKFUN_SAMD51_THING_PLUS.externalFlash.bytes).toBe(512 * 1024)
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
