/**
 * Browser-native guided "drive-copy" firmware flashing (Web W3, issue #284).
 *
 * RP2040 (BOOTSEL bootloader) and BBC micro:bit both flash on desktop by
 * copying a firmware file onto a mass-storage drive they mount as
 * (`src/main/firmware/flasher.ts` does this with a plain `fs` stream copy —
 * `.uf2` onto `RPI-RP2`, `.hex` onto `MICROBIT`). A browser tab can't see or
 * auto-detect that mounted drive, so this flow instead GUIDES the user
 * through the manual steps (hold BOOTSEL and plug in for RP2040; just plug
 * in for a micro:bit) and then uses the File System Access API's save-file
 * picker (`window.showSaveFilePicker`) to write the firmware bytes onto
 * whichever drive the user navigates to and picks in that OS-native dialog.
 *
 * This is the ONLY flashing option for RP2040 in a browser — BOOTSEL is pure
 * USB mass storage, with no WebUSB/DAPLink interface to talk to — and is
 * offered as an explicit fallback button for micro:bit boards where WebUSB
 * DAPLink (`microbitFlash.ts`) isn't available or doesn't respond (notably
 * older micro:bit v1 DAPLink firmware).
 *
 * Feature-detected via `hasFileSystemAccess()` from `../platform`; callers
 * should show a clear "use Chrome/Edge" message when it's unavailable — as
 * of writing, Firefox and Safari don't implement `showSaveFilePicker`.
 *
 * `FlashProgress`/`FlashResult` are the SAME shapes the desktop flasher
 * emits (re-exported, type-only, from the preload), so `FirmwareFlasher.tsx`
 * can render this alongside the ESP/micro:bit flows with identical
 * log/progress UI.
 */
import { hasFileSystemAccess } from '../platform'
import type { FlashProgress, FlashResult } from '../../../../preload/index.d'

/** Minimal shape of a File System Access API writable stream this module needs. */
export interface FileSystemWritableFileStreamLike {
  write(data: BufferSource): Promise<void>
  close(): Promise<void>
}

/** Minimal shape of a File System Access API file handle this module needs. */
export interface FileSystemFileHandleLike {
  createWritable(): Promise<FileSystemWritableFileStreamLike>
}

/** Minimal shape of `window.showSaveFilePicker`, narrowed to what this module calls. */
export type SaveFilePickerLike = (options?: {
  suggestedName?: string
  types?: { description?: string; accept: Record<string, string[]> }[]
}) => Promise<FileSystemFileHandleLike>

/**
 * Everything the flow needs from the File System Access API, injectable so
 * tests can substitute a fake picker/stream without a real OS file dialog.
 */
export interface DriveCopyDriver {
  showSaveFilePicker: SaveFilePickerLike
}

/** The real browser-backed driver, used in production. */
export const realDriveCopyDriver: DriveCopyDriver = {
  showSaveFilePicker: (options) =>
    (window as unknown as { showSaveFilePicker: SaveFilePickerLike }).showSaveFilePicker(options)
}

/** A sink for streamed progress lines — same shape the desktop flasher emits. */
export type Emit = (p: FlashProgress) => void

/**
 * Write `firmware` bytes to a user-picked location via the save-file picker,
 * streaming progress through `emit`. Intended to be called AFTER the user
 * has been shown on-screen instructions for mounting the target drive (hold
 * BOOTSEL and plug in for RP2040; just plug in for a micro:bit) — the
 * `showSaveFilePicker` dialog itself is where they navigate to and select
 * that mounted drive, `suggestedName` pre-fills the filename (e.g.
 * `firmware.uf2`) so they just need to pick the right folder.
 */
export async function copyFirmwareToDrive(
  // Constrained to a real `ArrayBuffer` (never `SharedArrayBuffer`) so it
  // satisfies `FileSystemWritableFileStream.write()`'s `BufferSource` type —
  // matches what `new Uint8Array(await file.arrayBuffer())` actually produces.
  firmware: Uint8Array<ArrayBuffer>,
  suggestedName: string,
  emit: Emit,
  driver: DriveCopyDriver = realDriveCopyDriver
): Promise<FlashResult> {
  if (!hasFileSystemAccess()) {
    const message =
      'Saving directly to a drive is not available in this browser. Use Google Chrome or Microsoft Edge.'
    emit({ kind: 'error', message })
    emit({ kind: 'done', ok: false, message })
    return { ok: false, error: message }
  }

  let result: FlashResult
  try {
    emit({ kind: 'log', message: `Choose the mounted drive, keeping the name "${suggestedName}"…` })
    const handle = await driver.showSaveFilePicker({ suggestedName })
    const writable = await handle.createWritable()
    emit({ kind: 'log', message: 'Copying firmware…', percent: 0 })
    await writable.write(firmware)
    await writable.close()
    emit({ kind: 'log', message: 'Copy complete.', percent: 100 })
    result = { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    emit({ kind: 'error', message })
    result = { ok: false, error: message }
  }

  emit({
    kind: 'done',
    ok: result.ok,
    message: result.ok ? 'Done.' : (result.error ?? 'Copy failed.')
  })
  return result
}
