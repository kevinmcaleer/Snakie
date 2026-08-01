import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'

/**
 * SHIPPED I²C EXAMPLES MUST NAME THEIR BOARD (#699).
 * =============================================================================
 *
 * Every I²C example we shipped read `I2C(1, sda=Pin(6), scl=Pin(7))` and called
 * it "the Grove port on a XIAO". The silk names (`D4`/`D5`) really are the same
 * across the XIAO family; the GPIO numbers behind them are not. That line is the
 * RP2040/RP2350 mapping — on a XIAO ESP32-S3, `D4` is GPIO5 and `D5` is GPIO6, so
 * it puts SCL on GPIO7 (which is `D8`/SCK) and the bus is simply dead.
 *
 * The failure has no error to read. An I²C device that isn't addressed doesn't
 * complain; it just never answers, and `scan()` comes back empty. A user wired a
 * Grove IMU correctly and lost an evening to it, because the example they copied
 * was ours.
 *
 * So: an example may pick whichever board it likes, but it has to SAY which. This
 * is a documentation contract, in the same family as the field/whitelist contracts
 * — it exists because the next example added will otherwise copy the last one.
 */

/** Where user-facing code examples live. */
const ROOTS = [
  'micropython/modules',
  'examples/parts',
  'src/renderer/src/components/help',
  'src/renderer/src/components'
]

/** Files that can carry an example. */
const EXT = /\.(py|md|tsx)$/

/**
 * An I²C pin example with a CONCRETE number — the thing whose value is
 * board-specific. `Pin(...)` placeholders and `Pin(${sda})` templates are
 * deliberately excluded: they assert nothing about a board, so there is nothing
 * for them to get wrong.
 */
const PIN_EXAMPLE = /sda\s*=\s*Pin\(\s*\d/

/** A specific board, named. `ESP32-S3` / `ESP32S3` covers both spellings. */
const NAMES_A_BOARD = /RP2040|RP2350|ESP32[-\s]?S3|ESP32[-\s]?C[0-9]|nRF52840|Pico|Feather|micro:bit/i

/**
 * The other honest option: say the pins are an example and the reader should
 * check their own board. A generic reference (`ref-i2c.md`) is right to do this
 * rather than pick a board it isn't about.
 */
const SAYS_PINS_VARY = /check your board|pins? (may )?differ|example pins|board-specific|your board's I/i

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const e of entries) {
    if (e === 'node_modules' || e === '__pycache__') continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (EXT.test(e)) out.push(p)
  }
  return out
}

// `help/` sits inside the components root, so the same file is reached twice.
const withExamples = [...new Set(ROOTS.flatMap((r) => walk(r)))]
  .map((f) => ({ file: relative(process.cwd(), f), text: readFileSync(f, 'utf-8') }))
  .filter((f) => PIN_EXAMPLE.test(f.text))

describe('shipped I²C examples name their board (#699)', () => {
  it('finds the examples at all — a silent zero would pass everything', () => {
    // The guard's own guard: if a refactor moves these files, this test would
    // otherwise keep passing while checking nothing.
    expect(withExamples.length).toBeGreaterThanOrEqual(6)
  })

  it('every concrete pin example either names a board or says pins vary', () => {
    // One or the other — an unanchored `Pin(6)` is a claim about hardware with
    // nothing to check it against, which is how this bug shipped.
    const unqualified = withExamples
      .filter((f) => !NAMES_A_BOARD.test(f.text) && !SAYS_PINS_VARY.test(f.text))
      .map((f) => f.file)
    expect(unqualified).toEqual([])
  })

  it('a file that says "XIAO" says WHICH XIAO', () => {
    // The exact defect: "the Grove port on a XIAO" is not a board. The GPIO
    // numbers differ across the family, so the family name is not enough.
    const vague = withExamples
      .filter((f) => /XIAO/i.test(f.text) && !NAMES_A_BOARD.test(f.text))
      .map((f) => f.file)
    expect(vague).toEqual([])
  })

  it('anything still on the RP2040 numbers says so on the same line', () => {
    // `sda=Pin(6), scl=Pin(7)` is correct for an RP2040/RP2350 and wrong for an
    // ESP32-S3, so it may stay — but only where the line itself is labelled,
    // since a reader copies the line, not the paragraph above it.
    const bare: string[] = []
    for (const { file, text } of withExamples) {
      text.split('\n').forEach((line, i) => {
        if (!/sda\s*=\s*Pin\(\s*6\s*\).*scl\s*=\s*Pin\(\s*7\s*\)/.test(line)) return
        if (NAMES_A_BOARD.test(line)) return
        bare.push(`${file}:${i + 1}`)
      })
    }
    expect(bare).toEqual([])
  })
})
