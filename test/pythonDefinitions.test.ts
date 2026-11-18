import { describe, it, expect } from 'vitest'
import { definitionOf, findDefinitions } from '../src/renderer/src/components/python-definitions'

const SRC = [
  'from machine import Pin, PWM', // 1
  'import time as t', // 2
  '', // 3
  'trigger = Pin(1, Pin.OUT)', // 4
  'motor_a = Pin(2, Pin.OUT)', // 5
  'motor_a_speed = PWM(Pin(6))', // 6
  'speed = 10', // 7
  '', // 8
  'def forward(power=50):', // 9
  '    """Drive forward. speed = ignored"""', // 10
  '    motor_a.on()', // 11
  '    level = power * speed', // 12
  '    motor_a_speed.duty_u16(level)', // 13
  '', // 14
  'class Robot:', // 15
  '    def __init__(self, pin):', // 16
  '        self.led = Pin(pin, Pin.OUT)', // 17
  '    def blink(self):', // 18
  '        self.led.toggle()', // 19
  '', // 20
  'speed = 20', // 21
  'for i, name in enumerate([1, 2]):', // 22
  '    print(i, name, sep=",")', // 23
  'forward(speed)', // 24
  "x = foo(a=1)  # a = 3", // 25
  'with open("f") as fh:', // 26
  '    fh.read()' // 27
].join('\n')

const def = (name: string, line: number, attr = false): number | undefined =>
  definitionOf(SRC, name, line, attr)?.line

describe('findDefinitions', () => {
  const defs = findDefinitions(SRC)
  const names = defs.map((d) => `${d.name}:${d.kind}`)

  it('finds assignments, functions, classes, imports and loop variables', () => {
    expect(names).toEqual(
      expect.arrayContaining([
        'Pin:import', 'PWM:import', 't:import', 'trigger:variable', 'motor_a:variable',
        'forward:function', 'power:parameter', 'level:variable', 'Robot:class',
        'pin:parameter', 'led:attribute', 'i:loop', 'name:loop', 'x:variable', 'fh:variable'
      ])
    )
  })

  it('ignores keyword arguments, comments and docstrings', () => {
    expect(names).not.toContain('sep:variable')
    expect(names).not.toContain('a:variable')
    expect(defs.filter((d) => d.name === 'speed').map((d) => d.line)).toEqual([7, 21])
  })

  it('records the column of the name', () => {
    const m = defs.find((d) => d.name === 'motor_a')!
    expect([m.line, m.column]).toEqual([5, 1])
    const p = defs.find((d) => d.name === 'power')!
    expect(p.column).toBe('def forward('.length + 1)
  })
})

describe('definitionOf', () => {
  it('jumps from a use to the assignment', () => {
    expect(def('motor_a', 11)).toBe(5)
    expect(def('motor_a_speed', 13)).toBe(6)
    expect(def('forward', 24)).toBe(9)
    expect(def('t', 30)).toBe(2)
  })

  it('prefers the function’s own parameters and locals', () => {
    expect(def('power', 12)).toBe(9)
    expect(def('level', 13)).toBe(12)
  })

  it('at module level, picks the latest binding above the use', () => {
    expect(def('speed', 24)).toBe(21)
  })

  it('from inside a function, picks where a global is introduced', () => {
    expect(def('speed', 12)).toBe(7)
  })

  it('follows self.attributes within the class', () => {
    expect(def('led', 19, true)).toBe(17)
  })

  it('returns null for names the file never binds', () => {
    expect(def('print', 23)).toBeUndefined()
    expect(def('enumerate', 22)).toBeUndefined()
  })
})
