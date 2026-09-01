import { describe, it, expect } from 'vitest'
import {
  flashTargetForDownload,
  flashTargetForFamily,
  isCircuitPythonDownload
} from '../src/shared/firmware-runtime'

/**
 * #823 — the esptool `write_flash` offset depends on the RUNTIME, not just the
 * chip, and only on two chips.
 *
 *   MicroPython, esp32   -> 0x1000   (micropython.org: `write_flash 0x1000 …`)
 *   CircuitPython, esp32 -> 0x0      (Adafruit: `write_flash -z 0x0 firmware.bin`)
 *
 * MicroPython ships the application expecting a second-stage bootloader already
 * at 0x1000. CircuitPython ships a COMBINED image whose own bootloader is at 0.
 * The S3 and every RISC-V part are 0x0 for both, which is exactly why this went
 * unnoticed — it bites only the two chips whose runtimes disagree.
 *
 * The consequence of getting it wrong is the one `flashTargetForFamily`'s own
 * comment names: it "flashes cleanly and leaves the board dead". There is no
 * error to go on, so these are worth pinning per combination.
 */
const MP = (family: string) =>
  `https://micropython.org/resources/firmware/${family.toUpperCase()}_GENERIC-20250101-v1.25.0.bin`
const CP = (boardId: string) =>
  `https://downloads.circuitpython.org/bin/${boardId}/en_GB/adafruit-circuitpython-${boardId}-en_GB-10.2.1.bin`

describe('the chip × runtime offset matrix', () => {
  it.each([
    // family,    runtime,          url,                                      offset
    ['esp32',   'MicroPython',   MP('esp32'),                              '0x1000'],
    ['esp32',   'CircuitPython', CP('adafruit_feather_esp32_v2'),          '0x0'],
    ['esp32s2', 'MicroPython',   MP('esp32s2'),                            '0x1000'],
    ['esp32s2', 'CircuitPython', CP('adafruit_metro_esp32s2'),             '0x0'],
    // The chips where the two runtimes already agree.
    ['esp32s3', 'MicroPython',   MP('esp32s3'),                            '0x0'],
    ['esp32s3', 'CircuitPython', CP('adafruit_feather_esp32s3'),           '0x0'],
    ['esp32c3', 'MicroPython',   MP('esp32c3'),                            '0x0'],
    ['esp32c3', 'CircuitPython', CP('adafruit_qtpy_esp32c3'),              '0x0']
  ])('%s + %s -> %s', (family, _runtime, url, offset) => {
    const t = flashTargetForDownload(family, url)
    expect(t.board).toBe('esp32')
    expect(t.offset).toBe(offset)
  })

  it('is the ONLY thing that changed — esp8266 and the drive-copy families are untouched', () => {
    expect(flashTargetForDownload('esp8266', MP('esp8266')).offset).toBe('0x0')
    expect(flashTargetForDownload('rp2', 'https://x/y.uf2').board).toBe('rp2040')
    expect(flashTargetForDownload('nrf52', 'https://x/y.hex').board).toBe('microbit')
  })

  it('leaves a CircuitPython .uf2 as a drive copy, not an esptool write', () => {
    // A CircuitPython S3 board publishes BOTH a .uf2 and a .bin; the extension
    // decides the mechanism, and the runtime rule must not override that.
    const t = flashTargetForDownload('esp32s3', CP('adafruit_feather_esp32s3').replace('.bin', '.uf2'))
    expect(t.board).toBe('rp2040')
    expect(t.offset).toBeUndefined()
  })
})

describe('isCircuitPythonDownload', () => {
  it('recognises a published CircuitPython binary by host', () => {
    expect(isCircuitPythonDownload(CP('adafruit_feather_esp32_v2'))).toBe(true)
  })

  it('does NOT claim a MicroPython build', () => {
    expect(isCircuitPythonDownload(MP('esp32'))).toBe(false)
  })

  it('treats anything it cannot identify as NOT CircuitPython', () => {
    // Unknown must fall back to MicroPython's 0x1000, not CircuitPython's 0x0:
    // moving a MicroPython write to 0x0 is the very failure this prevents, so
    // the uncertain case has to fail towards the default runtime.
    for (const u of ['', 'https://example.com/mirror/firmware.bin', '/local/firmware.bin']) {
      expect(isCircuitPythonDownload(u), u || '(empty)').toBe(false)
    }
    expect(flashTargetForDownload('esp32', 'https://example.com/mirror/fw.bin').offset).toBe('0x1000')
  })
})

describe('flashTargetForFamily is unchanged', () => {
  it('still answers per-chip for callers with no URL in hand', () => {
    // It cannot know the runtime, so it keeps the MicroPython default.
    expect(flashTargetForFamily('esp32').offset).toBe('0x1000')
    expect(flashTargetForFamily('esp32s2').offset).toBe('0x1000')
    expect(flashTargetForFamily('esp32s3').offset).toBe('0x0')
  })
})
