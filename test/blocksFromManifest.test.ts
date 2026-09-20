import { describe, it, expect, beforeEach } from 'vitest'
import * as Blockly from 'blockly/core'
// The stock blocks (`math_number`, `math_arithmetic`, `text`) — the shadows a
// manifest's number and text sockets are filled with, and the neighbours a
// generated value has to parenthesise itself against.
import 'blockly/blocks'
import { generateProgram } from '../src/renderer/src/lib/blocks/generator'
import {
  defineBlocks,
  defineDynamicBlocks,
  pruneDynamicBlocks,
  blocksInCategory,
  registeredBlocks,
  resetBlockRegistry,
  type BlockLevel
} from '../src/renderer/src/lib/blocks/registry'
import { categoryContents } from '../src/renderer/src/lib/blocks/toolbox'
import { BLOCK_CATEGORIES } from '../src/renderer/src/lib/blocks/theme'
import {
  blockDefinitionsFrom,
  blockTypeFor,
  type BlockSource
} from '../src/renderer/src/lib/blocks/manifest'
import { parseBlocksManifest } from '../src/shared/blocks-manifest'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A MANIFEST, ALL THE WAY TO MICROPYTHON (#1017, epic #1007).
 * =============================================================================
 *
 * `test/blocksManifest.test.ts` proves the schema keeps bad blocks out. This
 * proves the good ones arrive: the same YAML a part ships, loaded, registered,
 * dragged onto a headless Blockly workspace, and generated — because a manifest
 * that parses and then emits the wrong Python is exactly as broken as one that
 * does not parse, and only this end of the pipe can tell.
 *
 * It is a GOLDEN-FILE suite for the same reason #1010's is: the whole promise of
 * this issue is that adding a block never means touching Electron code, so the
 * thing under test is the code path a stranger's file takes, spelled out in full.
 */

const partSource = (partId: string): BlockSource => ({
  kind: 'part',
  id: `snakie-standard.${partId}`,
  name: partId.toUpperCase(),
  category: 'parts',
  part: { libraryId: 'snakie-standard', partId }
})

/**
 * Parse, load and register a manifest exactly as the app does, and hand back the
 * namespaced type of each of its blocks.
 *
 * A FRESH PART PER CALL by default. Blockly's definition table is global and
 * process-wide, so two tests installing a `beep` under one part id would each
 * redefine the other's shape — and the second would then be testing the first
 * test's block.
 */
let partCounter = 0
function install(yaml: string, partId = `fixture${++partCounter}`): (id: string) => string {
  const source = partSource(partId)
  const { manifest, warnings } = parseBlocksManifest(yaml)
  expect(warnings).toEqual([])
  const defs = blockDefinitionsFrom(manifest, source)
  Blockly.defineBlocksWithJsonArray(
    defs.map((d) => ({ type: d.type, style: `${d.category}_blocks`, ...d.json }))
  )
  defineDynamicBlocks(`${source.kind}:${source.id}`, defs)
  return (id: string) => blockTypeFor(source, id)
}

/** Build a workspace from serialised JSON and generate it. */
function gen(state: Record<string, unknown>): ReturnType<typeof generateProgram> {
  const ws = new Blockly.Workspace()
  Blockly.serialization.workspaces.load(state, ws)
  return generateProgram(ws)
}

beforeEach(() => {
  resetBlockRegistry()
})

describe('a manifest block generates MicroPython', () => {
  // The real palette, because the SHADOWS are real: a manifest's number socket
  // is filled with Blockly's own `math_number`, and a manifest value plugged
  // into `math_arithmetic` is how the precedence rule gets exercised. Registered
  // per test, after the global reset above wipes it.
  beforeEach(() => installCorePalette())

  it('emits a statement with its arguments filled in', () => {
    const type = install(`
blocks:
  - id: beep
    message: beep for %1 ms at %2
    code: "buzzer.beep({MS}, {NOTE})"
    args:
      - name: MS
        kind: number
        default: 200
      - name: NOTE
        kind: text-field
        default: C4
    imports:
      - module: buzzer
`)
    const out = gen({ blocks: { blocks: [{ type: type('beep'), id: 'b1' }] } })
    expect(out.code).toBe(["import buzzer", '', "buzzer.beep(200, 'C4')", ''].join('\n'))
  })

  it('uses a plugged-in value over the declared default', () => {
    const type = install(`
blocks:
  - id: beep
    message: beep for %1 ms
    code: "buzzer.beep({MS})"
    args:
      - name: MS
        kind: number
        default: 200
`)
    const out = gen({
      blocks: {
        blocks: [
          {
            type: type('beep'),
            id: 'b1',
            inputs: { MS: { block: { type: 'math_number', fields: { NUM: 50 } } } }
          }
        ]
      }
    })
    expect(out.code.trim()).toBe('buzzer.beep(50)')
  })

  it('hoists a setup expression and shares it between blocks', () => {
    // The property that makes part blocks worth having: a sensor read inside a
    // loop must not re-open the I²C bus three thousand times a second.
    const type = install(`
blocks:
  - id: read
    message: distance in cm
    shape: value
    output: Number
    code: "{SETUP}.range()"
    setup:
      key: "tof"
      name: tof
      expr: "vl53l0x.VL53L0X(I2C(0, sda=Pin(4), scl=Pin(5)))"
    imports:
      - module: vl53l0x
      - module: machine
        name: I2C
      - module: machine
        name: Pin
  - id: say
    message: say %1
    code: "print({WHAT})"
    args:
      - name: WHAT
        kind: any
`)
    const out = gen({
      blocks: {
        blocks: [
          {
            type: type('say'),
            id: 's1',
            inputs: { WHAT: { block: { type: type('read'), id: 'r1' } } },
            next: {
              block: {
                type: type('say'),
                id: 's2',
                inputs: { WHAT: { block: { type: type('read'), id: 'r2' } } }
              }
            }
          }
        ]
      }
    })
    expect(out.code).toBe(
      [
        'from machine import I2C, Pin',
        '',
        'import vl53l0x',
        '',
        'tof = vl53l0x.VL53L0X(I2C(0, sda=Pin(4), scl=Pin(5)))',
        '',
        'print(tof.range())',
        'print(tof.range())',
        ''
      ].join('\n')
    )
  })

  it('gives two different setup keys two different objects', () => {
    const type = install(`
blocks:
  - id: read
    message: read pin %1
    shape: value
    output: Number
    code: "{SETUP}.value()"
    args:
      - name: PIN
        kind: number-field
        default: 15
    setup:
      name: sensor
      expr: "Pin({PIN})"
    imports:
      - module: machine
        name: Pin
  - id: say
    message: say %1
    code: "print({WHAT})"
    args:
      - name: WHAT
        kind: any
`)
    const out = gen({
      blocks: {
        blocks: [
          {
            type: type('say'),
            id: 's1',
            inputs: {
              WHAT: { block: { type: type('read'), id: 'r1', fields: { PIN: 15 } } }
            },
            next: {
              block: {
                type: type('say'),
                id: 's2',
                inputs: {
                  WHAT: { block: { type: type('read'), id: 'r2', fields: { PIN: 16 } } }
                }
              }
            }
          }
        ]
      }
    })
    expect(out.code).toContain('sensor = Pin(15)')
    // The second object cannot reuse the name, so the generator disambiguates.
    expect(out.code).toContain('sensor_ = Pin(16)')
  })

  it('writes a choice verbatim and a text field quoted', () => {
    // A choice is usually a constant (`Pin.OUT`, `0x76`); quoting it would break
    // every one that is not a string.
    const type = install(`
blocks:
  - id: setup
    message: set %1 as %2
    code: "Pin({PIN}, {MODE})"
    args:
      - name: PIN
        kind: number-field
        default: 15
      - name: MODE
        kind: choice
        options:
          - [output, Pin.OUT]
          - [input, Pin.IN]
`)
    const out = gen({ blocks: { blocks: [{ type: type('setup'), id: 'b1' }] } })
    expect(out.code.trim()).toBe('Pin(15, Pin.OUT)')
  })

  it('renders a C-shaped body through a statements argument', () => {
    const type = install(`
blocks:
  - id: forever
    message: keep doing %1
    code: |
      while True:
      {BODY}
    args:
      - name: BODY
        kind: statements
  - id: beep
    message: beep
    code: "buzzer.beep()"
`)
    const out = gen({
      blocks: {
        blocks: [
          {
            type: type('forever'),
            id: 'f1',
            inputs: { BODY: { block: { type: type('beep'), id: 'b1' } } }
          }
        ]
      }
    })
    expect(out.code.trim()).toBe(['while True:', '    buzzer.beep()'].join('\n'))
  })

  it('writes `pass` for an empty body rather than invalid Python', () => {
    const type = install(`
blocks:
  - id: forever
    message: keep doing %1
    code: |
      while True:
      {BODY}
    args:
      - name: BODY
        kind: statements
`)
    const out = gen({ blocks: { blocks: [{ type: type('forever'), id: 'f1' }] } })
    expect(out.code.trim()).toBe(['while True:', '    pass'].join('\n'))
  })

  it('parenthesises a value that is not obviously atomic', () => {
    const type = install(`
blocks:
  - id: half
    message: half of %1
    shape: value
    output: Number
    code: "{N} / 2"
    args:
      - name: N
        kind: number
        default: 10
  - id: say
    message: say %1
    code: "print({WHAT})"
    args:
      - name: WHAT
        kind: any
`)
    const out = gen({
      blocks: {
        blocks: [
          {
            type: type('say'),
            id: 's1',
            inputs: {
              WHAT: {
                block: {
                  type: 'math_arithmetic',
                  fields: { OP: 'MULTIPLY' },
                  inputs: {
                    A: { block: { type: type('half'), id: 'h1' } },
                    B: { block: { type: 'math_number', fields: { NUM: 3 } } }
                  }
                }
              }
            }
          }
        ]
      }
    })
    // `10 / 2 * 3` would be a different number.
    expect(out.code.trim()).toBe('print((10 / 2) * 3)')
  })

  it('leaves a bare call unparenthesised', () => {
    const type = install(`
blocks:
  - id: read
    message: reading
    shape: value
    output: Number
    code: "sensor.read()"
  - id: say
    message: say %1
    code: "print({WHAT})"
    args:
      - name: WHAT
        kind: any
`)
    const out = gen({
      blocks: {
        blocks: [
          {
            type: type('say'),
            id: 's1',
            inputs: { WHAT: { block: { type: type('read'), id: 'r1' } } }
          }
        ]
      }
    })
    expect(out.code.trim()).toBe('print(sensor.read())')
  })
})
describe('namespacing', () => {
  it('gives two parts the same block id without a collision', () => {
    const tof = partSource('vl53l0x')
    const baro = partSource('bme280')
    expect(blockTypeFor(tof, 'read')).not.toBe(blockTypeFor(baro, 'read'))
    expect(blockTypeFor(tof, 'read')).toBe('snakie_part_snakie_standard_vl53l0x_read')
  })

  it('namespaces a plugin the same way', () => {
    expect(
      blockTypeFor({ kind: 'plugin', id: 'my-robot', name: 'My robot', category: 'plugins' }, 'beep')
    ).toBe('snakie_plugin_my_robot_beep')
  })
})

describe('the dynamic registry', () => {
  const GO = `
blocks:
  - id: go
    message: go
    code: "robot.go()"
`

  it('replaces a source whole rather than accumulating', () => {
    install(GO, 'rover')
    expect(blocksInCategory('parts')).toHaveLength(1)
    const type = install(
      `
blocks:
  - id: stop
    message: stop
    code: "robot.stop()"
`,
      'rover'
    )
    // The part re-registered with a different block; the old one is gone, not
    // sitting in the flyout generating code for hardware that isn't there.
    expect(blocksInCategory('parts').map((b) => b.type)).toEqual([type('stop')])
  })

  it('prunes a source that is no longer present', () => {
    install(GO)
    pruneDynamicBlocks(new Set<string>())
    expect(blocksInCategory('parts')).toHaveLength(0)
  })

  it('never prunes the hand-written palette', () => {
    // The core blocks carry no `source`, so a prune that keeps nothing must
    // still leave every one of them alone.
    defineBlocks([{ type: 'test_core', category: 'hardware', json: {}, code: () => 'x\n' }])
    install(GO)
    pruneDynamicBlocks(new Set<string>())
    expect(registeredBlocks().map((b) => b.type)).toEqual(['test_core'])
  })

  it('carries the part reference, so using a block can offer its driver', () => {
    install(GO, 'vl53l0x')
    expect(blocksInCategory('parts')[0].part).toEqual({
      libraryId: 'snakie-standard',
      partId: 'vl53l0x'
    })
    expect(blocksInCategory('parts')[0].group).toEqual({
      id: 'part:snakie-standard.vl53l0x',
      name: 'VL53L0X'
    })
  })
})

describe('a manifest block declares its level (#1213, epic #1206)', () => {
  const MIXED = `
blocks:
  - id: read
    message: distance
    shape: value
    output: Number
    code: "sensor.read()"
  - id: raw
    message: raw register
    shape: value
    output: Number
    level: advanced
    code: "sensor.read_reg(0)"
`

  /** The part drawer's contents, at the level the learner has chosen. */
  const drawer = (level: BlockLevel): Record<string, unknown>[] => {
    const category = BLOCK_CATEGORIES.find((c) => c.id === 'parts')!
    const contents = categoryContents(category, 'unknown', level)
    // One sub-category per part (see `categoryContents`) — the part's drawer.
    return (contents[0]?.contents as Record<string, unknown>[]) ?? []
  }

  it('keeps an advanced plugin block out of the drawer in simple mode', () => {
    const type = install(MIXED, 'tof')
    expect(drawer('advanced').map((b) => b.type)).toEqual([type('read'), type('raw')])
    expect(drawer('simple').map((b) => b.type)).toEqual([type('read')])
  })

  it('takes the whole drawer away when every block in it is advanced', () => {
    install(
      `
blocks:
  - id: raw
    message: raw register
    level: advanced
    code: "sensor.write_reg(0, 1)"
`,
      'rawonly'
    )
    const category = BLOCK_CATEGORIES.find((c) => c.id === 'parts')!
    expect(categoryContents(category, 'unknown', 'advanced')).toHaveLength(1)
    // Nothing survived the filter, so the group is never built — and the
    // category falls back to a hint rather than an empty drawer.
    const simple = categoryContents(category, 'unknown', 'simple')
    expect(simple.every((c) => c.kind === 'label')).toBe(true)
  })

  it('leaves a block that says nothing at the beginner level', () => {
    install(
      `
blocks:
  - id: go
    message: go
    code: "robot.go()"
`,
      'plain'
    )
    expect(blocksInCategory('parts')[0].level).toBeUndefined()
    expect(drawer('simple')).toHaveLength(1)
  })
})

describe('the BME280 ships real blocks (#1017)', () => {
  // The part the epic names by name: "wire a BME280 in Electronics and BME280
  // blocks are waiting for you in Blocks". Read off DISK, so the file that
  // actually ships is the one under test — a `blocks.yml` that stops generating
  // the right Python is otherwise something a child finds out about.
  beforeEach(() => installCorePalette())

  const yaml = readFileSync(
    join(process.cwd(), 'examples/parts/snakie-standard/bme280/blocks.yml'),
    'utf-8'
  )

  it('parses with no complaints', () => {
    const { manifest, warnings } = parseBlocksManifest(yaml)
    expect(warnings).toEqual([])
    expect(manifest.blocks.map((b) => b.id)).toEqual([
      'sensor',
      'temperature',
      'pressure',
      'humidity'
    ])
  })

  it('opens the sensor once and reads it three times', () => {
    const type = install(yaml, 'bme280')
    const say = (input: Record<string, unknown>, next?: Record<string, unknown>): Record<string, unknown> => ({
      type: 'text_print',
      inputs: { TEXT: { block: input } },
      ...(next ? { next: { block: next } } : {})
    })
    const reading = (id: string): Record<string, unknown> => ({
      type: type(id),
      inputs: { SENSOR: { shadow: { type: type('sensor'), fields: { BUS: 0, SDA: 4, SCL: 5 } } } }
    })
    const out = gen({
      blocks: {
        blocks: [say(reading('temperature'), say(reading('pressure'), say(reading('humidity'))))]
      }
    })
    expect(out.code).toBe(
      [
        // `machine` before the driver — the import manager's own grouping, and
        // the order every Snakie example is written in.
        'from machine import I2C, Pin',
        '',
        'from bme280 import BME280',
        '',
        'bme = BME280(I2C(0, sda=Pin(4), scl=Pin(5)))',
        '',
        'print(bme.temperature())',
        'print(bme.pressure())',
        'print(bme.humidity())',
        ''
      ].join('\n')
    )
  })

  it('gives two sensors on two buses two objects', () => {
    // The setup key is the WIRING, so one sensor read four times is one object
    // and two sensors are two.
    const type = install(yaml, 'bme280b')
    const reading = (bus: number, sda: number, scl: number): Record<string, unknown> => ({
      type: 'text_print',
      inputs: {
        TEXT: {
          block: {
            type: type('temperature'),
            inputs: { SENSOR: { shadow: { type: type('sensor'), fields: { BUS: bus, SDA: sda, SCL: scl } } } }
          }
        }
      }
    })
    const out = gen({
      blocks: { blocks: [{ ...reading(0, 4, 5), next: { block: reading(1, 6, 7) } }] }
    })
    expect(out.code).toContain('bme = BME280(I2C(0, sda=Pin(4), scl=Pin(5)))')
    expect(out.code).toContain('bme_ = BME280(I2C(1, sda=Pin(6), scl=Pin(7)))')
  })

  it("renders the escaped percent in the humidity block's label", () => {
    // `%%` is Blockly's escape for a literal per-cent sign, and getting it wrong
    // is a block that reads `humidity 1 from` — or one that throws while the
    // flyout builds it.
    const type = install(yaml, 'bme280c')
    const ws = new Blockly.Workspace()
    const block = ws.newBlock(type('humidity'))
    const text = block.inputList
      .flatMap((input) => input.fieldRow.map((f) => f.getText()))
      .join(' ')
    expect(text).toContain('%')
    expect(text).not.toContain('%%')
  })
})
