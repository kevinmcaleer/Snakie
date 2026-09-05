import { ipcMain, app } from 'electron'
import { join } from 'path'
import { promises as fsp } from 'fs'
import { BOARD_INDEX_URL } from '../../shared/board-index'
import type { IpcResult } from '../device/types'

/**
 * Fetching the published board index (#893).
 * =============================================================================
 *
 * All network access lives in main — the renderer's CSP forbids outbound
 * requests — mirroring the parts registry (#129), which this is deliberately
 * shaped like: a JSON document in a GitHub repo, administered by PRs against it.
 *
 * The renderer already has a complete BUNDLED copy served as a static asset, so
 * nothing here is on the critical path. This only ever supplies "newer than what
 * shipped", and every failure resolves to null so the caller keeps the seed:
 * offline, a repo that does not exist yet, a rate limit, a malformed body.
 *
 * The last good body is cached under `userData` so a machine that is offline
 * today still gets the document it fetched last week, rather than falling all
 * the way back to whatever the installer happened to contain.
 */

/** Bound the request so a stalled host cannot hang the IPC call. */
const TIMEOUT_MS = 8000

/** Refuse a body far larger than any plausible index (the real one is ~250 KB). */
const MAX_BYTES = 8 * 1024 * 1024

function cachePath(): string {
  return join(app.getPath('userData'), 'boards-index.json')
}

async function readCache(): Promise<unknown | null> {
  try {
    return JSON.parse(await fsp.readFile(cachePath(), 'utf8'))
  } catch {
    return null
  }
}

async function writeCache(body: string): Promise<void> {
  try {
    await fsp.writeFile(cachePath(), body, 'utf8')
  } catch {
    // A cache that cannot be written is a slower next launch, nothing worse.
  }
}

/**
 * The published index, or the last one we cached, or null.
 *
 * Parsing and schema checking happen in the RENDERER, against
 * `shared/board-index`, so the rules live in one place and are unit-tested
 * there. This returns the raw body and does not pretend to understand it.
 */
async function fetchIndex(url: string = BOARD_INDEX_URL): Promise<unknown | null> {
  const signal = AbortSignal.timeout(TIMEOUT_MS)
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal })
    if (!res.ok) return readCache()
    const length = Number(res.headers.get('content-length') ?? 0)
    if (length > MAX_BYTES) return readCache()
    const body = await res.text()
    if (body.length > MAX_BYTES) return readCache()
    const parsed: unknown = JSON.parse(body)
    await writeCache(body)
    return parsed
  } catch {
    // Offline, timed out, or the document is not there yet. Whatever we cached
    // last is still better than nothing, and the seed is better than both if it
    // happens to be newer — the renderer decides that.
    return readCache()
  }
}

async function wrap<T>(fn: () => Promise<T>): Promise<IpcResult<T>> {
  try {
    return { ok: true, value: await fn() }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Register the `boards:*` handlers. Call once, after the app is ready. */
export function registerBoardsIpc(): void {
  ipcMain.handle('boards:fetchIndex', () => wrap<unknown | null>(() => fetchIndex()))
}
