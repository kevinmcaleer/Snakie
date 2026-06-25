import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { libraryFromYaml, partFromYaml } from '../src/shared/part-yaml'
import { parseRegistry } from '../src/shared/part-registry'
import { normalisePart, validatePart } from '../src/renderer/src/components/part-editor.util'

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
