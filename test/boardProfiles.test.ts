import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import {
  BOARD_PROFILES,
  boardProfile,
  familyFitsBoard,
  firmwareFileIssue,
  firmwareMismatch,
  methodForBoardType
} from '../src/shared/board-profiles'
import { flashTargetForFamily } from '../src/main/firmware/catalog'

/**
 * Board profiles (#682) — naming the board carries the mechanics the user should
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

/** Boot-loop causes the profile has to carry (#683). */
describe('boot-loop guards', () => {
  it('steers XIAO ESP32-S3 owners to the octal-PSRAM build, ADVISORY only', () => {
    // Verified against micropython.org and the MicroPython discussions: the wrong
    // SPIRAM variant prints a PSRAM error and CARRIES ON BOOTING. It is worth
    // preferring the right one; it is not a reason a board fails to come up, and
    // claiming otherwise sends people down a dead end.
    const b = boardProfile('xiao-esp32s3')!
    expect(b.preferredBuild?.name).toContain('SPIRAM_OCT')
    expect(b.preferredBuild?.why).not.toMatch(/boot-?loop/i)
    expect(b.preferredBuild?.url).toContain('micropython.org')
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

  it('explains any preferred build, rather than just naming it', () => {
    for (const b of BOARD_PROFILES) {
      if (b.preferredBuild) expect(b.preferredBuild.why.length, b.id).toBeGreaterThan(20)
    }
  })
})

/**
 * There is exactly ONE copy of the offset rule (#684, #756).
 *
 * `flashTargetForFamily` used to be duplicated — once in
 * `src/main/firmware/catalog.ts` and once inside `FirmwareFlasher.tsx`, so the
 * renderer bundle stayed free of main-only modules — and this suite existed to
 * catch the two drifting apart. A silent divergence flashes to the wrong
 * address, which succeeds and leaves the board dead. #756 moved the rule into
 * `src/shared/firmware-runtime.ts`, which both sides import, so the two copies
 * cannot drift because there are no longer two. This pins that.
 */
describe('the offset rule has exactly one home', () => {
  const RENDERER = readFileSync('src/renderer/src/components/FirmwareFlasher.tsx', 'utf8')
  const MAIN = readFileSync('src/main/firmware/catalog.ts', 'utf8')
  const SHARED = readFileSync('src/shared/firmware-runtime.ts', 'utf8')

  it('the shared module is the only place the 0x1000 exceptions are listed', () => {
    // The S2 shares the original ESP32's 0x1000; everything from the S3 on is 0x0.
    expect(SHARED).toContain("esp32: '0x1000'")
    expect(SHARED).toContain("esp32s2: '0x1000'")
    // …and neither consumer re-states them.
    expect(RENDERER).not.toContain("esp32s2: '0x1000'")
    expect(MAIN).not.toContain("esp32s2: '0x1000'")
  })

  it('both consumers get the rule by importing it', () => {
    expect(RENDERER).toContain("from '../../../shared/firmware-runtime'")
    expect(MAIN).toContain("from '../../shared/firmware-runtime'")
  })

  it('nobody infers the offset from "is it plain esp32"', () => {
    // That inference is what got the S2 wrong.
    for (const src of [SHARED, RENDERER, MAIN]) {
      expect(src).not.toContain("fam === 'esp32' ? '0x1000' : '0x0'")
    }
  })
})

/**
 * A profile's `circuitPythonBoardId` is a per-BOARD key, and a wrong one flashes
 * a board that then needs re-flashing before it will talk (#756). So it must
 * look like a real CircuitPython board id, and no two profiles may claim the
 * same one.
 */
describe('CircuitPython board ids on profiles', () => {
  it('are lower_snake_case slugs, as circuitpython.org publishes them', () => {
    for (const b of BOARD_PROFILES) {
      if (!b.circuitPythonBoardId) continue
      expect(b.circuitPythonBoardId, b.id).toMatch(/^[a-z0-9][a-z0-9_.]*$/)
    }
  })

  it('are unique — two boards never share a build', () => {
    const ids = BOARD_PROFILES.map((b) => b.circuitPythonBoardId).filter(Boolean)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('are absent where CircuitPython has no build at all', () => {
    // CircuitPython dropped ESP8266, and never supported the nRF51 micro:bit v1.
    for (const id of ['esp8266', 'microbit-v1']) {
      expect(BOARD_PROFILES.find((b) => b.id === id)?.circuitPythonBoardId, id).toBeUndefined()
    }
  })
})

/**
 * The firmware FILE has to match how the board is flashed (#685).
 *
 * From a real report: a `.uf2` was flashed to an ESP32-S3 with esptool. Every
 * step reported success — esptool wrote what it was given and verified that same
 * data — and the board boot-looped. The log showed 3378176 bytes written, about
 * double a real S3 `.bin`, which is the UF2 container overhead.
 */
describe('firmwareFileIssue (#685)', () => {
  it('rejects a .uf2 for an esptool board, explaining what would happen', () => {
    const msg = firmwareFileIssue('esptool', '/Users/kev/Downloads/ESP32_GENERIC_S3-20260406-v1.28.0.uf2')
    expect(msg).toContain('.uf2')
    expect(msg).toContain('would not start')
    expect(msg).toContain('.bin')
  })

  it('accepts the right file for each method', () => {
    expect(firmwareFileIssue('esptool', 'ESP32_GENERIC_S3.bin')).toBeNull()
    expect(firmwareFileIssue('uf2', 'RPI_PICO.uf2')).toBeNull()
    expect(firmwareFileIssue('daplink', 'microbit.hex')).toBeNull()
  })

  it('rejects the wrong file for each method', () => {
    expect(firmwareFileIssue('uf2', 'firmware.bin')).toContain('.uf2')
    expect(firmwareFileIssue('daplink', 'firmware.uf2')).toContain('.hex')
    expect(firmwareFileIssue('esptool', 'firmware.hex')).toContain('.bin')
  })

  it('is case-insensitive and says nothing before a file is chosen', () => {
    expect(firmwareFileIssue('esptool', 'FIRMWARE.BIN')).toBeNull()
    expect(firmwareFileIssue('esptool', '')).toBeNull()
    expect(firmwareFileIssue('esptool', '   ')).toBeNull()
  })

  it('maps a coarse board type to its method', () => {
    expect(methodForBoardType('esp32')).toBe('esptool')
    expect(methodForBoardType('esp8266')).toBe('esptool')
    expect(methodForBoardType('rp2040')).toBe('uf2')
    expect(methodForBoardType('microbit')).toBe('daplink')
  })
})

describe('Adafruit ESP32 Feather V2 (#821)', () => {
  const feather = BOARD_PROFILES.find((p) => p.id === 'adafruit-feather-esp32-v2')

  it('is offered in the board picker at all — it was absent entirely', () => {
    expect(feather).toBeDefined()
  })

  it('flashes at 0x1000, the original ESP32 offset', () => {
    // The one chip whose offset is not 0x0. Getting this wrong writes the
    // firmware to the wrong address and the board does not come back.
    expect(feather?.chipFamily).toBe('esp32')
    expect(feather?.method).toBe('esptool')
    expect(feather?.offset).toBe('0x1000')
  })

  it('is not native USB — it sits behind a CH9102F bridge', () => {
    // So the port survives the flash and no replug is needed, unlike an S3.
    expect(feather?.nativeUsb).toBe(false)
  })

  it('carries the CircuitPython board id that actually exists', () => {
    // Verified against circuitpython.org rather than guessed: flashing another
    // board's build leaves a board needing a re-flash before it will talk.
    expect(feather?.circuitPythonBoardId).toBe('adafruit_feather_esp32_v2')
  })

  it('says how to enter download mode, which this board will not do by itself', () => {
    expect(feather?.notes).toMatch(/BOOT/)
    expect(feather?.notes).toMatch(/RESET/i)
  })

  it('erases first — it ships with factory firmware (#823 follow-up)', () => {
    // Reported symptom without this: the flash reports success and the board
    // boot-loops on "Image hash failed" / "No bootable app partitions", because
    // a plain write_flash leaves the factory partition table behind.
    expect(feather?.eraseByDefault).toBe(true)
  })
})
