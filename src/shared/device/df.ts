/**
 * Flash-usage query (issue #211) — shared between the Electron
 * `device:df` IPC handler (`src/main/device/ipc.ts`) and the web
 * `WorkerDeviceClient.df()` implementation. There's no dedicated device-level
 * `df` API (real boards, the Electron sim, and the web sim all only expose
 * `exec`), so both backends run this snippet over `exec()` and parse the
 * `SNKDF <total> <free>` sentinel it prints. A board that can't `statvfs`
 * (or replies with something non-numeric) yields `null` so the UI's disk
 * gauge just hides.
 */

/** Snippet run over `exec()` to report `os.statvfs('/')` in bytes. */
export const DF_SNIPPET = [
  'import os',
  'try:',
  '    _s = os.statvfs("/")',
  '    print("SNKDF", _s[0] * _s[2], _s[0] * _s[3])',
  'except Exception:',
  '    print("SNKDF -1 -1")'
].join('\n')

export interface DfResult {
  total: number
  free: number
  used: number
}

/** Parse the `SNKDF <total> <free>` line out of `exec()`'s stdout. */
export function parseDfOutput(stdout: string | undefined): DfResult | null {
  const m = /SNKDF\s+(-?\d+)\s+(-?\d+)/.exec(stdout ?? '')
  if (!m) return null
  const total = Number(m[1])
  const free = Number(m[2])
  if (!Number.isFinite(total) || total <= 0) return null
  const clampedFree = Math.max(0, Math.min(free, total))
  return { total, free: clampedFree, used: total - clampedFree }
}
