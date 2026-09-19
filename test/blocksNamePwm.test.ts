import { describe, it, expect, beforeEach } from 'vitest'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import { generateProgram } from '../src/renderer/src/lib/blocks/generator'
import { installBlockDefinitions, resetBlockRegistry } from '../src/renderer/src/lib/blocks/registry'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import { pythonToBlocks } from '../src/renderer/src/lib/blocks/python-to-blocks'
import { PWM_ALIAS_BLOCK, pwmAliasesIn } from '../src/renderer/src/lib/blocks/board-pins'

/**
 * NAMING A PWM, AND SETTING A MOTOR'S SPEED WITH IT.
 * =============================================================================
 *
 * A pin could be named since #1097; the PWM built on it could not. So every
 * block that wanted one got `pwm_15` — a name the learner never chose, on an
 * object they had no way to refer to — and a rover's two drive channels were
 * told apart by pin number.
 *
 * ```
 *   name PWM on pin [GP15 ▾] as [motor_a]     → motor_a = PWM(Pin(15))
 *   set speed of ( motor_a ) to [75] %        → motor_a.duty_u16(int(75 * 65535 / 100))
 *   set frequency of ( motor_a ) to [1000] Hz → motor_a.freq(1000)
 * ```
 *
 * AND THE LABEL IS HALF THE POINT. The block that already did this said *set
 * BRIGHTNESS of …*, with a tooltip admitting it also drives a motor. A child
 * building a rover should not have to work out that a motor is a dim LED.
 *
 * IT REUSES `AliasRule` UNCHANGED, which is the interesting part: that machinery
 * was written for pins, and a PWM fits it because its constructor carries a
 * single `{PIN}` — one mode, because a PWM has no direction to choose. What had
 * to change is the GENERATOR's side, where a name the learner declared must not
 * be renamed out from under its own declaration (`boundName`), and the READER's,
 * where a block that hoists its line rather than emitting it in place must not
 * also keep the blank line the generator writes after the setup section.
 */

beforeEach(() => {
  resetBlockRegistry()
  installCorePalette()
  installBlockDefinitions()
})

const IMPORT = 'from machine import PWM, Pin\n\n'

function regenerate(source: string): string {
  const { workspace } = pythonToBlocks(source)
  const ws = new Blockly.Workspace()
  Blockly.serialization.workspaces.load(workspace as never, ws)
  return generateProgram(ws).code
}

function roundTrips(source: string): void {
  expect(regenerate(source)).toBe(source)
}

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

const types = (source: string): string[] => blocks(source).map((b) => b.type as string)
const one = (source: string, type: string): Record<string, unknown> | undefined =>
  blocks(source).find((b) => b.type === type)

/** A named PWM with `body` under it, as a workspace the generator can run. */
function program(body: Record<string, unknown>[]): string {
  const chain = body.reduceRight<Record<string, unknown> | undefined>(
    (next, block) => ({ ...block, ...(next ? { next: { block: next } } : {}) }),
    undefined
  )
  const ws = new Blockly.Workspace()
  Blockly.serialization.workspaces.load(
    {
      blocks: {
        languageVersion: 0,
        blocks: [
          {
            type: PWM_ALIAS_BLOCK,
            id: 'n',
            fields: { PIN: '15', NAME: 'motor_a' },
            ...(chain ? { next: { block: chain } } : {})
          }
        ]
      },
      variables: [{ name: 'motor_a', id: 'm' }]
    } as never,
    ws
  )
  return generateProgram(ws).code
}

/** A `variables_get` for the named PWM, which is what goes in the socket. */
const NAMED = { type: 'variables_get', id: 'v', fields: { VAR: { id: 'm' } } }
const number = (n: number, id: string): Record<string, unknown> => ({
  type: 'math_number',
  id,
  fields: { NUM: n }
})

describe('the blocks a learner drags', () => {
  it('declares the PWM once, in the setup section', () => {
    // It emits NOTHING where it stands — so parking the naming block at the
    // bottom of the canvas cannot produce a `NameError`.
    expect(program([])).toBe('from machine import PWM, Pin\n\nmotor_a = PWM(Pin(15))\n')
  })

  it('writes the speed line a person would have written', () => {
    const code = program([
      {
        type: 'snakie_pwm_duty_named',
        id: 'd',
        inputs: { PWM: { block: NAMED }, PERCENT: { block: number(75, 'p') } }
      }
    ])
    expect(code).toContain('motor_a.duty_u16(int(75 * 65535 / 100))')
  })

  it('writes the frequency line', () => {
    const code = program([
      {
        type: 'snakie_pwm_freq_named',
        id: 'f',
        inputs: { PWM: { block: NAMED }, HZ: { block: number(1000, 'h') } }
      }
    ])
    expect(code).toContain('motor_a.freq(1000)')
  })

  it('never renames the name out from under its own declaration', () => {
    // The collision `boundName` exists for: the declaration goes into the setup
    // section under the learner's name, and a workspace variable of that name
    // renamed `motor_a_` would leave the two halves pointing at different
    // objects — the PWM declared on one and every block using it on the other.
    const code = program([
      {
        type: 'snakie_pwm_duty_named',
        id: 'd',
        inputs: { PWM: { block: NAMED }, PERCENT: { block: number(50, 'p') } }
      }
    ])
    expect(code).not.toContain('motor_a_')
  })

  it('reports the names it declares, for the generator to protect', () => {
    const ws = new Blockly.Workspace()
    const block = ws.newBlock(PWM_ALIAS_BLOCK)
    block.setFieldValue('motor_b', 'NAME')
    expect(pwmAliasesIn(ws as never)).toEqual(['motor_b'])
  })

  it('declares nothing while the name is being retyped', () => {
    // A learner clearing the field should get a program that still runs, not
    // ` = PWM(Pin(15))` on a line with nothing on its left.
    const ws = new Blockly.Workspace()
    const block = ws.newBlock(PWM_ALIAS_BLOCK)
    block.setFieldValue('', 'NAME')
    expect(generateProgram(ws).code).not.toContain('PWM(')
  })
})

describe('what opens as these blocks', () => {
  it('reads the declaration', () => {
    const src = `${IMPORT}motor_a = PWM(Pin(15))\n`
    expect(one(src, PWM_ALIAS_BLOCK)!.fields).toEqual({ PIN: '15', NAME: 'motor_a' })
    roundTrips(src)
  })

  it('reads a frequency call on the name', () => {
    const src = `${IMPORT}motor_a = PWM(Pin(15))\n\nmotor_a.freq(1000)\n`
    expect(types(src)).toContain('snakie_pwm_freq_named')
    roundTrips(src)
  })

  it('keeps two drive channels apart, which is the whole point', () => {
    const src = [
      'from machine import PWM, Pin',
      '',
      'motor_a = PWM(Pin(15))',
      'motor_b = PWM(Pin(16))',
      '',
      'motor_a.freq(1000)',
      'motor_b.freq(1000)',
      ''
    ].join('\n')
    expect(blocks(src).filter((b) => b.type === PWM_ALIAS_BLOCK)).toHaveLength(2)
    roundTrips(src)
  })

  it('gains no blank line each time the file is opened', () => {
    // A block that HOISTS its line rather than emitting it in place must not
    // also keep the learner's blank: the generator writes one after the setup
    // section, and two came back as an extra empty line per open.
    const src = `${IMPORT}motor_a = PWM(Pin(15))\n\nmotor_a.freq(1000)\n`
    expect(regenerate(regenerate(src))).toBe(src)
  })
})

describe('what stays an ordinary line, and why', () => {
  it('a constructor that is not what the block writes', () => {
    // The exact-match safety rule, as everywhere else: somebody wrote their own,
    // and reading it back as this block would rewrite it.
    const src = `${IMPORT}motor_a = PWM(Pin(15), freq=1000)\n`
    expect(types(src)).not.toContain(PWM_ALIAS_BLOCK)
    roundTrips(src)
  })

  it('a PWM built on a pin that was itself named', () => {
    // `PWM(motor_pin)` carries no number, and the alias template has exactly one
    // `{PIN}` to fill. Reading it as this block would put a pin number in a
    // field that never held one — so it stays as written.
    // The blank line is the generator's own: `name pin` hoists its declaration
    // into the setup section, which is written with a gap after it.
    const src = [
      'from machine import PWM, Pin',
      '',
      'motor_pin = Pin(15, Pin.OUT)',
      '',
      'motor_a = PWM(motor_pin)',
      ''
    ].join('\n')
    expect(types(src)).not.toContain(PWM_ALIAS_BLOCK)
    roundTrips(src)
  })

  it('the speed line, because its arithmetic is the lesson', () => {
    // `int(x * 65535 / 100)` cannot be unpicked into a socket by a table — the
    // same reason `snakie_pwm_duty` has never had a reader rule either.
    const src = `${IMPORT}motor_a = PWM(Pin(15))\n\nmotor_a.duty_u16(int(50 * 65535 / 100))\n`
    expect(types(src)).not.toContain('snakie_pwm_duty_named')
    roundTrips(src)
  })
})
