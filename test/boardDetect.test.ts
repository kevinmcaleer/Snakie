import { describe, it, expect } from 'vitest'
import { boardIdFromReplText, BUILTIN_BOARDS } from '../src/renderer/src/components/board-defs'

/** A realistic MicroPython friendly banner for a given description + mcu. */
const banner = (desc: string, mcu: string): string =>
  `MPY: soft reboot\r\nMicroPython v1.24.0 on 2024-11-29; ${desc} with ${mcu}\r\n>>> `

describe('boardIdFromReplText (#168 board inference)', () => {
  it('matches a board by its name in the banner (most specific wins)', () => {
    expect(boardIdFromReplText(banner('Raspberry Pi Pico 2 W', 'RP2350'))).toBe('pico2w')
    expect(boardIdFromReplText(banner('Pimoroni Pico Plus 2', 'RP2350'))).toBe('pico-plus-2')
    expect(boardIdFromReplText(banner('Pimoroni Tiny 2040', 'RP2040'))).toBe('tiny2040')
  })

  it('falls back to a UNIQUE mcu when the name is unknown', () => {
    // "Generic ESP32 module" isn't a board name, but ESP32 is a unique mcu.
    expect(boardIdFromReplText(banner('Generic ESP32 module', 'ESP32'))).toBe('esp32-devkit')
  })

  it('returns null for an ambiguous mcu with no name match', () => {
    // Three built-ins are RP2350, so an unknown RP2350 board is not guessable.
    expect(boardIdFromReplText(banner('Totally Unknown Board', 'RP2350'))).toBeNull()
  })

  it('uses the LAST banner when several are present (most recent boot)', () => {
    const text = banner('Raspberry Pi Pico 2 W', 'RP2350') + '\n' + banner('Pimoroni Tiny 2040', 'RP2040')
    expect(boardIdFromReplText(text)).toBe('tiny2040')
  })

  it('matches a board name even without a full banner', () => {
    expect(boardIdFromReplText('connected — Pimoroni Tiny 2350 ready\n>>> ')).toBe('tiny2350')
  })

  it('is total: empty / noise / no match → null', () => {
    expect(boardIdFromReplText('')).toBeNull()
    expect(boardIdFromReplText('>>> print("hello")\nhello\n')).toBeNull()
    expect(boardIdFromReplText('garbage \x00\x01 no board here')).toBeNull()
  })

  it('honours a custom board list', () => {
    const custom = [...BUILTIN_BOARDS, { id: 'my-rp2040', name: 'My Custom RP2040', mcu: 'RP2040', pcbColor: '#000', aspect: 0.5, headers: [] }]
    // Two RP2040 boards now → mcu ambiguous, so an unknown-named RP2040 → null.
    expect(boardIdFromReplText(banner('Unknown', 'RP2040'), custom)).toBeNull()
    // …but the explicit name still resolves.
    expect(boardIdFromReplText(banner('My Custom RP2040', 'RP2040'), custom)).toBe('my-rp2040')
  })
})
