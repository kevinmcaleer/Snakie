import { describe, it, expect, beforeEach } from 'vitest'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import { readModuleApi } from '../src/renderer/src/lib/blocks/module-api'
import { manifestForModule } from '../src/renderer/src/lib/blocks/module-blocks'
import { normaliseBlocksManifest } from '../src/shared/blocks-manifest'
import { blockDefinitionsFrom } from '../src/renderer/src/lib/blocks/manifest'
import {
  defineDynamicBlocks,
  installBlockDefinitions,
  resetBlockRegistry,
  blocksInCategory
} from '../src/renderer/src/lib/blocks/registry'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import { generateProgram } from '../src/renderer/src/lib/blocks/generator'

/**
 * A MODULE'S API, AS BLOCKS (#1048).
 * =============================================================================
 *
 * The end of the chain the reader starts: source → API → manifest → real
 * blocks → real MicroPython. Nothing here invents a registration path — it all
 * goes down #1017's, which is the point.
 */

const SSD1306 = `
WIDTH = 128

class SSD1306_I2C:
    def __init__(self, width, height, i2c, addr=0x3C):
        pass

    def text(self, string, x, y, col=1):
        pass

    def show(self):
        pass

    def blit(self, *rest):
        pass


def helper(a, b):
    return a + b
`

const manifest = (src = SSD1306): ReturnType<typeof manifestForModule> =>
  manifestForModule(readModuleApi('ssd1306', src))

describe('what a module offers', () => {
  const ids = manifest().blocks.map((b) => b.id)

  it('a constructor, a block per method, a function and a constant', () => {
    expect(ids).toContain('new_SSD1306_I2C')
    expect(ids).toContain('SSD1306_I2C_text')
    expect(ids).toContain('SSD1306_I2C_show')
    expect(ids).toContain('fn_helper')
    expect(ids).toContain('const_WIDTH')
  })

  it('skips a method whose signature cannot be sockets', () => {
    // `*args` cannot become a socket. #1018's call block is still the way to
    // reach it, and offering a block that silently drops arguments would be
    // worse than offering none.
    expect(ids).not.toContain('SSD1306_I2C_blit')
  })

  it('gives a defaulted parameter no socket, and leaves it out of the call', () => {
    // `addr=0x3C` is the address the driver's author expects. A beginner offered
    // four sockets for a display that needs three is being asked a question they
    // cannot answer.
    const ctor = manifest().blocks.find((b) => b.id === 'new_SSD1306_I2C')!
    expect(ctor.args?.map((a) => a.name)).toEqual(['WIDTH', 'HEIGHT', 'I2C'])
    expect(ctor.setup?.expr).toBe('ssd1306.SSD1306_I2C({WIDTH}, {HEIGHT}, {I2C})')
  })

  it('drops self, and keeps the real parameter names as labels', () => {
    const text = manifest().blocks.find((b) => b.id === 'SSD1306_I2C_text')!
    expect(text.args?.map((a) => a.label)).toEqual(['string', 'x', 'y', 'on'])
    expect(text.code).toBe('{OBJ}.text({STRING}, {X}, {Y})')
  })

  it('hoists the object so it is built once, above the program', () => {
    // A display re-initialised inside a loop is a display that flickers.
    expect(manifest().blocks.find((b) => b.id === 'new_SSD1306_I2C')!.setup).toBeDefined()
  })

  it('a module nothing could be read from offers nothing', () => {
    expect(manifest('x = 1\n').blocks).toEqual([])
  })
})

describe('the whole chain, ending in MicroPython', () => {
  beforeEach(() => {
    resetBlockRegistry()
    installCorePalette()
  })

  it('registers through #1017’s path and generates real code', () => {
    // Through `normaliseBlocksManifest` — the same front door the plugin path
    // uses — so anything this produces is held to the same schema rules.
    const { manifest: normalised, warnings } = normaliseBlocksManifest(manifest())
    expect(warnings).toEqual([])
    const defs = blockDefinitionsFrom(normalised, {
      kind: 'module',
      id: 'ssd1306',
      name: 'ssd1306',
      category: 'modules'
    })
    defineDynamicBlocks('module:ssd1306', defs)
    installBlockDefinitions()

    expect(blocksInCategory('modules').length).toBe(defs.length)

    const ctor = defs.find((d) => d.type.endsWith('new_ssd1306_i2c'))!
    const show = defs.find((d) => d.type.endsWith('ssd1306_i2c_show'))!
    const ws = new Blockly.Workspace()
    Blockly.serialization.workspaces.load(
      {
        blocks: {
          languageVersion: 0,
          blocks: [
            {
              type: show.type,
              id: 's',
              inputs: { OBJ: { block: { type: ctor.type, id: 'c' } } }
            }
          ]
        }
      } as never,
      ws
    )
    const code = generateProgram(ws).code
    expect(code).toContain('import ssd1306')
    expect(code).toContain('.show()')
  })
})
