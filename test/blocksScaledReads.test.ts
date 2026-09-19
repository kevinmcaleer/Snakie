import { beforeEach, describe, expect, it } from 'vitest'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import { generateProgram } from '../src/renderer/src/lib/blocks/generator'
import {
  installBlockDefinitions,
  resetBlockRegistry
} from '../src/renderer/src/lib/blocks/registry'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import { pythonToBlocks } from '../src/renderer/src/lib/blocks/python-to-blocks'

/**
 * A READING WITH ITS CONVERSION ON THE END IS THE BLOCK THAT WROTE IT (#1163).
 * =============================================================================
 *
 * *read (GP26) as [volts]* does not write `adc_26.read_u16()`. It writes
 * `adc_26.read_u16() * 3.3 / 65535`, because 0-65535 is what the hardware
 * gives and volts is what the learner asked for — and the conversion is on the
 * line where both are visible, exactly as the duty blocks' is.
 *
 * That conversion is why this block sat out #1058 altogether: a call rule
 * describes a CALL, and the volts line is a call inside a division. So the
 * whole reading came back as arithmetic wrapped round a block whose own
 * dropdown already offered *volts* — with the block in the middle of it set to
 * the OTHER option.
 *
 * `scaledBy` names the conversion, and the reader folds it back off the tree
 * the expression parser has already built. These tests hold both halves of what
 * that is allowed to do: the shapes the generator writes fold, and everything
 * else is somebody's own arithmetic and stays it.
 */

beforeEach(() => {
  resetBlockRegistry()
  installCorePalette()
  installBlockDefinitions()
})

const ADC = 'from machine import ADC, Pin\n\nadc_26 = ADC(Pin(26))\n\n'
const PWM = 'from machine import PWM, Pin\n\nmotor_a = PWM(Pin(15))\n\n'

/** Every block the reader builds for `source`, parents before children. */
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

function regenerate(source: string): string {
  const { workspace } = pythonToBlocks(source)
  const ws = new Blockly.Workspace()
  Blockly.serialization.workspaces.load(workspace as never, ws)
  return generateProgram(ws).code
}

/** The one promise the reader makes: the program comes back the program. */
function roundTrips(source: string): void {
  expect(regenerate(source)).toBe(source)
}

describe('an analogue reading reads back as its block', () => {
  it('claims the raw form, with the dropdown the line means', () => {
    // THE FIELD IS THE POINT. `UNIT` unset falls to the dropdown's FIRST
    // option — which is `volts` — so a block built without it regenerates the
    // conversion this line does not have.
    const src = `${ADC}level = adc_26.read_u16()\n`
    expect(types(src)).toContain('snakie_adc_read')
    expect(one(src, 'snakie_adc_read')!.fields).toEqual({ PIN: '26', UNIT: 'RAW' })
    roundTrips(src)
  })

  it('folds the volts conversion into the same block', () => {
    const src = `${ADC}volts = adc_26.read_u16() * 3.3 / 65535\n`
    expect(one(src, 'snakie_adc_read')!.fields).toEqual({ PIN: '26', UNIT: 'VOLTS' })
    // And no arithmetic left over around it — that is the whole complaint.
    expect(types(src)).not.toContain('math_arithmetic')
    roundTrips(src)
  })

  it('folds it wherever the reading sits, not only on its own', () => {
    // The fold is on the BUILT TREE, so it catches a reading the precedence
    // climber reached rather than one that happened to be a whole expression.
    const inIf = `${ADC}if adc_26.read_u16() * 3.3 / 65535 > 2:\n    print(1)\n`
    expect(one(inIf, 'snakie_adc_read')!.fields).toEqual({ PIN: '26', UNIT: 'VOLTS' })
    roundTrips(inIf)

    const inSum = `${ADC}x = adc_26.read_u16() * 3.3 / 65535 + 1\n`
    expect(one(inSum, 'snakie_adc_read')!.fields).toEqual({ PIN: '26', UNIT: 'VOLTS' })
    roundTrips(inSum)
  })

  it('reads a named PWM’s per-cent power back too', () => {
    const src = `${PWM}level = motor_a.duty_u16() * 100 / 65535\n`
    expect(types(src)).toContain('snakie_pwm_read_named')
    expect(one(src, 'snakie_pwm_read_named')!.fields).toEqual({ UNIT: 'PERCENT' })
    expect(types(src)).not.toContain('math_arithmetic')
    roundTrips(src)
  })

  it('still reads the raw power form as the raw one', () => {
    const src = `${PWM}level = motor_a.duty_u16()\n`
    expect(one(src, 'snakie_pwm_read_named')!.fields).toEqual({ UNIT: 'RAW' })
    roundTrips(src)
  })
})

describe('what stays the arithmetic somebody wrote', () => {
  it('a scale this block never writes', () => {
    const src = `${ADC}x = adc_26.read_u16() * 5.0 / 65535\n`
    expect(one(src, 'snakie_adc_read')!.fields).toEqual({ PIN: '26', UNIT: 'RAW' })
    expect(types(src)).toContain('math_arithmetic')
    roundTrips(src)
  })

  it('the same conversion applied twice', () => {
    // The fold only claims a reading still wearing the fields its own rule
    // gave it, so the inner one becomes `volts` and the outer stays a division.
    const src = `${ADC}x = adc_26.read_u16() * 3.3 / 65535 * 3.3 / 65535\n`
    expect(one(src, 'snakie_adc_read')!.fields).toEqual({ PIN: '26', UNIT: 'VOLTS' })
    expect(types(src)).toContain('math_arithmetic')
    roundTrips(src)
  })

  it('the same scale on something that is not a reading at all', () => {
    const src = 'x = reading * 3.3 / 65535\n'
    expect(types(src)).not.toContain('snakie_adc_read')
    roundTrips(src)
  })

  it('a reading built inline, which is not a line this block writes', () => {
    const src = 'from machine import ADC, Pin\n\nvolts = ADC(Pin(26)).read_u16()\n'
    expect(types(src)).not.toContain('snakie_adc_read')
    roundTrips(src)
  })
})
