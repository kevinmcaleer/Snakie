/**
 * INSTRUMENT DATA — pure, DOM-free helpers for the Oscilloscope (#101) and
 * Multimeter (#102) instrument windows.
 * =============================================================================
 *
 * Everything an instrument needs to turn a parsed PWM/ADC connection (and its
 * surrounding source, plus optional live device readings) into the numbers the
 * skeuomorphic UI draws — the PWM frequency/duty/period, the analog channel
 * mapping, the 12-bit→voltage conversion, the CRT square-wave path geometry, and
 * the rolling min/max/avg stats. Kept React/DOM-free (mirrors {@link ./parse-pins}
 * and {@link ./board-values}) so each piece is unit-testable in plain node.
 *
 * NONE of these throw: a missing/garbled config simply yields `undefined` fields
 * and the UI falls back to a sensible placeholder.
 */

// --- PWM frequency / duty ---------------------------------------------------

/** The PWM channel parameters pulled from a connection's constructor + source. */
export interface PwmConfig {
  /** Configured frequency in Hz, if found (`freq=` / `freq_hz=`). */
  freq?: number
  /**
   * Duty as a 0..1 fraction, if derivable. Sources, in priority order:
   *   - `duty_u16(<n>)` → n / 65535
   *   - `duty_ns(<n>)`  → n / (period_ns) when freq is known, else undefined
   *   - `duty(<n>)`     → n / 1023   (legacy 10-bit API)
   *   - `duty_u16=`/`duty=` kwargs in the constructor (same scaling)
   */
  duty?: number
}

/** Pull the first numeric argument of a `name(<num>)` call out of `text`. */
function callArg(text: string, name: string): number | undefined {
  // e.g. `duty_u16(32768)` → 32768. Tolerates spaces and an `_` digit sep.
  const re = new RegExp(`\\b${name}\\s*\\(\\s*([0-9][0-9_]*)\\s*\\)`)
  const m = text.match(re)
  if (!m) return undefined
  const n = Number(m[1].replace(/_/g, ''))
  return Number.isFinite(n) ? n : undefined
}

/** Pull a `name = <num>` keyword value out of `text`. */
function kwArg(text: string, name: string): number | undefined {
  const re = new RegExp(`\\b${name}\\s*=\\s*([0-9][0-9_]*\\.?[0-9_]*)`)
  const m = text.match(re)
  if (!m) return undefined
  const n = Number(m[1].replace(/_/g, ''))
  return Number.isFinite(n) ? n : undefined
}

/**
 * Derive the PWM frequency + duty for a connection.
 *
 * `source` is the constructor (and, ideally, the surrounding program) so that a
 * later `<var>.freq(1000)` / `<var>.duty_u16(...)` set AFTER construction is
 * still picked up — pass the whole file when you have it; the constructor alone
 * still works for the common `PWM(Pin(0), freq=1000, duty_u16=32768)` form.
 */
export function pwmConfig(source: string): PwmConfig {
  if (!source) return {}
  const cfg: PwmConfig = {}

  // FREQUENCY — `freq=` / `freq_hz=` kwargs, or a `.freq(<n>)` setter call.
  const freq = kwArg(source, 'freq') ?? kwArg(source, 'freq_hz') ?? callArg(source, 'freq')
  if (freq !== undefined && freq > 0) cfg.freq = freq

  // DUTY — prefer the explicit 16-bit form, then ns (needs freq), then legacy.
  const u16 = callArg(source, 'duty_u16') ?? kwArg(source, 'duty_u16')
  const ns = callArg(source, 'duty_ns') ?? kwArg(source, 'duty_ns')
  const legacy = callArg(source, 'duty') ?? kwArg(source, 'duty')

  if (u16 !== undefined) {
    cfg.duty = clamp01(u16 / 65535)
  } else if (ns !== undefined && cfg.freq) {
    const periodNs = 1e9 / cfg.freq
    cfg.duty = clamp01(ns / periodNs)
  } else if (legacy !== undefined) {
    // The legacy `duty()` is 0..1023 (10-bit); anything larger is treated u16.
    cfg.duty = clamp01(legacy / (legacy > 1023 ? 65535 : 1023))
  }
  return cfg
}

/** Clamp a number into [0, 1]. */
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

// --- ADC channel mapping ----------------------------------------------------

/** RP2040/RP2350 ADC channel for a GPIO pin token, or `undefined` if not analog. */
export function adcChannel(pin: string | undefined): 'ADC0' | 'ADC1' | 'ADC2' | undefined {
  if (pin === undefined) return undefined
  // Accept `26`, `GP26`, `gp26`, `Pin(26)`-stripped tokens — pull the digits.
  const m = String(pin).match(/(\d+)/)
  if (!m) return undefined
  switch (Number(m[1])) {
    case 26:
      return 'ADC0'
    case 27:
      return 'ADC1'
    case 28:
      return 'ADC2'
    default:
      return undefined
  }
}

// --- ADC voltage / raw conversion -------------------------------------------

/** Full-scale reference voltage on a Pico ADC pin. */
export const ADC_VREF = 3.3
/** ADC resolution in bits (the RP2040/RP2350 SAR ADC is 12-bit). */
export const ADC_BITS = 12
/** Max raw count for {@link ADC_BITS} (4095 for 12-bit). */
export const ADC_MAX_RAW = (1 << ADC_BITS) - 1

/** A decoded ADC sample: the 12-bit raw count and its voltage. */
export interface AdcSample {
  /** 0..4095 raw 12-bit count. */
  raw: number
  /** Voltage = (u16 / 65535) * VREF. */
  volts: number
}

/**
 * Decode MicroPython's `machine.ADC.read_u16()` 16-bit reading into volts + the
 * conventional 12-bit raw count. The Pico ADC is physically 12-bit; `read_u16()`
 * left-justifies it into 16 bits, so `raw12 = u16 >> 4` and
 * `volts = u16 / 65535 * VREF`.
 */
export function adcFromU16(u16: number): AdcSample {
  const clamped = u16 < 0 ? 0 : u16 > 65535 ? 65535 : u16
  return {
    raw: clamped >> 4,
    volts: (clamped / 65535) * ADC_VREF
  }
}

// --- Rolling min / max / avg ------------------------------------------------

/** Rolling statistics over the samples an instrument has received. */
export interface Stats {
  min: number
  max: number
  avg: number
  /** Number of samples folded in (0 ⇒ the other fields are not meaningful). */
  count: number
}

/** A fresh, empty {@link Stats} accumulator. */
export function emptyStats(): Stats {
  return { min: 0, max: 0, avg: 0, count: 0 }
}

/**
 * Fold one new `sample` into a running {@link Stats}. Pure — returns a NEW Stats
 * (so it slots straight into React state). The first sample seeds min/max/avg.
 */
export function foldStat(prev: Stats, sample: number): Stats {
  if (!Number.isFinite(sample)) return prev
  if (prev.count === 0) {
    return { min: sample, max: sample, avg: sample, count: 1 }
  }
  const count = prev.count + 1
  return {
    min: Math.min(prev.min, sample),
    max: Math.max(prev.max, sample),
    // Incremental mean keeps it O(1) and avoids holding the whole series.
    avg: prev.avg + (sample - prev.avg) / count,
    count
  }
}

// --- Oscilloscope square-wave geometry --------------------------------------

/** Inputs for {@link squareWavePath}: the screen box + the wave shape. */
export interface ScopeGeometry {
  /** Drawable screen width in px. */
  width: number
  /** Drawable screen height in px. */
  height: number
  /** Duty as a 0..1 fraction (0 ⇒ flat low, 1 ⇒ flat high). */
  duty: number
  /** Whole PWM cycles to draw across the screen (≥ 1). */
  cycles: number
  /** Vertical inset (px) from the top/bottom edges to the high/low rails. */
  padY?: number
}

/**
 * Build the SVG path `d` for a PWM **square wave** across a scope screen.
 *
 * The trace runs left→right over `cycles` whole periods. Each period spends
 * `duty` of its width HIGH (the top rail) then the rest LOW (the bottom rail),
 * with vertical edges between — exactly the idealised PWM output. A duty of 0 or
 * 1 degenerates to a flat line on the low/high rail (no edges), which is the
 * correct picture for a fully-off / fully-on channel.
 *
 * Pure geometry (no DOM): returns a path string in the screen's own pixel
 * coordinates so the caller can drop it straight into an `<path d=...>`.
 */
export function squareWavePath(g: ScopeGeometry): string {
  const w = Math.max(1, g.width)
  const h = Math.max(1, g.height)
  const pad = g.padY ?? Math.min(h * 0.18, 24)
  const yHigh = pad
  const yLow = h - pad
  const cycles = Math.max(1, Math.floor(g.cycles))
  const duty = clamp01(g.duty)
  const period = w / cycles

  // Degenerate flat cases — a single horizontal rail, no switching edges.
  if (duty <= 0) return `M0 ${yLow} L${w} ${yLow}`
  if (duty >= 1) return `M0 ${yHigh} L${w} ${yHigh}`

  // Start on the HIGH rail at x=0, then for each period: hold high for the duty
  // fraction, drop, hold low for the rest, rise (unless it's the final edge).
  const parts: string[] = [`M0 ${yHigh}`]
  for (let i = 0; i < cycles; i++) {
    const x0 = i * period
    const xFall = x0 + period * duty
    const xEnd = x0 + period
    parts.push(`L${round(xFall)} ${yHigh}`) // hold high
    parts.push(`L${round(xFall)} ${yLow}`) // falling edge
    parts.push(`L${round(xEnd)} ${yLow}`) // hold low
    if (i < cycles - 1) parts.push(`L${round(xEnd)} ${yHigh}`) // rising edge
  }
  return parts.join(' ')
}

/** Round to 2dp so the path strings stay short + stable for snapshot tests. */
function round(v: number): number {
  return Math.round(v * 100) / 100
}

// --- Oscilloscope sampled-waveform geometry (telemetry, #107) ---------------

/** Inputs for {@link sampleWavePath}: the screen box + the live samples. */
export interface SampleGeometry {
  /** Drawable screen width in px. */
  width: number
  /** Drawable screen height in px. */
  height: number
  /** The live samples (oldest → newest); auto-scaled to fill the height. */
  samples: number[]
  /** Vertical inset (px) from the top/bottom edges. */
  padY?: number
}

/**
 * Build the SVG path `d` for a LIVE sampled waveform across the scope screen
 * (issue #107) — the trace the Oscilloscope draws from printed `SNK SCOPE`
 * telemetry instead of the idealised square wave.
 *
 * Samples map left→right (oldest at x=0, newest at the right edge) and are
 * auto-scaled vertically to fill `height` minus `padY` (a flat series gets
 * centred). Returns `''` for an empty series (the caller then shows a
 * placeholder). Pure geometry, no DOM; mirrors {@link squareWavePath}.
 */
export function sampleWavePath(g: SampleGeometry): string {
  const w = Math.max(1, g.width)
  const h = Math.max(1, g.height)
  const pad = g.padY ?? Math.min(h * 0.18, 24)
  const s = g.samples
  if (s.length === 0) return ''

  const yTop = pad
  const yBot = h - pad
  const usable = Math.max(1, yBot - yTop)

  let min = Infinity
  let max = -Infinity
  for (const v of s) {
    if (!Number.isFinite(v)) continue
    if (v < min) min = v
    if (v > max) max = v
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return ''
  // Flat series → draw a centred horizontal line (avoid divide-by-zero).
  const span = max - min || 1
  const flat = max === min

  const xStep = s.length > 1 ? w / (s.length - 1) : 0
  const yOf = (v: number): number =>
    flat ? yTop + usable / 2 : yBot - ((v - min) / span) * usable

  const parts: string[] = []
  for (let i = 0; i < s.length; i++) {
    const v = s[i]
    const x = round(i * xStep)
    const y = round(yOf(Number.isFinite(v) ? v : min))
    parts.push(`${i === 0 ? 'M' : 'L'}${x} ${y}`)
  }
  return parts.join(' ')
}

// --- Human-readable formatting (frequency / period) -------------------------

/**
 * Format a frequency in Hz with an SI prefix, e.g. `1000 → "1.00 kHz"`,
 * `50 → "50.0 Hz"`, `2_000_000 → "2.00 MHz"`. Returns `'—'` for a missing /
 * non-positive frequency.
 */
export function formatFreq(hz: number | undefined): string {
  if (hz === undefined || !Number.isFinite(hz) || hz <= 0) return '—'
  if (hz >= 1e6) return `${(hz / 1e6).toPrecision(3)} MHz`
  if (hz >= 1e3) return `${(hz / 1e3).toPrecision(3)} kHz`
  return `${hz.toPrecision(3)} Hz`
}

/**
 * Format a PWM **period** (the reciprocal of `hz`) with an SI time unit, e.g.
 * `1000 Hz → "1.00 ms"`, `50 Hz → "20.0 ms"`, `1_000_000 Hz → "1.00 µs"`.
 * Returns `'—'` for a missing / non-positive frequency.
 */
export function formatPeriod(hz: number | undefined): string {
  if (hz === undefined || !Number.isFinite(hz) || hz <= 0) return '—'
  const s = 1 / hz
  if (s >= 1) return `${s.toPrecision(3)} s`
  if (s >= 1e-3) return `${(s * 1e3).toPrecision(3)} ms`
  if (s >= 1e-6) return `${(s * 1e6).toPrecision(3)} µs`
  return `${(s * 1e9).toPrecision(3)} ns`
}

/** Format a 0..1 duty fraction as a percentage, e.g. `0.5 → "50.0 %"`. */
export function formatDuty(duty: number | undefined): string {
  if (duty === undefined || !Number.isFinite(duty)) return '—'
  return `${(clamp01(duty) * 100).toFixed(1)} %`
}
