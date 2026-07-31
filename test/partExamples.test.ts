import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { libraryFromYaml, partFromYaml, partToYaml } from '../src/shared/part-yaml'
import { parseRegistry } from '../src/shared/part-registry'
import { installPathFor, moduleById } from '../src/shared/modules-catalog'
import {
  driverInstallMethod,
  driverModuleId,
  normalisePart,
  partToBoardDefinition,
  validatePart
} from '../src/renderer/src/components/part-editor.util'

/**
 * Guard the bundled example library (`examples/parts/`) — it doubles as the
 * Parts Library reference, so it must always parse, validate, and round-trip.
 */
const ROOT = join(__dirname, '..', 'examples', 'parts')

function read(...p: string[]): string {
  return readFileSync(join(ROOT, ...p), 'utf-8')
}

describe('example parts library', () => {
  it('library.yml parses with id + name', () => {
    const lib = libraryFromYaml(read('snakie-basics', 'library.yml'))
    expect(lib.id).toBe('snakie-basics')
    expect(lib.name).toBe('Snakie Basics')
    expect(lib.version).toBe('1.0.0')
  })

  it('vl53l0x declares a driver (#184) whose bundled file ships alongside it', () => {
    const part = partFromYaml(read('snakie-basics', 'vl53l0x', 'parts.yml'))
    expect(part.drivers?.length).toBeGreaterThan(0)
    for (const d of part.drivers ?? []) {
      expect(d.target).toMatch(/\S/)
      // A bundled (bare filename) source must exist next to parts.yml.
      const bundled = !/:/.test(d.source) && !d.source.includes('/')
      if (bundled) {
        expect(existsSync(join(ROOT, 'snakie-basics', 'vl53l0x', d.source))).toBe(true)
      }
    }
  })

  it.each(['vl53l0x', 'pico-2w'])('%s/parts.yml parses, validates and round-trips', (partId) => {
    const part = partFromYaml(read('snakie-basics', partId, 'parts.yml'))
    expect(part.id).toBe(partId)
    const clean = normalisePart(part)
    expect(validatePart(clean)).toBeNull()
    expect(clean.headers.length).toBeGreaterThan(0)
    // Every pin has a name; io pins may carry caps; power pins carry none.
    for (const h of clean.headers) {
      for (const pin of h.pins) {
        expect(pin.name).not.toBe('')
        if (pin.type !== 'io') expect(pin.capabilities).toBeUndefined()
      }
    }
  })

  it('registry.json parses and lists the example library', () => {
    const reg = parseRegistry(read('registry.json'))
    expect(reg.libraries.map((l) => l.id)).toContain('snakie-basics')
    expect(reg.libraries[0].repo).toMatch(/^https?:\/\//)
  })

  it.each([
    ['snakie-standard', 'sg90', 9],
    ['snakie-standard', 'hr-sr04', 8.5],
    ['snakie-standard', 'pico', 3]
  ])('%s/%s ships a real mass_g of %d grams (#554)', (lib, id, grams) => {
    const part = partFromYaml(read(lib, id, 'parts.yml'))
    expect(part.mass_g).toBe(grams)
  })
})

describe('standard parts library (snakie-standard)', () => {
  it('library.yml parses', () => {
    const lib = libraryFromYaml(read('snakie-standard', 'library.yml'))
    expect(lib.id).toBe('snakie-standard')
    // Renamed from "Standard Boards" — it now holds any component type (#192).
    expect(lib.name).toBe('Standard Parts')
  })

  // Each board is a full microcontroller part that must convert cleanly to a
  // BoardDefinition (so it can REPLACE the hardcoded built-ins).
  const boards = [
    { id: 'pico', pads: 40, mcu: 'RP2040' },
    { id: 'pico2w', pads: 40, mcu: 'RP2350' }, // canonical id, matches the built-in
    { id: 'esp32-devkit', pads: 30, mcu: 'ESP32' },
    { id: 'tiny2350', pads: 16, mcu: 'RP2350' }, // authored via the build-part-from-image skill (#198)
    { id: 'motor2040', pads: 20, mcu: 'RP2040' }, // Pimoroni quad motor controller
    { id: 'servo2040', pads: 92, mcu: 'RP2040' } // 18 servo + 6 sensor S/V/G headers (octagonal) + I/O
  ]

  it('the Tiny 2350 ships a life-like background photo', () => {
    const part = partFromYaml(read('snakie-standard', 'tiny2350', 'parts.yml'))
    expect(part.image).toBeTruthy() // build-part-from-image skill embeds a top-down photo
    // A PARSEABLE version, not a pinned one. The exact number changes every time
    // the part is legitimately edited, and asserting it only ever produced a
    // mechanical test update — while the thing worth guarding is that the part
    // declares a version at all, since that is what the seeder compares to decide
    // whether an install is behind (#643).
    expect(part.version).toMatch(/^\d+\.\d+\.\d+$/)
  })

  // Sweep EVERY part in the library, not just the named ones above — a new part
  // authored by hand or by the build-part-from-image skill is guarded the moment
  // it lands, rather than only the handful someone remembered to list.
  const allIds = readdirSync(join(ROOT, 'snakie-standard'), { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(ROOT, 'snakie-standard', e.name, 'parts.yml')))
    .map((e) => e.name)

  it('finds every part directory', () => {
    expect(allIds.length).toBeGreaterThan(20)
    expect(allIds).toContain('seeed-xiao-expansion-base')
  })

  it.each(allIds)('%s parses, validates and round-trips through normalise', (id) => {
    const part = partFromYaml(read('snakie-standard', id, 'parts.yml'))
    // The folder name is the id every other part of the app resolves it by.
    expect(part.id).toBe(id)
    const clean = normalisePart(part)
    expect(validatePart(clean)).toBeNull()
    expect(normalisePart(clean)).toEqual(clean)
    // Surviving a YAML round-trip is what proves no field is silently dropped by
    // the serialiser's field-by-field rebuild.
    expect(normalisePart(partFromYaml(partToYaml(clean)))).toEqual(clean)
    // A declared help/image file must actually ship alongside the part.
    for (const f of [part.help, part.image].filter(Boolean) as string[]) {
      expect(existsSync(join(ROOT, 'snakie-standard', id, f))).toBe(true)
    }
  })

  it.each(boards)('$id parses, validates, round-trips and converts to a board', ({ id, pads, mcu }) => {
    const part = partFromYaml(read('snakie-standard', id, 'parts.yml'))
    expect(part.id).toBe(id)
    expect(part.family).toBe('Microcontroller') // so it's picked up as a board
    const clean = normalisePart(part)
    expect(validatePart(clean)).toBeNull()
    // Round-trips through normalise (the canonical-shape invariant).
    expect(normalisePart(clean)).toEqual(clean)
    // Power/gnd/other pins carry no capabilities; io pins do.
    for (const h of clean.headers) {
      for (const pin of h.pins) {
        expect(pin.name).not.toBe('')
        if (pin.type !== 'io') expect(pin.capabilities).toBeUndefined()
      }
    }
    // The full pinout converts to a complete board.
    const board = partToBoardDefinition(clean)
    expect(board.mcu).toBe(mcu)
    const allPads = board.headers.flatMap((h) => h.pins)
    expect(allPads).toHaveLength(pads)
    // Every IO pad keeps a numeric gpio (needed for Pin(n) matching + I²C-detect).
    const gpioPads = allPads.filter((p) => p.type === 'gpio')
    expect(gpioPads.length).toBeGreaterThan(0)
    expect(gpioPads.every((p) => typeof p.gpio === 'number')).toBe(true)
  })
})

describe('suggested modules across the bundled library (#638)', () => {
  it('every `suggests` entry names a REAL catalog module', () => {
    // A typo'd id silently renders nothing in the detail pane — no error, just a
    // missing row. This sweep is the only thing that would catch it.
    let checked = 0
    // `examples/parts` also holds README.md / registry.json / .DS_Store, so walk
    // directories only.
    for (const lib of readdirSync(ROOT, { withFileTypes: true })) {
      if (!lib.isDirectory()) continue
      const libDir = join(ROOT, lib.name)
      for (const id of readdirSync(libDir)) {
        const yml = join(libDir, id, 'parts.yml')
        if (!existsSync(yml)) continue
        const part = partFromYaml(readFileSync(yml, 'utf-8'))
        for (const s of part.suggests ?? []) {
          expect(moduleById(s.module), `${lib.name}/${id} suggests "${s.module}"`).toBeTruthy()
          checked++
        }
      }
    }
    expect(checked, 'at least one part should suggest modules').toBeGreaterThan(0)
  })

  it('the XIAO Expansion Base offers its onboard peripherals', () => {
    const part = partFromYaml(read('snakie-standard', 'seeed-xiao-expansion-base', 'parts.yml'))
    const ids = (part.suggests ?? []).map((s) => s.module)
    // The four things actually ON the board that need a driver. The button needs
    // none (it is a Pin), so it must NOT appear here.
    expect(ids).toEqual(expect.arrayContaining(['ssd1306', 'pcf8563', 'buzzer', 'sdcard']))
    // These are OPTIONAL, so they must NOT be `drivers` — that list gets pushed
    // by the install banner, and a Grove-ports-only user should not be nagged.
    expect(part.drivers ?? []).toHaveLength(0)
  })

  it('every suggestion explains what it unlocks', () => {
    const part = partFromYaml(read('snakie-standard', 'seeed-xiao-expansion-base', 'parts.yml'))
    for (const s of part.suggests ?? []) {
      expect(s.unlocks, `"${s.module}" needs an unlocks line`).toBeTruthy()
    }
  })
})

describe('a placed Grove part asks for its driver (#638)', () => {
  // The gap this closes: adding the Grove IMU to a project prompted nothing, and
  // running the code failed with a bare `ImportError: no module named 'lsm6ds3'`.
  // Both notifications key off fields the part simply didn't have.
  const grove = ['grove-6axis-lsm6ds3', 'grove-i2c-motor-tb6612', 'grove-ultrasonic-ranger', 'grove-led-bar']

  it.each(grove)('%s declares the module its code must import', (id) => {
    const part = partFromYaml(read('snakie-standard', id, 'parts.yml'))
    // `requiredPartModules` keys ENTIRELY off this — without it, neither the
    // "this file doesn't import…" nor the "board is missing…" notice can fire.
    expect(part.library?.module, `${id} needs library.module`).toBeTruthy()
  })

  it.each(grove)('%s declares an installable driver', (id) => {
    const part = partFromYaml(read('snakie-standard', id, 'parts.yml'))
    expect(part.drivers?.length, `${id} needs drivers`).toBeGreaterThan(0)
    for (const d of part.drivers ?? []) {
      expect(driverInstallMethod(d.source)).toBe('module')
      // A `module:` source must name a REAL catalog module, or the install button
      // is a dead end.
      const mod = moduleById(driverModuleId(d.source))
      expect(mod, `${id} driver "${d.source}"`).toBeTruthy()
      // A BUNDLED module has a knowable path, so the declared target must match
      // it. A mip-backed one lands wherever mip decides — hence the banner probes
      // those by import name rather than by path.
      const path = installPathFor(mod!)
      if (path) expect(`/${d.target.replace(/^\//, '')}`).toBe(path)
      else expect(d.target.trim().length).toBeGreaterThan(0)
    }
  })

  it.each(grove)('%s imports the name the driver installs as', (id) => {
    const part = partFromYaml(read('snakie-standard', id, 'parts.yml'))
    const mod = moduleById(driverModuleId(part.drivers![0].source))!
    // The import in the user's code and the file on the board must agree.
    expect(part.library!.module).toBe(mod.importName)
  })
})
