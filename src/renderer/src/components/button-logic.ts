/**
 * BUTTON PANEL LOGIC (#114) — the pure, DOM-free reducer behind the Button
 * instrument (the READ panel).
 * =============================================================================
 *
 * The Button panel watches `SNK BTN <name> <0|1>` telemetry (parsed into
 * {@link ButtonTelemetry} by `instrument-telemetry.ts`) and keeps a small MAP of
 * `name → { pressed, edgeCount, ... }` so the UI can show live pressed/released
 * indicators AND a count of how many times each input has been pressed — a way
 * to watch a bank of buttons/switches without a multimeter.
 *
 * The interesting part is the RISING-EDGE count: `edgeCount` increments only on a
 * `released → pressed` transition (a press), NOT on a repeated `pressed` reading
 * and NOT on a release. A name's first-ever reading INITIALISES its slot (and, if
 * that first reading is already `pressed`, counts as one rising edge from the
 * implicit released baseline) so a button that's held when the panel opens still
 * registers its press.
 *
 * Kept React/DOM-free (a plain reducer over a plain map) so it is unit-testable
 * in node — mirrors `instrument-data.ts`, `parse-pins.ts`, the other pure cores.
 * Nothing here mutates its input: every update returns a fresh map + slot.
 */

/** One watched button's live state. */
export interface ButtonState {
  /** The button's logical name (the telemetry routing label). */
  name: string
  /** Whether it is currently held down. */
  pressed: boolean
  /** How many RISING edges (presses) have been seen since first observed. */
  edgeCount: number
  /** Monotonic sequence of the last reading applied (for "most recent" sorting). */
  lastSeq: number
}

/** The watched-button map, keyed by button name. */
export type ButtonMap = Record<string, ButtonState>

/** One telemetry reading shape the reducer consumes (a subset of ButtonTelemetry). */
export interface ButtonReading {
  name: string
  pressed: boolean
}

/** A fresh, empty button map. */
export function emptyButtonMap(): ButtonMap {
  return {}
}

/**
 * Apply one `{ name, pressed }` reading to `map`, returning a NEW map.
 *
 * Semantics:
 *  - FIRST time `name` is seen: a slot is created. `edgeCount` is `1` when that
 *    first reading is already `pressed` (a held button counts its press against
 *    the implicit "released" baseline), else `0`.
 *  - A `released → pressed` transition (a RISING edge) increments `edgeCount`.
 *  - A `pressed → pressed` repeat or any release does NOT change `edgeCount`.
 *  - `pressed` always tracks the latest reading; `lastSeq` is bumped so the UI
 *    can show the most-recently-changed button.
 *
 * Pure: `map` and its slots are never mutated.
 */
export function applyButtonReading(map: ButtonMap, reading: ButtonReading): ButtonMap {
  const { name, pressed } = reading
  const prev = map[name]
  // The next monotonic sequence number across the whole map.
  const seq = nextSeq(map)

  if (!prev) {
    // First sighting: a held button (pressed at first sight) counts one rising
    // edge from the implicit released baseline.
    const slot: ButtonState = {
      name,
      pressed,
      edgeCount: pressed ? 1 : 0,
      lastSeq: seq
    }
    return { ...map, [name]: slot }
  }

  // A rising edge is a released → pressed transition.
  const rising = pressed && !prev.pressed
  const slot: ButtonState = {
    name,
    pressed,
    edgeCount: prev.edgeCount + (rising ? 1 : 0),
    lastSeq: seq
  }
  return { ...map, [name]: slot }
}

/** The next monotonic sequence number (one past the current max `lastSeq`). */
function nextSeq(map: ButtonMap): number {
  let max = 0
  for (const k in map) {
    if (map[k].lastSeq > max) max = map[k].lastSeq
  }
  return max + 1
}

/**
 * The button slots as an array, most-recently-updated FIRST (descending
 * `lastSeq`). Ties (same seq — impossible in practice) fall back to name order.
 * Pure; returns a fresh array.
 */
export function buttonList(map: ButtonMap): ButtonState[] {
  return Object.values(map).sort((a, b) => b.lastSeq - a.lastSeq || a.name.localeCompare(b.name))
}

/** The name of the most-recently-updated button, or `undefined` for an empty map. */
export function lastButton(map: ButtonMap): string | undefined {
  return buttonList(map)[0]?.name
}

/** Total rising edges across every watched button. */
export function totalEdges(map: ButtonMap): number {
  let total = 0
  for (const k in map) total += map[k].edgeCount
  return total
}

/** How many distinct buttons are being watched. */
export function buttonCount(map: ButtonMap): number {
  return Object.keys(map).length
}
