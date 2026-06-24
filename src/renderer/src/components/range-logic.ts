/**
 * RANGE LOGIC — pure, DOM-free helpers for the distance-sensor RADAR instrument
 * (issue #112).
 * =============================================================================
 *
 * Everything the {@link ./RangeInstrument} needs to turn a stream of distance
 * readings (a ToF / ultrasonic sensor, optionally swept across an angle) into the
 * geometry + classifications the skeuomorphic UI draws:
 *
 *   - {@link polarToPoint}    — map (angle°, distance) → an (x, y) point inside the
 *     radar viewBox, scaled by a configurable max range. The radar is a half-dome
 *     (a 180° sweep) anchored at the bottom-centre, exactly like a marine radar.
 *   - {@link pushHistory} / {@link HISTORY_CAP} — a fixed-size ring buffer of the
 *     recent single-sensor distances (for the rolling history graph).
 *   - {@link classifyProximity} — near / clear vs. a proximity-alert threshold.
 *   - {@link mmToCm} / {@link cmToMm} / {@link convertUnit} / {@link formatRange}
 *     — mm ⟷ cm conversion + display formatting.
 *   - {@link isNoEcho} — out-of-range / no-echo detection (mm = 0, non-finite, or
 *     beyond the configured max → "no echo", a cleared reading).
 *
 * Kept React/DOM-free (mirrors {@link ./instrument-data} / {@link ./board-values})
 * so every piece is unit-testable in plain node. NOTHING here throws — a garbled
 * reading simply yields a "no echo" / cleared result.
 */

/** A distance unit the radar can display in. */
export type RangeUnit = 'mm' | 'cm'

/** Proximity classification of a reading against the alert threshold. */
export type Proximity = 'near' | 'clear' | 'none'

/** How many recent single-sensor samples the history ring retains. */
export const HISTORY_CAP = 120

/** Default max range (mm) when none is configured — a typical HC-SR04 ceiling. */
export const DEFAULT_MAX_MM = 4000

// --- no-echo / out-of-range detection ---------------------------------------

/**
 * Is `mm` a "no echo" / out-of-range reading? Many ToF + ultrasonic sensors
 * report `0` (or a very large sentinel) when nothing reflects within range, so we
 * treat a non-finite, non-positive, or beyond-`maxMm` distance as no-echo. The
 * UI then clears the blip / shows "NO ECHO" rather than plotting a phantom point.
 *
 * `maxMm` is optional; when omitted only the non-finite / non-positive cases are
 * no-echo (the caller may still want to plot an over-range value clamped to the
 * rim — see {@link clampRange}).
 */
export function isNoEcho(mm: number, maxMm?: number): boolean {
  if (!Number.isFinite(mm) || mm <= 0) return true
  if (maxMm !== undefined && Number.isFinite(maxMm) && maxMm > 0 && mm > maxMm) return true
  return false
}

/** Clamp a distance into the drawable [0, maxMm] band (negatives → 0). */
export function clampRange(mm: number, maxMm: number): number {
  if (!Number.isFinite(mm) || mm <= 0) return 0
  const cap = Number.isFinite(maxMm) && maxMm > 0 ? maxMm : DEFAULT_MAX_MM
  return mm > cap ? cap : mm
}

// --- mm ⟷ cm conversion + formatting ----------------------------------------

/** Convert millimetres → centimetres. */
export function mmToCm(mm: number): number {
  return mm / 10
}

/** Convert centimetres → millimetres. */
export function cmToMm(cm: number): number {
  return cm * 10
}

/** Convert a millimetre distance into the chosen display `unit`'s value. */
export function convertUnit(mm: number, unit: RangeUnit): number {
  return unit === 'cm' ? mmToCm(mm) : mm
}

/**
 * Format a millimetre distance for the readout in `unit`, e.g.
 * `1234, 'cm' → "123.4 cm"`, `1234, 'mm' → "1234 mm"`. A no-echo reading
 * (see {@link isNoEcho}, evaluated against `maxMm` when given) renders as
 * `"NO ECHO"`. cm is shown to 1dp, mm as a whole number.
 */
export function formatRange(mm: number, unit: RangeUnit, maxMm?: number): string {
  if (isNoEcho(mm, maxMm)) return 'NO ECHO'
  if (unit === 'cm') return `${mmToCm(mm).toFixed(1)} cm`
  return `${Math.round(mm)} mm`
}

// --- proximity classification -----------------------------------------------

/**
 * Classify a reading against the proximity-alert `threshold` (in mm):
 *
 *   - `'none'`  — no echo / out of range (nothing to alert on).
 *   - `'near'`  — a valid reading at/under the threshold → highlight the obstacle.
 *   - `'clear'` — a valid reading beyond the threshold.
 *
 * `maxMm` (optional) feeds the no-echo test so an over-range value classifies as
 * `'none'` rather than a false `'clear'`.
 */
export function classifyProximity(mm: number, threshold: number, maxMm?: number): Proximity {
  if (isNoEcho(mm, maxMm)) return 'none'
  if (Number.isFinite(threshold) && threshold > 0 && mm <= threshold) return 'near'
  return 'clear'
}

// --- polar → cartesian (the radar plot) -------------------------------------

/** A point in the radar viewBox (top-left origin, y grows downward as in SVG). */
export interface RadarPoint {
  x: number
  y: number
}

/** Inputs for {@link polarToPoint}: the viewBox + the reading + the scale. */
export interface RadarGeometry {
  /** Radar viewBox width in user units. */
  width: number
  /** Radar viewBox height in user units. */
  height: number
  /** Configured max range (mm) mapped to the dome radius. */
  maxMm: number
  /** Radius padding (user units) kept clear at the rim. */
  pad?: number
}

/**
 * Map a polar reading `(angleDeg, mm)` to a cartesian point inside the radar
 * viewBox. The radar is a 180° half-dome anchored at the BOTTOM-CENTRE
 * (`x = width/2, y = height - pad`), so:
 *
 *   - `angleDeg = 0`   points straight RIGHT along the baseline,
 *   - `angleDeg = 90`  points straight UP (the centre of the sweep),
 *   - `angleDeg = 180` points straight LEFT along the baseline.
 *
 * The distance scales linearly from the apex (0 mm) to the dome rim (`maxMm`),
 * clamped so an over-range value sits on the rim rather than outside the screen.
 * A no-echo / non-finite reading returns the apex point (the caller skips drawing
 * it). Pure geometry — no DOM; mirrors {@link ./instrument-data}.`squareWavePath`.
 */
export function polarToPoint(angleDeg: number, mm: number, g: RadarGeometry): RadarPoint {
  const w = Math.max(1, g.width)
  const h = Math.max(1, g.height)
  const pad = g.pad ?? 0
  const cx = w / 2
  const cy = h - pad
  // The dome radius is the smaller of the half-width and the full padded height,
  // so the 180° arc always fits the box.
  const radius = Math.max(1, Math.min(w / 2 - pad, h - pad))

  const cap = Number.isFinite(g.maxMm) && g.maxMm > 0 ? g.maxMm : DEFAULT_MAX_MM
  const dist = clampRange(mm, cap)
  const r = (dist / cap) * radius

  // SVG y grows downward, so UP (90°) must subtract from cy → use −sin.
  const rad = (angleDeg * Math.PI) / 180
  return {
    x: round(cx + r * Math.cos(rad)),
    y: round(cy - r * Math.sin(rad))
  }
}

/** Round to 2dp so geometry strings stay short + stable for snapshot tests. */
function round(v: number): number {
  return Math.round(v * 100) / 100
}

// --- single-sensor history ring ---------------------------------------------

/**
 * Push `mm` onto a fixed-size history ring (oldest → newest), capping at `cap`
 * (default {@link HISTORY_CAP}). Pure — returns a NEW array (so it slots straight
 * into React state). A no-echo reading is stored as `0` so the history graph
 * draws a dropout to the baseline rather than a phantom spike or a gap.
 */
export function pushHistory(history: number[], mm: number, cap = HISTORY_CAP): number[] {
  const value = Number.isFinite(mm) && mm > 0 ? mm : 0
  const next = history.length >= cap ? history.slice(history.length - cap + 1) : history.slice()
  next.push(value)
  return next
}

/**
 * Build the SVG polyline `points` string for a single-sensor history graph: the
 * `history` samples mapped left→right (oldest at x=0, newest at the right edge)
 * with distance scaled 0..`maxMm` to the FULL height (0 mm at the bottom, max at
 * the top). Returns `''` for an empty history. Pure geometry, no DOM.
 */
export function historyPath(
  history: number[],
  width: number,
  height: number,
  maxMm: number
): string {
  const w = Math.max(1, width)
  const h = Math.max(1, height)
  if (history.length === 0) return ''
  const cap = Number.isFinite(maxMm) && maxMm > 0 ? maxMm : DEFAULT_MAX_MM
  const xStep = history.length > 1 ? w / (history.length - 1) : 0
  const parts: string[] = []
  for (let i = 0; i < history.length; i++) {
    const dist = clampRange(history[i], cap)
    const x = round(i * xStep)
    const y = round(h - (dist / cap) * h)
    parts.push(`${x},${y}`)
  }
  return parts.join(' ')
}

// --- swept-sensor persistence (fading trails) -------------------------------

/** One retained swept-radar blip: its reading + an age used to fade the trail. */
export interface RadarBlip {
  /** Sweep angle in degrees (0..180). */
  angle: number
  /** Distance in mm (always a valid, in-range reading — no-echo blips dropped). */
  mm: number
  /** Monotonic sequence number at insert time (drives the fade). */
  seq: number
}

/** How many swept blips to retain for the fading persistence trail. */
export const SWEEP_TRAIL = 96

/**
 * Push a swept reading onto the persistence trail. A no-echo / out-of-range
 * reading is DROPPED (the sweep at that bearing simply shows nothing). A new blip
 * at (approximately) the same bearing replaces the older one so the trail holds at
 * most one blip per bearing bucket; the rest age out by `seq`. Pure — returns a
 * NEW array capped at {@link SWEEP_TRAIL}.
 */
export function pushBlip(
  trail: RadarBlip[],
  angle: number,
  mm: number,
  seq: number,
  maxMm?: number,
  cap = SWEEP_TRAIL
): RadarBlip[] {
  if (isNoEcho(mm, maxMm) || !Number.isFinite(angle)) return trail
  // Drop any existing blip within 1° of this bearing (one live blip per bearing).
  const filtered = trail.filter((b) => Math.abs(b.angle - angle) >= 1)
  filtered.push({ angle, mm, seq })
  return filtered.length > cap ? filtered.slice(filtered.length - cap) : filtered
}

/**
 * The 0..1 opacity for a blip given the newest sequence number: the freshest blip
 * is fully opaque, older blips fade linearly to `floor` over the trail window.
 * Clamped to [floor, 1]. Pure.
 */
export function blipOpacity(blipSeq: number, newestSeq: number, window = SWEEP_TRAIL, floor = 0.05): number {
  if (!Number.isFinite(blipSeq) || !Number.isFinite(newestSeq)) return floor
  const age = newestSeq - blipSeq
  if (age <= 0) return 1
  const t = 1 - age / window
  if (t <= floor) return floor
  return t > 1 ? 1 : t
}

// ---------------------------------------------------------------------------
// Range control payload + code-sync (mirrors buzzer-logic's pin sync) — the
// on-device receiver (`micropython/instruments.py` `Rangefinder` + `range_command`)
// attests the `range` control grammar the panel WRITES:
//
//     SNKCMD range pins <trig> <echo>          # retarget the HC-SR04 trig/echo pins
//
// `rangePinsPayload(trig, echo)` produces the `<payload>` half;
// `sendControl('range', payload)` frames the `SNKCMD range …` line. The two
// code-sync helpers read/rewrite the demo's `RANGE_TRIG`/`RANGE_ECHO` (or a
// `range_trig=`/`range_echo=` kwarg) so the panel can warn on + fix a mismatch.
// ---------------------------------------------------------------------------

/** A trig/echo pin pair read out of source code; `null` for an absent/symbolic one. */
export interface RangePins {
  trig: number | null
  echo: number | null
}

/**
 * The `<payload>` that retargets the rangefinder's trig/echo pins:
 * `pins <trig> <echo>`. Each pin is rounded to a whole, non-negative GPIO number.
 * Pass to `sendControl('range', rangePinsPayload(3, 2))` → the device sees
 * `SNKCMD range pins 3 2`.
 */
export function rangePinsPayload(trig: number, echo: number): string {
  const t = Math.max(0, Math.round(Number.isFinite(trig) ? trig : 0))
  const e = Math.max(0, Math.round(Number.isFinite(echo) ? echo : 0))
  return `pins ${t} ${e}`
}

/**
 * The regex matching a `RANGE_TRIG = <digits>` (or `range_trig=<digits>`)
 * declaration, with the value captured. Case-insensitive, whitespace-tolerant.
 * Built per-role so {@link findRangePinsInCode} / {@link setRangePinsInCode} agree
 * on the grammar. Not `/g` — both helpers act on the FIRST match of each role.
 */
const RANGE_TRIG_RE = /range_trig\s*=\s*([0-9]+)/i
const RANGE_ECHO_RE = /range_echo\s*=\s*([0-9]+)/i

/**
 * Find the numeric trig + echo pins declared by `RANGE_TRIG = <digits>` /
 * `RANGE_ECHO = <digits>` (or the lowercase `range_trig=`/`range_echo=` kwarg) in
 * `source`. Case-insensitive; tolerant of whitespace around the `=`. Returns the
 * FIRST such pin per role as a number, or `null` for a role the code declares no
 * numeric value for (including symbolic values like `range_trig=RANGE_TRIG`). Pure,
 * never throws.
 */
export function findRangePinsInCode(source: string): RangePins {
  if (!source) return { trig: null, echo: null }
  const t = RANGE_TRIG_RE.exec(source)
  const e = RANGE_ECHO_RE.exec(source)
  return {
    trig: t ? Number(t[1]) : null,
    echo: e ? Number(e[1]) : null
  }
}

/**
 * Rewrite the FIRST `RANGE_TRIG = <digits>` AND `RANGE_ECHO = <digits>` assignments
 * in `source` to `trig` / `echo`, preserving the surrounding text (and the author's
 * spacing + casing around each `=`). A role with no numeric match is left untouched
 * (nothing to sync). Each new pin is rounded to a whole, non-negative GPIO number.
 * Pure, never mutates — backs the panel's one-click "Update code". Mirrors
 * {@link setBuzzerPinInCode}.
 */
export function setRangePinsInCode(source: string, trig: number, echo: number): string {
  const t = Math.max(0, Math.round(Number.isFinite(trig) ? trig : 0))
  const e = Math.max(0, Math.round(Number.isFinite(echo) ? echo : 0))
  // Rebuild the matched text with the new number, keeping the original prefix
  // (`RANGE_TRIG`, the author's casing + spacing, `=`, spacing) intact so only the
  // value changes.
  const replaceValue = (value: number) => (matched: string, digits: string): string => {
    const numStart = matched.lastIndexOf(digits)
    return matched.slice(0, numStart) + String(value)
  }
  let out = source.replace(RANGE_TRIG_RE, replaceValue(t))
  out = out.replace(RANGE_ECHO_RE, replaceValue(e))
  return out
}
