import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { libraryFromYaml, partFromYaml } from '../src/shared/part-yaml'
import { parseRegistry } from '../src/shared/part-registry'
import {
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
    { id: 'esp32-devkit', pads: 30, mcu: 'ESP32' }
  ]

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
