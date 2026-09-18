import { describe, it, expect, beforeEach } from 'vitest'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import { generateProgram } from '../src/renderer/src/lib/blocks/generator'
import { installBlockDefinitions, resetBlockRegistry } from '../src/renderer/src/lib/blocks/registry'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import { pythonToBlocks } from '../src/renderer/src/lib/blocks/python-to-blocks'

/**
 * OBJECTS (W1, #1088, epic #1086).
 * =============================================================================
 *
 * The single largest gap in the corpus, and it needed no new blocks:
 * `snakie_python_call`, `snakie_python_call_value`, `snakie_python_attr_get` and
 * `snakie_python_attr_set` have all shipped since #1018, sitting in the Python
 * drawer for a person to drag. The reader simply never emitted one.
 *
 * **THE ORDERING TRAP IS WHY THIS FILE EXISTS.** A rule, a hoisted object
 * (#1058) and a function the program defines must all still win over the generic
 * reading — and if one of them stops winning, NEITHER half of #1086's ratchet
 * notices:
 *
 *  - coverage does not move, because a generic call block is "recognised" too;
 *  - round-trip does not move, because both blocks generate the same line.
 *
 * `led_15.set(True)` would quietly go from a real LED block, with the pin in a
 * field and a picture on it, to a grey call block — and nothing would say so.
 * So it is asserted here, block type by block type.
 */

beforeEach(() => {
  resetBlockRegistry()
  installCorePalette()
  installBlockDefinitions()
})

/** Convert, load, generate. */
function regenerate(source: string): string {
  const { workspace } = pythonToBlocks(source)
  const ws = new Blockly.Workspace()
  Blockly.serialization.workspaces.load(workspace as never, ws)
  return generateProgram(ws).code
}

/** THE property: what comes out is what went in. */
function roundTrips(source: string): void {
  expect(regenerate(source)).toBe(source)
}

/** The block types the conversion produced, in document order. */
function types(source: string): string[] {
  const { workspace } = pythonToBlocks(source)
  const out: string[] = []
  const walk = (block: Record<string, unknown> | undefined): void => {
    if (!block) return
    out.push(block.type as string)
    for (const input of Object.values((block.inputs ?? {}) as Record<string, unknown>)) {
      walk((input as { block?: Record<string, unknown> }).block)
    }
    walk((block.next as { block?: Record<string, unknown> } | undefined)?.block)
  }
  const blocks = (workspace as { blocks?: { blocks?: Record<string, unknown>[] } }).blocks?.blocks
  for (const block of blocks ?? []) walk(block)
  return out
}

describe('a method call on an object', () => {
  it('reads as the call block, not as grey Python', () => {
    expect(types('display.show()\n')).toEqual([
      'snakie_python_call',
      'variables_get'
    ])
    roundTrips('display.show()\n')
  })

  it('carries its arguments in sockets', () => {
    // Single quotes: a `text` block holds text, not the quotes round it, and the
    // generator writes its own — the house style the gate forgives.
    expect(types("display.text('hi', 0, 0)\n")).toEqual([
      'snakie_python_call',
      'variables_get',
      'text',
      'math_number',
      'math_number'
    ])
    roundTrips("display.text('hi', 0, 0)\n")
  })

  it('reads a call on an attribute of an object — the `self.x.y()` shape', () => {
    // 1,478 raw lines across 40 projects on its own, and the reason `readCall`
    // was not enough: it gives up at the second dot.
    const src = 'self.display.fill(0)\n'
    expect(types(src)).toEqual([
      'snakie_python_call',
      'snakie_python_attr_get',
      // `self` is its own block rather than a workspace variable (W6, #1093).
      'snakie_self',
      'math_number'
    ])
    roundTrips(src)
  })

  it('reads a call used as a value', () => {
    const src = 'raw = sensor.read_u16()\n'
    expect(types(src)).toEqual(['variables_set', 'snakie_python_call_value', 'variables_get'])
    roundTrips(src)
  })

  it('sockets an argument it cannot read rather than losing the line', () => {
    // §4.2 of the delivery plan: recognise the statement, socket the rest. This
    // is the whole reason f-strings cost five raw lines in 44 projects.
    const src = 'self.display.text(f"{temp:.1f}", 0, 0)\n'
    expect(types(src)).toContain('snakie_python_value')
    expect(types(src)[0]).toBe('snakie_python_call')
    roundTrips(src)
  })

  it('keeps a call with a trailing comma raw, rather than dropping the comma', () => {
    // The block has one socket per argument and nowhere to record the comma,
    // so reading it would rewrite the line.
    expect(types('thing.configure(1, 2,)\n')).toEqual(['snakie_python_statement'])
  })

  it('keeps a call with more arguments than the block can hold raw', () => {
    const src = 'thing.configure(1, 2, 3, 4, 5, 6, 7, 8, 9)\n'
    expect(types(src)).toEqual(['snakie_python_statement'])
    roundTrips(src)
  })
})

describe('reading something off an object', () => {
  it('reads an attribute in an expression', () => {
    const src = 'angle = self.hip\n'
    expect(types(src)).toEqual(['variables_set', 'snakie_python_attr_get', 'snakie_self'])
    roundTrips(src)
  })

  it('reads a chain of them', () => {
    const src = 'value = self.sensor.last.reading\n'
    expect(types(src)).toEqual([
      'variables_set',
      'snakie_python_attr_get',
      'snakie_python_attr_get',
      'snakie_python_attr_get',
      'snakie_self'
    ])
    roundTrips(src)
  })

  it('reads one inside a condition, which used to take the whole `if`', () => {
    const src = ['if self.running:', '    print(1)', ''].join('\n')
    expect(types(src)).toEqual([
      'controls_if',
      'snakie_python_attr_get',
      'snakie_self',
      'text_print',
      'math_number'
    ])
    roundTrips(src)
  })
})

describe('assigning to something on an object', () => {
  it('reads `self.x = y` as the attribute-set block', () => {
    // 2,649 raw lines across 45 projects — the second-largest gap in the corpus.
    const src = 'self.speed = speed\n'
    expect(types(src)).toEqual([
      'snakie_python_attr_set',
      'snakie_self',
      'variables_get'
    ])
    roundTrips(src)
  })

  it('reads `obj.attr = value`', () => {
    roundTrips('motor.speed = 3\n')
    expect(types('motor.speed = 3\n')).toEqual([
      'snakie_python_attr_set',
      'variables_get',
      'math_number'
    ])
  })

  it('reads a nested target', () => {
    const src = 'self.motor.speed = 0\n'
    expect(types(src)).toEqual([
      'snakie_python_attr_set',
      'snakie_python_attr_get',
      'snakie_self',
      'math_number'
    ])
    roundTrips(src)
  })

  it('is not fooled by a comparison', () => {
    // `==` lexes as one operator, so it is never the `=` that assigns.
    roundTrips(['if self.speed == 0:', '    print(1)', ''].join('\n'))
  })

  it('leaves an augmented assign on an attribute alone', () => {
    // `math_change` needs a workspace variable, and writing `self.total += 1` as
    // `self.total = self.total + 1` would be rewriting somebody's line.
    expect(types('self.total += 1\n')).toEqual(['snakie_python_statement'])
    roundTrips('self.total += 1\n')
  })

  it('leaves a subscript it cannot count back alone — that is W8', () => {
    // W2 (#1089) reads the two forms the Lists blocks can write back exactly:
    // `xs[0]` counts up to "item 1", and `xs[i - 1]` is the `- 1` the generator
    // put there. A bare `xs[i]` is neither — the block would have to hold
    // `i + 1` and would regenerate as `xs[i + 1 - 1]`.
    expect(types('self.rows[0] = 1\n')).toEqual([
      'snakie_list_set',
      'snakie_python_attr_get',
      'snakie_self',
      'math_number',
      'math_number'
    ])
    roundTrips('self.rows[0] = 1\n')
    expect(types('self.rows[index] = 1\n')).toEqual(['snakie_python_statement'])
    roundTrips('self.rows[index] = 1\n')
  })
})

describe('the ordering trap — what must still win', () => {
  it('a hoisted object still reads as its own hardware block (#1058)', () => {
    const src = [
      'from snakie import Led, Pin',
      '',
      'led_15 = Led(pin=Pin(15, Pin.OUT))',
      'led_15.set(True)',
      ''
    ].join('\n')
    expect(types(src)).toContain('snakie_led_set')
    expect(types(src)).not.toContain('snakie_python_call')
  })

  it('a hoisted object with ONE unreadable use stays whole', () => {
    // All-or-nothing (#1058). If the generic call block claimed
    // `led_15.frobnicate()`, the constructor would look fully accounted for, get
    // swallowed, and `led_15.set(True)` beside it would hoist a SECOND `Led` on
    // the same pin under a collision-avoiding name.
    const src = [
      'from snakie import Led, Pin',
      '',
      'led_15 = Led(pin=Pin(15, Pin.OUT))',
      'led_15.set(True)',
      'led_15.frobnicate()',
      ''
    ].join('\n')
    expect(types(src)).not.toContain('snakie_led_set')
    expect(regenerate(src)).not.toContain('led_15_')
    roundTrips(src)
  })

  it('a registered rule still wins — turtle', () => {
    const src = ['import turtle', '', 'turtle.forward(100)', ''].join('\n')
    expect(types(src)).toContain('snakie_turtle_forward')
    expect(types(src)).not.toContain('snakie_python_call')
  })

  it('a built-in rule still wins — the wait blocks', () => {
    const src = ['import time', '', 'time.sleep_ms(200)', ''].join('\n')
    expect(types(src)).toContain('snakie_wait_ms')
  })

  it('a call to the program’s own function still reads as its caller block', () => {
    const src = ['def wiggle(n):', '    print(n)', '', 'wiggle(3)', ''].join('\n')
    expect(types(src)).toContain('procedures_callnoreturn')
  })

  it('a call into a MODULE stays raw, because a module is not an object', () => {
    // `machine` is bound by the import line, so the generator's import manager
    // owns the name. A `variables_get` for it comes back RENAMED — the program
    // regenerated as `machine_.lightsleep(10)` and stopped running, and the
    // round-trip gate cannot see it because names are placeholders in a line
    // signature. This is exactly what it did before W1.
    const src = ['import machine', '', 'machine.lightsleep(10)', ''].join('\n')
    expect(types(src)).toContain('snakie_python_statement')
    expect(types(src)).not.toContain('snakie_python_call')
    roundTrips(src)
  })

  it('a name imported FROM a module is not an object either', () => {
    const src = ['from machine import Pin', '', 'Pin.toggle(1)', ''].join('\n')
    expect(types(src)).not.toContain('snakie_python_call')
    roundTrips(src)
  })

  it('a name the generator would rename stays raw', () => {
    // `bytes` is a builtin `names.ts` protects, so reading it as a variable
    // would write `bytes_.decode(data)` — a program that no longer runs, and one
    // the round-trip gate forgives.
    expect(types('bytes.decode(data)\n')).toEqual(['snakie_python_statement'])
    roundTrips('bytes.decode(data)\n')
  })
})

describe('a real class, end to end', () => {
  it('opens a motor driver as blocks rather than a grey wall', () => {
    const src = [
      'class Motor:',
      '    def __init__(self, forward):',
      '        self.forward = forward',
      '        self.speed = 0',
      '',
      '    def drive(self, speed):',
      '        self.speed = speed',
      '        self.forward.duty_u16(speed)',
      ''
    ].join('\n')
    const built = types(src)
    // The class and its methods are blocks of their own since W6 (#1093), and
    // every line inside them is a real block, which was the point of W1.
    expect(built).toContain('snakie_python_attr_set')
    expect(built).toContain('snakie_python_call')
    expect(built).toContain('snakie_class')
    expect(built).toContain('snakie_method')
    roundTrips(src)
  })
})
