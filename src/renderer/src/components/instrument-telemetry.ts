/**
 * INSTRUMENT TELEMETRY — pure, DOM-free parser for the on-device instruments
 * library's serial protocol (issue #107).
 * =============================================================================
 *
 * The board-side `micropython/instruments.py` library prints ONE reading per
 * line, prefixed with the sentinel token `SNK`, so a running program can feed
 * the IDE's Oscilloscope / Multimeter / Plotter live and NON-INVASIVELY — the
 * IDE parses the broadcast serial stream (exactly like the Plotter already
 * does) instead of polling the board over the raw REPL.
 *
 * The protocol (one line per `print()`, ASCII, space-delimited):
 *
 *   SNK SCOPE <ch> <value>            → a scope sample (value: float)
 *   SNK METER <ch> <value> [<unit>]   → a meter reading (default unit "V")
 *   SNK PLOT  <tok> [<tok> ...]       → plotter data, each tok name=value | number
 *   SNK IMU   <ch> <roll> <pitch> <yaw>       → Euler-angle orientation (deg)
 *   SNK IMUQ  <ch> <w> <x> <y> <z>            → quaternion orientation
 *   SNK DIST  <ch> <mm> [<angle>]             → a range reading (mm, optional deg)
 *   SNK BTN   <name> <0|1>                    → a button up/down event
 *   SNK ENC   <ch> <count> [<0|1>]            → an encoder count (+ optional press)
 *   SNK SCR   <addr> text <row> [<row> ...]   → a text screen (rows are `_`-joined)
 *   SNK SCR   <addr> fb <w> <h> <enc> <data>  → a framebuffer (base64/rle packed)
 *   SNK I2C   <addr> [<addr> ...]             → an I²C bus scan result set
 *   SNK WIFI  <ssid> <rssi> <ch> <sec>        → one Wi-Fi network (one line each)
 *   SNK BT    <name> <mac> <rssi>             → one Bluetooth device (one line each)
 *   SNK READY <caps ...>                      → the background service is alive
 *
 * `<ch>` is a user label (e.g. `pwm`, `adc0`, a variable name) used to match a
 * reading to an open instrument.
 *
 * This module mirrors {@link ./Plotter.parse} / {@link ./board-values}: kept
 * React/DOM-free so it is unit-testable in plain node, and NOTHING here throws —
 * a malformed or non-telemetry line simply yields `null`. The `PLOT` payload is
 * parsed with the Plotter's own {@link parseLine} token grammar so the two
 * stay consistent.
 */

import { parseLine } from './Plotter.parse'

/** The leading token that marks a line as instruments telemetry. */
export const TELEMETRY_SENTINEL = 'SNK'

/** A single labelled value inside a `PLOT` row (mirrors the Plotter series). */
export interface TelemetrySeries {
  /** The series label, or a 1-based positional name for a bare number. */
  label: string
  value: number
}

/** A parsed telemetry reading. The shape depends on `kind`. */
export interface ScopeTelemetry {
  kind: 'scope'
  /** The user channel label (matches an open instrument's source). */
  ch: string
  value: number
}
export interface MeterTelemetry {
  kind: 'meter'
  ch: string
  value: number
  /** The unit string (defaults to `V` when the line omits it). */
  unit: string
}
export interface PlotTelemetry {
  kind: 'plot'
  /** The parsed series for this row (bare numbers get positional labels). */
  series: TelemetrySeries[]
}
/** Euler-angle orientation from an IMU (degrees), e.g. for a 3-D attitude view. */
export interface ImuTelemetry {
  kind: 'imu'
  ch: string
  roll: number
  pitch: number
  yaw: number
}
/** Quaternion orientation from an IMU (drift-free, gimbal-lock-free). */
export interface ImuQuatTelemetry {
  kind: 'imuq'
  ch: string
  w: number
  x: number
  y: number
  z: number
}
/** A range/distance reading in mm, with an optional servo/lidar bearing (deg). */
export interface DistanceTelemetry {
  kind: 'dist'
  ch: string
  mm: number
  /** Bearing in degrees when the sensor sweeps, else `undefined`. */
  angle?: number
}
/** A momentary button event: pressed (`true`) or released (`false`). */
export interface ButtonTelemetry {
  kind: 'btn'
  /** The button's logical name (the routing label here, not a channel). */
  name: string
  pressed: boolean
}
/** A rotary-encoder reading: a running count and an optional push-switch state. */
export interface EncoderTelemetry {
  kind: 'enc'
  ch: string
  count: number
  /** The integrated push switch, when the encoder has one; else `undefined`. */
  pressed?: boolean
}
/**
 * A small display's contents. Either text `rows` (each row a string) or a packed
 * `framebuffer` (a monochrome bitmap, `w`×`h`, `encoding`-packed `data`).
 */
export interface ScreenTelemetry {
  kind: 'scr'
  /** The bus address label (e.g. `0x3C` for a common SSD1306 OLED). */
  addr: string
  /** Text rows when the device sent `text`; `undefined` for a framebuffer. */
  rows?: string[]
  /** The packed framebuffer when the device sent `fb`; `undefined` for text. */
  framebuffer?: { w: number; h: number; encoding: string; data: string }
}
/** An I²C bus scan result: every responding address (as printed, e.g. `0x3C`). */
export interface I2cTelemetry {
  kind: 'i2c'
  addrs: string[]
}
/** One Wi-Fi network from a scan (one `SNK WIFI …` line per network). */
export interface WifiTelemetry {
  kind: 'wifi'
  ssid: string
  rssi: number
  channel: number
  /** The security/auth mode token (e.g. `WPA2`, `OPEN`). */
  security: string
}
/** One Bluetooth device from a scan (one `SNK BT …` line per device). */
export interface BluetoothTelemetry {
  kind: 'bt'
  name: string
  /** The device MAC/address as printed (colon-separated hex, or `?`). */
  mac: string
  rssi: number
}
/**
 * A presence/readiness announcement from the on-device `snakie` background
 * service (`SNK READY <caps...>`). The IDE listens for it to know a Snakie
 * program is running and servicing the control channel — so e.g. a SCAN button
 * can drive it directly instead of asking the user to run a program.
 */
export interface ReadyTelemetry {
  kind: 'ready'
  /** Capability tokens the program services (e.g. `scan:wifi`, `teleop`). */
  caps: string[]
}

export type Telemetry =
  | ScopeTelemetry
  | MeterTelemetry
  | PlotTelemetry
  | ImuTelemetry
  | ImuQuatTelemetry
  | DistanceTelemetry
  | ButtonTelemetry
  | EncoderTelemetry
  | ScreenTelemetry
  | I2cTelemetry
  | WifiTelemetry
  | BluetoothTelemetry
  | ReadyTelemetry

/**
 * Is `line` an instruments-telemetry line? True when its first whitespace token
 * is the sentinel, so the Terminal can cheaply hide these and the Plotter can
 * skip its generic parse for them. Tolerates leading whitespace; an embedded
 * `SNK` later in the line (e.g. inside other output) does NOT count.
 */
export function isTelemetry(line: string): boolean {
  if (!line) return false
  const trimmed = line.trimStart()
  return trimmed === TELEMETRY_SENTINEL || trimmed.startsWith(`${TELEMETRY_SENTINEL} `)
}

/**
 * Parse one already-de-newlined line of telemetry. Returns the typed reading,
 * or `null` for a non-`SNK` line or a malformed/unknown one (so the caller can
 * fall through to its normal handling). Never throws.
 *
 *   - `SNK SCOPE <ch> <value>`            → `{ kind:'scope', ch, value }`
 *   - `SNK METER <ch> <value> [<unit>]`   → `{ kind:'meter', ch, value, unit }`
 *   - `SNK PLOT <tok> ...`                → `{ kind:'plot', series:[…] }`
 *   - `SNK IMU <ch> <r> <p> <y>`          → `{ kind:'imu', ch, roll, pitch, yaw }`
 *   - `SNK IMUQ <ch> <w> <x> <y> <z>`     → `{ kind:'imuq', ch, w, x, y, z }`
 *   - `SNK DIST <ch> <mm> [<angle>]`      → `{ kind:'dist', ch, mm, angle? }`
 *   - `SNK BTN <name> <0|1>`              → `{ kind:'btn', name, pressed }`
 *   - `SNK ENC <ch> <count> [<0|1>]`      → `{ kind:'enc', ch, count, pressed? }`
 *   - `SNK SCR <addr> text|fb …`          → `{ kind:'scr', addr, rows?|framebuffer? }`
 *   - `SNK I2C <addr> …`                  → `{ kind:'i2c', addrs:[…] }`
 *   - `SNK WIFI <ssid> <rssi> <ch> <sec>` → `{ kind:'wifi', ssid, rssi, channel, security }`
 *   - `SNK BT <name> <mac> <rssi>`        → `{ kind:'bt', name, mac, rssi }`
 */
export function parseTelemetry(line: string): Telemetry | null {
  if (!isTelemetry(line)) return null
  // Split on runs of whitespace; the first token is the sentinel.
  const parts = line.trim().split(/\s+/)
  // parts[0] === SENTINEL (guaranteed by isTelemetry); parts[1] is the kind.
  const kind = parts[1]

  if (kind === 'SCOPE') {
    // SNK SCOPE <ch> <value>
    const ch = parts[2]
    const value = Number(parts[3])
    if (!ch || !Number.isFinite(value)) return null
    return { kind: 'scope', ch, value }
  }

  if (kind === 'METER') {
    // SNK METER <ch> <value> [<unit>]
    const ch = parts[2]
    const value = Number(parts[3])
    if (!ch || !Number.isFinite(value)) return null
    const unit = parts[4] ?? 'V'
    return { kind: 'meter', ch, value, unit }
  }

  if (kind === 'PLOT') {
    // SNK PLOT <tok> [<tok> ...] — reuse the Plotter's token grammar on the
    // payload (everything after `SNK PLOT`).
    const payload = parts.slice(2).join(' ')
    const parsed = parseLine(payload)
    if (parsed.length === 0) return null
    let positional = 0
    const series: TelemetrySeries[] = parsed.map(({ label, value }) => ({
      label: label ?? `series ${++positional}`,
      value
    }))
    return { kind: 'plot', series }
  }

  if (kind === 'IMU') {
    // SNK IMU <ch> <roll> <pitch> <yaw>
    const ch = parts[2]
    const roll = Number(parts[3])
    const pitch = Number(parts[4])
    const yaw = Number(parts[5])
    if (!ch || !Number.isFinite(roll) || !Number.isFinite(pitch) || !Number.isFinite(yaw)) {
      return null
    }
    return { kind: 'imu', ch, roll, pitch, yaw }
  }

  if (kind === 'IMUQ') {
    // SNK IMUQ <ch> <w> <x> <y> <z>
    const ch = parts[2]
    const w = Number(parts[3])
    const x = Number(parts[4])
    const y = Number(parts[5])
    const z = Number(parts[6])
    if (!ch || ![w, x, y, z].every(Number.isFinite)) return null
    return { kind: 'imuq', ch, w, x, y, z }
  }

  if (kind === 'DIST') {
    // SNK DIST <ch> <mm> [<angle>]
    const ch = parts[2]
    const mm = Number(parts[3])
    if (!ch || !Number.isFinite(mm)) return null
    const out: DistanceTelemetry = { kind: 'dist', ch, mm }
    if (parts[4] !== undefined) {
      const angle = Number(parts[4])
      if (Number.isFinite(angle)) out.angle = angle
    }
    return out
  }

  if (kind === 'BTN') {
    // SNK BTN <name> <0|1>
    const name = parts[2]
    const raw = parts[3]
    if (!name || (raw !== '0' && raw !== '1')) return null
    return { kind: 'btn', name, pressed: raw === '1' }
  }

  if (kind === 'ENC') {
    // SNK ENC <ch> <count> [<0|1>]
    const ch = parts[2]
    const count = Number(parts[3])
    if (!ch || !Number.isFinite(count)) return null
    const out: EncoderTelemetry = { kind: 'enc', ch, count }
    if (parts[4] === '0' || parts[4] === '1') out.pressed = parts[4] === '1'
    return out
  }

  if (kind === 'SCR') {
    // SNK SCR <addr> text <row> [<row> ...]   (each row is `_`-joined for spaces)
    // SNK SCR <addr> fb <w> <h> <encoding> <data>
    const addr = parts[2]
    const mode = parts[3]
    if (!addr) return null
    if (mode === 'text') {
      // Each remaining token is one row; underscores stand in for spaces so a
      // row stays a single ASCII token on the wire.
      const rows = parts.slice(4).map((r) => r.replace(/_/g, ' '))
      return { kind: 'scr', addr, rows }
    }
    if (mode === 'fb') {
      const w = Number(parts[4])
      const h = Number(parts[5])
      const encoding = parts[6]
      const data = parts[7]
      if (!Number.isFinite(w) || !Number.isFinite(h) || !encoding || data === undefined) {
        return null
      }
      return { kind: 'scr', addr, framebuffer: { w, h, encoding, data } }
    }
    return null
  }

  if (kind === 'I2C') {
    // SNK I2C <addr> [<addr> ...] — a scan result set (possibly empty).
    return { kind: 'i2c', addrs: parts.slice(2) }
  }

  if (kind === 'WIFI') {
    // SNK WIFI <ssid> <rssi> <ch> <sec> — one network. SSID spaces are `_`-coded.
    const ssid = parts[2]
    const rssi = Number(parts[3])
    const channel = Number(parts[4])
    const security = parts[5]
    if (!ssid || !Number.isFinite(rssi) || !Number.isFinite(channel) || !security) return null
    return { kind: 'wifi', ssid: ssid.replace(/_/g, ' '), rssi, channel, security }
  }

  if (kind === 'BT') {
    // SNK BT <name> <mac> <rssi> — one device. Name spaces are `_`-coded.
    const name = parts[2]
    const mac = parts[3]
    const rssi = Number(parts[4])
    if (!name || !mac || !Number.isFinite(rssi)) return null
    return { kind: 'bt', name: name.replace(/_/g, ' '), mac, rssi }
  }

  if (kind === 'READY') {
    // SNK READY <caps...> — a presence/readiness heartbeat (caps may be empty).
    return { kind: 'ready', caps: parts.slice(2) }
  }

  // Unknown SNK sub-command — ignore it (still hidden from the console because
  // isTelemetry is true, but produces no instrument data).
  return null
}
