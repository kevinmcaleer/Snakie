import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { coerceDisplay, partFromYaml, partToYaml } from '../src/shared/part-yaml'
import { normalisePart } from '../src/renderer/src/components/part-editor.util'
import type { DisplayColour, PartDefinition } from '../src/shared/part'

/**
 * A part's `display` block (#780): its size in PIXELS.
 *
 * The thing worth testing here isn't that the coercer copies three fields — it's
 * the two properties that have gone wrong before in this repo:
 *
 *   1. the block SURVIVES a save + reload (the `sizeMm` / battery-electrical
 *      class of bug: a field added to the type but not to all three whitelists,
 *      silently dropped with no error), and
 *   2. pixels and millimetres stay APART. `dimensions` is the physical board
 *      size; conflating the two is the specific mistake the block exists to
 *      avoid, so a part carrying both must keep both, unmixed.
 */

/** A part with BOTH a physical size (mm) and a pixel panel — the interesting case. */
const MATRIX: PartDefinition = {
  id: 'panel',
  name: 'Panel',
  headers: [{ edge: 'bottom', pins: [{ name: 'SDA', type: 'io' }] }],
  dimensions: { width: 41, height: 25 }, // millimetres
  display: { width: 12, height: 8, colour: 'gray4' } // pixels
}

/** Save + reload, through all three sinks in the order the app uses them. */
const roundTrip = (p: PartDefinition): PartDefinition => partFromYaml(partToYaml(normalisePart(p)))

describe('display block round-trip', () => {
  it('survives normalisePart → parts.yml → partFromYaml unchanged', () => {
    expect(roundTrip(MATRIX).display).toEqual({ width: 12, height: 8, colour: 'gray4' })
  })

  it('reaches the YAML text as a `display:` block, not as prose', () => {
    const yaml = partToYaml(normalisePart(MATRIX))
    expect(yaml).toMatch(/^display:$/m)
    expect(partFromYaml(yaml).display?.width).toBe(12)
  })

  it('is kept by each sink independently, so no single one can drop it', () => {
    // Named separately: a failure points at the whitelist that lost it rather
    // than at a diff of two whole parts.
    expect(normalisePart(MATRIX).display).toBeDefined()
    expect(partToYaml(MATRIX)).toContain('display:')
    expect(partFromYaml(partToYaml(MATRIX)).display).toBeDefined()
  })

  it('is absent for a part that declares no panel', () => {
    const plain: PartDefinition = { id: 'p', name: 'P', headers: MATRIX.headers }
    expect(normalisePart(plain).display).toBeUndefined()
    expect(roundTrip(plain).display).toBeUndefined()
    expect(partToYaml(plain)).not.toContain('display:')
  })
})

describe('pixels are not millimetres', () => {
  it('keeps `display` and `dimensions` as independent quantities', () => {
    const out = roundTrip(MATRIX)
    expect(out.dimensions).toEqual({ width: 41, height: 25 })
    expect(out.display).toEqual({ width: 12, height: 8, colour: 'gray4' })
  })

  it('keeps a pixel panel on a part with no physical size', () => {
    const noMm: PartDefinition = { ...MATRIX, dimensions: undefined }
    expect(roundTrip(noMm).display?.width).toBe(12)
  })

  it('keeps a physical size on a part with no panel', () => {
    const noPanel: PartDefinition = { ...MATRIX, display: undefined }
    const out = roundTrip(noPanel)
    expect(out.dimensions).toEqual({ width: 41, height: 25 })
    expect(out.display).toBeUndefined()
  })
})

describe('coerceDisplay', () => {
  const at = (raw: unknown): ReturnType<typeof coerceDisplay> => coerceDisplay(raw)

  it('accepts a whole number of pixels', () => {
    expect(at({ width: 128, height: 64, colour: 'mono' })).toEqual({
      width: 128,
      height: 64,
      colour: 'mono'
    })
  })

  it.each([
    ['no block', undefined],
    ['null', null],
    ['a bare block', {}],
    ['width only', { width: 128 }],
    ['height only', { height: 64 }],
    ['a string size', { width: 'wide', height: 64 }],
    ['a zero side', { width: 0, height: 64 }],
    ['a negative side', { width: 128, height: -64 }],
    ['a fractional pixel', { width: 128.5, height: 64 }],
    ['a non-object', 'display']
  ])('drops %s', (_label, raw) => {
    expect(at(raw)).toBeNull()
  })

  it.each(['mono', 'gray2', 'gray4', 'gray8', 'rgb332', 'rgb565', 'rgb888'] as DisplayColour[])(
    'keeps the colour depth `%s`',
    (colour) => {
      expect(at({ width: 8, height: 8, colour })?.colour).toBe(colour)
    }
  )

  it.each([
    ['absent', undefined],
    ['unrecognised', 'sepia'],
    ['the wrong type', 7]
  ])('falls back to mono when the colour is %s', (_label, colour) => {
    // The safe floor, and the reason it is decided HERE and not at each use site.
    expect(at({ width: 8, height: 8, colour })?.colour).toBe('mono')
  })

  it('is the same validator the editor and the file both use', () => {
    // The whole point of exporting it: a block the coercer rejects must not
    // survive by sneaking through a different sink.
    const bad = { ...MATRIX, display: { width: 0, height: 8, colour: 'mono' } } as PartDefinition
    expect(normalisePart(bad).display).toBeUndefined()
    expect(partFromYaml(partToYaml(bad)).display).toBeUndefined()
  })
})

describe('the bundled parts that have a panel', () => {
  const LIB = join(__dirname, '..', 'examples', 'parts', 'snakie-standard')
  const load = (dir: string): PartDefinition =>
    partFromYaml(readFileSync(join(LIB, dir, 'parts.yml'), 'utf-8'))

  it('modulino-led-matrix is 12 x 8', () => {
    // Arduino's docs: 8 rows x 12 columns, 96 LEDs. The upstream MicroPython
    // driver sets _width = 12 / _height = 8 — the private state #780 exists so
    // nobody has to read.
    expect(load('modulino-led-matrix').display).toEqual({
      width: 12,
      height: 8,
      colour: 'gray4'
    })
  })

  it('seeed-xiao-expansion-base declares its onboard SSD1306', () => {
    expect(load('seeed-xiao-expansion-base').display).toEqual({
      width: 128,
      height: 64,
      colour: 'mono'
    })
  })

  it('keeps each panel distinct from its board millimetres', () => {
    // The regression that matters: a later edit that "tidies" one into the other.
    const matrix = load('modulino-led-matrix')
    expect(matrix.dimensions).toEqual({ width: 41, height: 25.36 })
    expect(matrix.display?.width).toBe(12)

    const base = load('seeed-xiao-expansion-base')
    expect(base.dimensions).toEqual({ width: 58, height: 42.5 })
    expect(base.display?.width).toBe(128)
  })
})

describe('hand-authored parts.yml', () => {
  it('reads a display block written by hand, defaulting the colour', () => {
    const part = partFromYaml('id: oled\nname: OLED\ndisplay:\n  width: 128\n  height: 64\n')
    expect(part.display).toEqual({ width: 128, height: 64, colour: 'mono' })
  })

  it('does not confuse `properties.display` prose with the real block', () => {
    // The XIAO Expansion Base really does carry `properties: { display: '0.96"…' }`,
    // so the two must not collide.
    const part = partFromYaml('id: b\nname: B\nproperties:\n  display: 0.96" SSD1306 OLED\n')
    expect(part.display).toBeUndefined()
    expect(part.properties?.display).toBe('0.96" SSD1306 OLED')
  })
})
