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
 * A module's `source` is ONE of:
 *   - `{ kind: 'bundled', file }` — a tiny, MIT-licensed driver stub SHIPPED with
 *     the app under `micropython/modules/<file>`. The main process reads it and
 *     writes it to the board over the raw REPL (the #108 instrument-library
 *     install path, generalised). Preferred for small drivers we can ship.
 *   - `{ kind: 'mip', spec }` — an official `mip` / `github:` spec (e.g.
 *     `'github:stlehmann/micropython-ssd1306/ssd1306.py'`), resolved on the HOST
 *     and written as files (#776). Used for drivers too large / not ours to
 *     vendor, so we reference the upstream source instead of copying it.
 *   - `{ kind: 'bundle', module }` — a library from the Adafruit CircuitPython
 *     Library Bundle (#758), which is what CircuitPython has instead of `mip`.
 *     Resolved by `circuitpy-bundle.ts` and written as `.mpy` BYTES.
 *
 * ## The source kind decides the DIALECT
 *
 * A driver is not portable between the two runtimes and pretending otherwise
 * would put an INSTALL button in front of a user that could only ever fail. The
 * shipped stubs and the `mip` specs are MicroPython code — they `import machine`
 * and are installed by a MicroPython mechanism; the bundle is CircuitPython
 * bytecode built against `board`/`digitalio`. So {@link moduleDialect} derives
 * the runtime from the source kind rather than asking each entry to restate it,
 * and the Modules manager shows a board only the half it can actually use.
 */

import type { Dialect } from './dialect'

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
  | 'motor'

/** Where a module's code comes from. */
export type ModuleSource =
  | {
      /** A small driver stub SHIPPED with the app (`micropython/modules/<file>`). */
      kind: 'bundled'
      /** The bundled file's basename, e.g. `ssd1306.py`. */
      file: string
      /**
       * The `__version__` the shipped file declares (#707) — what a board copy is
       * compared against to offer an UPDATE for a stale driver. Declared here so
       * the renderer (desktop AND web) can compare without reading the file; a
       * unit test asserts it matches the `.py`, so editing a driver without
       * bumping both fails CI.
       */
      version: string
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
  | {
      /**
       * A library from the Adafruit CircuitPython Library Bundle (#758) — the
       * `circup` source, and the only one CircuitPython has. Resolved on the
       * host by `circuitpy-bundle.ts` and written as `.mpy` bytes.
       */
      kind: 'bundle'
      /**
       * The bundle's own library name — the index key AND the import name, e.g.
       * `'adafruit_hcsr04'`. Its dependencies come from the index, so they are
       * never restated here.
       */
      module: string
    }

/** One installable module — a driver behind a dock instrument. */
export interface ModuleDef {
  /** Stable id (the catalog key + the install-path basename for bundled stubs). */
  id: string
  /** Display name shown in the Modules manager row. */
  name: string
  /** One-line description of what the driver is / which hardware it talks to. */
  description: string
  /**
   * The dock instrument this module powers (groups the Modules manager).
   *
   * OPTIONAL, because not every useful driver has a panel behind it — an RTC is a
   * real, installable dependency with nothing to plot or drive. Those group under
   * "Other drivers" rather than being filed under an unrelated instrument, which
   * would make the grouping lie.
   */
  instrument?: InstrumentId
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
    source: { kind: 'bundled', file: 'hcsr04.py', version: '1.0.0' },
    license: 'MIT'
  },
  {
    id: 'grove-ultrasonic',
    name: 'Grove Ultrasonic Ranger',
    description:
      'Seeed Grove ultrasonic ranger — ONE signal wire for both trigger and echo.',
    instrument: 'range',
    importName: 'grove_ultrasonic',
    // Not interchangeable with `hcsr04`: that driver holds trigger and echo as
    // separate fixed-direction pins, which a one-wire sensor cannot satisfy.
    source: { kind: 'bundled', file: 'grove_ultrasonic.py', version: '1.0.0' },
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
    source: { kind: 'bundled', file: 'mpu6050.py', version: '1.0.0' },
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
    id: 'lsm6ds3',
    name: 'LSM6DS3 IMU',
    description:
      '6-axis accelerometer + gyro over I²C — the sensor on the Grove 6-Axis module.',
    instrument: 'imu',
    importName: 'lsm6ds3',
    // A DIFFERENT part from the LSM6DSOX below, not a spelling of it: an LSM6DS3
    // answers WHO_AM_I 0x69, which that driver rejects.
    source: { kind: 'bundled', file: 'lsm6ds3.py', version: '1.0.0' },
    license: 'MIT'
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
    source: { kind: 'bundled', file: 'neopixel_ws2812.py', version: '1.0.0' },
    license: 'MIT'
  },
  {
    id: 'my9221',
    name: 'MY9221 LED bar',
    description: '10-segment Grove LED Bar (MY9221 2-wire clock/data driver).',
    instrument: 'led',
    importName: 'my9221',
    // Someone else's MIT driver — referenced upstream rather than vendored, per
    // this file's policy for code that isn't ours.
    source: { kind: 'mip', spec: 'github:mcauser/micropython-my9221/my9221.py' }
  },

  // --- Encoder (#117) ------------------------------------------------------
  {
    id: 'rotary',
    name: 'Rotary encoder',
    description: 'Helper for a quadrature rotary encoder (counts steps + direction).',
    instrument: 'encoder',
    importName: 'rotary',
    source: { kind: 'bundled', file: 'rotary.py', version: '1.0.0' },
    license: 'MIT'
  },

  // --- Buzzer --------------------------------------------------------------
  {
    id: 'buzzer',
    name: 'Buzzer (tones / RTTTL)',
    description: 'Play tones and RTTTL melodies on a piezo buzzer via PWM.',
    instrument: 'buzzer',
    importName: 'buzzer',
    source: { kind: 'bundled', file: 'buzzer.py', version: '1.0.0' },
    license: 'MIT'
  },

  // --- Gamepad / teleop ----------------------------------------------------
  {
    id: 'teleop',
    name: 'Teleop receiver',
    description: 'Apply Gamepad/teleop axes from the IDE control channel to motors.',
    instrument: 'gamepad',
    importName: 'teleop',
    source: { kind: 'bundled', file: 'teleop.py', version: '1.0.0' },
    license: 'MIT'
  },
  // --- Panel-less drivers --------------------------------------------------
  // Real dependencies with no dock instrument behind them (see `instrument`).
  {
    id: 'pcf8563',
    name: 'PCF8563 RTC',
    description: 'I²C real-time clock — the RTC on the XIAO Expansion Base (0x51).',
    importName: 'pcf8563',
    source: { kind: 'bundled', file: 'pcf8563.py', version: '1.0.0' },
    license: 'MIT'
  },
  {
    id: 'modulino',
    name: 'Arduino Modulino',
    description: 'Every Modulino module — buttons, knob, pixels, distance, IMU… — in one package.',
    // No single instrument: the range spans IMU, light, distance, LED and more,
    // so it groups under "Other drivers" rather than claiming one panel (#721).
    importName: 'modulino',
    // ONE catalog entry for the whole range (#722): all thirteen parts declare
    // `module:modulino`, so the Driver Install banner — which probes by import —
    // collapses them into a single install offer instead of thirteen identical
    // ones. Its package.json declares `deps` (lsm6dsox, ltr-381rgb-01, HS3003)
    // and mip installs those transitively, which is what makes Movement, Light
    // and Thermo work at all.
    source: { kind: 'mip', spec: 'github:arduino/arduino-modulino-mpy' }
  },
  {
    id: 'sdcard',
    name: 'SD card (SPI)',
    description: 'Mount a microSD card over SPI — e.g. the XIAO Expansion Base slot.',
    importName: 'sdcard',
    // MicroPython's own official driver — referenced, not vendored.
    source: { kind: 'mip', spec: 'github:micropython/micropython-lib/micropython/drivers/storage/sdcard/sdcard.py' }
  },
  {
    id: 'tb6612',
    name: 'Grove I²C Motor Driver (TB6612FNG)',
    description: 'Two DC motor channels over I²C — drives the Motor panel and teleop.',
    instrument: 'motor',
    importName: 'tb6612',
    source: { kind: 'bundled', file: 'tb6612.py', version: '1.0.0' },
    license: 'MIT'
  },

  // === CircuitPython — the Adafruit bundle (#758, epic #209) ================
  // Every entry above is MicroPython. These are the same sensors again, as
  // CircuitPython knows them: Adafruit's own drivers, taken from the Library
  // Bundle at the version it pins. They are NOT alternatives a MicroPython user
  // could pick — `moduleDialect` files them under CircuitPython and the Modules
  // manager hides them from a MicroPython board, because the `.mpy` would not
  // import there.
  //
  // Bundle DEPENDENCIES are deliberately absent from this list:
  // `adafruit_mpu6050` needs `adafruit_bus_device` and `adafruit_register`, and
  // the resolver installs them from the index. Restating them here would give
  // the manager rows for libraries nobody chose, and a second place to be wrong
  // when Adafruit changes one.
  {
    id: 'cp-hcsr04',
    name: 'HC-SR04 ultrasonic (CircuitPython)',
    description: "Adafruit's driver for the HC-SR04 ultrasonic range finder.",
    instrument: 'range',
    importName: 'adafruit_hcsr04',
    source: { kind: 'bundle', module: 'adafruit_hcsr04' }
  },
  {
    id: 'cp-vl53l0x',
    name: 'VL53L0X ToF (CircuitPython)',
    description: 'I²C driver for the VL53L0X time-of-flight distance sensor.',
    instrument: 'range',
    importName: 'adafruit_vl53l0x',
    source: { kind: 'bundle', module: 'adafruit_vl53l0x' }
  },
  {
    id: 'cp-ssd1306',
    name: 'SSD1306 OLED (CircuitPython)',
    description: 'I²C / SPI driver for the SSD1306 128×64 monochrome OLED display.',
    instrument: 'i2c-display',
    importName: 'adafruit_ssd1306',
    source: { kind: 'bundle', module: 'adafruit_ssd1306' }
  },
  {
    id: 'cp-mpu6050',
    name: 'MPU-6050 IMU (CircuitPython)',
    description: '6-axis accelerometer + gyro over I²C (the common MPU-6050).',
    instrument: 'imu',
    importName: 'adafruit_mpu6050',
    source: { kind: 'bundle', module: 'adafruit_mpu6050' }
  },
  {
    id: 'cp-lsm6ds',
    name: 'LSM6DS IMU (CircuitPython)',
    description: '6-axis accelerometer + gyro (LSM6DSOX / LSM6DS33) over I²C.',
    instrument: 'imu',
    importName: 'adafruit_lsm6ds',
    source: { kind: 'bundle', module: 'adafruit_lsm6ds' }
  },
  {
    id: 'cp-neopixel',
    name: 'NeoPixel (CircuitPython)',
    description: 'WS2812 / NeoPixel addressable RGB LED strip driver.',
    instrument: 'led',
    importName: 'neopixel',
    source: { kind: 'bundle', module: 'neopixel' }
  },
  {
    id: 'cp-motor',
    name: 'Motor / servo (CircuitPython)',
    description: 'DC motors, stepper motors and servos over PWM — Adafruit’s motor library.',
    instrument: 'motor',
    importName: 'adafruit_motor',
    source: { kind: 'bundle', module: 'adafruit_motor' }
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

/**
 * Which runtime a module's code is FOR, derived from where it comes from (#758).
 *
 * Not a field on the entry, because it is not an independent fact: a shipped
 * stub and a `mip` spec are MicroPython source installed by a MicroPython
 * mechanism, and an Adafruit bundle library is CircuitPython bytecode. Deriving
 * it means the two can never disagree — adding a bundle module cannot forget to
 * say it is CircuitPython. Pure.
 */
export function moduleDialect(def: ModuleDef): Dialect {
  return def.source.kind === 'bundle' ? 'circuitpython' : 'micropython'
}

/**
 * The modules a board of this dialect can actually install.
 *
 * `'unknown'` — and no dialect at all, which is what a disconnected board
 * looks like — returns EVERYTHING, on purpose: with nothing connected there is
 * no wrong answer to hide, and browsing the full catalog is how a user decides
 * what to buy. Once a board says what it is, the other runtime's drivers go
 * away rather than sit there offering an install that could only fail. Pure.
 */
export function modulesForDialect(
  dialect: Dialect | undefined | null,
  defs: ModuleDef[] = MODULES
): ModuleDef[] {
  if (!dialect || dialect === 'unknown') return [...defs]
  return defs.filter((m) => moduleDialect(m) === dialect)
}

/** One instrument's modules, grouped together for the Modules manager. */
export interface ModuleGroup {
  /** The instrument id these modules power; `undefined` for the panel-less group. */
  instrument?: InstrumentId
  /** The modules, in catalog order. */
  modules: ModuleDef[]
}

/**
 * Group the catalog by instrument, preserving first-seen instrument order and
 * per-instrument catalog order. Pure; returns fresh arrays so the UI can map
 * over stable groups (the Modules manager renders one section per instrument).
 */
export function groupByInstrument(defs: ModuleDef[] = MODULES): ModuleGroup[] {
  // `undefined` is a real key here — the panel-less drivers group (see
  // `ModuleDef.instrument`). Map handles it as a key, unlike an object.
  const order: (InstrumentId | undefined)[] = []
  const byInstrument = new Map<InstrumentId | undefined, ModuleDef[]>()
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
 *
 * **The name is evicted from `sys.modules` first (#703).** MicroPython caches
 * imported modules, and deleting the file does NOT evict the cache — so once
 * anything in the session has imported the driver, a bare `__import__` keeps
 * answering PRESENT for a file that no longer exists. Verified on the real
 * interpreter: delete the file and the probe still succeeds; pop the cache entry
 * and it correctly fails. Popping is safe for a running program, because objects
 * already bound to that module stay alive through their own references.
 *
 * **And evicted again afterwards, with a collect (#842).** The probes are
 * concatenated and run as ONE exec over the whole catalog, so without this every
 * driver the board owns stays resident in RAM simultaneously. That is affordable
 * for a one-file driver and emphatically not for `modulino`, whose `__init__`
 * eagerly imports nineteen submodules and three dependency packages. On a board
 * with modest free RAM the import then fails for want of memory — and because
 * `MemoryError` is an `Exception` like any other, the probe swallows it and
 * reports the driver ABSENT when it is installed and perfectly good.
 *
 * The eviction is by PREFIX: dropping `modulino` alone would leave the nineteen
 * `modulino.*` submodules cached and holding exactly the memory this is trying
 * to release.
 */
export function importProbeSnippet(importName: string): string {
  // importName is a catalog constant (a bare module name) so it never contains
  // quotes — but sanitise defensively all the same to a safe identifier.
  const name = importName.replace(/[^A-Za-z0-9_]/g, '')
  // Drop `name` AND every `name.*` submodule. A bare pop of the package leaves
  // its submodules cached, which both keeps the memory and lets a stale
  // submodule answer for a file that is gone.
  const purge = [
    '_snk_k = None',
    'for _snk_k in list(sys.modules):',
    `    if _snk_k == '${name}' or _snk_k.startswith('${name}.'):`,
    '        sys.modules.pop(_snk_k, None)'
  ]
  return [
    'import sys, gc',
    // Ask the FILESYSTEM, not the cache.
    ...purge,
    'try:',
    `    __import__('${name}')`,
    `    print('${MODULE_PRESENT}')`,
    'except Exception:',
    '    pass',
    // Release it again before the next probe in the batch runs, so peak memory
    // is one driver rather than the whole catalog.
    ...purge,
    '_snk_k = None',
    'del _snk_k',
    'gc.collect()'
  ].join('\n')
}

/**
 * Extract the `__version__ = "X.Y.Z"` literal from Python driver source — a
 * whole file, or the single line `readFileLine` returns — or `null` if absent
 * (a legacy copy predating versioning). Anchored to the start of a LINE
 * (allowing indentation) so a `__version__` example inside a doc comment is
 * never matched (its line starts with `#`, which `^\s*` can't cross). The same
 * rule `instrumentsLib.parseLibVersion` applies to the instrument library,
 * hosted here so drivers and library share ONE parse. Pure.
 */
export function parseModuleVersion(source: string | null | undefined): string | null {
  if (!source) return null
  const m = source.match(/^\s*__version__\s*=\s*['"]([^'"]+)['"]/m)
  return m ? m[1] : null
}

/**
 * The Modules manager's per-module install status. `installed` ⇒ importable on
 * the board (and, for a bundled module, its `/lib` copy matches the shipped
 * version where that was checked); `outdated` ⇒ importable but the `/lib` copy
 * is STALE against the version the catalog declares (#707 — offer an update,
 * not a lie); `available` ⇒ in the catalog but not (yet) on the board;
 * `unknown` ⇒ not probed (no connection / probe not run).
 */
export type ModuleStatus = 'installed' | 'outdated' | 'available' | 'unknown'

/**
 * Diff the catalog against the set of import-names found present on the board.
 *
 * `installedImportNames` is the set the renderer collected by running
 * {@link importProbeSnippet} for each module (or a bulk probe) and seeing the
 * {@link MODULE_PRESENT} sentinel. `outdatedImportNames` is the (possibly
 * empty) subset whose `/lib` copy read back STALE (#707) — only ever names that
 * also probed importable, and only bundled modules can appear in it. When
 * `connected` is false we don't know, so every module is `'unknown'`. Pure;
 * returns a fresh id→status map covering exactly the catalog ids — the Modules
 * manager reads it to render the INSTALLED vs AVAILABLE split.
 */
export function diffInstalled(
  installedImportNames: ReadonlySet<string>,
  connected: boolean,
  defs: ModuleDef[] = MODULES,
  outdatedImportNames: ReadonlySet<string> = new Set()
): Record<string, ModuleStatus> {
  const out: Record<string, ModuleStatus> = {}
  for (const m of defs) {
    if (!connected) {
      out[m.id] = 'unknown'
    } else if (!installedImportNames.has(m.importName)) {
      out[m.id] = 'available'
    } else {
      out[m.id] = outdatedImportNames.has(m.importName) ? 'outdated' : 'installed'
    }
  }
  return out
}
