/**
 * Firmware download → flash orchestration (issues #64, #125).
 *
 * The catalog hands the renderer a firmware URL: a `.uf2` (RP2040) or a `.bin`
 * (ESP). To flash it we (1) stream the file to a temp path under
 * `app.getPath('temp')`, emitting download `percent` as it arrives, then (2)
 * hand that local path to the existing {@link flash} engine, which dispatches
 * by `board` — copying the UF2 onto the boot drive (RP2040) OR shelling out to
 * esptool with `{ port, offset }` (ESP) — emitting its own phase `percent`. The
 * whole thing is ONE progress stream: download %, then copy/flash, then a
 * terminal `done` — exactly what the dialog's % bar + Done button consume. The
 * download itself is format-agnostic (it's just bytes); only the temp filename
 * and the downstream `flash` dispatch differ per board.
 *
 * All network access lives in the MAIN process (the renderer CSP blocks
 * outbound requests). The global `fetch` follows redirects, so the download
 * works even though the catalog URLs commonly 30x.
 */
import { createWriteStream } from 'fs'
import { unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import { Readable } from 'stream'
import { app } from 'electron'
import type { Emit } from './flasher'
import { flash } from './flasher'
import { reporter } from '../report-error'
import type { DownloadAndFlashOptions, FlashResult } from './types'

/**
 * Derive a safe firmware filename from the download URL (fallback included).
 * Keeps a real `.uf2` (RP2040) or `.bin` (ESP) basename; otherwise generates a
 * `.bin` name (esptool doesn't care about the extension, and a UF2 fallback
 * would never reach here for a real catalog URL).
 */
export function fileNameFromUrl(url: string): string {
  let name = ''
  try {
    name = basename(new URL(url).pathname)
  } catch {
    name = ''
  }
  // Strip query junk and keep it a plausible .uf2 / .bin / .hex name.
  name = name.split('?')[0]
  const lower = name.toLowerCase()
  if (!name || !(lower.endsWith('.uf2') || lower.endsWith('.bin') || lower.endsWith('.hex'))) {
    name = `micropython-${Date.now()}.bin`
  }
  return name
}

/** Resolve the OS temp directory, tolerating a non-Electron (test) context. */
function tempDir(): string {
  try {
    return app.getPath('temp')
  } catch {
    return tmpdir()
  }
}

/**
 * Stream `url` to a temp file, emitting `percent` download progress. Resolves
 * with the local temp path. Format-agnostic — works for `.uf2` and `.bin`
 * firmware alike (it's just bytes). Throws (with the temp file cleaned up) on a
 * non-OK response, a missing body, or a stream error.
 */
export async function downloadFirmware(url: string, emit: Emit): Promise<string> {
  emit({ kind: 'log', message: `Downloading ${url}`, percent: 0 })

  const res = await fetch(url, { headers: { Accept: 'application/octet-stream' } })
  if (!res.ok) {
    throw new Error(`Download failed (HTTP ${res.status}).`)
  }
  if (!res.body) {
    throw new Error('Download failed: empty response body.')
  }

  // `total` drives the progress bar ONLY. Comparing it to the bytes received as
  // an integrity check looks obvious and is wrong twice over (measured, #840):
  // a truncated response errors the stream rather than ending short, so the
  // comparison never fires for the case it would be written for; and under
  // `content-encoding: gzip` the header is the COMPRESSED length while the
  // decoded stream is larger, so it fires on healthy downloads. Firmware
  // integrity is checked where it can actually be judged — against the image's
  // own SHA-256, in `esp-image.ts`.
  const total = Number(res.headers.get('content-length') ?? '0')
  const dest = join(tempDir(), fileNameFromUrl(url))

  let received = 0
  let lastPct = -1
  const source = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0])
  source.on('data', (chunk: Buffer) => {
    received += chunk.length
    if (total > 0) {
      const pct = Math.min(100, Math.floor((received / total) * 100))
      if (pct !== lastPct && pct % 5 === 0) {
        lastPct = pct
        emit({ kind: 'log', message: `Downloading… ${pct}%`, percent: pct })
      }
    }
  })

  try {
    await new Promise<void>((resolve, reject) => {
      const write = createWriteStream(dest)
      source.on('error', reject)
      write.on('error', reject)
      write.on('finish', () => resolve())
      source.pipe(write)
    })
  } catch (err) {
    // Best-effort cleanup of the partial temp file.
    await unlink(dest).catch(reporter('firmware: cleanup partial download'))
    throw err instanceof Error ? err : new Error(String(err))
  }

  emit({ kind: 'log', message: `Downloaded ${basename(dest)}`, percent: 100 })
  return dest
}

/**
 * Download a catalog firmware file (`.uf2` or `.bin`) to a temp file then flash
 * it onto the selected target, producing a single combined progress stream
 * (download %, copy/flash, `done`). The board-specific fields are forwarded
 * straight to {@link flash}, which dispatches by `board`: RP2040 copies the UF2
 * onto `mountPath`; ESP shells out to esptool on `port` at `offset` (issue
 * #125). The temp file is removed afterwards. Always emits a terminal `done`
 * (delegated to {@link flash} on success; emitted here if the download fails).
 */
export async function downloadAndFlash(
  opts: DownloadAndFlashOptions,
  emit: Emit
): Promise<FlashResult> {
  let tempPath: string
  try {
    tempPath = await downloadFirmware(opts.url, emit)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    emit({ kind: 'error', message: msg })
    emit({ kind: 'done', ok: false, message: msg })
    return { ok: false, error: msg }
  }

  try {
    // `flash` validates the file, dispatches by board (UF2 copy / esptool), and
    // emits the terminal `done`.
    // Forward EVERY option, not a subset. Listing the fields by hand here is
    // exactly what dropped `eraseFirst`: the direct path erased, this one
    // silently did not, and the dialog said the same thing for both.
    return await flash(
      {
        board: opts.board,
        firmwarePath: tempPath,
        mountPath: opts.mountPath,
        port: opts.port,
        offset: opts.offset,
        eraseFirst: opts.eraseFirst,
        baud: opts.baud,
        chip: opts.chip
      },
      emit
    )
  } finally {
    await unlink(tempPath).catch(reporter('firmware: cleanup temp file'))
  }
}

/**
 * Does `url` actually resolve to a file? Used before offering a build whose
 * address was DERIVED rather than read from a catalog (#833).
 *
 * A composed URL is a guess about a naming convention. Handing a 404 to the
 * flasher would be worse than the manual download it replaces, so the guess is
 * checked before it is offered. HEAD, so nothing is transferred.
 *
 * Never throws: offline, blocked, or a slow server all mean "cannot offer it",
 * which is the same as "not there" from the caller's point of view.
 */
export async function firmwareUrlExists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD' })
    return res.ok
  } catch {
    return false
  }
}
