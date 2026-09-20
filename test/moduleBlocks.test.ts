import { describe, it, expect, beforeEach } from 'vitest'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import { readModuleApi } from '../src/renderer/src/lib/blocks/module-api'
import {
  manifestForModule,
  objectNameFor,
  objectRulesForModule,
  readRulesForModule
} from '../src/renderer/src/lib/blocks/module-blocks'
import { normaliseBlocksManifest } from '../src/shared/blocks-manifest'
import { blockDefinitionsFrom, blockTypeFor, type BlockSource } from '../src/renderer/src/lib/blocks/manifest'
import {
  pythonToBlocks,
  registerDynamicCallRules,
  registerDynamicObjectRules
} from '../src/renderer/src/lib/blocks/python-to-blocks'
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
    // OBJ first — the name the object is given, then the wiring.
    expect(ctor.args?.map((a) => a.name)).toEqual(['OBJ', 'WIDTH', 'HEIGHT', 'I2C'])
    expect(ctor.code).toBe('{OBJ} = SSD1306_I2C({WIDTH}, {HEIGHT}, {I2C})')

    const ping = manifestForModule(readModuleApi('range_finder', RANGE_FINDER)).blocks.find(
      (b) => b.id === 'new_RangeFinder'
    )!
    expect(ping.args).toEqual([
      { name: 'OBJ', kind: 'variable', default: 'range_finder' },
      { name: 'ECHO_PIN', kind: 'number', default: 0, label: 'echo_pin' },
      { name: 'TRIGGER_PIN', kind: 'number', default: 1, label: 'trigger_pin' }
    ])
    expect(ping.code).toBe('{OBJ} = RangeFinder(echo_pin={ECHO_PIN}, trigger_pin={TRIGGER_PIN})')
    // `from range_finder import RangeFinder` — the line the driver's own README
    // shows, rather than `import range_finder` and a dotted call.
    expect(ping.imports).toEqual([{ module: 'range_finder', name: 'RangeFinder' }])
  })

  it('names the object after its class, in the casing Python gives an object', () => {
    expect(objectNameFor('RangeFinder')).toBe('range_finder')
    expect(objectNameFor('SSD1306_I2C')).toBe('ssd1306_i2c')
    expect(objectNameFor('Servo')).toBe('servo')
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
    expect(text.args?.map((a) => a.label)).toEqual(['string', 'x', 'y', undefined])
    expect(text.args?.[3]).toEqual({ name: 'OBJ', kind: 'variable', default: 'ssd1306_i2c' })
    expect(text.code).toBe('{OBJ}.text({STRING}, {X}, {Y})')
  })

  it('makes the object once, on a line of its own, rather than inside every call', () => {
    // The wiring is typed on ONE block. Every other block on the class is two
    // dropdowns — which object, and which part of it — so a learner never
    // re-states the pins to take a reading (#1209).
    const ctor = manifest().blocks.find((b) => b.id === 'new_SSD1306_I2C')!
    expect(ctor.shape).toBeUndefined()
    expect(ctor.setup).toBeUndefined()
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
    const oled = ws.getVariableMap().createVariable('oled', '')
    Blockly.serialization.workspaces.load(
      {
        blocks: {
          languageVersion: 0,
          blocks: [
            {
              type: ctor.type,
              id: 'c',
              fields: { OBJ: { id: oled.getId() } },
              next: { block: { type: show.type, id: 's', fields: { OBJ: { id: oled.getId() } } } }
            }
          ]
        },
        variables: [{ name: 'oled', id: oled.getId() }]
      } as never,
      ws
    )
    const code = generateProgram(ws).code
    expect(code).toContain('from ssd1306 import SSD1306_I2C')
    // ONE object, made once and named, then used by name — which is what the
    // learner sees on the canvas as well (#1209).
    expect(code).toContain('oled = SSD1306_I2C(')
    expect(code).toContain('oled.show()')
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
  const typeFor = (id: string): string => blockTypeFor(from, id)

  beforeEach(() => {
    resetBlockRegistry()
    installCorePalette()
    const { manifest: normalised, warnings } = normaliseBlocksManifest(manifestForModule(api))
    expect(warnings).toEqual([])
    defineDynamicBlocks('module:range_finder', blockDefinitionsFrom(normalised, from))
    registerDynamicCallRules('module:range_finder', readRulesForModule(api, typeFor))
    registerDynamicObjectRules('module:range_finder', objectRulesForModule(api, typeFor))
    installBlockDefinitions()
  })

  it('one dropdown for everything the sensor can be asked', () => {
    // The whole read surface of the class on ONE block: the `@property`, the
    // `__init__` attributes, and the reading method — which wears its brackets
    // in the menu, because that is the difference a learner has to learn.
    const get = manifestForModule(api).blocks.find((b) => b.id === 'RangeFinder_get')!
    expect(get.shape).toBe('value')
    expect(get.code).toBe('{OBJ}.{MEMBER}')
    expect(get.args?.[1].options?.map((o) => o.value)).toEqual([
      'echo',
      'trigger',
      'unit',
      'ready',
      'distance()'
    ])
    expect(get.args?.[1].options?.find((o) => o.value === 'distance()')?.label).toBe('distance()')
    // `_last` is private: the class did not offer it, so neither does the menu.
    expect(get.args?.[1].options?.map((o) => o.value)).not.toContain('_last')
  })

  it('offers only the members that can actually be assigned to', () => {
    // `ready` is a `@property` WITH a `.setter`, so it is settable; a getter-only
    // property would not be, because `ping.x = 1` on one raises.
    const set = manifestForModule(api).blocks.find((b) => b.id === 'RangeFinder_set')!
    expect(set.code).toBe('{OBJ}.{MEMBER} = {VALUE}')
    expect(set.args?.[1].options?.map((o) => o.value)).toEqual([
      'echo',
      'trigger',
      'unit',
      'ready'
    ])
    // A reading is not a thing you assign to. `ping.distance() = 1` is not Python.
    expect(set.args?.[1].options?.map((o) => o.value)).not.toContain('distance()')
  })

  it('a method with arguments keeps a block of its own; a bare reading does not', () => {
    const ids = manifestForModule(api).blocks.map((b) => b.id)
    // `calibrate(offset)` needs a socket, and a dropdown cannot grow one.
    expect(ids).toContain('RangeFinder_calibrate')
    // `distance()` is in the dropdown, so a second block writing the same line
    // would be a second shelf entry for one thing — and an ambiguity for the
    // reader, which has to choose a block for `ping.distance()`.
    expect(ids).not.toContain('RangeFinder_distance')
    expect(ids).not.toContain('RangeFinder_unit')
    expect(ids).toEqual(['new_RangeFinder', 'RangeFinder_get', 'RangeFinder_set', 'RangeFinder_calibrate'])
  })

  it('opens the issue’s own program with nothing left grey, and writes it back unchanged', () => {
    const { workspace } = pythonToBlocks(PROGRAM)
    const json = JSON.stringify(workspace)
    expect(json).toContain('"type":"snakie_print_format"')
    // THE CONSTRUCTOR LINE IS A BLOCK NOW (#1209). It used to be the one grey
    // value in this program — the learner's own `ping = RangeFinder(…)` coming
    // back as raw Python above blocks that had forgotten they were about it.
    expect(json).toContain(`"type":"${typeFor('new_RangeFinder')}"`)
    expect(json).toContain(`"type":"${typeFor('RangeFinder_get')}"`)
    expect(json).toContain('"MEMBER":"distance()"')
    expect(json).not.toContain('snakie_python_value')

    // AND BOTH HALVES NAME ONE VARIABLE. That is the whole point of holding the
    // object in a variable field: renaming `ping` on the canvas moves the
    // declaration and every use of it together.
    const ids = [...json.matchAll(/"OBJ":\{"id":"([^"]+)"\}/g)].map((m) => m[1])
    expect(ids.length).toBe(2)
    expect(new Set(ids).size).toBe(1)

    const ws = new Blockly.Workspace()
    Blockly.serialization.workspaces.load(workspace as never, ws)
    expect(generateProgram(ws).code).toBe(PROGRAM)
  })

  it('reads a member assignment back as the set block, and only a settable one', () => {
    const settable = pythonToBlocks(
      'from range_finder import RangeFinder\n\nping = RangeFinder(echo_pin=0, trigger_pin=1)\nping.unit = "in"\n'
    )
    expect(JSON.stringify(settable.workspace)).toContain(`"type":"${typeFor('RangeFinder_set')}"`)
  })

  it('leaves a line the block could not write exactly as the learner wrote it', () => {
    // `addr` is not a parameter of this constructor at all, so no socket can
    // hold it — and a block that came back without it would be a silent
    // rewrite. The line stays raw, which regenerates it verbatim.
    const odd = pythonToBlocks(
      'from range_finder import RangeFinder\n\nping = RangeFinder(echo_pin=0, addr=60)\n'
    )
    const json = JSON.stringify(odd.workspace)
    expect(json).not.toContain(`"type":"${typeFor('new_RangeFinder')}"`)
    expect(json).toContain('snakie_python_value')
  })
})
