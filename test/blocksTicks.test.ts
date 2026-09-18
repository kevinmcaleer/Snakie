import { describe, it, expect, beforeEach } from 'vitest'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import { generateProgram } from '../src/renderer/src/lib/blocks/generator'
import { installBlockDefinitions, resetBlockRegistry } from '../src/renderer/src/lib/blocks/registry'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import { pythonToBlocks } from '../src/renderer/src/lib/blocks/python-to-blocks'
import type { Dialect } from '../src/shared/dialect'

/**
 * READING THE CLOCK — `ticks_ms` AND `ticks_us`.
 * =============================================================================
 *
 * The Wait drawer shipped `ticks_us` and `ticks between` (#1011) and stopped
 * there, on the argument that microseconds are the unit a datasheet quotes. That
 * is true of the WAITS and false of the COUNTERS: `ticks_ms` is what nearly
 * every real program reads, because "has half a second gone by yet" is the shape
 * of every non-blocking loop, every debounce and every timeout, and none of them
 * want microseconds. A `start = time.ticks_ms()` opened as a grey blob.
 *
 * BOTH COUNTERS, NOT ONE WITH A UNIT DROPDOWN, for the reason the drawer has
 * three separate waits: `time.ticks_ms()` and `time.ticks_us()` are two
 * different MicroPython functions, and the whole point of the mirror is that the
 * generated code is the code a learner will later write.
 *
 * ONE `ticks between` SERVES BOTH, because `ticks_diff` does not care which
 * counter produced its arguments — so this is a block and a table row, not a
 * second half of the timing drawer.
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

/** The Python a workspace of these blocks generates, for a dialect. */
function generate(json: Record<string, unknown>[], dialect: Dialect = 'micropython'): string {
  const ws = new Blockly.Workspace()
  Blockly.serialization.workspaces.load(
    { blocks: { languageVersion: 0, blocks: json } } as never,
    ws
  )
  return generateProgram(ws, dialect).code
}

/** `print(<counter>)`, the smallest workspace that puts a counter somewhere. */
function printing(type: string): Record<string, unknown>[] {
  return [{ type: 'text_print', id: 'p', inputs: { TEXT: { block: { type, id: 't' } } } }]
}

describe('both counters read back', () => {
  it('reads `time.ticks_ms()`', () => {
    const src = ['import time', '', 'start = time.ticks_ms()', ''].join('\n')
    expect(types(src)).toContain('snakie_ticks_ms')
    roundTrips(src)
  })

  it('reads `time.ticks_us()`, as it did', () => {
    const src = ['import time', '', 'start = time.ticks_us()', ''].join('\n')
    expect(types(src)).toContain('snakie_ticks_us')
    roundTrips(src)
  })

  it('leaves no grey value behind for either', () => {
    // The measurement that matters: `report.raw` was already zero for
    // `start = time.ticks_ms()` — it is a real `set start to` block — and the
    // line still rendered as *set start to (grey blob)*. That is what
    // `rawSockets` (#1087) exists to see.
    for (const fn of ['ticks_ms', 'ticks_us']) {
      const { report } = pythonToBlocks(`import time\n\nstart = time.${fn}()\n`)
      expect({ fn, raw: report.raw, rawSockets: report.rawSockets }).toEqual({
        fn,
        raw: 0,
        rawSockets: 0
      })
    }
  })
})

describe('the loop everybody actually writes', () => {
  it('opens as blocks, end to end', () => {
    // The non-blocking wait: read the clock, and keep going round until enough
    // has passed. This is the program `ticks_ms` exists for, and every line of
    // it is a block now.
    const src = [
      'import time',
      '',
      'start = time.ticks_ms()',
      '',
      'while time.ticks_diff(time.ticks_ms(), start) < 500:',
      '    print(1)',
      ''
    ].join('\n')
    const { report } = pythonToBlocks(src)
    expect(report.raw).toBe(0)
    expect(report.rawSockets).toBe(0)
    expect(types(src)).toContain('snakie_ticks_ms')
    expect(types(src)).toContain('snakie_ticks_diff')
    roundTrips(src)
  })

  it('subtracts with `ticks between`, whichever counter fed it', () => {
    // One `ticks_diff` block for both counters — it does not care which of them
    // produced its arguments, so the drawer does not need two.
    for (const fn of ['ticks_ms', 'ticks_us']) {
      const src = [
        'import time',
        '',
        `start = time.${fn}()`,
        '',
        `print(time.ticks_diff(time.${fn}(), start))`,
        ''
      ].join('\n')
      expect(types(src), fn).toContain('snakie_ticks_diff')
      roundTrips(src)
    }
  })
})

describe('what the blocks generate', () => {
  it('writes the two different MicroPython calls, not one with a unit', () => {
    expect(generate(printing('snakie_ticks_ms'))).toContain('print(time.ticks_ms())')
    expect(generate(printing('snakie_ticks_us'))).toContain('print(time.ticks_us())')
  })

  it('substitutes the nanosecond counter on CircuitPython, which has neither', () => {
    // `time.monotonic()` is a float in seconds that loses resolution the longer
    // the board stays up — the wrong property for timing anything — so both
    // counters come off `monotonic_ns`, floor-divided to the unit the label
    // promises.
    expect(generate(printing('snakie_ticks_ms'), 'circuitpython')).toContain(
      'time.monotonic_ns() // 1000000'
    )
    expect(generate(printing('snakie_ticks_us'), 'circuitpython')).toContain(
      'time.monotonic_ns() // 1000'
    )
  })
})

describe('what stays grey, and why that is right', () => {
  it('refuses a bare `ticks_ms()` off a from-import', () => {
    // `from time import ticks_ms` binds the name, and the block writes
    // `time.ticks_ms()` — so reading the bare call as this block would rewrite
    // the learner's line AND leave their import unused. A module is not an
    // object (#1088), and this is the same rule.
    const src = ['from time import ticks_ms', '', 'start = ticks_ms()', ''].join('\n')
    expect(types(src)).not.toContain('snakie_ticks_ms')
    roundTrips(src)
  })

  it('refuses a clock reading thrown away on a line of its own', () => {
    // `time.ticks_ms()` as a STATEMENT discards what it just read. The block has
    // an output and no statement connections — a Blockly block has one or the
    // other, never both — so there is nothing to read it as, and a block that
    // regenerated the line without its value would be a lie about dead code.
    const src = ['import time', '', 'time.ticks_ms()', ''].join('\n')
    expect(types(src)).not.toContain('snakie_ticks_ms')
    roundTrips(src)
  })
})
