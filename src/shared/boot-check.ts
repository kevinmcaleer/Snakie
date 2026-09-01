/**
 * WHAT THE BOARD SAID AFTER FLASHING — issue #827.
 * =============================================================================
 *
 * `Flash complete.` was the flasher's last word, and it said that whenever
 * esptool exited 0 — which esptool does even when the board it just wrote
 * cannot boot. So the one screen that could have explained the failure instead
 * asserted success, while the board, one serial read away, repeated:
 *
 *     E (658) esp_image: Image hash failed - image is corrupt
 *     E (659) boot: No bootable app partitions in the partition table
 *
 * That is not a hypothetical. It was diagnosed on a real Adafruit ESP32 Feather
 * V2 only after reading the partition table off the chip and decoding the app
 * image header by hand — every intermediate signal said the flash was fine,
 * because it WAS. `Hash of data verified` is true and unhelpful.
 *
 * This module is the pure half: given whatever the board printed, say which of
 * three things happened. The reading itself lives in `main/firmware/flasher.ts`.
 *
 * Deliberately advisory. A flash that esptool completed is a flash that
 * completed; nothing here may turn that into a reported failure. The worst this
 * can do is stay quiet.
 */

/** What the board's post-flash output tells us. */
export type BootVerdict =
  | { kind: 'running'; runtime: string; message: string }
  | { kind: 'bootloop'; evidence: string; message: string }
  | { kind: 'unknown' }

/** Lines that mean the second-stage bootloader rejected the app. */
const BOOTLOOP_MARKERS = [
  'esp_image:',
  'no bootable app partitions',
  'is not bootable',
  'invalid segment length',
  'image hash failed',
  'checksum failed'
]

/** The ROM banner that heads each boot attempt on an ESP32. */
const RESET_MARKER = /rst:0x[0-9a-f]+/gi

/**
 * What to actually DO about a given bootloader complaint.
 *
 * These are not interchangeable, and saying so matters: the generic "erase and
 * try again" is right for a stale partition table and actively misleading for a
 * hash failure, which means the bytes ON the chip do not match their own
 * checksum. Snakie verifies the firmware file's SHA-256 before writing it (see
 * `main/firmware/esp-image.ts`), so by the time a hash failure reaches here the
 * FILE was known-good and the WRITE is the thing under suspicion — advice that
 * sends the user round the erase-and-retry loop again just wastes their evening.
 */
function adviceFor(lowerText: string): string {
  // Keyed off the whole output, NOT the matched marker: the marker list is
  // ordered by generality, so a hash failure matches the broad `esp_image:`
  // entry first and would otherwise get the generic advice.
  if (lowerText.includes('image hash failed') || lowerText.includes('checksum failed')) {
    return (
      'That means the bytes on the chip do not match their own checksum. Snakie verifies the ' +
      'firmware file against its own SHA-256 before writing it, so this is not a bad download. ' +
      'Erase the whole flash and flash again — stale partition or OTA data can point the ' +
      'bootloader at an app slot that was never written. If it survives an erase, the write ' +
      'itself is suspect: try a lower baud rate, a different USB cable, and a powered port.'
    )
  }
  return (
    'This is usually a leftover partition table from whatever was on the board before: ' +
    'erasing the whole flash and flashing again usually fixes it.'
  )
}

/**
 * Classify what a board printed in the seconds after a flash.
 *
 * Order matters: a boot-loop can scroll a runtime banner off the top on a board
 * that was working before, so the FAILURE markers are checked first. A banner
 * only counts when nothing is also complaining.
 */
export function classifyBootOutput(raw: string): BootVerdict {
  const text = (raw ?? '').replace(/\r/g, '')
  if (!text.trim()) return { kind: 'unknown' }
  const lower = text.toLowerCase()

  const marker = BOOTLOOP_MARKERS.find((m) => lower.includes(m))
  if (marker) {
    const evidence =
      text
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.toLowerCase().includes(marker)) ?? marker
    return {
      kind: 'bootloop',
      evidence,
      message:
        'The firmware was written and verified, but the board is not booting it — it says ' +
        `"${evidence}". ${adviceFor(lower)}`
    }
  }

  // A board that resets over and over without ever saying anything else is also
  // looping, just without a diagnosis of its own.
  const resets = text.match(RESET_MARKER)?.length ?? 0
  if (resets >= 3) {
    return {
      kind: 'bootloop',
      evidence: `the board reset ${resets} times`,
      message:
        'The firmware was written and verified, but the board keeps resetting instead of ' +
        'starting. Erasing the whole flash and flashing again usually fixes it.'
    }
  }

  const banner = /(MicroPython|Adafruit CircuitPython)\s+\S+[^\n]*/i.exec(text)
  if (banner) {
    return {
      kind: 'running',
      runtime: banner[0].trim(),
      message: `Flash complete — the board is running ${banner[0].trim()}`
    }
  }

  return { kind: 'unknown' }
}
