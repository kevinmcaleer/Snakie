/**
 * Disk-usage helpers (#211) — pure, DOM-free formatting for the device files
 * panel's flash gauge. The board reports `os.statvfs('/')` as total/free/used
 * BYTES (via `window.api.device.df()`); this turns that into a percentage + a
 * compact human label. Unit-testable, never throws.
 */

export interface DiskUsage {
  total: number
  free: number
  used: number
}

/** Used space as a whole percentage (0..100), clamped. `0` for a bad/empty df. */
export function usedPct(df: DiskUsage | null | undefined): number {
  if (!df || !Number.isFinite(df.total) || df.total <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((df.used / df.total) * 100)))
}

/**
 * Compact byte size: `B` under 1 KiB, else `KB`/`MB` (1024-based) with one decimal
 * under 10 and rounded above. `—` for a non-finite/negative input.
 */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n < 1024) return `${Math.round(n)} B`
  const kb = n / 1024
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`
  const mb = kb / 1024
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
}

/** A one-line "used / total" summary, e.g. `120 KB / 1.4 MB`. */
export function usageLabel(df: DiskUsage | null | undefined): string {
  if (!df || df.total <= 0) return ''
  return `${formatBytes(df.used)} / ${formatBytes(df.total)}`
}
