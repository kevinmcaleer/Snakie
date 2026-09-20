import { describe, it, expect, beforeEach } from 'vitest'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import { explainBlock } from '../src/renderer/src/lib/blocks/explain'
import { pythonForBlock } from '../src/renderer/src/lib/blocks/generator'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import {
  defineDynamicBlocks,
  installBlockDefinitions,
  resetBlockRegistry
} from '../src/renderer/src/lib/blocks/registry'
import { blockDefinitionsFrom } from '../src/renderer/src/lib/blocks/manifest'
import { parseBlocksManifest } from '../src/shared/blocks-manifest'

/**
 * WHAT BLOCK IS THIS? (#1245)
 * =============================================================================
 *
 * The panel is a drop target with no facts of its own: every answer it gives
 * comes from `explainBlock`, so the answers can be checked here rather than by
 * dragging blocks onto a corner of a real canvas.
 *
 * The property under test throughout is HONESTY. A learner asking what a block
 * is has no way to check the reply, so a wrong category, an invented library or
 * a confident description of a block this build does not know would all be
 * worse than the silence they replace.
 */

beforeEach(() => {
  resetBlockRegistry()
  installCorePalette()
  installBlockDefinitions()
})

function blockOf(type: string): Blockly.Block {
  const ws = new Blockly.Workspace()
  return ws.newBlock(type)
}

describe('a block from the built-in palette', () => {
  it('reads out its name, shape, drawer and library', () => {
    const ex = explainBlock(blockOf('snakie_wait_seconds'))
    expect(ex.title).toContain('wait')
    expect(ex.shape).toBe('statement')
    expect(ex.category).toEqual({ id: 'wait', name: 'Wait' })
    expect(ex.origin.kind).toBe('core')
    expect(ex.libraries).toContain('time')
    expect(ex.description).toContain('Pause the program')
    expect(ex.help).toBe('ref-timing')
    expect(ex.unknown).toBe(false)
  })

  it('shows the Python that one block writes, and only that block', () => {
    const block = blockOf('snakie_wait_seconds')
    expect(explainBlock(block).python).toBe('time.sleep(0)')
  })

  it('lists the sockets and says which are empty', () => {
    const ex = explainBlock(blockOf('snakie_wait_seconds'))
    expect(ex.sockets).toEqual([{ name: 'SECS', kind: 'value', filled: false, holds: null }])
  })

  it('names what is plugged in when something is', () => {
    const ws = new Blockly.Workspace()
    const wait = ws.newBlock('snakie_wait_seconds')
    const number = ws.newBlock('math_number')
    number.setFieldValue(3, 'NUM')
    wait.getInput('SECS')?.connection?.connect(number.outputConnection!)
    const socket = explainBlock(wait).sockets[0]
    expect(socket.filled).toBe(true)
    expect(socket.holds).toContain('3')
  })

  it('reports a value block as a value block', () => {
    expect(explainBlock(blockOf('math_number')).shape).toBe('value')
  })
})

describe('a hardware block', () => {
  it('says which pin it claims, which way it drives it and what it stands for', () => {
    const ex = explainBlock(blockOf('snakie_pin_write'))
    expect(ex.category?.id).toBe('hardware')
    expect(ex.pin).toEqual({
      field: 'PIN',
      role: 'pin output',
      needs: 'digital',
      direction: 'out'
    })
    expect(ex.call).toBe('<object>.value()')
    expect(ex.fields.map((f) => f.name)).toContain('PIN')
  })
})

/**
 * The case the feature exists for: a block in somebody else's program that came
 * from a part, which is exactly the block whose drawer the learner cannot find
 * because it is not in the palette at all.
 */
describe('a block a part brought with it', () => {
  it('names the part rather than the namespaced type', () => {
    const { manifest, warnings } = parseBlocksManifest(
      [
        'blocks:',
        '  - id: read',
        '    message: distance in mm',
        '    shape: value',
        '    output: Number',
        '    tooltip: How far away the nearest thing is.',
        '    imports:',
        '      - module: vl53l0x',
        '    code: sensor.read()'
      ].join('\n')
    )
    expect(warnings).toEqual([])
    defineDynamicBlocks(
      'part:snakie-standard.vl53l0x',
      blockDefinitionsFrom(manifest, {
        kind: 'part',
        id: 'snakie-standard.vl53l0x',
        name: 'VL53L0X',
        category: 'parts',
        part: { libraryId: 'snakie-standard', partId: 'vl53l0x' }
      })
    )
    installBlockDefinitions()

    const ex = explainBlock(blockOf('snakie_part_snakie_standard_vl53l0x_read'))
    expect(ex.origin.kind).toBe('part')
    expect(ex.origin.label).toContain('VL53L0X')
    expect(ex.origin.part).toEqual({ libraryId: 'snakie-standard', partId: 'vl53l0x' })
    expect(ex.category?.id).toBe('parts')
    expect(ex.libraries).toEqual(['vl53l0x'])
    expect(ex.description).toBe('How far away the nearest thing is.')
    expect(ex.shape).toBe('value')
  })
})

describe('a block this build does not know', () => {
  it('says so instead of describing it', () => {
    Blockly.defineBlocksWithJsonArray([
      { type: 'from_the_future', message0: 'from the future', previousStatement: null }
    ])
    const ex = explainBlock(blockOf('from_the_future'))
    expect(ex.unknown).toBe(true)
    expect(ex.origin.kind).toBe('blockly')
    expect(ex.category).toBeNull()
    expect(ex.libraries).toEqual([])
    expect(ex.python).toBeNull()
  })
})

describe('pythonForBlock (#1245)', () => {
  it('leaves no source markers in the line it hands back', () => {
    const code = pythonForBlock(blockOf('snakie_wait_seconds'))
    expect(code).not.toContain('\u0000')
  })

  it('stops at the block it was asked about', () => {
    const ws = new Blockly.Workspace()
    const first = ws.newBlock('snakie_wait_seconds')
    const second = ws.newBlock('snakie_wait_seconds')
    first.nextConnection!.connect(second.previousConnection!)
    expect(pythonForBlock(first).trim()).toBe('time.sleep(0)')
  })
})
