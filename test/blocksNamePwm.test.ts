import { describe, it, expect, beforeEach } from 'vitest'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import { generateProgram } from '../src/renderer/src/lib/blocks/generator'
import { installBlockDefinitions, resetBlockRegistry } from '../src/renderer/src/lib/blocks/registry'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import { pythonToBlocks } from '../src/renderer/src/lib/blocks/python-to-blocks'
import {
  PIN_ALIAS_BLOCK,
  PWM_ALIAS_BLOCK,
  pwmAliasesIn
} from '../src/renderer/src/lib/blocks/board-pins'

/**
 * NAMING A PWM, AND SETTING IT DIRECTLY.
 * =============================================================================
 *
 * A pin could be named since #1097; the PWM built on it could not. So every
 * block that wanted one got `pwm_15` — a name the learner never chose, on an
 * object they had no way to refer to — and a rover's two drive channels were
 * told apart by pin number.
 *
 * ```
 *   name PWM on pin [GP15 ▾] as [motor_a]     → motor_a = PWM(Pin(15))
 *   set power of ( motor_a ) to [75] %        → motor_a.duty_u16(int(75 * 65535 / 100))
 *   set frequency of ( motor_a ) to [1000] Hz → motor_a.freq(1000)
 *   power of ( motor_a ) as [0-65535 ▾]       → motor_a.duty_u16()
 *   turn PWM ( motor_a ) off                  → motor_a.deinit()
 * ```
 *
 * AND THE LABEL IS HALF THE POINT — *set power*, NOT *set speed*. A motor block
 * would have to promise something about the driver, and there is nothing to
 * promise: one driver takes a PWM on its speed pin, another takes plain digital
 * on/off, and a Modulino takes neither. These blocks say what they do to the
 * PIN, which is true of every board; what that does to a motor belongs to the
 * driver's datasheet. *Power* is the word that survives that: it is true of an
 * LED, of a motor and of a heater, where *speed* and *brightness* are each true
 * of one of them — and a PAIR of blocks, one per word, is the thing this palette
 * cannot have, because both would write the same line and the reader would have
 * nothing to tell them apart by.
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

  it('builds the PWM on a pin the program has already named', () => {
    // THE BUG THIS BLOCK HAD. Every pin dropdown lists the names the program
    // declares ABOVE the numbers, so a learner who has named GP15 `motor_left`
    // reaches for the name here — and the field was read with `Number`, so the
    // name came out `NaN` and the block generated NOTHING: no declaration, no
    // `PWM` import, nothing said. It builds on the pin OBJECT now, which is
    // what `pinObject` does for every other block that takes a pin.
    const ws = new Blockly.Workspace()
    const pin = ws.newBlock(PIN_ALIAS_BLOCK)
    pin.setFieldValue('15', 'PIN')
    pin.setFieldValue('motor_left', 'NAME')
    const pwm = ws.newBlock(PWM_ALIAS_BLOCK)
    pwm.setFieldValue('motor_left', 'PIN')
    pwm.setFieldValue('motor_a', 'NAME')
    expect(generateProgram(ws).code).toBe(
      'from machine import PWM, Pin\n\nmotor_left = Pin(15, Pin.OUT)\nmotor_a = PWM(motor_left)\n'
    )

    // AND THE IMPORT GOES WITH THE BLOCK. The import section is a consequence
    // of what the blocks need, so the last PWM block leaving takes `PWM` with
    // it — the other half of the same bug, and the half a learner notices when
    // their program keeps an import for hardware it no longer has.
    pwm.dispose(false)
    expect(generateProgram(ws).code).toBe(
      'from machine import Pin\n\nmotor_left = Pin(15, Pin.OUT)\n'
    )
  })

  it('needs no `Pin` import when the pin it builds on is named', () => {
    // `from machine import Pin` with no `Pin(` anywhere under it is the same
    // untidiness the other way round: on a named pin the `name pin` block is
    // what writes the constructor, and it is what declares the import.
    const ws = new Blockly.Workspace()
    const pwm = ws.newBlock(PWM_ALIAS_BLOCK)
    // A name nothing declares still writes through unchanged — a `name pin`
    // block deleted out from under this one. `NameError` is the honest answer;
    // inventing a pin number would drive the wrong hardware silently.
    pwm.setFieldValue('motor_left', 'PIN')
    pwm.setFieldValue('motor_a', 'NAME')
    expect(generateProgram(ws).code).toBe('from machine import PWM\n\nmotor_a = PWM(motor_left)\n')
  })

  it('writes the duty line a person would have written', () => {
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

  it('writes the off line, which is not the same as a duty of zero', () => {
    const code = program([{ type: 'snakie_pwm_off_named', id: 'o', inputs: { PWM: { block: NAMED } } }])
    expect(code).toContain('motor_a.deinit()')
  })

  it('reads the duty back, raw and as a percentage', () => {
    const raw = program([
      {
        type: 'variables_set',
        id: 's',
        fields: { VAR: { id: 'd' } },
        inputs: {
          VALUE: {
            block: {
              type: 'snakie_pwm_read_named',
              id: 'r',
              fields: { UNIT: 'RAW' },
              inputs: { PWM: { block: NAMED } }
            }
          }
        }
      }
    ])
    expect(raw).toContain('motor_a.duty_u16()')
    expect(raw).not.toContain('65535')

    const percent = program([
      {
        type: 'variables_set',
        id: 's',
        fields: { VAR: { id: 'd' } },
        inputs: {
          VALUE: {
            block: {
              type: 'snakie_pwm_read_named',
              id: 'r',
              fields: { UNIT: 'PERCENT' },
              inputs: { PWM: { block: NAMED } }
            }
          }
        }
      }
    ])
    expect(percent).toContain('motor_a.duty_u16() * 100 / 65535')
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
    //
    // `freq=` USED TO BE THE EXAMPLE HERE and is now the block's own (#1170) —
    // see the suite below. These are the shapes still past it: a second keyword
    // the block has nowhere to put, and a positional argument, which is not
    // what `freq=` means even though it lands in the same parameter.
    for (const ctor of ['PWM(Pin(15), freq=1000, duty_u16=0)', 'PWM(Pin(15), 1000)']) {
      const src = `${IMPORT}motor_a = ${ctor}\n`
      expect([ctor, types(src).includes(PWM_ALIAS_BLOCK)]).toEqual([ctor, false])
      roundTrips(src)
    }
  })

  it('a PWM built on a pin that was itself named IS this block', () => {
    // `PWM(motor_pin)` is what this block writes when its pin field holds a
    // name, so it comes back as the block that wrote it — with the name in the
    // field, which is what pin fields have held since #1097.
    const src = [
      'from machine import PWM, Pin',
      '',
      'motor_pin = Pin(15, Pin.OUT)',
      'motor_a = PWM(motor_pin)',
      ''
    ].join('\n')
    expect(types(src)).toContain(PWM_ALIAS_BLOCK)
    expect(one(src, PWM_ALIAS_BLOCK)!.fields).toEqual({ PIN: 'motor_pin', NAME: 'motor_a' })
    roundTrips(src)
  })

  it('reads the off line back as its block', () => {
    const src = `${IMPORT}motor_a = PWM(Pin(15))\n\nmotor_a.deinit()\n`
    expect(types(src)).toContain('snakie_pwm_off_named')
    roundTrips(src)
  })

  it('reads a bare duty getter back as the socket block, not the fielded one', () => {
    // The fielded twin regenerates through `pwm()`, which would build
    // `pwm_motor_a = PWM(motor_a)` — so only one of the pair may claim this line,
    // and it is the one that writes it back unchanged.
    const src = `${IMPORT}motor_a = PWM(Pin(15))\n\nlevel = motor_a.duty_u16()\n`
    expect(types(src)).toContain('snakie_pwm_read_named')
    expect(types(src)).not.toContain('snakie_pwm_read')
    expect(one(src, 'snakie_pwm_read_named')!.fields).toEqual({ UNIT: 'RAW' })
    roundTrips(src)
  })

  it('a duty line whose arithmetic is not the block\u2019s own', () => {
    // `percentOf` undoes exactly the shape the generator writes and nothing
    // else. A raw 0-65535 duty is somebody\u2019s own line, and stays one.
    const src = `${IMPORT}motor_a = PWM(Pin(15))\n\nmotor_a.duty_u16(32768)\n`
    expect(types(src)).not.toContain('snakie_pwm_duty_named')
    roundTrips(src)
  })

  it('a duty line scaled against a number this block never writes', () => {
    const src = `${IMPORT}motor_a = PWM(Pin(15))\n\nmotor_a.duty_u16(int(50 * 1023 / 100))\n`
    expect(types(src)).not.toContain('snakie_pwm_duty_named')
    roundTrips(src)
  })

  it('a duty line whose int() is not the outermost thing on it', () => {
    // `int(a) * 65535 / 100` lexes to the same tokens in the same order as the
    // shape this reads, and is a different program.
    const src = `${IMPORT}motor_a = PWM(Pin(15))\n\nmotor_a.duty_u16(int(50) * 65535 / 100)\n`
    expect(types(src)).not.toContain('snakie_pwm_duty_named')
    roundTrips(src)
  })
})

describe('the duty line reads back as the block that wrote it (#1163)', () => {
  it('unwraps the per-cent arithmetic into the socket', () => {
    const src = `${IMPORT}motor_a = PWM(Pin(15))\n\nmotor_a.duty_u16(int(50 * 65535 / 100))\n`
    expect(types(src)).toContain('snakie_pwm_duty_named')
    // The socket-driven block, not the fielded one, which would regenerate
    // through `pwm()` and build `pwm_motor_a = PWM(motor_a)`.
    expect(types(src)).not.toContain('snakie_pwm_duty')
    expect(one(src, 'math_number')!.fields).toEqual({ NUM: 50 })
    roundTrips(src)
  })

  it('splits at the last top-level `* 65535 / 100`, brackets and all', () => {
    // The per-cent may hold the very characters the shape is made of, so the
    // reader walks tokens rather than matching text: `min(a, b)` has a comma
    // and a bracket pair in it and is one socket.
    const src = `${IMPORT}motor_a = PWM(Pin(15))\n\nmotor_a.duty_u16(int(min(a, b) * 65535 / 100))\n`
    expect(types(src)).toContain('snakie_pwm_duty_named')
    expect(types(src)).toContain('snakie_math_min_max')
    roundTrips(src)
  })

  it('does not claim the fielded block\u2019s line for the named one', () => {
    // `pwm_15` is a name the generator hoisted, not one a learner gave out, so
    // this is the block whose pin is a dropdown.
    const src = `${IMPORT}pwm_15 = PWM(Pin(15))\n\npwm_15.duty_u16(int(25 * 65535 / 100))\n`
    expect(types(src)).toContain('snakie_pwm_duty')
    expect(types(src)).not.toContain('snakie_pwm_duty_named')
    roundTrips(src)
  })
})

/**
 * THE FREQUENCY ON THE DECLARATION (#1170).
 * =============================================================================
 *
 * `pwm_motor_a = PWM(motor_a, freq=1000)` is how nearly every robot tutorial
 * opens, and it matched no template this palette had — so `pwm_motor_a` was not
 * a declared name, and every `pwm_motor_a.duty_u16(int(50 * 65535 / 100))`
 * under it came back as the generic *call duty_u16 on (pwm_motor_a) with (turn
 * (50 × 65535 ÷ 100) into a whole number (int))*. One keyword argument at the
 * top of a file turned the whole of its hardware grey.
 */
describe('a PWM declared with its frequency (#1170)', () => {
  it('is the naming block, with the Hz in its own field', () => {
    const src = `${IMPORT}motor_a = PWM(Pin(15), freq=1000)\n`
    expect(types(src)).toContain(PWM_ALIAS_BLOCK)
    expect(one(src, PWM_ALIAS_BLOCK)!.fields).toEqual({ PIN: '15', NAME: 'motor_a', FREQ: '1000' })
    roundTrips(src)
  })

  it('leaves the field empty when the constructor has no frequency', () => {
    // And that is what stops this rewriting every workspace saved before the
    // field existed: blank means "don't set one".
    const src = `${IMPORT}motor_a = PWM(Pin(15))\n`
    expect(one(src, PWM_ALIAS_BLOCK)!.fields).toEqual({ PIN: '15', NAME: 'motor_a' })
    roundTrips(src)
  })

  it('takes the frequency on a PWM built on a pin that was itself named', () => {
    const src = [
      'from machine import PWM, Pin',
      '',
      'motor_pin = Pin(15, Pin.OUT)',
      'motor_a = PWM(motor_pin, freq=1000)',
      ''
    ].join('\n')
    expect(one(src, PWM_ALIAS_BLOCK)!.fields).toEqual({
      PIN: 'motor_pin',
      NAME: 'motor_a',
      FREQ: '1000'
    })
    roundTrips(src)
  })

  it('takes a NAME as the frequency, not just a number', () => {
    const src = `${IMPORT}motor_a = PWM(Pin(15), freq=MOTOR_HZ)\n`
    expect(one(src, PWM_ALIAS_BLOCK)!.fields).toEqual({
      PIN: '15',
      NAME: 'motor_a',
      FREQ: 'MOTOR_HZ'
    })
    roundTrips(src)
  })

  it('makes the power lines under it blocks again — the whole point', () => {
    // The bug as it was reported: a robot file whose every motor line read
    // *call duty_u16 on (pwm_motor_a) with (turn (50 × 65535 ÷ 100) into a
    // whole number (int))*, five blocks deep, for a line one block writes.
    const src = [
      'from machine import PWM, Pin',
      '',
      'motor_a = Pin(8, Pin.OUT)',
      'pwm_motor_a = PWM(motor_a, freq=1000)',
      '',
      'pwm_motor_a.duty_u16(int(50 * 65535 / 100))',
      ''
    ].join('\n')
    expect(types(src)).toContain('snakie_pwm_duty_named')
    expect(types(src)).not.toContain('snakie_python_call')
    roundTrips(src)
  })

  it('a frequency the block could not write back is left as an ordinary line', () => {
    // Arithmetic in the constructor is not a shape a text field can hold, and
    // the exact-match rule is what keeps somebody's own line theirs.
    const src = `${IMPORT}motor_a = PWM(Pin(15), freq=1000 * 2)\n`
    expect(types(src)).not.toContain(PWM_ALIAS_BLOCK)
    roundTrips(src)
  })
})
