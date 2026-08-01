import { describe, it, expect } from 'vitest'
import {
  BOARD_PROFILES,
  boardProfile,
  familyFitsBoard,
  firmwareMismatch
} from '../src/shared/board-profiles'
import { flashTargetForFamily } from '../src/main/firmware/catalog'

/**
 * Board profiles (#680) — naming the board carries the mechanics the user should
 * not have to know, and covers boards an upstream catalog happens to lack.
 */
describe('board profiles', () => {
  it('covers the XIAO ESP32-S3, which Thonny\'s catalog does not list', () => {
    const b = boardProfile('xiao-esp32s3')!
    expect(b.chipFamily).toBe('esp32s3')
    expect(b.method).toBe('esptool')
  })

  it('has unique ids and a label for every entry', () => {
    const ids = BOARD_PROFILES.map((b) => b.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(BOARD_PROFILES.every((b) => b.label.includes(b.model))).toBe(true)
  })

  it('gives every esptool board an offset, and no other board one', () => {
    for (const b of BOARD_PROFILES) {
      if (b.method === 'esptool') expect(b.offset, b.id).toBeTruthy()
      else expect(b.offset, b.id).toBeUndefined()
    }
  })

  it('flashes ONLY the original ESP32 at 0x1000', () => {
    // The trap: at 0x1000 an S3 image writes cleanly and never boots.
    for (const b of BOARD_PROFILES.filter((x) => x.method === 'esptool')) {
      expect(b.offset, b.id).toBe(b.chipFamily === 'esp32' ? '0x1000' : '0x0')
    }
  })

  it('agrees with the catalog mapper, so the two cannot drift', () => {
    // Both decide an offset; they must never disagree about the same chip.
    for (const b of BOARD_PROFILES.filter((x) => x.method === 'esptool')) {
      expect(flashTargetForFamily(b.chipFamily).offset, b.id).toBe(b.offset)
    }
  })

  it('flags the native-USB boards, whose port changes after a flash', () => {
    expect(boardProfile('xiao-esp32s3')!.nativeUsb).toBe(true)
    expect(boardProfile('esp8266')!.nativeUsb).toBeUndefined()
  })
})

describe('firmware / board compatibility', () => {
  const s3 = boardProfile('xiao-esp32s3')!

  it('accepts firmware for the board\'s own chip', () => {
    expect(familyFitsBoard(s3, 'esp32s3')).toBe(true)
    expect(familyFitsBoard(s3, 'ESP32S3')).toBe(true)
    expect(firmwareMismatch(s3, 'esp32s3')).toBeNull()
  })

  it('warns, in terms of what will happen, when it does not fit', () => {
    const msg = firmwareMismatch(s3, 'esp32')
    expect(msg).toContain('esp32s3')
    expect(msg).toContain('will not start')
  })

  it('says nothing when no firmware is chosen yet', () => {
    expect(firmwareMismatch(s3, '')).toBeNull()
  })
})
