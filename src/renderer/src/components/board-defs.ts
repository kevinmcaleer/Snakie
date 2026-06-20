/**
 * Built-in board registry for the Board View.
 *
 * Each entry is a {@link BoardDefinition} (the same shape a user authors as JSON
 * — see `docs/board.md`). The Board View's generic SVG drawer renders any of
 * these, and a parsed `Pin(...)` token is matched to a pad by `gpio` (numeric)
 * or `label` (case-insensitive, `GP12`/`12` equivalent).
 *
 * The pinouts are **best-effort and recognisable**, not guaranteed pin-perfect;
 * users can override any built-in by dropping a JSON file with the same `id`
 * into `<userData>/boards/`.
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

/** Helper: a power/ground/marker pad with no GPIO. */
function mark(label: string): BoardPad {
  return { label }
}

/**
 * Raspberry Pi Pico 2 W — RP2350, green PCB. The standard 2×20 castellated
 * header: left edge GP0..GP19-ish with power markers, right edge GP28..GP6.
 */
const PICO2W: BoardDefinition = {
  id: 'pico2w',
  name: 'Raspberry Pi Pico 2 W',
  mcu: 'RP2350',
  pcbColor: '#0f5a2e',
  aspect: 0.52,
  ledLabel: 'LED',
  features: [
    { label: 'RP2350', kind: 'mcu', x: 0.32, y: 0.42, w: 0.36, h: 0.18 },
    { label: 'CYW43439', kind: 'wifi', x: 0.12, y: 0.08, w: 0.42, h: 0.13 }
  ],
  headers: [
    {
      edge: 'left',
      pins: [
        gp(0), gp(1), mark('GND'), gp(2), gp(3), gp(4), gp(5), mark('GND'),
        gp(6), gp(7), gp(8), gp(9), mark('GND'), gp(10), gp(11), gp(12),
        gp(13), mark('GND'), gp(14), gp(15)
      ]
    },
    {
      edge: 'right',
      pins: [
        mark('VBUS'), mark('VSYS'), mark('GND'), mark('3V3_EN'), mark('3V3'),
        mark('ADC_VREF'), gp(28), mark('GND'), gp(27), gp(26), mark('RUN'),
        gp(22), mark('GND'), gp(21), gp(20), gp(19), gp(18), mark('GND'),
        gp(17), gp(16)
      ]
    }
  ]
}

/**
 * Pimoroni Pico Plus 2 — RP2350 in the Pico form factor, dark purple/black PCB,
 * USB-C, 8MB flash + 16MB PSRAM, QwST (I2C) + SP/E connectors. Same 2×20 layout
 * as the Pico with extra silk labels.
 */
const PICO_PLUS_2: BoardDefinition = {
  id: 'pico-plus-2',
  name: 'Pimoroni Pico Plus 2',
  mcu: 'RP2350',
  pcbColor: '#23202b',
  aspect: 0.52,
  ledLabel: 'LED',
  features: [
    { label: 'RP2350', kind: 'mcu', x: 0.32, y: 0.42, w: 0.36, h: 0.18 },
    { label: 'USB-C', kind: 'usb', x: 0.36, y: -0.02, w: 0.28, h: 0.06 },
    { label: 'QwST', kind: 'chip', x: 0.66, y: 0.08, w: 0.26, h: 0.1 },
    { label: 'SP/EN', kind: 'chip', x: 0.66, y: 0.22, w: 0.26, h: 0.1 }
  ],
  headers: [
    {
      edge: 'left',
      pins: [
        gp(0), gp(1), mark('GND'), gp(2), gp(3), gp(4), gp(5), mark('GND'),
        gp(6), gp(7), gp(8), gp(9), mark('GND'), gp(10), gp(11), gp(12),
        gp(13), mark('GND'), gp(14), gp(15)
      ]
    },
    {
      edge: 'right',
      pins: [
        mark('VBUS'), mark('VSYS'), mark('GND'), mark('3V3_EN'), mark('3V3'),
        mark('ADC_VREF'), gp(28), mark('GND'), gp(27), gp(26), mark('RUN'),
        gp(22), mark('GND'), gp(21), gp(20), gp(19), gp(18), mark('GND'),
        gp(17), gp(16)
      ]
    }
  ]
}

/**
 * Pimoroni Tiny 2040 — RP2040 in a tiny ~22.9×18.2mm purple PCB, castellated
 * pads on the top + bottom edges, onboard RGB LED, ~12 broken-out GPIO.
 */
const TINY_2040: BoardDefinition = {
  id: 'tiny2040',
  name: 'Pimoroni Tiny 2040',
  mcu: 'RP2040',
  pcbColor: '#3a1d52',
  aspect: 1.26,
  ledLabel: 'LED',
  features: [
    { label: 'RP2040', kind: 'mcu', x: 0.36, y: 0.34, w: 0.28, h: 0.32 },
    { label: 'USB-C', kind: 'usb', x: 0.4, y: -0.04, w: 0.2, h: 0.08 }
  ],
  headers: [
    {
      edge: 'top',
      pins: [mark('5V'), mark('GND'), gp(0), gp(1), gp(2), gp(3), gp(4)]
    },
    {
      edge: 'bottom',
      pins: [
        gp(7), gp(6), gp(5),
        { gpio: 29, label: 'A3' },
        { gpio: 28, label: 'A2' },
        { gpio: 27, label: 'A1' },
        { gpio: 26, label: 'A0' }
      ]
    }
  ]
}

/**
 * Pimoroni Tiny 2350 — RP2350 in the same tiny castellated form factor as the
 * Tiny 2040, onboard RGB LED, GP0–GP7 + GP26–GP29 analogue.
 */
const TINY_2350: BoardDefinition = {
  id: 'tiny2350',
  name: 'Pimoroni Tiny 2350',
  mcu: 'RP2350',
  pcbColor: '#2a1745',
  aspect: 1.26,
  ledLabel: 'LED',
  features: [
    { label: 'RP2350', kind: 'mcu', x: 0.36, y: 0.34, w: 0.28, h: 0.32 },
    { label: 'USB-C', kind: 'usb', x: 0.4, y: -0.04, w: 0.2, h: 0.08 }
  ],
  headers: [
    {
      edge: 'top',
      pins: [mark('5V'), mark('GND'), gp(0), gp(1), gp(2), gp(3), gp(4)]
    },
    {
      edge: 'bottom',
      pins: [
        gp(7), gp(6), gp(5),
        { gpio: 29, label: 'A3' },
        { gpio: 28, label: 'A2' },
        { gpio: 27, label: 'A1' },
        { gpio: 26, label: 'A0' }
      ]
    }
  ]
}

/** Helper: an ESP32 IO pad whose label is `IO<n>` and gpio is `n`. */
function io(n: number): BoardPad {
  return { gpio: n, label: `IO${n}` }
}

/**
 * ESP32 DevKit (DevKitC) — ESP32, dark-blue/black PCB, two long headers of ~15
 * pins each with the classic DevKitC labels. The `IOxx` pads carry their numeric
 * gpio so a numeric `Pin(23)` matches; IO34..IO39 are input-only.
 */
const ESP32_DEVKIT: BoardDefinition = {
  id: 'esp32-devkit',
  name: 'ESP32 DevKit',
  mcu: 'ESP32',
  pcbColor: '#1b2733',
  aspect: 0.46,
  features: [
    { label: 'ESP32-WROOM', kind: 'wifi', x: 0.18, y: 0.06, w: 0.64, h: 0.2 },
    { label: 'USB', kind: 'usb', x: 0.36, y: 0.92, w: 0.28, h: 0.07 }
  ],
  headers: [
    {
      edge: 'left',
      pins: [
        mark('3V3'), mark('EN'), io(36), io(39), io(34), io(35), io(32),
        io(33), io(25), io(26), io(27), io(14), io(12), mark('GND'), io(13)
      ]
    },
    {
      edge: 'right',
      pins: [
        mark('VIN'), mark('GND'), io(23), io(22), mark('TX0'), mark('RX0'),
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
