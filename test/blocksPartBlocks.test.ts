import { describe, it, expect } from 'vitest'
import { parseBlocksManifest } from '../src/shared/blocks-manifest'
import {
  classNameFromApi,
  derivedManifestFor,
  guessClassName,
  moduleOf,
  placedPartBlocks,
  placedPartModules,
  wiringFor
} from '../src/renderer/src/lib/blocks/part-blocks'
import type { PartDefinition } from '../src/shared/part'
import type { RobotDefinition } from '../src/shared/robot'

/**
 * BLOCKS FOLLOW YOUR CIRCUIT (#1017, epic #1007).
 * =============================================================================
 *
 * Wire a sensor up in Electronics and its blocks appear in Blocks with the pins
 * it is ACTUALLY joined to already in them. This is the join between two things
 * Snakie has known separately since #129 — `robot.yml` says what is on the
 * breadboard and what it is wired to; `parts.yml` says what each of those pins
 * MEANS — and the tests here are about that join being right, because a
 * constructor pre-filled with the wrong pin is worse than an empty one.
 *
 * Pure and DOM-free: the board pin lookup is a function passed in, so a test can
 * wire an imaginary board without a canvas anywhere near it.
 */

/** GP<n> ⇄ n, and nothing else — the imaginary board these tests are wired to. */
const gp = (label: string): number | undefined => {
  const m = /^GP(\d+)$/.exec(label)
  return m ? Number(m[1]) : undefined
}

const i2cSensor: PartDefinition = {
  id: 'vl53l0x',
  name: 'VL53L0X',
  library: { module: 'vl53l0x' },
  headers: [
    {
      edge: 'left',
      pins: [
        { name: 'VCC', type: 'pwr' },
        { name: 'GND', type: 'gnd' },
        { name: 'SDA', type: 'io', capabilities: ['i2c'], signals: { i2c: 'SDA' }, buses: { i2c: 0 } },
        { name: 'SCL', type: 'io', capabilities: ['i2c'], signals: { i2c: 'SCL' }, buses: { i2c: 0 } }
      ]
    }
  ]
}

const oneWire: PartDefinition = {
  id: 'buzzer',
  name: 'Buzzer',
  library: { module: 'passive_buzzer' },
  headers: [
    {
      edge: 'left',
      pins: [
        { name: 'SIG', type: 'io', capabilities: ['pwm'] },
        { name: 'GND', type: 'gnd' }
      ]
    }
  ]
}

const wired = (connections: [string, string][]): RobotDefinition => ({
  parts: [],
  connections: connections.map(([from, to], i) => ({ id: `w${i}`, from, to }))
})

describe('wiringFor', () => {
  it('reads an I²C part off the connection graph', () => {
    const robot = wired([
      ['tof1.SDA', 'board.GP4'],
      ['board.GP5', 'tof1.SCL'],
      ['tof1.VCC', 'board.3V3'],
      ['tof1.GND', 'board.GND']
    ])
    const w = wiringFor(robot, { id: 'tof1', lib: 'std', part: 'vl53l0x' }, i2cSensor, gp)
    expect(w.pins).toEqual({ SDA: 4, SCL: 5 })
    expect(w.i2cBus).toBe(0)
  })

  it('reads the wire whichever end the part is on', () => {
    // `robot.yml` records a wire in the order it was drawn, which is whichever
    // pad the user clicked first.
    const a = wiringFor(wired([['tof1.SDA', 'board.GP4']]), { id: 'tof1', lib: 'l', part: 'p' }, i2cSensor, gp)
    const b = wiringFor(wired([['board.GP4', 'tof1.SDA']]), { id: 'tof1', lib: 'l', part: 'p' }, i2cSensor, gp)
    expect(a.pins.SDA).toBe(4)
    expect(b.pins.SDA).toBe(4)
  })

  it('ignores power and ground', () => {
    // A constructor takes no argument for them, and treating 3V3 as a GPIO
    // would produce code that addresses the wrong hardware.
    const w = wiringFor(
      wired([
        ['tof1.VCC', 'board.GP0'],
        ['tof1.GND', 'board.GP1']
      ]),
      { id: 'tof1', lib: 'l', part: 'p' },
      i2cSensor,
      gp
    )
    expect(w.pins).toEqual({})
    expect(w.signal).toBeUndefined()
  })

  it('ignores a wire to another PART rather than to the board', () => {
    const w = wiringFor(
      wired([['tof1.SDA', 'oled2.SDA']]),
      { id: 'tof1', lib: 'l', part: 'p' },
      i2cSensor,
      gp
    )
    expect(w.pins).toEqual({})
  })

  it('finds the single signal pin of a one-wire part', () => {
    const w = wiringFor(
      wired([
        ['buz1.SIG', 'board.GP16'],
        ['buz1.GND', 'board.GND']
      ]),
      { id: 'buz1', lib: 'l', part: 'buzzer' },
      oneWire,
      gp
    )
    expect(w.signal).toBe(16)
  })

  it('keeps the first wire when a pin is joined twice', () => {
    // Overwriting would make the generated constructor depend on the order the
    // wires happen to sit in the file.
    const w = wiringFor(
      wired([
        ['tof1.SDA', 'board.GP4'],
        ['tof1.SDA', 'board.GP8']
      ]),
      { id: 'tof1', lib: 'l', part: 'p' },
      i2cSensor,
      gp
    )
    expect(w.pins.SDA).toBe(4)
  })

  it('translates SPI datasheet names into the ones drivers use', () => {
    const spiPart: PartDefinition = {
      id: 'sd',
      name: 'SD card',
      library: { module: 'sdcard' },
      headers: [
        {
          edge: 'left',
          pins: [
            { name: 'SCK', type: 'io', capabilities: ['spi'], signals: { spi: 'SCK' }, buses: { spi: 1 } },
            { name: 'DI', type: 'io', capabilities: ['spi'], signals: { spi: 'TX' } },
            { name: 'DO', type: 'io', capabilities: ['spi'], signals: { spi: 'RX' } },
            { name: 'CS', type: 'io', capabilities: ['spi'], signals: { spi: 'CSn' } }
          ]
        }
      ]
    }
    const w = wiringFor(
      wired([
        ['sd1.SCK', 'board.GP10'],
        ['sd1.DI', 'board.GP11'],
        ['sd1.DO', 'board.GP12'],
        ['sd1.CS', 'board.GP13']
      ]),
      { id: 'sd1', lib: 'l', part: 'sd' },
      spiPart,
      gp
    )
    expect(w.pins).toEqual({ SCK: 10, MOSI: 11, MISO: 12, CS: 13 })
    expect(w.spiBus).toBe(1)
  })
})

describe('guessClassName', () => {
  it('upper-cases a chip-named module', () => {
    expect(guessClassName('vl53l0x')).toBe('VL53L0X')
    expect(guessClassName('bme280')).toBe('BME280')
  })

  it('leaves a name somebody deliberately mixed-cased alone', () => {
    expect(guessClassName('MyDriver')).toBe('MyDriver')
  })

  it('takes the last segment of a dotted module', () => {
    expect(guessClassName('drivers.ssd1306')).toBe('SSD1306')
  })
})

describe('moduleOf', () => {
  it('prefers the declared library module', () => {
    expect(moduleOf(i2cSensor)).toBe('vl53l0x')
  })

  it('falls back to a copied driver file name', () => {
    // `lib/vl53l0x.py` is `import vl53l0x`, which is all a derived block needs.
    expect(
      moduleOf({
        id: 'x',
        name: 'X',
        headers: [],
        drivers: [{ source: 'vl53l0x.py', target: 'lib/vl53l0x.py' }]
      })
    ).toBe('vl53l0x')
  })

  it('is null for a part with no code at all', () => {
    expect(moduleOf({ id: 'led', name: 'LED', headers: [] })).toBeNull()
  })
})

describe('derivedManifestFor', () => {
  it('builds an I²C constructor from the real pins', () => {
    const manifest = derivedManifestFor(i2cSensor, { pins: { SDA: 4, SCL: 5 }, i2cBus: 1 })
    const object = manifest.blocks.find((b) => b.id === 'object')!
    expect(object.setup?.expr).toBe('vl53l0x.{CLASS}(I2C(1, sda=Pin(4), scl=Pin(5)))')
    expect(object.imports).toEqual([
      { module: 'vl53l0x' },
      { module: 'machine', name: 'I2C' },
      { module: 'machine', name: 'Pin' }
    ])
  })

  it('builds a one-pin constructor when there is no bus', () => {
    const manifest = derivedManifestFor(oneWire, { pins: {}, signal: 16 })
    expect(manifest.blocks[0].setup?.expr).toBe('passive_buzzer.{CLASS}(Pin(16))')
  })

  it('still produces blocks for a part that is wired to nothing yet', () => {
    // The learner sees the shape before the wires exist, which is the point of
    // "rough, but never nothing".
    const manifest = derivedManifestFor(i2cSensor, { pins: {} })
    expect(manifest.blocks[0].setup?.expr).toBe('vl53l0x.{CLASS}()')
  })

  it('produces nothing for a part with no module to import', () => {
    expect(derivedManifestFor({ id: 'led', name: 'LED', headers: [] }, { pins: {} }).blocks).toEqual([])
  })

  it('puts the guessed class in an editable field on the face of the block', () => {
    // A guess you can see and correct is a different thing from one that fails
    // silently on the board.
    const manifest = derivedManifestFor(i2cSensor, { pins: {} })
    expect(manifest.blocks[0].args).toEqual([
      { name: 'CLASS', kind: 'text-field', default: 'VL53L0X' }
    ])
  })

  it('lets one block construct and the others take it as an argument', () => {
    // A class field on all three would let a learner set two different classes
    // for what is meant to be one object.
    const manifest = derivedManifestFor(i2cSensor, { pins: {} })
    expect(manifest.blocks.map((b) => b.id)).toEqual(['object', 'call', 'read'])
    for (const block of manifest.blocks.slice(1)) {
      expect(block.setup).toBeUndefined()
      expect(block.args?.find((a) => a.name === 'OBJ')?.shadow).toBe('object')
    }
  })

  it('generates a no-argument call for an empty argument socket', () => {
    // `sensor.update(None)` is a TypeError on the board.
    const call = derivedManifestFor(i2cSensor, { pins: {} }).blocks.find((b) => b.id === 'call')!
    expect(call.code).toBe('{OBJ}.{METHOD}({ARG})')
    expect(call.args?.find((a) => a.name === 'ARG')?.default).toBe('')
  })

  it('survives its own validator', () => {
    // Everything this module generates has to pass the same gate a stranger's
    // `blocks.yml` does — otherwise the derived palette would be held to a
    // lower standard than the declared one.
    const yaml = derivedManifestFor(i2cSensor, { pins: { SDA: 4, SCL: 5 } })
    const { manifest, warnings } = parseBlocksManifest(JSON.stringify(yaml))
    expect(warnings).toEqual([])
    expect(manifest.blocks).toHaveLength(3)
  })
})

describe('placedPartBlocks', () => {
  const libraries = [{ id: 'std', parts: [i2cSensor, oneWire] }]
  const robot: RobotDefinition = {
    parts: [
      { id: 'tof1', lib: 'std', part: 'vl53l0x' },
      { id: 'tof2', lib: 'std', part: 'vl53l0x' },
      { id: 'buz1', lib: 'std', part: 'buzzer' }
    ],
    connections: [
      { id: 'w1', from: 'tof1.SDA', to: 'board.GP4' },
      { id: 'w2', from: 'tof1.SCL', to: 'board.GP5' },
      { id: 'w3', from: 'buz1.SIG', to: 'board.GP16' }
    ]
  }

  it('gives each distinct part one drawer, in robot.yml order', () => {
    const out = placedPartBlocks(robot, libraries, gp, parseBlocksManifest)
    expect(out.map((p) => p.source.name)).toEqual(['VL53L0X', 'Buzzer'])
    expect(out.every((p) => p.derived)).toBe(true)
  })

  it('carries the first instance′s wiring', () => {
    const out = placedPartBlocks(robot, libraries, gp, parseBlocksManifest)
    expect(out[0].manifest.blocks[0].setup?.expr).toContain('sda=Pin(4), scl=Pin(5)')
  })

  it('skips a placed part the libraries no longer have', () => {
    const out = placedPartBlocks(
      { parts: [{ id: 'x1', lib: 'std', part: 'gone' }], connections: [] },
      libraries,
      gp,
      parseBlocksManifest
    )
    expect(out).toEqual([])
  })

  it('prefers a shipped blocks.yml over the derived set', () => {
    const shipped: PartDefinition = {
      ...i2cSensor,
      blocksYaml: `
blocks:
  - id: range
    message: distance in mm
    shape: value
    output: Number
    code: "tof.range()"
`
    }
    const out = placedPartBlocks(robot, [{ id: 'std', parts: [shipped] }], gp, parseBlocksManifest)
    expect(out[0].derived).toBe(false)
    expect(out[0].manifest.blocks.map((b) => b.id)).toEqual(['range'])
  })

  it('pre-fills a shipped manifest′s pin arguments from the real wiring', () => {
    // A part author cannot know which GPIO you chose; this puts yours in.
    const shipped: PartDefinition = {
      ...i2cSensor,
      blocksYaml: `
blocks:
  - id: range
    message: distance on %1 / %2
    shape: value
    output: Number
    code: "read({SDA}, {SCL})"
    args:
      - name: SDA
        kind: pin
        default: 0
      - name: SCL
        kind: pin
        default: 1
`
    }
    const out = placedPartBlocks(robot, [{ id: 'std', parts: [shipped] }], gp, parseBlocksManifest)
    expect(out[0].manifest.blocks[0].args?.map((a) => a.default)).toEqual([4, 5])
  })

  it('leaves the author′s default alone for a role the circuit does not fill', () => {
    const shipped: PartDefinition = {
      ...i2cSensor,
      blocksYaml: `
blocks:
  - id: reset
    message: reset via %1
    code: "reset({XSHUT})"
    args:
      - name: XSHUT
        kind: pin
        default: 22
`
    }
    const out = placedPartBlocks(robot, [{ id: 'std', parts: [shipped] }], gp, parseBlocksManifest)
    expect(out[0].manifest.blocks[0].args?.[0].default).toBe(22)
  })

  it('falls back to the derived set when every declared block was dropped', () => {
    // A drawer that is empty because the author made a typo is worse than one
    // full of rough blocks, and the warning still says what happened.
    const broken: PartDefinition = {
      ...i2cSensor,
      blocksYaml: 'blocks:\n  - id: bad\n    message: bad\n    code: "x({NOPE})"\n'
    }
    const out = placedPartBlocks(robot, [{ id: 'std', parts: [broken] }], gp, parseBlocksManifest)
    expect(out[0].derived).toBe(true)
    expect(out[0].warnings.join('\n')).toContain('{NOPE}')
  })

  it('falls back to the derived set when the YAML will not parse at all', () => {
    const broken: PartDefinition = { ...i2cSensor, blocksYaml: 'blocks: [ unclosed' }
    const out = placedPartBlocks(robot, [{ id: 'std', parts: [broken] }], gp, parseBlocksManifest)
    expect(out[0].derived).toBe(true)
    expect(out[0].warnings.join('\n')).toContain('could not be read')
  })
})

/**
 * THE GUESS, UPGRADED TO A FACT (#1048).
 *
 * `guessClassName` is right for most drivers and visibly wrong for the rest.
 * Once a module's source can be found and parsed, the wired part's block can
 * carry the class the driver actually declares — so these are about picking the
 * right one when a driver declares several, and about falling back cleanly when
 * the file is nowhere.
 */
describe('classNameFromApi', () => {
  it('is null for a module that declares no class', () => {
    expect(classNameFromApi('vl53l0x', [])).toBeNull()
  })

  it('takes the only class, whatever the convention guessed', () => {
    expect(classNameFromApi('passive_buzzer', [{ name: 'Buzzer' }])).toBe('Buzzer')
  })

  it('prefers the class the convention pointed at, case-insensitively', () => {
    expect(classNameFromApi('ssd1306', [{ name: 'SSD1306' }, { name: 'SSD1306_I2C' }])).toBe(
      'SSD1306'
    )
  })

  it('takes the last class when none matches — a driver names the usable one last', () => {
    expect(classNameFromApi('display', [{ name: 'FrameBuffer' }, { name: 'Screen' }])).toBe('Screen')
  })
})

describe('placedPartModules', () => {
  const libraries = [{ id: 'std', parts: [i2cSensor, oneWire] }]

  it('names each placed part′s driver module once', () => {
    const robot: RobotDefinition = {
      parts: [
        { id: 'tof1', lib: 'std', part: 'vl53l0x' },
        { id: 'tof2', lib: 'std', part: 'vl53l0x' },
        { id: 'buz1', lib: 'std', part: 'buzzer' }
      ],
      connections: []
    }
    expect(placedPartModules(robot, libraries)).toEqual(['vl53l0x', 'passive_buzzer'])
  })

  it('is empty for no robot, and skips a part the libraries no longer have', () => {
    expect(placedPartModules(null, libraries)).toEqual([])
    expect(
      placedPartModules({ parts: [{ id: 'x', lib: 'std', part: 'gone' }], connections: [] }, libraries)
    ).toEqual([])
  })
})

describe('placedPartBlocks with a readable driver', () => {
  const libraries = [{ id: 'std', parts: [i2cSensor] }]
  const robot: RobotDefinition = {
    parts: [{ id: 'tof1', lib: 'std', part: 'vl53l0x' }],
    connections: [
      { id: 'w1', from: 'tof1.SDA', to: 'board.GP4' },
      { id: 'w2', from: 'tof1.SCL', to: 'board.GP5' }
    ]
  }

  it('writes the class the driver declares onto the block', () => {
    const out = placedPartBlocks(robot, libraries, gp, parseBlocksManifest, () => 'Sensor')
    expect(out[0].manifest.blocks[0].args?.[0].default).toBe('Sensor')
  })

  it('keeps the conventional guess when the driver could not be read', () => {
    const out = placedPartBlocks(robot, libraries, gp, parseBlocksManifest, () => undefined)
    expect(out[0].manifest.blocks[0].args?.[0].default).toBe('VL53L0X')
  })
})
