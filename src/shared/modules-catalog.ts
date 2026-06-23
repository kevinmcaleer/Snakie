/**
 * SNAKIE MODULE CATALOG (#120) — "Make Snakie modular".
 * =============================================================================
 *
 * The dock exposes ~13 instrument panels (Range, IMU, LED, …; see the renderer's
 * `instruments-registry.ts`). Each panel speaks to a *real* MicroPython driver on
 * the board — an `ssd1306` display driver, an `hcsr04` ultrasonic helper, an
 * `mpu6050` IMU driver, and so on. Rather than dumping every driver onto every
 * board, #120 makes installs MODULAR: the user installs ONLY the driver behind
 * the instrument they're actually wiring up.
 *
 * This file is the single, typed source of truth for those installable modules.
 * It is deliberately **dependency-free** (no React, no Electron, no node) — the
 * same wire-format-core discipline as `control.ts` — so it can be imported from:
 *   - the MAIN process (resolve a bundled `.py` / build a `mip` install plan),
 *   - the PRELOAD bridge (typings),
 *   - the RENDERER (the Modules manager UI + its installed-vs-available diffing),
 * and so the pure lookup/diff/resolve logic below is unit-testable in plain node.
 *
 * Each module maps to ONE dock instrument id (`instrument`), so the Modules
 * manager can group "what powers the Range view" vs "what powers the IMU view".
 * Those instrument ids MUST stay in sync with the renderer's `INSTRUMENTS`
 * registry ids (`range`, `imu`, `led`, `encoder`, `i2c-display`, `buzzer`,
 * `gamepad`, …) — they are restated here as a string union rather than imported,
 * to keep this module renderer-free.
 *
 * A module's `source` is EITHER:
 *   - `{ kind: 'bundled', file }` — a tiny, MIT-licensed driver stub SHIPPED with
 *     the app under `micropython/modules/<file>`. The main process reads it and
 *     writes it to the board over the raw REPL (the #108 instrument-library
 *     install path, generalised). Preferred for small drivers we can ship.
 *   - `{ kind: 'mip', spec }` — an official `mip` / `github:` spec (e.g.
 *     `'github:stlehmann/micropython-ssd1306/ssd1306.py'`). The main process
 *     builds a `mip.install(spec)` snippet (the #20 package-install path) for the
 *     renderer to run on the device. Used for drivers too large / not ours to
 *     vendor, so we reference the upstream source instead of copying it.
 */

/**
 * The dock instrument a module powers. A STRING-UNION mirror of the renderer's
 * `INSTRUMENTS[].id` values (kept renderer-free on purpose — see the file
 * header). Only the ids that have an installable driver behind them are listed.
 */
export type InstrumentId =
  | 'i2c-display'
  | 'range'
  | 'imu'
  | 'led'
  | 'encoder'
  | 'buzzer'
  | 'gamepad'

/** Where a module's code comes from. */
export type ModuleSource =
  | {
      /** A small driver stub SHIPPED with the app (`micropython/modules/<file>`). */
      kind: 'bundled'
      /** The bundled file's basename, e.g. `ssd1306.py`. */
      file: string
    }
  | {
      /** An upstream driver installed on-device via MicroPython's `mip`. */
      kind: 'mip'
      /**
       * The `mip` install spec — a package name, or a `github:`/`https:` spec,
       * e.g. `'github:stlehmann/micropython-ssd1306/ssd1306.py'`.
       */
      spec: string
    }

/** One installable module — a driver behind a dock instrument. */
export interface ModuleDef {
  /** Stable id (the catalog key + the install-path basename for bundled stubs). */
  id: string
  /** Display name shown in the Modules manager row. */
  name: string
  /** One-line description of what the driver is / which hardware it talks to. */
  description: string
  /** The dock instrument this module powers (groups the Modules manager). */
  instrument: InstrumentId
  /**
   * The Python module name it becomes importable as on the board, e.g. `ssd1306`
   * (from `import ssd1306`). Used to PROBE whether it's already installed (a
   * cheap `import <name>` on the device) and to tell the user what to import.
   */
  importName: string
  /** Where the code comes from: a bundled stub or an upstream `mip` spec. */
  source: ModuleSource
  /** SPDX licence id for bundled stubs (documents provenance). */
  license?: string
}

/**
 * THE catalog — every installable module, grouped (by `instrument`) for the
 * Modules manager. Drivers map to the instruments they power per #120 / the
 * panel issues it references (#118 display, #112 range, #111 IMU, #114 LED,
 * #117 encoder, plus the buzzer/teleop helpers).
 *
 * Bundled stubs are tiny, self-contained, MIT-licensed register drivers shipped
 * under `micropython/modules/`; larger / community-owned drivers reference their
 * upstream `mip`/`github:` spec instead of being vendored.
 */
export const MODULES: ModuleDef[] = [
  // --- I²C display (#118) --------------------------------------------------
  {
    id: 'ssd1306',
    name: 'SSD1306 OLED',
    description: 'I²C / SPI driver for the SSD1306 128×64 monochrome OLED display.',
    instrument: 'i2c-display',
    importName: 'ssd1306',
    // Upstream MicroPython official driver — referenced, not vendored.
    source: { kind: 'mip', spec: 'github:stlehmann/micropython-ssd1306/ssd1306.py' }
  },
  {
    id: 'sh1106',
    name: 'SH1106 OLED',
    description: 'I²C / SPI driver for the SH1106 128×64 OLED (1.3" displays).',
    instrument: 'i2c-display',
    importName: 'sh1106',
    source: { kind: 'mip', spec: 'github:robert-hh/SH1106/sh1106.py' }
  },

  // --- Range (#112) --------------------------------------------------------
  {
    id: 'hcsr04',
    name: 'HC-SR04 ultrasonic',
    description: 'Driver for the HC-SR04 ultrasonic range finder (trigger/echo pins).',
    instrument: 'range',
    importName: 'hcsr04',
    // Small enough + MIT — bundled as a stub.
    source: { kind: 'bundled', file: 'hcsr04.py' },
    license: 'MIT'
  },
  {
    id: 'vl53l0x',
    name: 'VL53L0X ToF',
    description: 'I²C driver for the VL53L0X time-of-flight distance sensor.',
    instrument: 'range',
    importName: 'vl53l0x',
    source: { kind: 'mip', spec: 'github:kevinmcaleer/vl53l0x/vl53l0x.py' }
  },
  {
    id: 'vl53l1x',
    name: 'VL53L1X ToF',
    description: 'I²C driver for the longer-range VL53L1X time-of-flight sensor.',
    instrument: 'range',
    importName: 'vl53l1x',
    source: { kind: 'mip', spec: 'github:drakxtwo/vl53l1x_pico/vl53l1x.py' }
  },

  // --- IMU (#111) ----------------------------------------------------------
  {
    id: 'mpu6050',
    name: 'MPU-6050 IMU',
    description: '6-axis accelerometer + gyro over I²C (the common MPU-6050).',
    instrument: 'imu',
    importName: 'mpu6050',
    source: { kind: 'bundled', file: 'mpu6050.py' },
    license: 'MIT'
  },
  {
    id: 'bno055',
    name: 'BNO055 IMU',
    description: '9-axis absolute-orientation IMU with on-chip sensor fusion.',
    instrument: 'imu',
    importName: 'bno055',
    source: { kind: 'mip', spec: 'github:micropython-IMU/micropython-bno055/bno055.py' }
  },
  {
    id: 'lsm6ds',
    name: 'LSM6DS IMU',
    description: '6-axis accelerometer + gyro (LSM6DSOX / LSM6DS33) over I²C.',
    instrument: 'imu',
    importName: 'lsm6dsox',
    source: {
      kind: 'mip',
      spec: 'github:jposada202020/MicroPython_LSM6DSOX/micropython_lsm6dsox'
    }
  },

  // --- LED (#114) ----------------------------------------------------------
  {
    id: 'neopixel',
    name: 'NeoPixel (WS2812)',
    description: 'WS2812 / NeoPixel addressable RGB LED strip driver.',
    instrument: 'led',
    importName: 'neopixel_ws2812',
    // `neopixel` is a FROZEN built-in on most ports; this stub is a tiny
    // bit-banged fallback for ports that lack it. (See the file's comment.)
    source: { kind: 'bundled', file: 'neopixel_ws2812.py' },
    license: 'MIT'
  },

  // --- Encoder (#117) ------------------------------------------------------
  {
    id: 'rotary',
    name: 'Rotary encoder',
    description: 'Helper for a quadrature rotary encoder (counts steps + direction).',
    instrument: 'encoder',
    importName: 'rotary',
    source: { kind: 'bundled', file: 'rotary.py' },
    license: 'MIT'
  },

  // --- Buzzer --------------------------------------------------------------
  {
    id: 'buzzer',
    name: 'Buzzer (tones / RTTTL)',
    description: 'Play tones and RTTTL melodies on a piezo buzzer via PWM.',
    instrument: 'buzzer',
    importName: 'buzzer',
    source: { kind: 'bundled', file: 'buzzer.py' },
    license: 'MIT'
  },

  // --- Gamepad / teleop ----------------------------------------------------
  {
    id: 'teleop',
    name: 'Teleop receiver',
    description: 'Apply Gamepad/teleop axes from the IDE control channel to motors.',
    instrument: 'gamepad',
    importName: 'teleop',
    source: { kind: 'bundled', file: 'teleop.py' },
    license: 'MIT'
  }
]

/** Quick id → def lookup, built once from {@link MODULES}. */
const BY_ID: Record<string, ModuleDef> = Object.fromEntries(MODULES.map((m) => [m.id, m]))

/** Look up one module by id (or `undefined` if unknown). Pure. */
export function moduleById(id: string): ModuleDef | undefined {
  return BY_ID[id]
}

/** Every module powering a given instrument, in catalog order. Pure. */
export function modulesForInstrument(instrument: InstrumentId): ModuleDef[] {
  return MODULES.filter((m) => m.instrument === instrument)
}

/** One instrument's modules, grouped together for the Modules manager. */
export interface ModuleGroup {
  /** The instrument id these modules power. */
  instrument: InstrumentId
  /** The modules, in catalog order. */
  modules: ModuleDef[]
}

/**
 * Group the catalog by instrument, preserving first-seen instrument order and
 * per-instrument catalog order. Pure; returns fresh arrays so the UI can map
 * over stable groups (the Modules manager renders one section per instrument).
 */
export function groupByInstrument(defs: ModuleDef[] = MODULES): ModuleGroup[] {
  const order: InstrumentId[] = []
  const byInstrument = new Map<InstrumentId, ModuleDef[]>()
  for (const m of defs) {
    let bucket = byInstrument.get(m.instrument)
    if (!bucket) {
      bucket = []
      byInstrument.set(m.instrument, bucket)
      order.push(m.instrument)
    }
    bucket.push(m)
  }
  return order.map((instrument) => ({ instrument, modules: byInstrument.get(instrument) ?? [] }))
}

/** The `/lib` directory bundled modules install into (created before writing). */
export const MODULES_LIB_DIR = '/lib'

/**
 * The on-device install path for a BUNDLED module: `/lib/<file>` (the standard
 * MicroPython import path — a module on `/lib` is `import`able from anywhere),
 * mirroring the instrument library's `/lib/instruments.py`. Returns `undefined`
 * for `mip` modules — `mip` chooses its own on-device path (`/lib/<pkg>/…`), so
 * there is no single deterministic file to write. Pure.
 */
export function installPathFor(def: ModuleDef): string | undefined {
  return def.source.kind === 'bundled' ? `${MODULES_LIB_DIR}/${def.source.file}` : undefined
}

/**
 * The cheap device probe sentinel: printed iff `import <name>` succeeds on the
 * board. We probe by IMPORT (not by `stat`ing a path) because `mip` modules may
 * land at a non-deterministic path but are always importable once installed.
 */
export const MODULE_PRESENT = '<<SNAKIE_MOD_PRESENT>>'

/**
 * Build the cheap device probe that decides whether a module is already
 * installed: `__import__(<name>)` succeeds (prints {@link MODULE_PRESENT}) iff
 * the driver is importable on the board. Pure (string-only); never throws on the
 * device (the import is wrapped in try/except).
 */
export function importProbeSnippet(importName: string): string {
  // importName is a catalog constant (a bare module name) so it never contains
  // quotes — but sanitise defensively all the same to a safe identifier.
  const name = importName.replace(/[^A-Za-z0-9_]/g, '')
  return [
    'try:',
    `    __import__('${name}')`,
    `    print('${MODULE_PRESENT}')`,
    'except Exception:',
    '    pass'
  ].join('\n')
}

/**
 * The Modules manager's per-module install status. `installed` ⇒ importable on
 * the board; `available` ⇒ in the catalog but not (yet) on the board; `unknown`
 * ⇒ not probed (no connection / probe not run).
 */
export type ModuleStatus = 'installed' | 'available' | 'unknown'

/**
 * Diff the catalog against the set of import-names found present on the board.
 *
 * `installedImportNames` is the set the renderer collected by running
 * {@link importProbeSnippet} for each module (or a bulk probe) and seeing the
 * {@link MODULE_PRESENT} sentinel. When `connected` is false we don't know, so
 * every module is `'unknown'`. Pure; returns a fresh id→status map covering
 * exactly the catalog ids — the Modules manager reads it to render the
 * INSTALLED vs AVAILABLE split.
 */
export function diffInstalled(
  installedImportNames: ReadonlySet<string>,
  connected: boolean,
  defs: ModuleDef[] = MODULES
): Record<string, ModuleStatus> {
  const out: Record<string, ModuleStatus> = {}
  for (const m of defs) {
    if (!connected) {
      out[m.id] = 'unknown'
    } else {
      out[m.id] = installedImportNames.has(m.importName) ? 'installed' : 'available'
    }
  }
  return out
}
