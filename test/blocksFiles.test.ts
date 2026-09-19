import { describe, it, expect, beforeEach } from 'vitest'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import { generateProgram } from '../src/renderer/src/lib/blocks/generator'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import {
  blockDefinition,
  installBlockDefinitions,
  resetBlockRegistry
} from '../src/renderer/src/lib/blocks/registry'
import { categoryContents } from '../src/renderer/src/lib/blocks/toolbox'
import { BLOCK_CATEGORIES } from '../src/renderer/src/lib/blocks/theme'
import { pythonToBlocks } from '../src/renderer/src/lib/blocks/python-to-blocks'
import { verifyConversion } from '../src/renderer/src/lib/blocks/round-trip'

/**
 * FILES, AND THE `with` THAT KEEPS THEM SAFE (#1132, epic #1119).
 * =============================================================================
 *
 * `snakie_with` shipped hidden in W7. On a board, `with` has one overwhelmingly
 * common use — opening a file on the flash — and neither the `with` nor the
 * `open()` was expressible in blocks at all.
 *
 * THIS IS THE ONE HIDDEN BLOCK WHOSE VALUE IS IN WHAT IT CONTAINS, which is why
 * flipping the field alone would have given a learner a C-shape with nothing to
 * put in it. The file blocks are the point, not an extra.
 */

beforeEach(() => {
  resetBlockRegistry()
  installCorePalette()
  installBlockDefinitions()
})

function roundTrip(source: string): string {
  const { workspace } = pythonToBlocks(source)
  const ws = new Blockly.Workspace()
  Blockly.serialization.workspaces.load(workspace as never, ws)
  const out = generateProgram(ws)
  expect(out.missing).toEqual([])
  return out.code
}

function rootOf(source: string): Record<string, unknown> {
  const { workspace } = pythonToBlocks(source)
  return (workspace as { blocks: { blocks: Record<string, unknown>[] } }).blocks.blocks[0]
}

describe('the drawer', () => {
  it('is a Files shelf inside Control, not a category of its own', () => {
    // A fifteenth vivid hue would have to come out of somebody else's drawer:
    // #1120 took the last slot the wheel had at the palette's depth.
    expect(BLOCK_CATEGORIES.map((c) => c.id)).not.toContain('files')
    const contents = categoryContents(
      BLOCK_CATEGORIES.find((c) => c.id === 'control')!,
      'micropython'
    )
    const shelf = (contents.filter((c) => c.kind === 'category') as {
      name: string
      contents: { type: string }[]
    }[]).find((c) => c.name === 'Files')!
    expect(shelf.contents.map((c) => c.type)).toEqual([
      'snakie_use',
      'snakie_file_open',
      'snakie_file_write',
      'snakie_file_lines'
    ])
  })

  it('leaves `with` reachable and its exact twin hidden', () => {
    expect(blockDefinition('snakie_use')!.hidden).toBeUndefined()
    expect(blockDefinition('snakie_with')!.hidden).toBe(true)
  })

  it('offers the file blocks on both runtimes — reading works on each', () => {
    // Writing is the difference, and it is in the tooltip and the help page
    // rather than in a scope: taking the blocks away from a CircuitPython board
    // would take READING away too, which that board does perfectly well.
    for (const type of ['snakie_use', 'snakie_file_open', 'snakie_file_write']) {
      expect([type, blockDefinition(type)!.scope]).toEqual([type, undefined])
    }
    expect(blockDefinition('snakie_file_open')!.json!.tooltip).toContain('CircuitPython')
  })
})

describe('logging readings', () => {
  it('builds and reads back `with open(path, mode) as f:`', () => {
    const root = rootOf("with open('data.csv', 'a') as file:\n    file.write('1')\n")
    expect(root.type).toBe('snakie_use')
    const thing = (root.inputs as Record<string, { block: Record<string, unknown> }>).THING.block
    expect(thing.type).toBe('snakie_file_open')
    expect(thing.fields).toEqual({ MODE: 'a' })
    expect(roundTrip("with open('data.csv', 'a') as file:\n    file.write('1')\n")).toContain(
      "with open('data.csv', 'a') as file:"
    )
  })

  it('reads every mode the dropdown has, and declines the ones it does not', () => {
    for (const mode of ['r', 'w', 'a']) {
      const root = rootOf(`with open('f', '${mode}') as file:\n    print(1)\n`)
      const thing = (root.inputs as Record<string, { block: Record<string, unknown> }>).THING.block
      expect(thing.fields, mode).toEqual({ MODE: mode })
    }
    // `'rb'` is a real mode with no block. It stays verbatim rather than coming
    // back as `'r'`, which would be a different program.
    expect(roundTrip("with open('f', 'rb') as file:\n    print(1)\n")).toContain("open('f', 'rb')")
  })

  it('reads the write, and the line loop as the ordinary `for each`', () => {
    expect(rootOf("file.write('hello')\n").type).toBe('snakie_file_write')
    // `for line in f:` is a line `controls_forEach` writes too, and nothing in
    // the text says which block built it. The ordinary loop keeps it.
    expect(rootOf('for line in file:\n    print(line)\n').type).toBe('controls_forEach')
  })
})

describe('what the friendly block does not claim', () => {
  it('leaves two context managers, `async with`, and a bare `with` to the exact one', () => {
    expect(rootOf('with a() as f, b() as g:\n    print(f)\n').type).toBe('snakie_with')
    expect(rootOf('with lock:\n    print(1)\n').type).toBe('snakie_with')
    const asyncSrc = [
      'async def go(service):',
      '    async with service.connect() as connection:',
      '        print(connection)',
      ''
    ].join('\n')
    expect(roundTrip(asyncSrc)).toBe(asyncSrc)
  })
})

describe('a data logger', () => {
  it('goes through the round-trip gate whole', async () => {
    const source = [
      "with open('data.csv', 'a') as file:",
      "    file.write('hello\\n')",
      '',
      "with open('data.csv') as file:",
      '    for line in file:',
      '        print(line.strip())',
      ''
    ].join('\n')
    const { workspace } = pythonToBlocks(source)
    expect(await verifyConversion(source, workspace as never)).toEqual({ ok: true })
  })
})
