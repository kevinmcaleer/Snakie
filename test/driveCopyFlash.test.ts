import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  copyFirmwareToDrive,
  realDriveCopyDriver,
  type DriveCopyDriver,
  type FileSystemWritableFileStreamLike
} from '../src/renderer/src/lib/webFirmware/driveCopyFlash'
import type { FlashProgress } from '../src/main/firmware/types'

/**
 * Unit tests for the guided drive-copy flash flow (Web W3, issue #284).
 * `window.showSaveFilePicker` is stubbed behind a fake `DriveCopyDriver` so
 * this exercises the orchestration (feature detection, write/close
 * sequencing, error handling) without a real OS file dialog. Tests that
 * exercise the "available" path stub a minimal `window` global too, since
 * `hasFileSystemAccess()` — the feature-detection gate — checks for
 * `showSaveFilePicker` there (the vitest environment is plain Node, with no
 * `window` at all).
 */

afterEach(() => {
  vi.unstubAllGlobals()
})

function makeFakeDriver(overrides?: {
  write?: FileSystemWritableFileStreamLike['write']
  close?: FileSystemWritableFileStreamLike['close']
  showSaveFilePicker?: DriveCopyDriver['showSaveFilePicker']
}): { driver: DriveCopyDriver; writes: BufferSource[]; closed: boolean } {
  const writes: BufferSource[] = []
  let closed = false
  const writable: FileSystemWritableFileStreamLike = {
    write:
      overrides?.write ??
      (async (data) => {
        writes.push(data)
      }),
    close:
      overrides?.close ??
      (async () => {
        closed = true
      })
  }
  const driver: DriveCopyDriver = {
    showSaveFilePicker:
      overrides?.showSaveFilePicker ??
      (async () => ({
        createWritable: async () => writable
      }))
  }
  return { driver, writes, closed }
}

describe('copyFirmwareToDrive', () => {
  it('reports a friendly error when File System Access is unavailable', async () => {
    // The vitest environment is plain Node — no `window`/`showSaveFilePicker`.
    const events: FlashProgress[] = []
    const result = await copyFirmwareToDrive(
      new Uint8Array([1]),
      'firmware.uf2',
      (p) => events.push(p),
      realDriveCopyDriver
    )

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/not available in this browser/)
    expect(events.at(-1)?.kind).toBe('done')
  })

  it('writes the firmware bytes, closes the stream, and reports success', async () => {
    vi.stubGlobal('window', { showSaveFilePicker: () => {} })
    const { driver, writes } = makeFakeDriver()
    const firmware = new Uint8Array([1, 2, 3, 4])
    const events: FlashProgress[] = []

    const result = await copyFirmwareToDrive(firmware, 'firmware.uf2', (p) => events.push(p), driver)

    expect(result).toEqual({ ok: true })
    expect(writes).toEqual([firmware])
    expect(events.at(-1)).toEqual({ kind: 'done', ok: true, message: 'Done.' })
  })

  it('passes the suggested name through to the save-file picker', async () => {
    vi.stubGlobal('window', { showSaveFilePicker: () => {} })
    const showSaveFilePicker = vi.fn(async () => ({
      createWritable: async () => ({ write: async () => {}, close: async () => {} })
    }))
    const { driver } = makeFakeDriver({ showSaveFilePicker })

    await copyFirmwareToDrive(new Uint8Array([1]), 'my-firmware.hex', () => {}, driver)

    expect(showSaveFilePicker).toHaveBeenCalledWith({ suggestedName: 'my-firmware.hex' })
  })

  it('reports failure when the user cancels the picker', async () => {
    vi.stubGlobal('window', { showSaveFilePicker: () => {} })
    const { driver } = makeFakeDriver({
      showSaveFilePicker: async () => {
        throw new Error('The user aborted a request.')
      }
    })

    const result = await copyFirmwareToDrive(new Uint8Array([1]), 'firmware.uf2', () => {}, driver)

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/aborted/)
  })

  it('reports failure when writing fails', async () => {
    vi.stubGlobal('window', { showSaveFilePicker: () => {} })
    const { driver } = makeFakeDriver({
      write: async () => {
        throw new Error('disk full')
      }
    })

    const result = await copyFirmwareToDrive(new Uint8Array([1]), 'firmware.uf2', () => {}, driver)

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/disk full/)
  })
})
