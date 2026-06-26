/**
 * Built-in board registry for the Board View.
 *
 * Each entry is a {@link BoardDefinition} (the same shape a user authors as JSON
 * — see `docs/board.md`). The Board View's generic SVG drawer renders any of
 * these, and a parsed `Pin(...)` token is matched to a pad by `gpio` (numeric)
 * or `label` (case-insensitive, `GP12`/`12` equivalent).
 *
 * PINOUT ACCURACY (#109): the headers below follow each board's REAL physical
 * edge order (so a wire lands on the right castellation), power/ground pads carry
 * a `type` so they're drawn as rails (never wired), and the `features` are placed
 * at their true normalised positions (USB connector, MCU, wifi can, LED). The
 * pinouts are transcribed from the published reference pinouts:
 *   • Raspberry Pi Pico-series datasheet (the 2×20 header is identical across the
 *     whole Pico family, including the Pico 2 W) — left = physical pins 1..20,
 *     right = physical pins 40..21 read top→bottom.
 *   • Pimoroni Pico Plus 2 (Pico form factor; same 2×20 order + USB-C + a Qw/ST
 *     STEMMA-QT/Qwiic I²C connector + an SP/E debug connector).
 *   • Pimoroni Tiny 2040 / Tiny 2350 (tiny castellated boards; pads run down the
 *     two LONG edges → modelled on `left` + `right`, i.e. VERTICAL pins per #109).
 *   • Espressif ESP32-DevKitC (ESP32-WROOM-32, the common 30-pin variant).
 * A user can still override any built-in by dropping a JSON file with the same
 * `id` into `<userData>/boards/`.
 */

import type { BoardDefinition, BoardPad } from '../../../shared/board'

export type {
  BoardDefinition,
  BoardPad,
  BoardPadType,
  BoardHeader,
  BoardFeature
} from '../../../shared/board'

/** Helper: a GPIO pad whose label is `GP<n>` (the RP2040/RP2350 convention). */
function gp(n: number): BoardPad {
  return { gpio: n, label: `GP${n}` }
}

/** Helper: a ground pad (`GND`). */
function gnd(): BoardPad {
  return { label: 'GND', type: 'gnd' }
}

/** Helper: a power-rail pad (e.g. `3V3`, `5V`, `VBUS`, `VSYS`, `VIN`). */
function vcc(label: string): BoardPad {
  return { label, type: 'vcc' }
}

/** Helper: a non-GPIO signal pad (e.g. `RUN`, `EN`, `ADC_VREF`). */
function other(label: string): BoardPad {
  return { label, type: 'other' }
}

/**
 * Raspberry Pi Pico 2 W — RP2350 + CYW43439 wifi, green PCB, micro-USB at the
 * top. The standard Pico 2×20 castellated header (identical pin order across the
 * Pico family): left edge = physical pins 1..20 (top→bottom), right edge =
 * physical pins 40..21 (top→bottom). The onboard LED is driven via the CYW43
 * wireless chip — in MicroPython it's `Pin("LED")`, not a GPIO number.
 */
const PICO2W: BoardDefinition = {
  id: 'pico2w',
  name: 'Raspberry Pi Pico 2 W',
  mcu: 'RP2350',
  pcbColor: '#0f5a2e',
  aspect: 0.46,
  ledLabel: 'LED',
  features: [
    // micro-USB at the top centre, RP2350 mid-board, CYW43439 wifi can near the
    // top edge (just below the USB), like the real silk/can placement.
    { label: 'USB', kind: 'usb', x: 0.36, y: -0.035, w: 0.28, h: 0.05 },
    { label: 'CYW43439', kind: 'wifi', x: 0.22, y: 0.08, w: 0.56, h: 0.1 },
    { label: 'RP2350', kind: 'mcu', x: 0.28, y: 0.44, w: 0.44, h: 0.2 }
  ],
  headers: [
    {
      // Physical pins 1..20 (top→bottom on the left edge).
      edge: 'left',
      pins: [
        gp(0), gp(1), gnd(), gp(2), gp(3), gp(4), gp(5), gnd(), gp(6), gp(7),
        gp(8), gp(9), gnd(), gp(10), gp(11), gp(12), gp(13), gnd(), gp(14), gp(15)
      ]
    },
    {
      // Physical pins 40..21 (top→bottom on the right edge).
      edge: 'right',
      pins: [
        vcc('VBUS'), vcc('VSYS'), gnd(), other('3V3_EN'), vcc('3V3'),
        other('ADC_VREF'), gp(28), gnd(), gp(27), gp(26), other('RUN'), gp(22),
        gnd(), gp(21), gp(20), gp(19), gp(18), gnd(), gp(17), gp(16)
      ]
    }
  ]
}

/**
 * Pimoroni Pico Plus 2 — RP2350 in the Pico form factor (so the SAME 2×20 header
 * order as the Pico), dark PCB, but a USB-C connector, 16MB flash + 8MB PSRAM, a
 * Qw/ST (STEMMA-QT / Qwiic I²C) connector and an SP/E (debug) connector on the
 * board. Onboard user LED on GP25 (drawn as the LED dot), plus an RGB LED.
 */
const PICO_PLUS_2: BoardDefinition = {
  id: 'pico-plus-2',
  name: 'Pimoroni Pico Plus 2',
  mcu: 'RP2350',
  pcbColor: '#23202b',
  aspect: 0.46,
  ledLabel: '25',
  features: [
    { label: 'USB-C', kind: 'usb', x: 0.34, y: -0.04, w: 0.32, h: 0.055 },
    { label: 'RP2350', kind: 'mcu', x: 0.28, y: 0.42, w: 0.44, h: 0.2 },
    // Qw/ST (STEMMA-QT) + SP/E (debug) connectors on the bottom edge area.
    { label: 'Qw/ST', kind: 'chip', x: 0.18, y: 0.86, w: 0.3, h: 0.08 },
    { label: 'SP/E', kind: 'chip', x: 0.54, y: 0.86, w: 0.28, h: 0.08 }
  ],
  headers: [
    {
      edge: 'left',
      pins: [
        gp(0), gp(1), gnd(), gp(2), gp(3), gp(4), gp(5), gnd(), gp(6), gp(7),
        gp(8), gp(9), gnd(), gp(10), gp(11), gp(12), gp(13), gnd(), gp(14), gp(15)
      ]
    },
    {
      edge: 'right',
      pins: [
        vcc('VBUS'), vcc('VSYS'), gnd(), other('3V3_EN'), vcc('3V3'),
        other('ADC_VREF'), gp(28), gnd(), gp(27), gp(26), other('RUN'), gp(22),
        gnd(), gp(21), gp(20), gp(19), gp(18), gnd(), gp(17), gp(16)
      ]
    }
  ]
}

/**
 * Pimoroni Tiny 2040 — RP2040 in a tiny ~22.9×18.2mm purple PCB with castellated
 * pads down the two LONG edges and a USB-C on the top short end. Per #109 the
 * pins run VERTICALLY → modelled as `left` + `right` headers. Breaks out ~12
 * GPIO + power; onboard RGB LED (R=GP18, G=GP19, B=GP20). The four ADC pads are
 * the high GPIO (A0=GP29, A1=GP28, A2=GP27, A3=GP26).
 *
 * Left edge (USB at top), top→bottom:  5V, GND, 3V3, GP0, GP1, GP2, GP3
 * Right edge (USB at top), top→bottom: GP7, GP6, GP5, GP4, A3, A2, A1, A0
 */
const TINY_2040: BoardDefinition = {
  id: 'tiny2040',
  name: 'Pimoroni Tiny 2040',
  mcu: 'RP2040',
  pcbColor: '#3a1d52',
  aspect: 0.78,
  // RGB LED — lit when any channel (GP18/19/20) is driven, or the "LED" token.
  ledLabel: 'LED',
  features: [
    { label: 'USB-C', kind: 'usb', x: 0.34, y: -0.06, w: 0.32, h: 0.1 },
    { label: 'RP2040', kind: 'mcu', x: 0.3, y: 0.36, w: 0.4, h: 0.3 },
    { label: 'RGB', kind: 'led', x: 0.4, y: 0.74, w: 0.2, h: 0.12 }
  ],
  headers: [
    {
      edge: 'left',
      pins: [vcc('5V'), gnd(), vcc('3V3'), gp(0), gp(1), gp(2), gp(3)]
    },
    {
      edge: 'right',
      pins: [
        gp(7), gp(6), gp(5), gp(4),
        { gpio: 26, label: 'A3' },
        { gpio: 27, label: 'A2' },
        { gpio: 28, label: 'A1' },
        { gpio: 29, label: 'A0' }
      ]
    }
  ]
}

/**
 * Pimoroni Tiny 2350 — RP2350 in the same tiny castellated form factor + RGB LED
 * as the Tiny 2040, USB-C top end, pins running VERTICALLY (`left` + `right`).
 * Same broken-out pin set as the Tiny 2040 (GP0–GP7 + the four ADC pads
 * A0=GP29..A3=GP26), RP2350 MCU. RGB LED on GP18/GP19/GP20.
 *
 * Left edge (USB at top), top→bottom:  5V, GND, 3V3, GP0, GP1, GP2, GP3
 * Right edge (USB at top), top→bottom: GP7, GP6, GP5, GP4, A3, A2, A1, A0
 */
const TINY_2350: BoardDefinition = {
  id: 'tiny2350',
  name: 'Pimoroni Tiny 2350',
  mcu: 'RP2350',
  pcbColor: '#2a1745',
  aspect: 0.78,
  ledLabel: 'LED',
  features: [
    { label: 'USB-C', kind: 'usb', x: 0.34, y: -0.06, w: 0.32, h: 0.1 },
    { label: 'RP2350', kind: 'mcu', x: 0.3, y: 0.36, w: 0.4, h: 0.3 },
    { label: 'RGB', kind: 'led', x: 0.4, y: 0.74, w: 0.2, h: 0.12 }
  ],
  headers: [
    {
      edge: 'left',
      pins: [vcc('5V'), gnd(), vcc('3V3'), gp(0), gp(1), gp(2), gp(3)]
    },
    {
      edge: 'right',
      pins: [
        gp(7), gp(6), gp(5), gp(4),
        { gpio: 26, label: 'A3' },
        { gpio: 27, label: 'A2' },
        { gpio: 28, label: 'A1' },
        { gpio: 29, label: 'A0' }
      ]
    }
  ]
}

/** Helper: an ESP32 IO pad whose label is `IO<n>` and gpio is `n`. */
function io(n: number): BoardPad {
  return { gpio: n, label: `IO${n}` }
}

/**
 * ESP32-DevKitC (ESP32-WROOM-32) — the common 30-pin DevKit: the WROOM-32 module
 * (metal can) at the TOP and a micro-USB at the BOTTOM, two long 15-pin headers.
 * Held USB-down, the labels run top→bottom:
 *
 *   Left edge:  3V3, EN, IO36(VP), IO39(VN), IO34, IO35, IO32, IO33, IO25, IO26,
 *               IO27, IO14, IO12, GND, IO13
 *   Right edge: VIN, GND, IO23, IO22, IO1(TX0), IO3(RX0), IO21, IO19, IO18, IO5,
 *               IO17, IO16, IO4, IO0, IO2
 *
 * IO34/35/36/39 are input-only. Many DevKitC clones wire an onboard LED to GPIO2
 * (the on-module LED varies by clone; GPIO2 is the most common).
 */
const ESP32_DEVKIT: BoardDefinition = {
  id: 'esp32-devkit',
  name: 'ESP32 DevKit',
  mcu: 'ESP32',
  pcbColor: '#1b2733',
  aspect: 0.42,
  ledLabel: '2',
  features: [
    { label: 'ESP32-WROOM-32', kind: 'wifi', x: 0.14, y: 0.05, w: 0.72, h: 0.22 },
    { label: 'USB', kind: 'usb', x: 0.36, y: 0.95, w: 0.28, h: 0.05 }
  ],
  headers: [
    {
      edge: 'left',
      pins: [
        vcc('3V3'), other('EN'),
        { gpio: 36, label: 'IO36' },
        { gpio: 39, label: 'IO39' },
        io(34), io(35), io(32), io(33), io(25), io(26), io(27), io(14), io(12),
        gnd(), io(13)
      ]
    },
    {
      edge: 'right',
      pins: [
        vcc('VIN'), gnd(),
        io(23), io(22),
        { gpio: 1, label: 'TX0' },
        { gpio: 3, label: 'RX0' },
        io(21), io(19), io(18), io(5), io(17), io(16), io(4), io(0), io(2)
      ]
    }
  ]
}

/** All built-in boards, in selector order. `pico2w` is the default. */
export const BUILTIN_BOARDS: BoardDefinition[] = [
  PICO2W,
  PICO_PLUS_2,
  TINY_2040,
  TINY_2350,
  ESP32_DEVKIT
]

/** The board shown by default (and when a saved selection no longer exists). */
export const DEFAULT_BOARD_ID = 'pico2w'

/**
 * Merge built-in boards with user-authored ones, with a user board overriding a
 * built-in of the same id. Order: built-ins first (in registry order), then any
 * extra user boards appended in their given order.
 */
export function mergeBoards(user: BoardDefinition[]): BoardDefinition[] {
  const byId = new Map<string, BoardDefinition>()
  for (const b of BUILTIN_BOARDS) byId.set(b.id, b)
  const extra: BoardDefinition[] = []
  for (const b of user) {
    if (!b || typeof b.id !== 'string') continue
    if (byId.has(b.id)) byId.set(b.id, b)
    else extra.push(b)
  }
  // Built-ins keep their registry order; overrides replace in place.
  const ordered = BUILTIN_BOARDS.map((b) => byId.get(b.id) ?? b)
  return [...ordered, ...extra]
}

/**
 * Best-effort: infer a board id from REPL/console text (#168). MicroPython's
 * friendly banner reads like `MicroPython v1.24 on 2024-…; Raspberry Pi Pico 2 W
 * with RP2350` — we match the description against board NAMES (most specific
 * wins), then fall back to a UNIQUE mcu match (several boards are RP2350, so an
 * ambiguous mcu yields nothing rather than a wrong guess). Returns null when
 * nothing is confidently matched. Pure + total (never throws) so it's unit-tested.
 */
export function boardIdFromReplText(replText: string, boards: BoardDefinition[] = BUILTIN_BOARDS): string | null {
  if (!replText) return null
  const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim()
  const text = norm(replText)

  /** The longest board whose NAME appears verbatim in `hay` (most specific wins). */
  const byName = (hay: string): BoardDefinition | null => {
    let best: BoardDefinition | null = null
    for (const b of boards) {
      const bn = norm(b.name)
      if (bn && hay.includes(bn) && (!best || norm(best.name).length < bn.length)) best = b
    }
    return best
  }
  /** The board for an mcu string, only when exactly one board has that mcu. */
  const byUniqueMcu = (mcu: string): BoardDefinition | null => {
    const m = norm(mcu)
    if (!m) return null
    const hits = boards.filter((b) => norm(b.mcu) === m)
    return hits.length === 1 ? hits[0] : null
  }

  // 1) Parse the MicroPython banner(s); the LAST one wins (most recent boot).
  const re = /micropython\s+v\S+\s+on\s+[^;]*;\s*(.+?)\s+with\s+([a-z0-9-]+)/gi
  let desc = ''
  let mcu = ''
  for (let m = re.exec(replText); m !== null; m = re.exec(replText)) {
    desc = norm(m[1])
    mcu = norm(m[2])
  }
  if (desc) {
    const n = byName(desc)
    if (n) return n.id
    const m = byUniqueMcu(mcu)
    if (m) return m.id
  }

  // 2) No usable banner — scan the whole console for a board name, then unique mcu.
  const n2 = byName(text)
  if (n2) return n2.id
  for (const b of boards) {
    if (text.includes(norm(b.mcu)) && byUniqueMcu(b.mcu)) return b.id
  }
  return null
}
