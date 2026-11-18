import { describe, it, expect } from 'vitest'
import data from '../src/renderer/src/components/micropython-stubs.json'
import type { StubCatalogue } from '../src/renderer/src/components/micropython-stubs'
import {
  activeSignature,
  callContext,
  dottedOwner,
  fromImportContext,
  memberDetail,
  memberMarkdown,
  membersOf,
  memberSortText,
  resolveExpr,
  scanScope,
  signaturesFor,
  type Resolved
} from '../src/renderer/src/components/micropython-intellisense'

const cat = data as unknown as StubCatalogue

const names = (r: Resolved | null): string[] => (r ? membersOf(cat, r).map((e) => e.name) : [])
const resolve = (src: string, expr: string): Resolved | null => resolveExpr(expr, scanScope(src), cat)

describe('the generated stub catalogue', () => {
  it('covers the core MicroPython modules', () => {
    for (const mod of ['machine', 'time', 'network', 'os', 'gc', 'micropython', 'struct', 'json', 'neopixel', 'bluetooth', 'rp2', 'esp32', 'asyncio', 'framebuf']) {
      expect(cat.modules[mod], mod).toBeDefined()
    }
  })

  it('has every machine class a robot needs', () => {
    for (const cls of ['Pin', 'PWM', 'ADC', 'I2C', 'SoftI2C', 'SPI', 'UART', 'Timer', 'RTC', 'WDT', 'Signal']) {
      expect(cat.modules.machine.members[cls]?.kind, cls).toBe('class')
    }
  })

  it('maps the u-modules onto their real names', () => {
    expect(cat.aliases.utime).toBe('time')
    expect(cat.aliases.ustruct).toBe('struct')
    expect(cat.aliases.ujson).toBe('json')
    expect(cat.aliases.uos).toBe('os')
  })

  it('tags port-specific API with its port', () => {
    expect(cat.modules.rp2.ports).toEqual(['rp2'])
    expect(cat.modules.esp32.ports).toEqual(['esp32'])
    expect(cat.modules.machine.ports).toBeUndefined()
    expect(cat.modules.machine.members.Pin.ports).toBeUndefined()
    expect(cat.modules.machine.members.Pin.members?.ALT_PIO0?.ports).toEqual(['rp2'])
  })

  it('keeps only MicroPython’s slice of the standard library', () => {
    expect(cat.modules.os.members.listdir).toBeDefined()
    expect(cat.modules.os.members.fork).toBeUndefined()
    expect(cat.modules.asyncio.members.sleep_ms).toBeDefined()
  })
})

describe('scanScope + resolveExpr — following the file', () => {
  it('resolves a plain module and its classes', () => {
    expect(resolve('import machine', 'machine')).toEqual({ kind: 'module', module: 'machine' })
    expect(names(resolve('import machine', 'machine'))).toContain('Pin')
    expect(names(resolve('import machine', 'machine.Pin'))).toEqual(expect.arrayContaining(['OUT', 'IN', 'value', 'irq']))
  })

  it('follows `import x as y` and u-aliases', () => {
    expect(resolve('import machine as m', 'm')).toEqual({ kind: 'module', module: 'machine' })
    expect(names(resolve('import utime', 'utime'))).toContain('sleep_ms')
    expect(names(resolve('import utime as t', 't'))).toContain('ticks_diff')
  })

  it('follows `from x import y as z`, including parenthesised lists', () => {
    const src = 'from machine import (\n  Pin,\n  PWM as P,\n)\n'
    expect(resolve(src, 'P')).toMatchObject({ kind: 'member', path: ['PWM'], instance: false })
    expect(names(resolve(src, 'Pin'))).toContain('PULL_UP')
  })

  it('types a variable from the class it was built with', () => {
    const src = 'from machine import Pin, PWM\nled = Pin(25, Pin.OUT)\npwm = PWM(Pin(15))\n'
    const led = resolve(src, 'led')
    expect(led).toMatchObject({ kind: 'member', path: ['Pin'], instance: true })
    expect(names(led)).toEqual(expect.arrayContaining(['on', 'off', 'toggle', 'value']))
    expect(names(resolve(src, 'pwm'))).toEqual(expect.arrayContaining(['duty_u16', 'freq', 'deinit']))
  })

  it('types `self.x = module.Class(...)` and dotted constructors', () => {
    const src = [
      'import machine, network',
      'class Robot:',
      '    def __init__(self):',
      '        self.i2c = machine.I2C(0, sda=machine.Pin(4), scl=machine.Pin(5))',
      'wlan = network.WLAN(network.STA_IF)'
    ].join('\n')
    expect(names(resolve(src, 'self.i2c'))).toEqual(expect.arrayContaining(['scan', 'writeto', 'readfrom']))
    expect(names(resolve(src, 'wlan'))).toEqual(expect.arrayContaining(['connect', 'isconnected', 'active']))
  })

  it('types a parameter annotated with a class', () => {
    const src = 'from machine import UART\ndef send(u: UART, msg):\n    pass'
    expect(names(resolve(src, 'u'))).toContain('write')
  })

  it('follows star imports', () => {
    expect(names(resolve('from machine import *', 'ADC'))).toContain('read_u16')
  })

  it('inherits members from a base class', () => {
    const soft = resolve('from machine import SoftI2C\ni2c = SoftI2C(scl=1, sda=2)', 'i2c')
    expect(names(soft)).toContain('scan')
  })

  it('types a variable built by a function that returns a class', () => {
    // rp2.PIO(0).state_machine(...) is not followed, but a direct factory is
    const sm = resolve('import rp2\nsm = rp2.StateMachine(0, prog)', 'sm')
    expect(names(sm)).toEqual(expect.arrayContaining(['active', 'put', 'get']))
  })

  it('still completes a bare module or class name before its import is written', () => {
    expect(resolve('', 'machine')).toEqual({ kind: 'module', module: 'machine' })
    expect(names(resolve('', 'Pin'))).toContain('OUT')
  })

  it('returns null for something it does not know', () => {
    expect(resolve('x = 3', 'x')).toBeNull()
    expect(resolve('', 'nothing_here')).toBeNull()
  })
})

describe('cursor contexts', () => {
  it('reads `from x import` lists', () => {
    expect(fromImportContext('from machine import ')).toEqual({ module: 'machine', partial: '' })
    expect(fromImportContext('from machine import Pin, P')).toEqual({ module: 'machine', partial: 'P' })
    expect(fromImportContext('from machine import Pin as p, AD')).toEqual({ module: 'machine', partial: 'AD' })
    expect(fromImportContext('import machine')).toBeNull()
  })

  it('reads the dotted owner before a dot', () => {
    expect(dottedOwner('    self.led.va')).toEqual({ owner: 'self.led', partial: 'va' })
    expect(dottedOwner('x = machine.')).toEqual({ owner: 'machine', partial: '' })
    expect(dottedOwner('foo(bar')).toBeNull()
  })

  it('finds the call and argument under the cursor', () => {
    expect(callContext('led = Pin(25, ')).toEqual({ callee: 'Pin', argIndex: 1, keyword: undefined })
    expect(callContext('machine.Pin(')).toEqual({ callee: 'machine.Pin', argIndex: 0, keyword: undefined })
    expect(callContext('i2c = I2C(0, scl=Pin(5), sda=')).toEqual({ callee: 'I2C', argIndex: 2, keyword: 'sda', used: ['scl'] })
    expect(callContext('uart.write("a, (b", ')).toMatchObject({ callee: 'uart.write', argIndex: 1 })
    expect(callContext('print([1, 2], ')).toMatchObject({ callee: 'print', argIndex: 1 })
    expect(callContext('x = foo(1)')).toBeNull()
    expect(callContext('print("unfinished (')).toBeNull()
    expect(callContext('def f(a, ')).toBeNull()
  })

  it('handles a call spread over several lines', () => {
    expect(callContext('pwm = PWM(\n    Pin(15),\n    freq=')).toMatchObject({ callee: 'PWM', argIndex: 1, keyword: 'freq' })
  })
})

describe('signatures', () => {
  it('shows the Pin constructor and highlights by position or keyword', () => {
    const target = resolve('from machine import Pin', 'Pin')
    const sigs = signaturesFor(target)
    expect(sigs[0].label).toMatch(/^Pin\(id, mode/)
    expect(activeSignature(sigs, { callee: 'Pin', argIndex: 1 }).parameter).toBe(1)
    const pull = activeSignature(sigs, { callee: 'Pin', argIndex: 0, keyword: 'pull' })
    expect(sigs[pull.signature].params[pull.parameter]).toMatch(/^pull/)
  })

  it('picks the overload that takes the keywords already written', () => {
    // I2C(id, *, freq, timeout) / I2C(id, *, scl, sda, freq, timeout) / I2C(*, scl, sda, freq)
    const sigs = signaturesFor(resolve('from machine import I2C', 'I2C'))
    const ctx = callContext('i2c = I2C(id=0, sda=sda, ')!
    expect(ctx.used).toEqual(['id', 'sda'])
    const a = activeSignature(sigs, ctx)
    expect(sigs[a.signature].params.map((p) => p.split(':')[0])).toContain('scl')
    expect(sigs[a.signature].params[a.parameter]).toMatch(/^scl/)
  })

  it('picks the overload with enough parameters', () => {
    // PWM.duty_u16() reads, duty_u16(value) writes
    const sigs = signaturesFor(resolve('from machine import PWM\np = PWM(1)', 'p.duty_u16'))
    expect(sigs.length).toBe(2)
    const a = activeSignature(sigs, { callee: 'p.duty_u16', argIndex: 0 })
    expect(sigs[a.signature].params.length).toBeGreaterThan(0)
  })
})

describe('presentation', () => {
  it('lists constants first on a class and methods first on an object', () => {
    const pin = cat.modules.machine.members.Pin
    const out = { name: 'OUT', member: pin.members!.OUT }
    const on = { name: 'on', member: pin.members!.on }
    expect(memberSortText(out, 'class') < memberSortText(on, 'class')).toBe(true)
    expect(memberSortText(on, 'instance') < memberSortText(out, 'instance')).toBe(true)
  })

  it('lists classes first on a module', () => {
    const m = cat.modules.machine.members
    expect(memberSortText({ name: 'Pin', member: m.Pin }, 'module') < memberSortText({ name: 'IDLE', member: m.IDLE }, 'module')).toBe(true)
  })

  it('sorts port-specific members after the everywhere ones', () => {
    const pin = cat.modules.machine.members.Pin
    const alt = { name: 'ALT_PIO0', member: pin.members!.ALT_PIO0 }
    const pullUp = { name: 'PULL_UP', member: pin.members!.PULL_UP }
    expect(memberSortText(pullUp, 'class') < memberSortText(alt, 'class')).toBe(true)
  })

  it('labels details with a signature and a port note', () => {
    expect(memberDetail('sleep_ms', cat.modules.time.members.sleep_ms)).toMatch(/^sleep_ms\(/)
    expect(memberDetail('bootloader', cat.modules.machine.members.bootloader)).toMatch(/^RP2 \(Pico\) only · /)
  })

  it('renders hover markdown with the qualified signature and docs', () => {
    const md = memberMarkdown('machine.Pin', cat.modules.machine.members.Pin)
    expect(md).toContain('machine.Pin(id')
    expect(md).toContain('GPIO')
    expect(md).not.toMatch(/:ref:|[^`]``[^`]/)
  })
})
