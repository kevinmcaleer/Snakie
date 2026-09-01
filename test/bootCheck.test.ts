import { describe, it, expect } from 'vitest'
import { classifyBootOutput } from '../src/shared/boot-check'

/**
 * #827 — the flasher reported `Flash complete.` while the board boot-looped.
 *
 * The samples below are verbatim from the Adafruit ESP32 Feather V2 that
 * prompted this, captured off the serial port after a flash that esptool had
 * reported as verified.
 */
const BOOTLOOP = `ets Jul 29 2019 12:21:46

rst:0x3 (SW_RESET),boot:0x13 (SPI_FAST_FLASH_BOOT)
configsip: 271414342, SPIWP:0xee
mode:DIO, clock div:2
load:0x3fff0030,len:4200
entry 0x400805a8
E (658) esp_image: Image hash failed - image is corrupt
E (659) boot: Factory app partition is not bootable
E (659) boot: No bootable app partitions in the partition table
ets Jul 29 2019 12:21:46`

const SEGMENT = `entry 0x400805a8
E (146) esp_image: invalid segment length 0x88125782
E (146) boot: No bootable app partitions in the partition table`

const RUNNING = `entry 0x400805a8
MicroPython v1.28.0 on 2026-04-06; Generic ESP32 module with ESP32
Type "help()" for more information.
>>> `

describe('a board that will not boot', () => {
  it('recognises the reported failure and quotes the board’s own words', () => {
    const v = classifyBootOutput(BOOTLOOP)
    expect(v.kind).toBe('bootloop')
    if (v.kind !== 'bootloop') return
    expect(v.evidence).toContain('Image hash failed')
    expect(v.message).toMatch(/written and verified/i)
  })

  it('recognises the other shape the same board produced', () => {
    // The error varies with what is left on the flash; both mean the same thing.
    expect(classifyBootOutput(SEGMENT).kind).toBe('bootloop')
  })

  it('points at the fix that actually worked, rather than at the flash', () => {
    const v = classifyBootOutput(BOOTLOOP)
    if (v.kind !== 'bootloop') throw new Error('expected bootloop')
    expect(v.message).toMatch(/eras/i)
    // It must NOT claim the write failed — esptool verified every byte.
    expect(v.message).not.toMatch(/flash failed|write failed/i)
  })

  it('catches a board that resets repeatedly without explaining itself', () => {
    const silent = Array(4).fill('rst:0x3 (SW_RESET),boot:0x13\nmode:DIO, clock div:2').join('\n')
    const v = classifyBootOutput(silent)
    expect(v.kind).toBe('bootloop')
  })

  it('does not cry wolf over a single reset — that is just booting', () => {
    expect(classifyBootOutput('rst:0x1 (POWERON_RESET),boot:0x13\nmode:DIO').kind).toBe('unknown')
  })
})

describe('a board that came up', () => {
  it('names the runtime, which is what the user actually wanted to know', () => {
    const v = classifyBootOutput(RUNNING)
    expect(v.kind).toBe('running')
    if (v.kind !== 'running') return
    expect(v.runtime).toContain('MicroPython v1.28.0')
    expect(v.message).toContain('MicroPython v1.28.0')
  })

  it('recognises CircuitPython too', () => {
    const v = classifyBootOutput('Adafruit CircuitPython 10.2.1 on 2026-08-18; Feather')
    expect(v.kind).toBe('running')
  })

  it('reports a FAILURE when both appear — the banner may be scrollback', () => {
    // A board that was working before still has its old banner in the buffer;
    // the complaint is the newer, and truer, signal.
    expect(classifyBootOutput(RUNNING + '\n' + BOOTLOOP).kind).toBe('bootloop')
  })
})

describe('silence', () => {
  it('says nothing at all rather than guessing', () => {
    // A native-USB board re-enumerates after flashing and will not be there to
    // read. No output must never be reported as a failure.
    for (const s of ['', '   \r\n', '\x00\x00']) {
      expect(classifyBootOutput(s).kind).toBe('unknown')
    }
  })

  it('stays quiet on output it cannot make sense of', () => {
    expect(classifyBootOutput('\x1b[0m garbled ~~~ noise').kind).toBe('unknown')
  })
})

describe('bootloader advice is specific to the complaint (#840)', () => {
  it('does not send a hash failure round the erase-and-retry loop', () => {
    // The advice that cost an evening: "leftover partition table, erase and try
    // again" is right for a stale partition table and misleading for a hash
    // failure, which means the bytes on the chip do not match their own
    // checksum. The file is verified before writing, so the WRITE is suspect.
    const v = classifyBootOutput('E (579) esp_image: Image hash failed - image is corrupt')
    if (v.kind !== 'bootloop') throw new Error('expected bootloop')
    expect(v.message).toMatch(/do not match their own checksum/i)
    // Both real causes, not just the cheap one: a stale slot (erase fixes it)
    // and a bad write (erase does not).
    expect(v.message).toMatch(/eras/i)
    expect(v.message).toMatch(/baud|cable/i)
    // And it must not send the user hunting for a bad download -- the file was
    // already verified before it was written.
    expect(v.message).toMatch(/not a bad download/i)
  })

  it('still gives the erase advice for a genuinely stale partition table', () => {
    const v = classifyBootOutput('E (61) boot: No bootable app partitions in the partition table')
    if (v.kind !== 'bootloop') throw new Error('expected bootloop')
    expect(v.message).toMatch(/leftover partition table/i)
  })
})
