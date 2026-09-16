import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as Blockly from 'blockly/core'
import { generateProgram, type GeneratedProgram } from '../src/renderer/src/lib/blocks/generator'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import { blocksInCategory, installBlockDefinitions } from '../src/renderer/src/lib/blocks/registry'
import { derivedInstrumentBlocks } from '../src/renderer/src/lib/blocks/palette/instruments'
import { INSTRUMENTS } from '../src/renderer/src/components/instruments-registry'
import { ImportManager, importGroup } from '../src/renderer/src/lib/blocks/imports'
import { shouldShowBanner } from '../src/renderer/src/lib/instrumentsLib'

/**
 * INSTRUMENTS IN BLOCK MODE (#1014, epic #1007).
 * =============================================================================
 *
 * Two claims to keep honest, and they pull in opposite directions:
 *
 *  - the palette is DERIVED, so adding an instrument's block is a registry edit
 *    and nothing else — tested by deriving it and counting, not by listing the
 *    block types here (a list here would be the second source of truth the
 *    derivation exists to prevent);
 *  - the generated code MATCHES `micropython/instruments.py` — tested by
 *    reading the library off disk, as the turtle palette does.
 */

beforeAll(() => {
  installCorePalette()
  installBlockDefinitions()
})

function gen(blocks: unknown[]): GeneratedProgram {
  const ws = new Blockly.Workspace()
  Blockly.serialization.workspaces.load({ blocks: { languageVersion: 0, blocks } }, ws)
  const out = generateProgram(ws)
  expect(out.missing).toEqual([])
  return out
}

const lines = (blocks: unknown[]): string[] => gen(blocks).code.split('\n')
const num = (n: number): Record<string, unknown> => ({ type: 'math_number', fields: { NUM: n } })
const str = (t: string): Record<string, unknown> => ({ type: 'text', fields: { TEXT: t } })
/** A value block wrapped in a `print`, since one alone generates nothing. */
const printed = (type: string, fields?: Record<string, unknown>): string[] =>
  lines([
    { type: 'text_print', id: 'p', inputs: { TEXT: { block: { type, id: 'v', fields } } } }
  ])

describe('the palette is derived from the registry (#1014)', () => {
  it('produces exactly the blocks the registry declares', () => {
    const declared = INSTRUMENTS.flatMap((i) => i.blocks ?? [])
    expect(derivedInstrumentBlocks().map((b) => b.type)).toEqual(declared.map((b) => b.type))
    // Not a token few: the registry carries real descriptors, so a regression
    // that empties `blocks` on every instrument would fail here rather than
    // quietly shipping an empty category.
    expect(declared.length).toBeGreaterThanOrEqual(13)
  })

  it('gives every derived block its instrument, its help article and a tooltip', () => {
    for (const block of derivedInstrumentBlocks()) {
      const instrument = INSTRUMENTS.find((i) => (i.blocks ?? []).some((b) => b.type === block.type))
      expect(instrument, block.type).toBeTruthy()
      // Dragging it reveals that instrument (#1013's field), and its Help opens
      // that instrument's article — both from the same id, so they can't drift.
      expect(block.instrument).toBe(instrument!.id)
      expect(block.help).toBe(`inst-${instrument!.id}`)
      expect(String(block.json?.tooltip ?? '')).not.toBe('')
    }
  })

  it('points every block at a help article that exists', () => {
    // The turtle/core palettes' rule, applied here: a help link that 404s is
    // worse than none, because they click it once.
    for (const block of blocksInCategory('instruments')) {
      const path = join(__dirname, '..', 'src/renderer/src/components/help', `${block.help}.md`)
      expect(() => readFileSync(path, 'utf-8'), `${block.type} → ${block.help}`).not.toThrow()
    }
  })

  it('says so on the block when a call pauses the program', () => {
    // A scanner is not safe in a tight loop and every other block here is. A
    // child who puts one in `forever` sees their program stutter with nothing
    // to explain it, so the block itself explains it.
    const slow = INSTRUMENTS.flatMap((i) => i.blocks ?? []).filter((b) => b.slow)
    expect(slow.length).toBeGreaterThanOrEqual(2)
    for (const def of slow) {
      const block = derivedInstrumentBlocks().find((b) => b.type === def.type)!
      expect(String(block.json?.tooltip), def.type).toContain("don't put it in a fast loop")
    }
  })
})

describe('the emitters (#1014)', () => {
  it('imports the library the way every Snakie example does', () => {
    expect(lines([{ type: 'snakie_inst_scope', id: 's' }])[0]).toBe('import instruments as inst')
  })

  it('sends a scope sample, leaving the default channel unsaid', () => {
    // `ch="ch1"` IS the library default, so spelling it out would be noise in
    // every program that never touches it.
    expect(
      lines([{ type: 'snakie_inst_scope', id: 's', inputs: { VALUE: { shadow: num(42) } } }])
    ).toContain('inst.scope(42)')
  })

  it('names the channel when the learner changes it', () => {
    expect(
      lines([
        {
          type: 'snakie_inst_scope',
          id: 's',
          fields: { CH: 'ch2' },
          inputs: { VALUE: { shadow: num(42) } }
        }
      ])
    ).toContain("inst.scope(42, ch='ch2')")
  })

  it('sends a meter reading with its unit', () => {
    expect(
      lines([
        {
          type: 'snakie_inst_meter',
          id: 'm',
          fields: { UNIT: 'mA', CH: 'adc0' },
          inputs: { VALUE: { shadow: num(3) } }
        }
      ])
    ).toContain("inst.meter(3, unit='mA')")
  })

  it('plots a named series the learner typed', () => {
    expect(
      lines([
        {
          type: 'snakie_inst_plot',
          id: 'p',
          fields: { NAME: 'temp' },
          inputs: { VALUE: { shadow: num(21) } }
        }
      ])
    ).toContain('inst.plot(temp=21)')
  })

  it('makes a series name a learner typed into a legal keyword', () => {
    // `plot(my reading=21)` is a SyntaxError, and naming a series with a space
    // in it is not a mistake a child is making.
    expect(
      lines([
        {
          type: 'snakie_inst_plot',
          id: 'p',
          fields: { NAME: 'my reading' },
          inputs: { VALUE: { shadow: num(21) } }
        }
      ])
    ).toContain('inst.plot(my_reading=21)')
  })

  it('sends a button state as a real boolean, not the string "True"', () => {
    // A text socket here would generate `inst.button("a", "True")` — a string,
    // which is truthy whatever it says, so the button would never read as up.
    expect(
      lines([
        {
          type: 'snakie_inst_button',
          id: 'b',
          fields: { NAME: 'go' },
          inputs: { STATE: { shadow: { type: 'logic_boolean', fields: { BOOL: 'FALSE' } } } }
        }
      ])
    ).toContain("inst.button('go', False)")
  })

  it('sends display rows as a LIST, not a string to be iterated', () => {
    // `screen('Hello')` iterates the string and puts five one-character rows on
    // the display: it runs, it produces something, and it is wrong in a way the
    // block gives no clue about.
    expect(
      lines([{ type: 'snakie_inst_screen', id: 's', inputs: { LINES: { shadow: str('Ready') } } }])
    ).toContain("inst.screen(['Ready'])")
  })

  it('sends IMU angles and a weather reading positionally', () => {
    expect(lines([{ type: 'snakie_inst_imu', id: 'i' }])).toContain('inst.imu(0, 0, 0)')
    expect(lines([{ type: 'snakie_inst_env', id: 'e' }])).toContain('inst.env(20, 1013, 50)')
  })

  it('scans, and services the control channel', () => {
    expect(lines([{ type: 'snakie_inst_wifi_scan', id: 'w' }])).toContain('inst.wifi_scan()')
    expect(lines([{ type: 'snakie_inst_bt_scan', id: 'b' }])).toContain('inst.bt_scan(4000)')
    expect(lines([{ type: 'snakie_inst_start', id: 's' }])).toContain('inst.start()')
    expect(lines([{ type: 'snakie_inst_poll', id: 'p' }])).toContain('inst.control.poll()')
  })
})

describe('the blocks that take hardware (#1014)', () => {
  it('reads an ADC through one hoisted object, shared with the Hardware palette', () => {
    // Two blocks on GP26 must be ONE `ADC`: two would be a real bug, not an
    // untidiness — which is why the hoister is shared rather than copied.
    const out = gen([
      {
        type: 'text_print',
        id: 'p',
        inputs: { TEXT: { block: { type: 'snakie_inst_read_adc', id: 'a' } } },
        next: {
          block: {
            type: 'text_print',
            id: 'p2',
            inputs: { TEXT: { block: { type: 'snakie_adc_read', id: 'b' } } }
          }
        }
      }
    ])
    expect(out.code.split('\n').filter((l) => l.includes('ADC(Pin('))).toEqual([
      'adc_26 = ADC(Pin(26))'
    ])
    expect(out.code).toContain("print(inst.read_adc(adc_26, ch='adc26'))")
  })

  it('reads a PWM as a value block', () => {
    const out = printed('snakie_inst_read_pwm')
    expect(out).toContain('pwm_15 = PWM(Pin(15))')
    expect(out).toContain("print(inst.read_pwm(pwm_15, ch='pwm15'))")
  })

  it('picks the I²C bus the pins actually select', () => {
    // GP4/GP5 are I2C0 on the RP mux; GP2/GP3 are I2C1. Getting this from the
    // shared table rather than guessing is the difference between a scan that
    // finds the device and one that finds nothing.
    expect(lines([{ type: 'snakie_inst_i2c_scan', id: 'i' }])).toContain(
      'i2c_0 = I2C(0, sda=Pin(4), scl=Pin(5))'
    )
    expect(
      lines([{ type: 'snakie_inst_i2c_scan', id: 'i', fields: { SDA: '2', SCL: '3' } }])
    ).toContain('i2c_1 = I2C(1, sda=Pin(2), scl=Pin(3))')
  })

  it('reads a gamepad axis without raising before the first message', () => {
    // `.get(name, 0)` rather than `[name]`: an axis the gamepad has not sent yet
    // must read as centred, not stop a robot's drive loop with a KeyError.
    expect(printed('snakie_inst_gamepad_axis', { AXIS: 'y' })).toContain(
      "print(inst.teleop()[0].get('y', 0))"
    )
  })
})

describe('the generated code matches the real library (#1014)', () => {
  const library = readFileSync(
    join(__dirname, '..', 'micropython', 'instruments.py'),
    'utf-8'
  )
  const moduleFunctions = new Set([...library.matchAll(/^def ([a-z_]+)\(/gm)].map((m) => m[1]))

  it('calls only functions instruments.py defines at module level', () => {
    const called = new Set<string>()
    for (const def of blocksInCategory('instruments')) {
      const statement = def.json?.previousStatement !== undefined
      const code = gen([
        statement
          ? { type: def.type, id: 'x' }
          : { type: 'text_print', id: 'p', inputs: { TEXT: { block: { type: def.type, id: 'x' } } } }
      ]).code
      for (const m of code.matchAll(/\binst\.([a-z_]+)\(/g)) called.add(m[1])
    }
    expect(called.size).toBeGreaterThanOrEqual(13)
    expect([...called].filter((fn) => !moduleFunctions.has(fn))).toEqual([])
  })

  it('reaches the control channel through the object the library exposes', () => {
    // `inst.control.poll()` is an attribute, not a module function, so the check
    // above cannot see it — it is pinned separately rather than left untested.
    expect(library).toMatch(/^control = Control\(\)/m)
    expect(library).toMatch(/^\s+def poll\(self\)/m)
  })
})

describe('the library-install banner reaches block mode (#1014)', () => {
  it('depends on the board, not on which workspace is open', () => {
    // The banner lives at the top of the shell rather than inside the Code
    // workspace, so it is already visible from the canvas. Pinned as behaviour:
    // a child who drags an instrument block onto a board without the library
    // cannot be expected to diagnose `ImportError: no module named instruments`.
    expect(shouldShowBanner({ connected: true, installState: 'absent', dismissed: false })).toBe(
      true
    )
    expect(shouldShowBanner({ connected: true, installState: 'outdated', dismissed: false })).toBe(
      true
    )
    expect(shouldShowBanner({ connected: true, installState: 'present', dismissed: false })).toBe(
      false
    )
    // Nothing to install onto: in the simulator there is no board and no banner.
    expect(shouldShowBanner({ connected: false, installState: 'absent', dismissed: false })).toBe(
      false
    )
  })
})

describe('import aliases (#1014)', () => {
  it('writes the alias and keeps the grouping', () => {
    const imports = new ImportManager()
    imports.need({ module: 'instruments', alias: 'inst' })
    imports.need({ module: 'time' })
    expect(imports.render()).toBe('import time\n\nimport instruments as inst')
    expect(importGroup('instruments')).toBe('snakie')
  })

  it('protects the ALIAS from a learner s own variable, not the module name', () => {
    // `inst = 3` above a loop calling `inst.scope(...)` is the failure; the
    // module is never named in the program at all.
    const imports = new ImportManager()
    imports.need({ module: 'instruments', alias: 'inst' })
    expect([...imports.boundNames()]).toEqual(['inst'])
  })

  it('keeps the first alias, so the section cannot depend on emit order', () => {
    const imports = new ImportManager()
    imports.need({ module: 'instruments', alias: 'inst' })
    imports.need({ module: 'instruments', alias: 'instr' })
    expect(imports.render()).toBe('import instruments as inst')
  })
})
