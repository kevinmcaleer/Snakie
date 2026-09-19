import { describe, it, expect, beforeEach } from 'vitest'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import { generateProgram } from '../src/renderer/src/lib/blocks/generator'
import { installBlockDefinitions, resetBlockRegistry } from '../src/renderer/src/lib/blocks/registry'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import { pythonToBlocks } from '../src/renderer/src/lib/blocks/python-to-blocks'

/**
 * `async def` AND `await` (W9, #1096, epic #1086).
 * =============================================================================
 *
 * 570 raw lines across 15 projects — real, and the narrowest workstream in the
 * epic, which is why it is scheduled last. `asyncio` and `uasyncio` together
 * appear in 59 files across ~19 projects, so this is a genuine part of how
 * MicroPython gets written; it is simply not a majority.
 *
 * AND IT IS THE CHEAPEST OF THE "NEW BLOCK" WORKSTREAMS, once W6 has landed,
 * because both are keyword prefixes on shapes the reader already handles.
 * `async def` is one more SETTING on the method block that already carries
 * `@property`, and `async with` one more on the `with` block. `await` is the one
 * thing that needed blocks of its own, and it needed two of them for the reason
 * `snakie_python_call` and `snakie_python_call_value` are two blocks: a Blockly
 * block has an output or a pair of statement connections, never both.
 *
 * `async for` IS DELIBERATELY NOT HERE. #1096 says to include it "if the
 * modifier approach generalises" — and it does not: `for each` is Blockly's own
 * `controls_forEach`, so a setting on it would mean redefining a stock block.
 * Nine projects, and an `async for` line stays a raw suite with its body in
 * blocks under it.
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
const one = (source: string, type: string): Record<string, unknown> | undefined =>
  blocks(source).find((b) => b.type === type)

describe('async def', () => {
  it('reads as the method block with the async setting', () => {
    const src = ['async def main():', '    print(1)', ''].join('\n')
    expect(one(src, 'snakie_method')!.fields).toMatchObject({ NAME: 'main', KIND: 'ASYNC' })
    roundTrips(src)
  })

  it('never becomes a procedure block, which has nowhere to put the keyword', () => {
    const src = ['async def main():', '    print(1)', ''].join('\n')
    expect(types(src)).not.toContain('procedures_defnoreturn')
  })

  it('reads an async method inside a class', () => {
    const src = [
      'class Player:',
      '    async def play(self, frames):',
      '        print(frames)',
      ''
    ].join('\n')
    expect(types(src)).toContain('snakie_class')
    expect(one(src, 'snakie_method')!.fields).toMatchObject({ KIND: 'ASYNC' })
    roundTrips(src)
  })

  it('reads a decorated async def', () => {
    const src = ['class T:', '    @staticmethod', '    async def go():', '        print(1)', ''].join('\n')
    expect(one(src, 'snakie_method')!.fields).toMatchObject({
      DECORATOR: 'staticmethod',
      KIND: 'ASYNC'
    })
    roundTrips(src)
  })

  it('leaves an ordinary def alone', () => {
    const src = ['def go():', '    print(1)', ''].join('\n')
    expect(types(src)).toContain('procedures_defnoreturn')
    roundTrips(src)
  })
})

describe('await', () => {
  it('reads one on a line of its own', () => {
    const src = ['async def go():', '    await sleeper()', ''].join('\n')
    expect(types(src)).toContain('snakie_await')
    roundTrips(src)
  })

  it('reads one inside an expression', () => {
    const src = ['async def go():', '    data = await sensor.read()', ''].join('\n')
    expect(types(src)).toContain('snakie_await_value')
    roundTrips(src)
  })

  it('reads one in a condition', () => {
    const src = ['async def go():', '    if await sensor.ready():', '        print(1)', ''].join('\n')
    expect(types(src)).toContain('snakie_await_value')
    roundTrips(src)
  })

  it('keeps a bare unknown call grey, and the await around it real', () => {
    // `ready()` is a bare call to nothing this program defines, which has no
    // block — there is no object for it to be a method of. The line is still a
    // real `await` with a grey value in it.
    const src = ['async def go():', '    if await ready():', '        print(1)', ''].join('\n')
    expect(types(src)).toContain('controls_if')
    roundTrips(src)
  })

  it('sockets a call into a module as grey, and keeps the line', () => {
    // `asyncio` is bound by the import line, so a generic call on it would come
    // back renamed (W1, #1088) — the expression stays grey and the `await`
    // around it is still a real block.
    const src = [
      'import uasyncio as asyncio',
      '',
      'async def go():',
      '    await asyncio.sleep(0.2)',
      ''
    ].join('\n')
    expect(types(src)).toContain('snakie_await')
    expect(types(src)).toContain('snakie_python_value')
    roundTrips(src)
  })

  it('treats `uasyncio` and `asyncio` alike, because it treats neither specially', () => {
    for (const module of ['asyncio', 'uasyncio']) {
      const src = [`import ${module}`, '', 'async def go():', `    await ${module}.sleep(1)`, ''].join('\n')
      expect(types(src), module).toContain('snakie_await')
      roundTrips(src)
    }
  })
})

describe('async with', () => {
  it('reads as the with block with the async setting', () => {
    const src = [
      'async def go(service):',
      '    async with service.connect() as connection:',
      '        print(connection)',
      ''
    ].join('\n')
    expect(one(src, 'snakie_with')!.fields).toMatchObject({ KIND: 'ASYNC' })
    roundTrips(src)
  })

  it('leaves an ordinary with alone', () => {
    // A plain `with … as name` is the Files drawer's friendly block since
    // #1132, so what this asserts is the half that matters here: the async
    // setting is not put on a block that never asked for it.
    const src = ['with open(path) as handle:', '    print(handle)', ''].join('\n')
    expect(one(src, 'snakie_with')).toBeUndefined()
    expect(one(src, 'snakie_use')).toBeTruthy()
    roundTrips(src)
  })
})

describe('a real aioble-shaped file', () => {
  it('opens as blocks, and regenerates unchanged', () => {
    const src = [
      'import uasyncio as asyncio',
      '',
      'import aioble',
      '',
      '',
      'async def blink(led, period):',
      '    while True:',
      '        led.toggle()',
      '        await asyncio.sleep(period)',
      '',
      '',
      'async def sense(service):',
      '    async with service.connect() as connection:',
      '        data = await connection.read()',
      '        print(data)',
      '',
      '',
      'async def main():',
      '    await asyncio.gather(blink(led, 0.2), sense(svc))',
      ''
    ].join('\n')
    const { report } = pythonToBlocks(src)
    expect(report.raw).toBe(0)
    roundTrips(src)
  })
})
