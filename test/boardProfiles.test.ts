import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
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

/** Boot-loop causes the profile has to carry (#681). */
describe('boot-loop guards', () => {
  it('tells XIAO ESP32-S3 owners which build they need, and why', () => {
    // The catalog only offers the plain ESP32_GENERIC_S3; this board has octal
    // PSRAM and boot-loops on it — flashes clean, then drops off repeatedly.
    const b = boardProfile('xiao-esp32s3')!
    expect(b.requiredBuild?.name).toContain('SPIRAM_OCT')
    expect(b.requiredBuild?.why).toMatch(/boot-loop/i)
    expect(b.requiredBuild?.url).toContain('micropython.org')
  })

  it('erases by default on the boards that arrive running something else', () => {
    expect(boardProfile('xiao-esp32s3')!.eraseByDefault).toBe(true)
    // A drive-copy board has no erase step at all.
    expect(boardProfile('pico')!.eraseByDefault).toBeUndefined()
  })

  it('only ever sets eraseByDefault on esptool boards', () => {
    for (const b of BOARD_PROFILES) {
      if (b.eraseByDefault) expect(b.method, b.id).toBe('esptool')
    }
  })

  it('gives a required build only where a generic one genuinely will not do', () => {
    for (const b of BOARD_PROFILES) {
      if (b.requiredBuild) expect(b.requiredBuild.why.length, b.id).toBeGreaterThan(20)
    }
  })
})

/**
 * The two copies of the offset rule must never disagree (#682).
 *
 * `flashTargetForFamily` is duplicated — once in `src/main/firmware/catalog.ts`
 * (canonical) and once inside `FirmwareFlasher.tsx`, so the renderer bundle stays
 * free of main-only modules. A silent divergence there flashes to the wrong
 * address, which succeeds and leaves the board dead.
 */
describe('the mirrored offset rule stays in step', () => {
  const RENDERER = readFileSync('src/renderer/src/components/FirmwareFlasher.tsx', 'utf8')

  it('both copies list the same 0x1000 exceptions', () => {
    // The S2 shares the original ESP32's 0x1000; everything from the S3 on is 0x0.
    expect(RENDERER).toContain("esp32: '0x1000'")
    expect(RENDERER).toContain("esp32s2: '0x1000'")
  })

  it('the renderer no longer infers the offset from "is it plain esp32"', () => {
    // That inference is what got the S2 wrong.
    expect(RENDERER).not.toContain("fam === 'esp32' ? '0x1000' : '0x0'")
  })
})
