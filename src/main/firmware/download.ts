/**
 * UF2 firmware download → flash orchestration (issue #64).
 *
 * The catalog hands the renderer a `.uf2` URL on micropython.org. To flash it
 * we (1) stream the file to a temp path under `app.getPath('temp')`, emitting
 * download `percent` as it arrives, then (2) hand that local path to the
 * existing {@link flash} engine (which copies the UF2 onto the boot drive,
 * emitting its own copy `percent`). The whole thing is ONE progress stream:
 * download %, then copy %, then a terminal `done` — exactly what the dialog's
 * % bar + Done button consume.
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
import type { DownloadAndFlashOptions, FlashResult } from './types'

/** Derive a safe `.uf2` filename from the download URL (fallback included). */
export function fileNameFromUrl(url: string): string {
  let name = ''
  try {
    name = basename(new URL(url).pathname)
  } catch {
    name = ''
  }
  // Strip query junk and keep it a plausible .uf2 name.
  name = name.split('?')[0]
  if (!name || !name.toLowerCase().endsWith('.uf2')) {
    name = `micropython-${Date.now()}.uf2`
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
 * with the local temp path. Throws (with the temp file cleaned up) on a non-OK
 * response, a missing body, or a stream error.
 */
export async function downloadUf2(url: string, emit: Emit): Promise<string> {
  emit({ kind: 'log', message: `Downloading ${url}`, percent: 0 })

  const res = await fetch(url, { headers: { Accept: 'application/octet-stream' } })
  if (!res.ok) {
    throw new Error(`Download failed (HTTP ${res.status}).`)
  }
  if (!res.body) {
    throw new Error('Download failed: empty response body.')
  }

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
    await unlink(dest).catch(() => {})
    throw err instanceof Error ? err : new Error(String(err))
  }

  emit({ kind: 'log', message: `Downloaded ${basename(dest)}`, percent: 100 })
  return dest
}

/**
 * Download a catalog `.uf2` to a temp file then flash it onto the selected boot
 * drive, producing a single combined progress stream (download %, copy %,
 * `done`). The temp file is removed afterwards. Always emits a terminal `done`
 * (delegated to {@link flash} on success; emitted here if the download fails).
 */
export async function downloadAndFlash(
  opts: DownloadAndFlashOptions,
  emit: Emit
): Promise<FlashResult> {
  let tempPath: string
  try {
    tempPath = await downloadUf2(opts.url, emit)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    emit({ kind: 'error', message: msg })
    emit({ kind: 'done', ok: false, message: msg })
    return { ok: false, error: msg }
  }

  try {
    // `flash` validates the file, copies it, and emits the terminal `done`.
    return await flash(
      { board: opts.board, firmwarePath: tempPath, mountPath: opts.mountPath },
      emit
    )
  } finally {
    await unlink(tempPath).catch(() => {})
  }
}
