/**
 * INSTRUMENT REGISTRY (#119) — the single source of truth for the dock's
 * instrument set.
 * =============================================================================
 *
 * The instrument dock is going from 3 to ~13+ instruments, so every surface that
 * needs to know "what instruments exist" (the dock header toggle rows, the
 * "Add instrument" palette, the placeholder window factory, the per-id visibility
 * map) reads from THIS one list instead of duplicating the catalogue. Adding a
 * new instrument is a one-line change here; the dock, the palette and the
 * placeholder all pick it up.
 *
 * Two **kinds** of instrument live in the dock:
 *
 *   - `kind: 'pin'`   — opened PER PIN from the board-view node launchers (one
 *     Oscilloscope per PWM pin, one Multimeter per ADC pin). These keep their
 *     existing `OpenInstrument`/`useInstruments` machinery untouched (#101/#102);
 *     the registry only describes their toggle/accent so the header can render a
 *     SCOPE/METER button consistently with the rest.
 *   - `kind: 'singleton'` — exactly one instance, toggled on/off (the Plotter
 *     #103 today, plus the new #110–#121 placeholder instruments). Visibility is a
 *     simple per-id boolean; the body is rendered once through the shared
 *     `InstrumentWindow` chrome.
 *
 * The accents / active-border alphas come from the Board View handoff (the
 * per-instrument accent + the border at ~.45–.5 alpha). Icons are inline SVG path
 * data drawn at 24×24 (the toggle row + palette render them at 12–16px).
 *
 * Kept React/DOM-free (icons are plain path strings, not JSX) so the grouping +
 * in-use + palette-filter logic below can be unit-tested in a plain node
 * environment — mirrors `parse-pins.ts`, `instrument-host.ts`, etc.
 */

import { parsePins, type PinType } from './parse-pins'

/** The in/out classification an instrument belongs to (drives the header group). */
export type InstrumentGroup = 'input' | 'output' | 'both'

/**
 * Whether the instrument is opened per-pin (the existing scope/meter) or is a
 * single toggleable singleton (the Plotter + every new placeholder).
 */
export type InstrumentKind = 'pin' | 'singleton'

/** One instrument's static descriptor — the dock/toolbar/palette all read this. */
export interface InstrumentDef {
  /** Stable id (the visibility-map key + the palette/dock key). */
  id: string
  /** Display name shown in the toggle, the palette row and the window title. */
  name: string
  /** Accent colour (icon + active text), from the handoff per-instrument accents. */
  accent: string
  /** Active-border colour — the accent at ~.45–.5 alpha (handoff). */
  border: string
  /** Inline SVG path/markup `d`-string(s) drawn at 24×24 in a `<path>`. */
  icon: string
  /** Inputs vs Outputs vs both — drives which header group the toggle sits in. */
  group: InstrumentGroup
  /** `pin` = per-pin (scope/meter), `singleton` = one toggleable instance. */
  kind: InstrumentKind
  /** One-line palette description (what the instrument is for). */
  description: string
  /**
   * The `parse-pins` peripheral type(s) that, when present in the active file,
   * mark THIS instrument as in-use. `undefined` for instruments with no cheap
   * code signal (still reachable via the palette, never auto-shown).
   */
  uses?: PinType[]
  /**
   * Cheap import/driver hints (lower-cased substrings). If the active file's
   * source contains any of these the instrument is also treated as in-use — for
   * peripherals `parse-pins` doesn't classify (e.g. an IMU/encoder/BLE driver).
   */
  hints?: string[]
}

/** A `<path d="…">` border alpha helper kept inline for clarity in the table. */

/**
 * THE registry — every dock instrument, in display order. The first three are
 * the existing real bodies (scope/meter are `pin`, plotter is a `singleton`);
 * the rest are the new `#110–#121` placeholders rendered through the shared
 * placeholder window until each panel issue lands its real body.
 */
export const INSTRUMENTS: InstrumentDef[] = [
  // --- Existing real bodies ------------------------------------------------
  {
    id: 'scope',
    name: 'Oscilloscope',
    accent: '#86ffb6',
    border: 'rgba(82,224,138,.45)',
    // square wave
    icon: 'M3 15 L3 9 L8 9 L8 15 L13 15 L13 9 L18 9 L18 15 L21 15',
    group: 'input',
    kind: 'pin',
    description: 'Trace a PWM channel as a live square-wave on a CRT screen.',
    uses: ['pwm']
  },
  {
    id: 'meter',
    name: 'Multimeter',
    accent: '#5fe0c8',
    border: 'rgba(70,214,187,.45)',
    // gauge + needle
    icon: 'M4 18 A9 9 0 0 1 20 18 M12 18 L16.6 12.4',
    group: 'input',
    kind: 'pin',
    description: 'Read an ADC pin as a voltage with min/max/avg statistics.',
    uses: ['adc']
  },
  {
    id: 'plotter',
    name: 'Plotter',
    accent: '#7fc4f0',
    border: 'rgba(95,184,240,.45)',
    // trend line
    icon: 'M3 17 L9 11 L13 14.5 L21 6',
    group: 'input',
    kind: 'singleton',
    description: 'Plot printed serial values over time as a scrolling chart.'
  },

  // --- New placeholder bodies (#110–#121) ----------------------------------
  {
    id: 'gamepad',
    name: 'Gamepad',
    accent: '#b18cf0',
    border: 'rgba(177,140,240,.5)',
    // d-pad + button
    icon: 'M7 11 L11 11 M9 9 L9 13 M16 10 a1.4 1.4 0 1 0 0.01 0 M5 7 h14 a2 2 0 0 1 2 2 v6 a2 2 0 0 1 -2 2 H5 a2 2 0 0 1 -2 -2 V9 a2 2 0 0 1 2 -2 Z',
    group: 'output',
    kind: 'singleton',
    description: 'Drive a connected device from an on-screen gamepad.',
    hints: ['gamepad', 'joystick']
  },
  {
    id: 'range',
    name: 'Range',
    accent: '#f0b94a',
    border: 'rgba(240,185,74,.5)',
    // sonar arcs
    icon: 'M5 18 A7 7 0 0 1 19 18 M8.5 18 A3.5 3.5 0 0 1 15.5 18 M12 18 v-1',
    group: 'input',
    kind: 'singleton',
    description: 'Show distance from an ultrasonic / ToF range sensor.',
    hints: ['hcsr04', 'hc-sr04', 'ultrasonic', 'vl53', 'tof', 'distance', 'range']
  },
  {
    id: 'pot',
    name: 'Potentiometer',
    accent: '#e0a44a',
    border: 'rgba(224,164,74,.5)',
    // a rotary knob with an indicator + base
    icon: 'M12 12 m-8 0 a8 8 0 1 0 16 0 a8 8 0 1 0 -16 0 M12 12 L12 5 M12 20 v1',
    group: 'input',
    kind: 'singleton',
    description: 'Read a potentiometer as 0–100% on a vintage ammeter dial.',
    hints: ['potentiometer', 'pot', 'poti']
  },
  {
    id: 'imu',
    name: 'IMU',
    accent: '#ff9b7a',
    border: 'rgba(255,155,122,.5)',
    // cube / orientation
    icon: 'M12 3 L20 7 L20 16 L12 20 L4 16 L4 7 Z M12 3 L12 12 M12 12 L20 7 M12 12 L4 7',
    group: 'input',
    kind: 'singleton',
    description: 'Visualise accelerometer / gyro orientation from an IMU.',
    hints: ['imu', 'mpu6050', 'mpu9250', 'lsm', 'icm20948', 'bno055', 'accel', 'gyro']
  },
  {
    id: 'led',
    name: 'LED',
    accent: '#ff6b5e',
    border: 'rgba(255,107,94,.5)',
    // glowing bulb
    icon: 'M12 4 a6 6 0 0 1 4 10.4 V17 H8 v-2.6 A6 6 0 0 1 12 4 Z M9 20 h6',
    group: 'output',
    kind: 'singleton',
    description: 'Toggle and dim a digital / PWM LED output.',
    hints: ['neopixel', 'ws2812', 'led']
  },
  {
    id: 'servo',
    name: 'Servo',
    accent: '#ffd166',
    border: 'rgba(255,209,102,.5)',
    // a dial with a pointer arm
    icon: 'M4 14 a8 8 0 0 1 16 0 M12 14 L17 9',
    group: 'output',
    kind: 'singleton',
    description: 'Set a servo angle with a dial, sweep, and min/max limits.',
    // `hints` (not `uses:['pwm']`) so it lights up only when a servo library /
    // name appears — a bare PWM pin already offers the oscilloscope.
    hints: ['servo', 'sg90', 'mg90', 'mg996', 'pca9685']
  },
  {
    id: 'button',
    name: 'Button',
    accent: '#6fb4ee',
    border: 'rgba(111,180,238,.5)',
    // push button
    icon: 'M5 14 a7 7 0 0 1 14 0 M3 14 h18 M9 14 v-2 a3 3 0 0 1 6 0 v2',
    group: 'input',
    kind: 'singleton',
    description: 'Watch a digital input button / switch state.',
    hints: ['button', 'switch']
  },
  {
    id: 'buzzer',
    name: 'Buzzer',
    accent: '#ff7ac2',
    border: 'rgba(255,122,194,.5)',
    // speaker + waves
    icon: 'M4 9 H8 L13 5 V19 L8 15 H4 Z M16 9 a4 4 0 0 1 0 6 M18.5 7 a7 7 0 0 1 0 10',
    group: 'output',
    kind: 'singleton',
    description: 'Play tones / melodies on a piezo buzzer.',
    hints: ['buzzer', 'piezo', 'tone', 'rtttl']
  },
  {
    id: 'sam',
    name: 'SAM',
    accent: '#f6a96b',
    border: 'rgba(246,169,107,.5)',
    // speech bubble with a tail
    icon: 'M4 5 h16 a1 1 0 0 1 1 1 v9 a1 1 0 0 1 -1 1 H9 l-4 4 v-4 H4 a1 1 0 0 1 -1 -1 V6 a1 1 0 0 1 1 -1 Z',
    group: 'output',
    kind: 'singleton',
    description: 'Software Automated Mouth — speak typed text out of a buzzer pin.',
    hints: ['sam', 'sam_render', 'software automated mouth']
  },
  {
    id: 'encoder',
    name: 'Encoder',
    accent: '#aee05e',
    border: 'rgba(174,224,94,.5)',
    // rotary knob + arrow
    icon: 'M12 12 m-7 0 a7 7 0 1 0 14 0 a7 7 0 1 0 -14 0 M12 12 L12 6 M16 8 l1.5 -1.5 M17.5 6.5 l-3 0 M17.5 6.5 l0 3',
    group: 'input',
    kind: 'singleton',
    description: 'Count steps and direction from a rotary encoder.',
    hints: ['encoder', 'rotary']
  },
  {
    id: 'i2c-display',
    name: 'Display',
    accent: '#5fd6f0',
    border: 'rgba(95,214,240,.5)',
    // small screen with text lines
    icon: 'M4 5 h16 a1 1 0 0 1 1 1 v12 a1 1 0 0 1 -1 1 H4 a1 1 0 0 1 -1 -1 V6 a1 1 0 0 1 1 -1 Z M7 9 h10 M7 12 h10 M7 15 h6',
    group: 'both',
    kind: 'singleton',
    description: 'Preview text/graphics for an I²C OLED / LCD or an ST7789 SPI TFT.',
    uses: ['i2c'],
    hints: ['ssd1306', 'sh1106', 'lcd', 'oled', 'st7789', 'tft', 'spi']
  },
  {
    id: 'wifi-scan',
    name: 'Wi-Fi scan',
    accent: '#5ab8ff',
    border: 'rgba(90,184,255,.5)',
    // wifi arcs
    icon: 'M3 9 A13 13 0 0 1 21 9 M6 12.5 A8.5 8.5 0 0 1 18 12.5 M9 16 A4 4 0 0 1 15 16 M12 19 h0.01',
    group: 'input',
    kind: 'singleton',
    description: 'List nearby Wi-Fi networks and signal strength.',
    hints: ['network', 'wlan', 'wifi']
  },
  {
    id: 'bluetooth',
    name: 'Bluetooth',
    accent: '#6f8cff',
    border: 'rgba(111,140,255,.5)',
    // bluetooth rune
    icon: 'M8 7 L16 17 L12 20 V4 L16 7 L8 17',
    group: 'input',
    kind: 'singleton',
    description: 'Scan for and inspect nearby Bluetooth / BLE devices.',
    hints: ['bluetooth', 'ble', 'ubluetooth', 'aioble']
  },
  {
    id: 'i2c-detect',
    name: 'I²C detect',
    accent: '#8fe0b8',
    border: 'rgba(143,224,184,.5)',
    // address grid
    icon: 'M4 4 h16 v16 H4 Z M4 9 h16 M4 14 h16 M9 4 v16 M14 4 v16',
    group: 'input',
    kind: 'singleton',
    description: 'Scan the I²C bus and list responding device addresses.',
    uses: ['i2c'],
    hints: ['i2c', 'scan']
  }
]

/** Quick id → def lookup built once from {@link INSTRUMENTS}. */
const BY_ID: Record<string, InstrumentDef> = Object.fromEntries(
  INSTRUMENTS.map((d) => [d.id, d])
)

/** Look up one instrument by id (or `undefined` if unknown). */
export function instrumentById(id: string): InstrumentDef | undefined {
  return BY_ID[id]
}

/** Every SINGLETON instrument id (the per-id visibility map's keys). */
export const SINGLETON_IDS: string[] = INSTRUMENTS.filter((d) => d.kind === 'singleton').map(
  (d) => d.id
)

/** Every PIN-kind instrument id (scope/meter — the existing per-pin launchers). */
export const PIN_IDS: string[] = INSTRUMENTS.filter((d) => d.kind === 'pin').map((d) => d.id)

/**
 * Group the registry into the header's `Inputs` vs `Outputs` columns.
 *
 * A `both`-group instrument (the I²C display reads AND writes) is placed by
 * `bothInto` — defaults to `'input'` so it sits with the other I²C/sensor
 * instruments, matching the handoff's "sensibly placed" note — but the caller can
 * override. Order within each group follows registry order. Pure, returns fresh
 * arrays.
 */
export function groupInstruments(
  defs: InstrumentDef[] = INSTRUMENTS,
  bothInto: 'input' | 'output' = 'input'
): { input: InstrumentDef[]; output: InstrumentDef[] } {
  const input: InstrumentDef[] = []
  const output: InstrumentDef[] = []
  for (const d of defs) {
    const target = d.group === 'both' ? bothInto : d.group
    if (target === 'output') output.push(d)
    else input.push(d)
  }
  return { input, output }
}

/**
 * Derive which instruments the active file's code declares as IN-USE.
 *
 * Cheap + best-effort: an instrument is in-use when (a) any of its `uses`
 * peripheral types appears in `parsePins(source)`, OR (b) any of its `hints`
 * substrings appears in the (lower-cased) source — so a driver import like
 * `from mpu6050 import MPU6050` lights the IMU even though `parse-pins` can't
 * classify it. Returns the set of in-use instrument ids. Non-Python / empty
 * source ⇒ empty set. Pure (parse-pins is itself pure + DOM-free), unit-testable.
 */
export function deriveInUse(source: string, isPython: boolean): Set<string> {
  const inUse = new Set<string>()
  if (!isPython || !source) return inUse
  const conns = parsePins(source)
  const usedTypes = new Set<PinType>(conns.map((c) => c.type))
  const lower = source.toLowerCase()
  for (const d of INSTRUMENTS) {
    const byType = d.uses?.some((t) => usedTypes.has(t)) ?? false
    const byHint = d.hints?.some((h) => lower.includes(h)) ?? false
    if (byType || byHint) inUse.add(d.id)
  }
  return inUse
}

/**
 * Whether a placed part's driver `module` is already covered by an IN-USE
 * instrument — so the "your file doesn't import <module>" / "the board is missing
 * <module>" nag can be suppressed for a part the user drives through its
 * INSTRUMENT (the control/telemetry channel) instead of its driver library.
 *
 * A module matches an in-use instrument when that instrument's `id` equals the
 * module OR its `hints` list the module verbatim (e.g. the `servo` instrument's
 * id `servo` / hint `servo` covers the SG90 part's `library.module: servo`). Exact
 * matching only — a fuzzy match could wrongly hide a genuine missing-import.
 * Pure + unit-testable.
 */
export function moduleCoveredByInstrument(module: string, inUse: Set<string>): boolean {
  const m = module.trim().toLowerCase()
  if (!m) return false
  return INSTRUMENTS.some(
    (d) => inUse.has(d.id) && (d.id === m || (d.hints ?? []).includes(m))
  )
}

/**
 * Which instruments can visualise/control each WATCHED-object kind (from a
 * `SNK BIND <name> <kind>` descriptor, emitted by `inst.watch(obj)`). A PWM →
 * Oscilloscope + Servo; an ADC → Multimeter + scope; an I²C bus → the scanner; a
 * bare Pin → LED/Button. So when the user binds a REAL object, the dock lights up
 * the instrument(s) that know how to show it — the type drives the UI.
 */
export const BOUND_KIND_INSTRUMENTS: Record<string, string[]> = {
  pwm: ['scope', 'servo'],
  servo: ['servo'],
  adc: ['meter', 'scope', 'pot'],
  i2c: ['i2c-detect'],
  pin: ['led', 'button']
}

/** The instrument ids to mark in-use for the currently-bound objects (`name→kind`). */
export function instrumentsForBinds(binds: Record<string, string>): Set<string> {
  const out = new Set<string>()
  for (const kind of Object.values(binds)) {
    for (const id of BOUND_KIND_INSTRUMENTS[kind] ?? []) out.add(id)
  }
  return out
}

/**
 * The default per-singleton visibility map: in-use singletons start VISIBLE
 * (prominent), the rest start hidden (discoverable via the palette). The Plotter
 * is always-available, so when nothing marks it in-use we still default it ON so
 * the dock is never empty on first open. Pin-kind ids (scope/meter) are NOT
 * included — their visibility is summoned on open, kept as today.
 */
export function defaultVisibility(inUse: Set<string>): Record<string, boolean> {
  const vis: Record<string, boolean> = {}
  for (const id of SINGLETON_IDS) {
    vis[id] = inUse.has(id) || id === 'plotter'
  }
  return vis
}

/**
 * Filter the registry for the "Add instrument" palette by a search query.
 *
 * Matches the query (case-insensitive, trimmed) against the instrument NAME and
 * DESCRIPTION; an empty query returns everything (so the palette opens showing
 * the full catalogue). Order follows registry order. Pure + unit-testable.
 */
export function filterPalette(query: string, defs: InstrumentDef[] = INSTRUMENTS): InstrumentDef[] {
  const q = query.trim().toLowerCase()
  if (!q) return defs.slice()
  return defs.filter(
    (d) => d.name.toLowerCase().includes(q) || d.description.toLowerCase().includes(q)
  )
}

/**
 * Per-instrument visibility flags (the grouped dock-header toggles), keyed by the
 * registry id — `scope` / `meter` for the per-pin instruments, plus every
 * singleton id (`plotter`, `gamepad`, …). A missing key reads as hidden. Extended
 * (#119) from the old fixed `{scope,meter,plotter}` shape so the dock can host the
 * full ~13-instrument set off one map.
 */
export type InstrumentVisibility = Record<string, boolean>

/** Read one instrument's visibility from the map (missing ⇒ hidden). */
export function isVisible(vis: InstrumentVisibility, id: string): boolean {
  return vis[id] === true
}

/**
 * Migrate a persisted visibility value into a full, current-shape map.
 *
 * Tolerates the OLD `{scope,meter,plotter}` shape (or any partial/garbage from a
 * previous version) stored in localStorage: every singleton id gets a concrete
 * boolean — using the persisted value when present, else `defaults[id]` (the
 * in-use-derived default), else `false`. `scope`/`meter` (per-pin kinds) keep
 * their persisted value (default hidden — they're summoned on open). Pure;
 * always returns a fresh map covering exactly the registry ids.
 */
export function normaliseVisibility(
  persisted: Partial<InstrumentVisibility> | undefined,
  defaults: Record<string, boolean>
): InstrumentVisibility {
  const p = persisted ?? {}
  const out: InstrumentVisibility = {}
  // Per-pin kinds: default hidden (summoned on open), honour any persisted value.
  for (const id of PIN_IDS) {
    out[id] = p[id] === true
  }
  for (const id of SINGLETON_IDS) {
    out[id] = typeof p[id] === 'boolean' ? (p[id] as boolean) : (defaults[id] ?? false)
  }
  return out
}
