/**
 * SCANNER LOGIC (#121) — pure, DOM-free view logic for the three on-demand
 * scanner instruments (I²C detect, Wi-Fi scan, Bluetooth scan).
 * =============================================================================
 *
 * The scanner panels are thin: a SCAN button kicks an on-device scan over the
 * control channel (`SNKCMD scan:i2c` / `scan:wifi` / `scan:bt`), and the results
 * arrive back as already-parsed {@link Telemetry} readings on the broadcast
 * serial stream (the shared `instrument-telemetry` parser already decodes the
 * board's `SNK I2C` / `SNK WIFI` / `SNK BT` lines into `I2cTelemetry` /
 * `WifiTelemetry` / `BluetoothTelemetry`). Everything visual the panels need —
 * mapping an I²C address to a grid cell, an RSSI to signal bars, a channel to a
 * Wi-Fi band, picking the strongest network / nearest device, and deduping the
 * accumulated result lists — is here, framework-free, so it is unit-testable in
 * plain node exactly like `parse-pins.ts` / `instrument-host.ts`.
 *
 * Nothing here throws or touches the DOM; the panels keep their own tiny React
 * state (the accumulating list + the "scanning" flag) and call into these helpers
 * to render. Re-exports the three scanner telemetry types so the panels (and the
 * tests) import one scanner-local module.
 */

import type {
  BluetoothTelemetry,
  I2cTelemetry,
  WifiTelemetry
} from './instrument-telemetry'

export type { BluetoothTelemetry, I2cTelemetry, WifiTelemetry }

// ── I²C address grid ─────────────────────────────────────────────────────────
//
// The classic `i2cdetect` grid is 8 rows × 16 columns: rows are the high nibble
// (0x00, 0x10, … 0x70) and columns the low nibble (0x0 … 0xF), so the cell at
// (row r, col c) is the 7-bit address `r*16 + c`. (7-bit addressing tops out at
// 0x77, but the grid is drawn full-width to row 0x70 like the CLI tool.)

/** The number of rows in the i2cdetect grid (high nibble 0x00–0x70). */
export const I2C_GRID_ROWS = 8
/** The number of columns in the i2cdetect grid (low nibble 0x0–0xF). */
export const I2C_GRID_COLS = 16

/** A row/column coordinate in the i2cdetect grid. */
export interface GridCell {
  row: number
  col: number
}

/**
 * Parse an I²C address string (`'0x3C'`, `'0X3c'`, `'60'`, `60`) to its numeric
 * value, or `null` when it isn't a valid 0–127 7-bit address. Tolerates a `0x`
 * prefix (hex) OR a bare decimal/hex digit string; whitespace is trimmed. The
 * board prints addresses as `0x%02X`, so the common case is `'0x3C'`.
 */
export function parseI2cAddr(addr: string | number): number | null {
  if (typeof addr === 'number') {
    return Number.isInteger(addr) && addr >= 0 && addr <= 0x7f ? addr : null
  }
  const s = addr.trim()
  if (!s) return null
  // `0x..`/`0X..` → hex; otherwise the board only ever prints hex, but accept a
  // bare token as hex too (the grid never sees decimals from the wire).
  const value = /^0x/i.test(s) ? Number.parseInt(s.slice(2), 16) : Number.parseInt(s, 16)
  if (!Number.isFinite(value) || value < 0 || value > 0x7f) return null
  return value
}

/** Map a numeric 7-bit address to its `{row, col}` cell in the i2cdetect grid. */
export function addrToCell(value: number): GridCell {
  return { row: Math.floor(value / I2C_GRID_COLS), col: value % I2C_GRID_COLS }
}

/** Format a 7-bit address as a 2-digit upper-case hex string (`'0x3C'`). */
export function formatI2cAddr(value: number): string {
  return `0x${value.toString(16).toUpperCase().padStart(2, '0')}`
}

/**
 * Build the membership set of detected 7-bit addresses from a telemetry result.
 * Invalid / out-of-range tokens are dropped (the wire is trusted but never
 * trusted to throw). The set holds NUMBERS so the grid model can test a cell in
 * O(1).
 */
export function detectedSet(addrs: Array<string | number>): Set<number> {
  const set = new Set<number>()
  for (const a of addrs) {
    const v = parseI2cAddr(a)
    if (v !== null) set.add(v)
  }
  return set
}

/** One built cell of the i2cdetect grid model. */
export interface I2cGridCell extends GridCell {
  /** The 7-bit address this cell represents. */
  addr: number
  /** The address as `0x..` hex (the cell title / glow label). */
  label: string
  /** Whether a device responded at this address (glow the accent). */
  detected: boolean
}

/** The full i2cdetect grid model: 8 rows of 16 cells, each flagged detected. */
export interface I2cGridModel {
  rows: I2cGridCell[][]
  /** The detected addresses (sorted ascending) — drives FOUND / readout. */
  found: number[]
}

/**
 * Build the 8×16 i2cdetect grid model from the scan's address list. Every cell is
 * materialised (so the grid always draws full) with its address, hex label and a
 * `detected` flag set from the membership of the parsed address set. `found` is
 * the sorted list of detected addresses for the readout strip. Pure.
 */
export function buildI2cGrid(addrs: Array<string | number>): I2cGridModel {
  const detected = detectedSet(addrs)
  const rows: I2cGridCell[][] = []
  for (let r = 0; r < I2C_GRID_ROWS; r++) {
    const row: I2cGridCell[] = []
    for (let c = 0; c < I2C_GRID_COLS; c++) {
      const addr = r * I2C_GRID_COLS + c
      row.push({ row: r, col: c, addr, label: formatI2cAddr(addr), detected: detected.has(addr) })
    }
    rows.push(row)
  }
  return { rows, found: [...detected].sort((a, b) => a - b) }
}

// ── Signal strength (RSSI) ───────────────────────────────────────────────────

/** The number of signal bars rendered for a Wi-Fi / BLE entry (0–4). */
export const MAX_SIGNAL_BARS = 4

/**
 * Map an RSSI in dBm to a 0–4 signal-bar count, using the common Wi-Fi
 * thresholds (≥ −55 excellent → 4, ≥ −67 good → 3, ≥ −78 fair → 2, ≥ −90 weak
 * → 1, below → 0). A non-finite RSSI reads as no signal (0). Monotonic: a
 * stronger (less negative) RSSI never yields fewer bars.
 */
export function rssiToBars(rssi: number): number {
  if (!Number.isFinite(rssi)) return 0
  if (rssi >= -55) return 4
  if (rssi >= -67) return 3
  if (rssi >= -78) return 2
  if (rssi >= -90) return 1
  return 0
}

// ── Wi-Fi ────────────────────────────────────────────────────────────────────

/** A Wi-Fi frequency band derived from the channel number. */
export type WifiBand = '2.4 GHz' | '5 GHz' | '—'

/**
 * Derive the Wi-Fi band from a channel number: channels 1–14 are 2.4 GHz, 32+
 * (the 5 GHz U-NII channels, e.g. 36/40/…/165) are 5 GHz. An out-of-range /
 * non-finite channel yields `'—'` (unknown). Pure.
 */
export function wifiBand(channel: number): WifiBand {
  if (!Number.isFinite(channel)) return '—'
  if (channel >= 1 && channel <= 14) return '2.4 GHz'
  if (channel >= 32 && channel <= 196) return '5 GHz'
  return '—'
}

/**
 * Accumulate a Wi-Fi network into a list, deduping by SSID: a repeat SSID
 * REPLACES the existing entry when the new reading is stronger (a closer/better
 * sample wins), else keeps the existing one. Returns a NEW array (insertion order
 * preserved; a replaced entry keeps its slot). An empty SSID (a hidden network)
 * is kept distinct under the empty key so hidden networks don't all collapse —
 * but multiple hidden ones still dedupe to the strongest, matching the named
 * case. Pure.
 */
export function addWifi(list: WifiTelemetry[], net: WifiTelemetry): WifiTelemetry[] {
  const idx = list.findIndex((n) => n.ssid === net.ssid)
  if (idx === -1) return [...list, net]
  if (net.rssi > list[idx].rssi) {
    const next = list.slice()
    next[idx] = net
    return next
  }
  return list
}

/** The strongest (max-RSSI) network in a list, or `undefined` when empty. */
export function bestWifi(list: WifiTelemetry[]): WifiTelemetry | undefined {
  if (list.length === 0) return undefined
  return list.reduce((best, n) => (n.rssi > best.rssi ? n : best))
}

/**
 * The dominant band across the scanned networks (the band of the strongest
 * network), or `'—'` when nothing has been seen — drives the BAND readout.
 */
export function dominantBand(list: WifiTelemetry[]): WifiBand {
  const best = bestWifi(list)
  return best ? wifiBand(best.channel) : '—'
}

/** A display label for a network's SSID (hidden networks read `‹hidden›`). */
export function ssidLabel(ssid: string): string {
  return ssid.trim() === '' ? '‹hidden›' : ssid
}

// ── Bluetooth ────────────────────────────────────────────────────────────────

/**
 * Accumulate a BLE device into a list, deduping by MAC: a repeat MAC REPLACES the
 * existing entry when the new reading is stronger (nearer), else keeps it.
 * Returns a NEW array (insertion order preserved). A `?`/empty MAC is treated as
 * one unknown bucket. Pure — mirrors {@link addWifi}.
 */
export function addBt(list: BluetoothTelemetry[], dev: BluetoothTelemetry): BluetoothTelemetry[] {
  const idx = list.findIndex((d) => d.mac === dev.mac)
  if (idx === -1) return [...list, dev]
  if (dev.rssi > list[idx].rssi) {
    const next = list.slice()
    next[idx] = dev
    return next
  }
  return list
}

/** The nearest (max-RSSI) BLE device in a list, or `undefined` when empty. */
export function nearestBt(list: BluetoothTelemetry[]): BluetoothTelemetry | undefined {
  if (list.length === 0) return undefined
  return list.reduce((near, d) => (d.rssi > near.rssi ? d : near))
}

/** A display label for a BLE device's name (missing names read `‹unknown›`). */
export function btNameLabel(name: string): string {
  const n = name.trim()
  return n === '' || n === '?' ? '‹unknown›' : n
}

// ── Sorting helpers (strongest-first list ordering) ──────────────────────────

/** Networks sorted strongest-first (stable for equal RSSI). Returns a new array. */
export function sortWifiByStrength(list: WifiTelemetry[]): WifiTelemetry[] {
  return list
    .map((n, i) => ({ n, i }))
    .sort((a, b) => b.n.rssi - a.n.rssi || a.i - b.i)
    .map(({ n }) => n)
}

/** Devices sorted nearest-first (stable for equal RSSI). Returns a new array. */
export function sortBtByStrength(list: BluetoothTelemetry[]): BluetoothTelemetry[] {
  return list
    .map((d, i) => ({ d, i }))
    .sort((a, b) => b.d.rssi - a.d.rssi || a.i - b.i)
    .map(({ d }) => d)
}
