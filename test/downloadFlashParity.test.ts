import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * #833 — the erase checkbox did nothing on the "Download & Flash" path.
 *
 * `DownloadAndFlashOptions` carried a SUBSET of `FlashOptions`, and
 * `downloadAndFlash` rebuilt the options object field by field. `eraseFirst`
 * was not among them, so it was silently dropped — on the catalog path, which
 * is the default source and the one almost everyone uses.
 *
 * The dialog said the same thing for both paths. The box was ticked, the board
 * arrived with vendor firmware, nothing was erased, and it boot-looped on a
 * leftover partition table with the log cheerfully reporting
 * `Hash of data verified.`
 *
 * Reported by a user who could not flash an Adafruit ESP32 Feather V2 through
 * the UI while the identical esptool command worked by hand — the difference
 * being the `--erase-all` the UI never passed.
 *
 * These read the SOURCE rather than calling anything, because the bug was a
 * field that did not exist: it cannot be caught by exercising a type that is
 * already missing it.
 */
const read = (p: string): string => readFileSync(join(__dirname, '..', p), 'utf-8')

/** The optional fields of an interface, as declared. */
function fieldsOf(src: string, name: string): string[] {
  const m = new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`).exec(src)
  if (!m) throw new Error(`interface ${name} not found`)
  return [...m[1].matchAll(/^\s{2}(\w+)\??:/gm)].map((x) => x[1])
}

describe('the download path carries every option the direct path does', () => {
  const types = read('src/main/firmware/types.ts')

  it('DownloadAndFlashOptions is not missing esptool knobs FlashOptions has', () => {
    const flash = fieldsOf(types, 'FlashOptions')
    const dl = fieldsOf(types, 'DownloadAndFlashOptions')
    // `firmwarePath` is the one legitimate difference: the download path
    // produces it rather than receiving it.
    const missing = flash.filter((f) => f !== 'firmwarePath' && !dl.includes(f))
    expect(missing, `DownloadAndFlashOptions is missing: ${missing.join(', ')}`).toEqual([])
  })

  it('carries eraseFirst specifically — the field whose absence was the bug', () => {
    expect(fieldsOf(types, 'DownloadAndFlashOptions')).toContain('eraseFirst')
  })

  it('downloadAndFlash actually forwards them to flash()', () => {
    const dl = read('src/main/firmware/download.ts')
    const call = /return await flash\(\s*\{([\s\S]*?)\}/.exec(dl)
    expect(call, 'the flash() call was not found').toBeTruthy()
    for (const f of ['eraseFirst', 'baud', 'chip', 'offset', 'port', 'mountPath']) {
      expect(call![1], `flash() call drops ${f}`).toContain(f)
    }
  })

  it('the renderer sends them on the catalog branch too', () => {
    const ui = read('src/renderer/src/components/FirmwareFlasher.tsx')
    const call = /downloadAndFlash\(\{([\s\S]*?)\}\)/.exec(ui)
    expect(call, 'the downloadAndFlash call was not found').toBeTruthy()
    expect(call![1], 'the erase checkbox is not forwarded').toContain('eraseFirst')
    expect(call![1], 'the chip hint is not forwarded').toContain('chip')
  })
})
