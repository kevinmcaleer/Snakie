import { describe, expect, it } from 'vitest'
import { findUsages, functionHints, functionInfo } from '../src/renderer/src/components/python-function-info'

const BOT = `from machine import Pin
motor_a = Pin(2, Pin.OUT)
motor_b = Pin(3, Pin.OUT)

def stop():
    """Describe this function..."""
    motor_a.value(0)
    motor_b.value(0)

def left():
    """Describe this function..."""
    motor_a.value(0)
    motor_b.value(1)

def drive(speed: int = 50, *args, turn=None, **kw) -> None:
    """Drive forward.

    Speed is a percentage.
    """
    motor_a.value(speed)

drive(10)
stop()
handler = stop  # a reference
# stop() in a comment
print("stop()")
stop()
`

const line = (src: string, needle: string): number => src.split('\n').findIndex((l) => l.includes(needle)) + 1

describe('functionInfo', () => {
  it('reads the signature, parameters, return type and docstring', () => {
    const info = functionInfo(BOT, line(BOT, 'def drive'))!
    expect(info.name).toBe('drive')
    expect(info.signature).toBe('def drive(speed: int = 50, *args, turn=None, **kw) -> None')
    expect(info.returns).toBe('None')
    expect(info.params.map((p) => [p.name, p.annotation, p.default, p.kind])).toEqual([
      ['speed', 'int', '50', 'normal'],
      ['args', null, null, 'star'],
      ['turn', null, 'None', 'normal'],
      ['kw', null, null, 'starstar']
    ])
    expect(info.docstring).toBe('Drive forward.\n\nSpeed is a percentage.')
  })

  it('joins a header that spans lines', () => {
    const src = 'def f(a,\n      b=(1, 2),\n      c="x, y"):\n    return a\n'
    const info = functionInfo(src, 1)!
    expect(info.params.map((p) => p.name)).toEqual(['a', 'b', 'c'])
    expect(info.params[1].default).toBe('(1, 2)')
    expect(info.params[2].default).toBe('"x, y"')
    expect(info.bodyStart).toBe(4)
  })

  it('knows a method and drops self', () => {
    const src = 'class Bot:\n    @micropython.native\n    def go(self, n):\n        pass\n'
    const info = functionInfo(src, 3)!
    expect(info.className).toBe('Bot')
    expect(info.decorators).toEqual(['@micropython.native'])
    expect(info.params.map((p) => p.name)).toEqual(['n'])
  })

  it('returns null for a line that is not a def', () => {
    expect(functionInfo(BOT, 2)).toBeNull()
  })
})

describe('findUsages', () => {
  it('finds calls and references, not comments, strings or the def', () => {
    const info = functionInfo(BOT, line(BOT, 'def stop'))!
    const uses = findUsages(BOT, info)
    const lines = BOT.split('\n')
    const handler = line(BOT, 'handler = stop')
    expect(lines[handler - 2]).toBe('stop()')
    expect(uses.map((u) => [u.line, u.call])).toEqual([
      [handler - 1, true],
      [handler, false],
      [lines.lastIndexOf('stop()') + 1, true]
    ])
  })

  it('matches a method only as an attribute, and a function only as a bare name', () => {
    const src = 'class Bot:\n    def reset(self):\n        pass\n\nbot = Bot()\nbot.reset()\nreset()\nmachine.reset()\n'
    const info = functionInfo(src, 2)!
    expect(findUsages(src, info).map((u) => u.line)).toEqual([6, 8])
    const fsrc = 'def reset():\n    pass\nreset()\nmachine.reset()\n'
    expect(findUsages(fsrc, functionInfo(fsrc, 1)!).map((u) => u.line)).toEqual([3])
  })
})

describe('functionHints', () => {
  it('flags the placeholder docstring and twin functions', () => {
    const info = functionInfo(BOT, line(BOT, 'def stop'))!
    const hints = functionHints(BOT, info, findUsages(BOT, info))
    expect(hints.some((h) => h.includes('still the placeholder'))).toBe(true)
    expect(hints.some((h) => h.includes('same shape as `left`'))).toBe(true)
  })

  it('flags an unused function, a missing docstring and a mutable default', () => {
    const src = 'def addItem(x=[]):\n    x.append(1)\n'
    const info = functionInfo(src, 1)!
    const hints = functionHints(src, info, findUsages(src, info))
    expect(hints.some((h) => h.startsWith('Add a docstring'))).toBe(true)
    expect(hints.some((h) => h.includes("isn't used anywhere"))).toBe(true)
    expect(hints.some((h) => h.includes('mutable'))).toBe(true)
    expect(hints.some((h) => h.includes('`add_item`'))).toBe(true)
  })

  it('says nothing about a tidy, used function', () => {
    const src = 'def blink(n):\n    """Blink n times."""\n    print(n)\n\nblink(3)\n'
    const info = functionInfo(src, 1)!
    expect(functionHints(src, info, findUsages(src, info))).toEqual([])
  })
})
