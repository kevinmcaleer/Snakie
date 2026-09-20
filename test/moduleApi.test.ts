import { describe, it, expect } from 'vitest'
import {
  apiFromCurated,
  paramsFromDetail,
  readModuleApi,
  readParam,
  splitParams
} from '../src/renderer/src/lib/blocks/module-api'

/**
 * READING A MODULE (#1048).
 * =============================================================================
 *
 * The `ssd1306.py` in the issue is the fixture, because it is the shape a real
 * driver has: a base class holding the API, a subclass holding the constructor,
 * module constants, and a private helper nobody should be offered.
 */

const SSD1306 = `
# A realistic MicroPython display driver.
import framebuf

WIDTH = 128
HEIGHT = 64
SET_CONTRAST = 0x81
_BUFFER = bytearray(1)


def _helper(a, b=2):
    return a + b


def swap(a, b):
    return b, a


class SSD1306(framebuf.FrameBuffer):
    def __init__(self, width, height, external_vcc=False):
        self.width = width

    def text(self, string, x, y, col=1):
        pass

    def contrast(self, contrast):
        pass

    def _write(self, cmd):
        pass


class SSD1306_I2C(SSD1306):
    def __init__(self, width, height, i2c, addr=0x3C, external_vcc=False):
        super().__init__(width, height, external_vcc)

    def show(self):
        pass
`

describe('reading a driver', () => {
  const api = readModuleApi('ssd1306', SSD1306)

  it('finds the classes and what they inherit', () => {
    expect(api.classes.map((c) => c.name)).toEqual(['SSD1306', 'SSD1306_I2C'])
    // The base often names the real API — `framebuf.FrameBuffer` is where
    // `pixel` and `fill` come from.
    expect(api.classes[0].bases).toEqual(['framebuf.FrameBuffer'])
    expect(api.classes[1].bases).toEqual(['SSD1306'])
  })

  it('reads a constructor with its real names and defaults', () => {
    // The whole point: real parameter names, and which ones may be omitted.
    expect(api.classes[1].init).toEqual([
      { name: 'width' },
      { name: 'height' },
      { name: 'i2c' },
      { name: 'addr', default: '0x3C' },
      { name: 'external_vcc', default: 'False' }
    ])
  })

  it('drops `self`, which the block already has', () => {
    const text = api.classes[0].methods.find((m) => m.name === 'text')!
    expect(text.params).toEqual([
      { name: 'string' },
      { name: 'x' },
      { name: 'y' },
      { name: 'col', default: '1' }
    ])
  })

  it('skips private methods but keeps __init__, which is not private', () => {
    expect(api.classes[0].methods.map((m) => m.name)).toEqual(['text', 'contrast'])
    expect(api.classes[0].init).toBeDefined()
  })

  it('finds module functions and skips the private ones', () => {
    expect(api.functions.map((f) => f.name)).toEqual(['swap'])
  })

  it('finds upper-case constants and skips module state', () => {
    // Lower-case module-level names are nearly always a private cache or a
    // singleton — a block reading one would be a block about the driver's
    // insides.
    expect(api.constants).toEqual(['WIDTH', 'HEIGHT', 'SET_CONTRAST'])
    expect(api.constants).not.toContain('_BUFFER')
  })

  it('does not leak a method out of its class', () => {
    expect(api.functions.map((f) => f.name)).not.toContain('show')
    expect(api.classes[1].methods.map((m) => m.name)).toEqual(['show'])
  })
})

describe('parameter lists', () => {
  it('respects nesting rather than splitting on every comma', () => {
    expect(splitParams('a, b=(1, 2), c')).toEqual(['a', 'b=(1, 2)', 'c'])
    expect(splitParams('')).toEqual([])
  })

  it('marks *args and **kwargs, which cannot become sockets', () => {
    expect(readParam('*rest')).toEqual({ name: 'rest', variadic: true })
    expect(readParam('**kw')).toEqual({ name: 'kw', variadic: true })
  })

  it('drops a type annotation, since every socket is `any` anyway', () => {
    expect(readParam('x: int = 0')).toEqual({ name: 'x', default: '0' })
    expect(readParam('name: str')).toEqual({ name: 'name' })
  })

  it('is not fooled by an == inside a default', () => {
    expect(readParam('flag=(a == b)')).toEqual({ name: 'flag', default: '(a == b)' })
  })

  it('ignores the positional and keyword-only markers', () => {
    expect(readParam('/')).toBeNull()
    expect(readParam('*')).toBeNull()
  })
})

describe('what it refuses to guess', () => {
  it('reads an async def like any other', () => {
    const api = readModuleApi('m', 'async def go(n):\n    pass\n')
    expect(api.functions).toEqual([{ name: 'go', params: [{ name: 'n' }] }])
  })

  it('ignores a return annotation', () => {
    const api = readModuleApi('m', 'def go(n) -> int:\n    pass\n')
    expect(api.functions[0].params).toEqual([{ name: 'n' }])
  })

  it('a module it cannot read is an empty API, not an error', () => {
    // A driver that builds its API with `setattr` in a loop is invisible to a
    // parser. That is what a board-side `dir()` is for, and saying nothing is
    // the honest answer here.
    const api = readModuleApi('weird', 'for n in NAMES:\n    setattr(M, n, make(n))\n')
    expect(api).toEqual({ module: 'weird', classes: [], functions: [], constants: [], variables: [] })
  })

  it('a private class takes its methods with it', () => {
    const api = readModuleApi('m', 'class _Hidden:\n    def go(self):\n        pass\n')
    expect(api.classes).toEqual([])
    expect(api.functions).toEqual([])
  })
})

describe('the curated tier (#1048)', () => {
  it('reads a signature out of the detail line', () => {
    // `micropython-symbols.ts` was written for Monaco and turns out to carry
    // real signatures — so the modules whose source we will NEVER have (they
    // are frozen into the firmware) still get real parameter names.
    expect(paramsFromDetail('time.ticks_diff(a, b)')).toEqual([{ name: 'a' }, { name: 'b' }])
    expect(paramsFromDetail('time.sleep(seconds)')).toEqual([{ name: 'seconds' }])
    expect(paramsFromDetail('machine.freq()')).toEqual([])
  })

  it('a detail with no call says nothing about arguments', () => {
    // `machine.Pin` is a name, not a signature. An empty list is the honest
    // reading; inventing one would be the guessing this module refuses to do.
    expect(paramsFromDetail('machine.Pin')).toEqual([])
    expect(paramsFromDetail(undefined)).toEqual([])
  })

  it('maps kinds onto the same shape the parser produces', () => {
    const api = apiFromCurated('machine', [
      { name: 'Pin', kind: 'class', detail: 'machine.Pin' },
      { name: 'freq', kind: 'function', detail: 'machine.freq()' },
      { name: 'reset', kind: 'function', detail: 'machine.reset()' },
      { name: 'ID', kind: 'constant' },
      // Module state is not an API — a block reading one would be a block
      // about the module's insides.
      { name: 'cache', kind: 'variable' },
      { name: '_secret', kind: 'function' }
    ])
    expect(api.classes.map((c) => c.name)).toEqual(['Pin'])
    expect(api.functions.map((f) => f.name)).toEqual(['freq', 'reset'])
    expect(api.constants).toEqual(['ID'])
  })

  it('gives a curated class no invented constructor', () => {
    const api = apiFromCurated('machine', [{ name: 'Pin', kind: 'class', detail: 'machine.Pin' }])
    expect(api.classes[0].init).toBeUndefined()
    expect(api.classes[0].methods).toEqual([])
  })
})

describe('what a body tells us', () => {
  const SRC = `
class Sensor:
    def __init__(self, pin=0):
        self.pin = pin
        self.unit = 'cm'
        self._cache = None
        self.pin = 1

    @property
    def ready(self):
        return True

    @ready.setter
    def ready(self, v):
        pass

    def read(self):
        if self.pin:
            return 42
        return 0

    def reset(self):
        self._cache = None
        return


def helper(x):
    return x * 2


def go():
    pass
`
  const api = readModuleApi('sensor', SRC)

  it('a method or function with a return value is a value', () => {
    const [sensor] = api.classes
    expect(sensor.methods.map((m) => [m.name, m.returns ?? false])).toEqual([
      ['read', true],
      ['reset', false]
    ])
    expect(api.functions.map((f) => [f.name, f.returns ?? false])).toEqual([
      ['helper', true],
      ['go', false]
    ])
  })

  it('a @property and a public self.attribute are properties, and a setter is nothing new', () => {
    expect(api.classes[0].properties).toEqual(['pin', 'unit', 'ready'])
    expect(api.classes[0].methods.map((m) => m.name)).not.toContain('ready')
  })

  it('an __init__ attribute is settable, and a @property only with a .setter (#1209)', () => {
    // `ready` has one, so `sensor.ready = True` is a line somebody may write.
    // A getter-only property would not be here: assigning to one raises, and a
    // *set … to …* block offering it would be a block whose only outcome is an
    // `AttributeError`.
    expect(api.classes[0].settable).toEqual(['pin', 'unit', 'ready'])
  })

  it('a getter-only @property is readable but not settable', () => {
    const only = readModuleApi(
      'sensor',
      'class Sensor:\n    @property\n    def ready(self):\n        return True\n'
    )
    expect(only.classes[0].properties).toEqual(['ready'])
    expect(only.classes[0].settable).toEqual([])
  })
})
