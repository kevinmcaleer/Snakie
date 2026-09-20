import { describe, it, expect, beforeEach } from 'vitest'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import { readModuleApi } from '../src/renderer/src/lib/blocks/module-api'
import { manifestForModule, readRulesForModule } from '../src/renderer/src/lib/blocks/module-blocks'
import { normaliseBlocksManifest } from '../src/shared/blocks-manifest'
import { blockDefinitionsFrom, blockTypeFor, type BlockSource } from '../src/renderer/src/lib/blocks/manifest'
import { pythonToBlocks, registerDynamicCallRules } from '../src/renderer/src/lib/blocks/python-to-blocks'
import {
  defineDynamicBlocks,
  installBlockDefinitions,
  resetBlockRegistry,
  blocksInCategory
} from '../src/renderer/src/lib/blocks/registry'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import { generateProgram } from '../src/renderer/src/lib/blocks/generator'

/**
 * A MODULE'S API, AS BLOCKS (#1048).
 * =============================================================================
 *
 * The end of the chain the reader starts: source → API → manifest → real
 * blocks → real MicroPython. Nothing here invents a registration path — it all
 * goes down #1017's, which is the point.
 */

const SSD1306 = `
WIDTH = 128

class SSD1306_I2C:
    def __init__(self, width, height, i2c, addr=0x3C):
        pass

    def text(self, string, x, y, col=1):
        pass

    def show(self):
        pass

    def blit(self, *rest):
        pass


def helper(a, b):
    return a + b
`

/**
 * The module from the issue that asked for this: a sensor whose constructor
 * carries the wiring in its defaults, a method that RETURNS a reading, a
 * `@property`, and an attribute set in `__init__`.
 */
const RANGE_FINDER = `
from machine import Pin
import time


class RangeFinder:
    def __init__(self, echo_pin=0, trigger_pin=1):
        self.echo = Pin(echo_pin, Pin.IN)
        self.trigger = Pin(trigger_pin, Pin.OUT)
        self.unit = 'cm'
        self._last = None

    @property
    def ready(self):
        return self._last is not None

    @ready.setter
    def ready(self, value):
        pass

    def distance(self):
        self.trigger.value(1)
        return 42.0

    def calibrate(self, offset):
        self._offset = offset
`

const manifest = (src = SSD1306): ReturnType<typeof manifestForModule> =>
  manifestForModule(readModuleApi('ssd1306', src))

describe('what a module offers', () => {
  const ids = manifest().blocks.map((b) => b.id)

  it('a constructor, a block per method, a function and a constant', () => {
    expect(ids).toContain('new_SSD1306_I2C')
    expect(ids).toContain('SSD1306_I2C_text')
    expect(ids).toContain('SSD1306_I2C_show')
    expect(ids).toContain('fn_helper')
    expect(ids).toContain('const_WIDTH')
  })

  it('skips a method whose signature cannot be sockets', () => {
    // `*args` cannot become a socket. #1018's call block is still the way to
    // reach it, and offering a block that silently drops arguments would be
    // worse than offering none.
    expect(ids).not.toContain('SSD1306_I2C_blit')
  })

  it('a constructor default it can show becomes a pre-filled socket and a keyword argument', () => {
    // `RangeFinder(echo_pin=0, trigger_pin=1)` puts the WIRING in its defaults,
    // and a block with no way to say which pins the sensor is on is a block
    // for somebody else's breadboard. `addr=0x3C` has no shadow that shows it
    // as written, so it stays out of the block and in the call by omission.
    const ctor = manifest().blocks.find((b) => b.id === 'new_SSD1306_I2C')!
    expect(ctor.args?.map((a) => a.name)).toEqual(['WIDTH', 'HEIGHT', 'I2C'])
    expect(ctor.setup?.expr).toBe('ssd1306.SSD1306_I2C({WIDTH}, {HEIGHT}, {I2C})')

    const ping = manifestForModule(readModuleApi('range_finder', RANGE_FINDER)).blocks.find(
      (b) => b.id === 'new_RangeFinder'
    )!
    expect(ping.args).toEqual([
      { name: 'ECHO_PIN', kind: 'number', default: 0, label: 'echo_pin' },
      { name: 'TRIGGER_PIN', kind: 'number', default: 1, label: 'trigger_pin' }
    ])
    expect(ping.setup?.expr).toBe(
      'range_finder.RangeFinder(echo_pin={ECHO_PIN}, trigger_pin={TRIGGER_PIN})'
    )
  })

  it('a method default still gets no socket', () => {
    // `col=1` is the colour the driver's author expects. A beginner offered five
    // sockets for a call that needs three is being asked a question they cannot
    // answer — and unlike a constructor, nothing about the wiring lives here.
    const text = manifest().blocks.find((b) => b.id === 'SSD1306_I2C_text')!
    expect(text.args?.map((a) => a.name)).toEqual(['STRING', 'X', 'Y', 'OBJ'])
  })

  it('drops self, and keeps the real parameter names as labels', () => {
    const text = manifest().blocks.find((b) => b.id === 'SSD1306_I2C_text')!
    expect(text.args?.map((a) => a.label)).toEqual(['string', 'x', 'y', 'on'])
    expect(text.code).toBe('{OBJ}.text({STRING}, {X}, {Y})')
  })

  it('hoists the object so it is built once, above the program', () => {
    // A display re-initialised inside a loop is a display that flickers.
    expect(manifest().blocks.find((b) => b.id === 'new_SSD1306_I2C')!.setup).toBeDefined()
  })

  it('a module nothing could be read from offers nothing', () => {
    expect(manifest('x = 1\n').blocks).toEqual([])
  })
})

describe('the whole chain, ending in MicroPython', () => {
  beforeEach(() => {
    resetBlockRegistry()
    installCorePalette()
  })

  it('registers through #1017’s path and generates real code', () => {
    // Through `normaliseBlocksManifest` — the same front door the plugin path
    // uses — so anything this produces is held to the same schema rules.
    const { manifest: normalised, warnings } = normaliseBlocksManifest(manifest())
    expect(warnings).toEqual([])
    const defs = blockDefinitionsFrom(normalised, {
      kind: 'module',
      id: 'ssd1306',
      name: 'ssd1306',
      category: 'modules'
    })
    defineDynamicBlocks('module:ssd1306', defs)
    installBlockDefinitions()

    expect(blocksInCategory('modules').length).toBe(defs.length)

    const ctor = defs.find((d) => d.type.endsWith('new_ssd1306_i2c'))!
    const show = defs.find((d) => d.type.endsWith('ssd1306_i2c_show'))!
    const ws = new Blockly.Workspace()
    Blockly.serialization.workspaces.load(
      {
        blocks: {
          languageVersion: 0,
          blocks: [
            {
              type: show.type,
              id: 's',
              inputs: { OBJ: { block: { type: ctor.type, id: 'c' } } }
            }
          ]
        }
      } as never,
      ws
    )
    const code = generateProgram(ws).code
    expect(code).toContain('import ssd1306')
    expect(code).toContain('.show()')
  })
})

describe('a sensor module, the way the issue wrote it', () => {
  const PROGRAM = `import time

from range_finder import RangeFinder

ping = RangeFinder(echo_pin=0, trigger_pin=1)

while True:
    print(f"ping.distance {ping.distance()}")
    time.sleep(0.5)
`
  const from: BlockSource = {
    kind: 'module',
    id: 'range_finder',
    name: 'range_finder',
    category: 'modules'
  }
  const api = readModuleApi('range_finder', RANGE_FINDER)

  beforeEach(() => {
    resetBlockRegistry()
    installCorePalette()
    const { manifest: normalised, warnings } = normaliseBlocksManifest(manifestForModule(api))
    expect(warnings).toEqual([])
    defineDynamicBlocks('module:range_finder', blockDefinitionsFrom(normalised, from))
    registerDynamicCallRules(
      'module:range_finder',
      readRulesForModule(api, (id) => blockTypeFor(from, id))
    )
    installBlockDefinitions()
  })

  it('a method that returns is a value block; one that does not is a statement', () => {
    const blocks = manifestForModule(api).blocks
    expect(blocks.find((b) => b.id === 'RangeFinder_distance')?.shape).toBe('value')
    expect(blocks.find((b) => b.id === 'RangeFinder_calibrate')?.shape).toBeUndefined()
  })

  it('a @property and a self.attribute are value blocks with no brackets', () => {
    const blocks = manifestForModule(api).blocks
    const ids = blocks.map((b) => b.id)
    expect(ids).toContain('RangeFinder_ready')
    expect(ids).toContain('RangeFinder_unit')
    expect(ids).toContain('RangeFinder_echo')
    expect(ids).not.toContain('RangeFinder__last')
    expect(blocks.find((b) => b.id === 'RangeFinder_unit')).toMatchObject({
      shape: 'value',
      code: '{OBJ}.unit'
    })
  })

  it('reads ping.distance() inside the print back as the module block, and regenerates the program', () => {
    const { workspace } = pythonToBlocks(PROGRAM)
    const json = JSON.stringify(workspace)
    expect(json).toContain('"type":"snakie_print_format"')
    expect(json).toContain(`"type":"${blockTypeFor(from, 'RangeFinder_distance')}"`)
    // The ONE grey value left is the constructor line, kept exactly as the
    // learner wrote it: the module's constructor block hoists an object of its
    // own, and reading `ping = RangeFinder(…)` as that block would rename it.
    expect(json.match(/snakie_python_value/g)?.length).toBe(1)
    const ws = new Blockly.Workspace()
    Blockly.serialization.workspaces.load(workspace as never, ws)
    expect(generateProgram(ws).code).toBe(PROGRAM)
  })

  it('the constructor block writes the wiring as keyword arguments, hoisted once', () => {
    const ctor = blockTypeFor(from, 'new_RangeFinder')
    const distance = blockTypeFor(from, 'RangeFinder_distance')
    const ws = new Blockly.Workspace()
    Blockly.serialization.workspaces.load(
      {
        blocks: {
          languageVersion: 0,
          blocks: [
            {
              type: 'snakie_print_format',
              fields: { TEMPLATE: 'ping.distance {}' },
              extraState: { items: 1 },
              inputs: {
                ADD0: {
                  block: {
                    type: distance,
                    inputs: {
                      OBJ: {
                        block: {
                          type: ctor,
                          inputs: {
                            ECHO_PIN: { block: { type: 'math_number', fields: { NUM: 2 } } },
                            TRIGGER_PIN: { block: { type: 'math_number', fields: { NUM: 3 } } }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          ]
        }
      } as never,
      ws
    )
    const code = generateProgram(ws).code
    expect(code).toContain('import range_finder')
    expect(code).toContain('rangefinder = range_finder.RangeFinder(echo_pin=2, trigger_pin=3)')
    expect(code).toContain('print(f"ping.distance {rangefinder.distance()}")')
  })
})
