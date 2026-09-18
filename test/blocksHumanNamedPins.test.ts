import { describe, it, expect, beforeEach } from 'vitest'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import { generateProgram } from '../src/renderer/src/lib/blocks/generator'
import { installBlockDefinitions, resetBlockRegistry } from '../src/renderer/src/lib/blocks/registry'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import { pythonToBlocks } from '../src/renderer/src/lib/blocks/python-to-blocks'
import { PIN_ALIAS_BLOCK } from '../src/renderer/src/lib/blocks/board-pins'

/**
 * HUMAN-NAMED PINS (W10, #1097, epic #1086).
 * =============================================================================
 *
 * ```
 *   set echo to ( Pin(0, Pin.IN) )        ← before
 *   name pin 0 as echo for input           ← the block the palette already had
 * ```
 *
 * `snakie_name_pin` is the one hardware block whose whole Python output is an
 * ASSIGNMENT rather than a call, so it was the one that could never carry a
 * `read` rule — and the only difference between a program that opened as
 * hardware blocks and one that opened grey was **the variable name**:
 * `pin_15 = Pin(15, Pin.OUT)` read perfectly, `led = Pin(15, Pin.OUT)` did not.
 *
 * It is also the keystone for the rest of the hardware round trip, and the
 * reason is worth stating because it is why relaxing the name test alone is not
 * the fix: with an arbitrary name, a `snakie_pin_write` holding `PIN=15`
 * regenerates as `pin_15 = Pin(15, Pin.OUT)` and silently renames the learner's
 * `led`. This block resolves it because it is the block that HOLDS the name.
 *
 * The coverage ratchet cannot see any of this — `variables_set` with a grey
 * value reports `recognised: 1, raw: 0` — which is exactly why #1087 measures
 * sockets separately, and why this file asserts block types rather than numbers.
 */

beforeEach(() => {
  resetBlockRegistry()
  installCorePalette()
  installBlockDefinitions()
})

function regenerate(source: string): string {
  const { workspace } = pythonToBlocks(source)
  const ws = new Blockly.Workspace()
  Blockly.serialization.workspaces.load(workspace as never, ws)
  return generateProgram(ws).code
}

function roundTrips(source: string): void {
  expect(regenerate(source)).toBe(source)
}

/** Every block the conversion produced, in document order. */
function blocks(source: string): Record<string, unknown>[] {
  const { workspace } = pythonToBlocks(source)
  const out: Record<string, unknown>[] = []
  const walk = (block: Record<string, unknown> | undefined): void => {
    if (!block) return
    out.push(block)
    for (const input of Object.values((block.inputs ?? {}) as Record<string, unknown>)) {
      walk((input as { block?: Record<string, unknown> }).block)
    }
    walk((block.next as { block?: Record<string, unknown> } | undefined)?.block)
  }
  const roots = (workspace as { blocks?: { blocks?: Record<string, unknown>[] } }).blocks?.blocks
  for (const block of roots ?? []) walk(block)
  return out
}

/** The one block of `type` the conversion produced, or undefined. */
function one(source: string, type: string): Record<string, unknown> | undefined {
  return blocks(source).find((b) => b.type === type)
}

const IMPORT = 'from machine import Pin\n\n'

describe('a name for a pin', () => {
  it('reads all four directions', () => {
    const cases: [string, string, string][] = [
      ['led = Pin(15, Pin.OUT)', '15', 'OUT'],
      ['echo = Pin(0, Pin.IN)', '0', 'IN'],
      ['button = Pin(14, Pin.IN, Pin.PULL_UP)', '14', 'PULL_UP'],
      ['sense = Pin(9, Pin.IN, Pin.PULL_DOWN)', '9', 'PULL_DOWN']
    ]
    for (const [line, pin, direction] of cases) {
      const src = `${IMPORT}${line}\n`
      const block = one(src, PIN_ALIAS_BLOCK)
      expect(block, line).toBeDefined()
      expect(block!.fields).toEqual({
        PIN: pin,
        NAME: line.slice(0, line.indexOf(' ')),
        DIRECTION: direction
      })
      roundTrips(src)
    }
  })

  it('keeps the learner’s own name, rather than rewriting it to pin_15', () => {
    // The whole point. `snakie_pin_write` holding `PIN=15` would have hoisted
    // `pin_15 = Pin(15, Pin.OUT)` beside the learner's `led` and driven that.
    const src = `${IMPORT}led = Pin(15, Pin.OUT)\n\nled.value(1)\n`
    expect(regenerate(src)).not.toContain('pin_15')
    roundTrips(src)
  })

  it('binds a later call on the name to the hardware block', () => {
    const src = `${IMPORT}led = Pin(15, Pin.OUT)\n\nled.value(1)\nled.toggle()\n`
    const built = blocks(src).map((b) => b.type)
    expect(built).toContain('snakie_pin_write')
    expect(built).toContain('snakie_led_toggle')
    expect(one(src, 'snakie_pin_write')!.fields).toMatchObject({ PIN: 'led' })
    roundTrips(src)
  })

  it('reads a pull resistor off the declaration, where it lives', () => {
    const src = `${IMPORT}button = Pin(14, Pin.IN, Pin.PULL_UP)\n\nprint(button.value())\n`
    expect(one(src, 'snakie_pin_read')!.fields).toMatchObject({ PIN: 'button', PULL: 'PULL_UP' })
    roundTrips(src)
  })

  it('leaves no grey value behind', () => {
    // The measurement this workstream is really about: `report.raw` was already
    // zero, and the line still rendered as *set echo to (grey blob)*.
    const { report } = pythonToBlocks(`${IMPORT}echo = Pin(0, Pin.IN)\n`)
    expect(report.raw).toBe(0)
    expect(report.rawSockets).toBe(0)
  })
})

describe('what must NOT change', () => {
  it('the generator’s own names still read as they did (#1058)', () => {
    // `pin_15` is a hoisted object whose constructor is CONSUMED and whose pin
    // comes out of its name. Reading it as a name as well gave the file two
    // objects on one pin — the learner's `pin_15` and the blocks' own copy,
    // renamed `pin_15_` to dodge the collision.
    const src = `${IMPORT}pin_15 = Pin(15, Pin.OUT)\n\npin_15.value(1)\npin_15.toggle()\n`
    const built = blocks(src).map((b) => b.type)
    expect(built).toContain('snakie_pin_write')
    expect(built).not.toContain(PIN_ALIAS_BLOCK)
    expect(regenerate(src)).not.toContain('pin_15_')
    roundTrips(src)
  })

  it('a constructor that is not what the block writes stays an ordinary line', () => {
    // The exact-match safety rule, unchanged: somebody wrote their own, and
    // reading it back as a block would rewrite it.
    const src = `${IMPORT}led = Pin(15, Pin.OUT, value=0)\n`
    expect(one(src, PIN_ALIAS_BLOCK)).toBeUndefined()
    roundTrips(src)
  })

  it('keeps the name even when a use has no block of its own', () => {
    // THE COMMONEST PROGRAM THERE IS, and it used to be the one case this
    // workstream missed. `on()` and `off()` are ordinary MicroPython with no
    // hardware block behind them, so they read as generic call blocks — and the
    // name used to be dropped entirely whenever that happened, because a
    // workspace variable called `led` would have been renamed `led_` beside the
    // `led = Pin(...)` the naming block writes into the setup section. The
    // declaration then fell back to *set led to (grey blob)*.
    //
    // The generator binds a declared pin and a variable of that name to ONE
    // identifier now, because that is what they are, so there is nothing left
    // to defend against.
    const src = `${IMPORT}led = Pin(25, Pin.OUT)\n\nled.on()\nled.off()\n`
    expect(one(src, PIN_ALIAS_BLOCK)).toBeDefined()
    expect(regenerate(src)).not.toContain('led_')
    roundTrips(src)
  })

  it('holds for the blink program, end to end', () => {
    const src = [
      'from machine import Pin',
      'import time',
      '',
      'led = Pin(25, Pin.OUT)',
      '',
      'while True:',
      '    led.on()',
      '    time.sleep(0.5)',
      '    led.off()',
      '    time.sleep(0.5)',
      ''
    ].join('\n')
    const { report } = pythonToBlocks(src)
    expect(report.raw).toBe(0)
    expect(report.rawSockets).toBe(0)
    expect(one(src, PIN_ALIAS_BLOCK)).toBeDefined()
  })

  it('a pin named after a module still loses to the module', () => {
    // The one precedence that does not change: a pin somebody called `time`
    // must not take the name out from under `import time`, or every
    // `time.sleep()` in the program breaks.
    const src = ['from machine import Pin', 'import time', '', 'time = Pin(15, Pin.OUT)', ''].join(
      '\n'
    )
    expect(regenerate(src)).not.toMatch(/^time = Pin/m)
  })

  it('names a pin that is only mentioned, never called', () => {
    // `time_pulse_us(echo, 1, 30000)` is an unreadable EXPRESSION, not an
    // unreadable statement — the line is still a real `set width to` block — so
    // the name survives and the declaration is still the naming block.
    const src = [
      'from machine import Pin, time_pulse_us',
      '',
      'echo = Pin(2, Pin.IN)',
      '',
      'width = time_pulse_us(echo, 1, 30000)',
      ''
    ].join('\n')
    expect(one(src, PIN_ALIAS_BLOCK)).toBeDefined()
    roundTrips(src)
  })

  it('does not name the same pin twice when it is named and used', () => {
    const src = `${IMPORT}led = Pin(15, Pin.OUT)\n\nled.value(1)\n`
    expect(regenerate(src).match(/Pin\(15/g)).toHaveLength(1)
    expect(blocks(src).filter((b) => b.type === PIN_ALIAS_BLOCK)).toHaveLength(1)
  })
})
