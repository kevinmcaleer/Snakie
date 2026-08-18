/**
 * RUNTIME DIALECT — which Python is actually on the board (#752, epic #209).
 * =============================================================================
 *
 * Snakie was built assuming MicroPython everywhere: the connect banner is
 * rebuilt from `os.uname()`, the status bar says "MicroPython", the flash button
 * offers MicroPython firmware. CircuitPython speaks the same raw-REPL protocol
 * but differs in ways that reach almost every layer — a read-only filesystem, a
 * `code.py` that auto-runs, a different package mechanism, and `board` +
 * `digitalio` instead of `machine`.
 *
 * Rather than have each of those layers sniff for itself, the device session
 * carries ONE {@link RuntimeInfo}, probed on connect, and everything else reads
 * it. This module is the pure half of that: the probe snippet, the parsers, and
 * the labels. Dependency-free (the same discipline as `control.ts`) so main,
 * preload and renderer can all import it, and so the parsing is unit-testable
 * without a board.
 *
 * There are three places a runtime identifies itself, in descending order of
 * how much we trust them:
 *
 *  1. **`sys.implementation`** — the machine-readable answer, and the only one
 *     guaranteed to exist. `.name` is `'micropython'` / `'circuitpython'`.
 *  2. **`os.uname()`** — carries the build date and the board string that make
 *     the banner read like the board's own. Deprecated on CircuitPython, so it
 *     is asked for but never required.
 *  3. **`boot_out.txt`** — written to the CIRCUITPY drive at boot. Names the
 *     version AND the Board ID with no serial connection at all, which is what
 *     makes drive-only identification possible (#753).
 */

/** Which Python implementation a connected board is running. */
export type Dialect = 'micropython' | 'circuitpython' | 'unknown'

/** What a board told us about itself. Every field but `dialect` is best-effort. */
export interface RuntimeInfo {
  dialect: Dialect
  /** Dotted version, no leading `v` and no build date — `'1.28.0'`, `'10.2.1'`. */
  version?: string
  /** The board string, as the runtime names it (`'Raspberry Pi Pico with RP2040'`). */
  machine?: string
  /** CircuitPython's per-board build id from `boot_out.txt` (`'adafruit_feather_rp2040'`). */
  boardId?: string
  /** The build date the runtime reports (`'2026-08-18'`), when it gives one. */
  buildDate?: string
}

/** How each dialect is named in the UI. */
export const DIALECT_LABEL: Record<Dialect, string> = {
  micropython: 'MicroPython',
  circuitpython: 'CircuitPython',
  unknown: 'Unknown runtime'
}

/**
 * The line prefixes the probe prints. Distinct sentinels rather than one packed
 * line because {@link RuntimeInfo.machine} contains spaces ("Raspberry Pi Pico
 * with RP2040") and would need quoting otherwise.
 */
const P_NAME = 'SNKIMPL '
const P_VERSION = 'SNKVER '
const P_MACHINE = 'SNKMACH '

/**
 * Ask the board what it is. Run through the raw REPL on connect; parse the
 * stdout with {@link parseRuntimeProbe}.
 *
 * `sys.implementation` is the load-bearing part and is asked for first, so a
 * board whose `os` module is unusual still yields a dialect. `os.uname()` only
 * enriches: on MicroPython its `.version` is `'1.28.0 on 2026-01-01'` (the
 * banner tail), which is where the build date comes from. Everything is wrapped
 * so a missing attribute degrades to an empty line rather than a traceback.
 */
export const RUNTIME_PROBE_PY = [
  'import sys as _s',
  "_n=getattr(_s.implementation,'name','')",
  "_v='.'.join(str(x) for x in getattr(_s.implementation,'version',()))",
  "_m=''",
  'try:',
  ' import os as _o',
  ' _u=_o.uname()',
  " _v=getattr(_u,'version','') or _v",
  " _m=getattr(_u,'machine','')",
  'except Exception:',
  " _m=getattr(_s.implementation,'_machine','')",
  `print(${JSON.stringify(P_NAME)}+_n)`,
  `print(${JSON.stringify(P_VERSION)}+_v)`,
  `print(${JSON.stringify(P_MACHINE)}+_m)`
].join('\n')

/** `'circuitpython'` / `'MicroPython'` / anything → a {@link Dialect}. */
export function dialectFromName(name: string): Dialect {
  const n = name.trim().toLowerCase()
  if (n === 'circuitpython') return 'circuitpython'
  if (n === 'micropython') return 'micropython'
  return 'unknown'
}

/**
 * Split a version string that may carry a build date, as `os.uname().version`
 * does on both runtimes: `'1.28.0 on 2026-01-01'` → `{ version: '1.28.0',
 * buildDate: '2026-01-01' }`. A leading `v` is dropped so versions compare
 * cleanly with `isNewerVersion`.
 */
function splitVersion(raw: string): { version?: string; buildDate?: string } {
  const trimmed = raw.trim().replace(/^v/i, '')
  if (!trimmed) return {}
  const m = /^(\S+)\s+on\s+(\S+)/.exec(trimmed)
  if (m) return { version: m[1], buildDate: m[2] }
  return { version: trimmed.split(/\s+/)[0] }
}

/** Drop empty fields so a `RuntimeInfo` never carries `undefined`-ish blanks. */
function compact(info: RuntimeInfo): RuntimeInfo {
  const out: RuntimeInfo = { dialect: info.dialect }
  if (info.version) out.version = info.version
  if (info.machine) out.machine = info.machine
  if (info.boardId) out.boardId = info.boardId
  if (info.buildDate) out.buildDate = info.buildDate
  return out
}

/**
 * Parse the stdout of {@link RUNTIME_PROBE_PY}. Returns `null` when the output
 * carries no name line at all — an old or unusual board that answered nothing
 * useful, which the caller treats as "keep the previous behaviour" rather than
 * as an error.
 */
export function parseRuntimeProbe(stdout: string): RuntimeInfo | null {
  let name: string | null = null
  let version = ''
  let machine = ''
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith(P_NAME)) name = line.slice(P_NAME.length).trim()
    else if (line.startsWith(P_VERSION)) version = line.slice(P_VERSION.length).trim()
    else if (line.startsWith(P_MACHINE)) machine = line.slice(P_MACHINE.length).trim()
  }
  if (name === null) return null
  return compact({ dialect: dialectFromName(name), machine, ...splitVersion(version) })
}

/**
 * Parse a runtime's own boot banner — the line a board prints on reset, and the
 * line `boot_out.txt` opens with:
 *
 *   `MicroPython v1.28.0 on 2026-01-01; Raspberry Pi Pico with RP2040`
 *   `Adafruit CircuitPython 10.2.1 on 2026-08-18; Adafruit Feather RP2040 with rp2040`
 *
 * Returns `null` for a line that names neither runtime, so a caller can scan a
 * console buffer with it.
 */
export function parseRuntimeBanner(line: string): RuntimeInfo | null {
  const m = /(Adafruit\s+CircuitPython|MicroPython)\s+(\S+)(?:\s+on\s+(\S+?))?\s*(?:;\s*(.*))?$/i.exec(
    line.trim()
  )
  if (!m) return null
  const dialect: Dialect = /circuitpython/i.test(m[1]) ? 'circuitpython' : 'micropython'
  return compact({
    dialect,
    version: m[2].replace(/^v/i, '').replace(/;$/, ''),
    buildDate: m[3]?.replace(/;$/, ''),
    machine: m[4]?.trim()
  })
}

/**
 * Parse a CIRCUITPY drive's `boot_out.txt` (#753 reads this without connecting):
 *
 *   Adafruit CircuitPython 10.2.1 on 2026-08-18; Adafruit Feather RP2040 with rp2040
 *   Board ID:adafruit_feather_rp2040
 *   UID:E661640843373E2A
 *
 * The Board ID is what makes a firmware-update check precise (#757), because
 * CircuitPython builds are per-board rather than per-chip.
 */
export function parseBootOut(text: string): RuntimeInfo | null {
  let info: RuntimeInfo | null = null
  let boardId = ''
  for (const line of text.split(/\r?\n/)) {
    if (!info) info = parseRuntimeBanner(line)
    const m = /^Board\s*ID\s*:\s*(\S+)/i.exec(line.trim())
    if (m) boardId = m[1]
  }
  if (!info) return boardId ? compact({ dialect: 'circuitpython', boardId }) : null
  return compact({ ...info, boardId })
}

/**
 * The `UID:` line `boot_out.txt` carries on CircuitPython 7 and later — the
 * board's own unique id, and the same value it reports as
 * `microcontroller.cpu.uid`.
 *
 * This is what lets a mounted drive be tied to a specific serial port WITHOUT
 * connecting to it (#753): USB exposes the same id as the port's serial number
 * on the boards that have one, so the two can be matched offline. Returns
 * `undefined` on an older board that writes no UID line, which is why the
 * pairing has a fallback.
 */
export function parseBootOutUid(text: string): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    const m = /^UID\s*:\s*([0-9A-F]+)\s*$/i.exec(line.trim())
    if (m) return m[1].toUpperCase()
  }
  return undefined
}

/**
 * Rebuild the greeting a board prints on reset, so connecting shows the same
 * line the board itself would (#612). Each runtime words its banner
 * differently — `MicroPython v1.28.0 on …` versus `Adafruit CircuitPython
 * 10.2.1 on …` — and showing a CircuitPython user the MicroPython wording would
 * be a small lie in the first thing they read.
 *
 * Returns `''` when there is nothing worth printing.
 */
export function runtimeGreeting(info: RuntimeInfo | null): string {
  if (!info || !info.version) return ''
  const name = info.dialect === 'circuitpython' ? 'Adafruit CircuitPython' : 'MicroPython'
  const version = info.dialect === 'circuitpython' ? info.version : `v${info.version}`
  const date = info.buildDate ? ` on ${info.buildDate}` : ''
  const machine = info.machine ? `; ${info.machine}` : ''
  return `${name} ${version}${date}${machine}`
}

/** Short runtime + version for the status bar — `'CircuitPython 10.2.1'`. */
export function runtimeLabel(info: RuntimeInfo | null): string {
  if (!info) return ''
  const label = DIALECT_LABEL[info.dialect]
  return info.version ? `${label} ${info.version}` : label
}
