import { beforeEach, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import { generateProgram } from '../src/renderer/src/lib/blocks/generator'
import {
  installBlockDefinitions,
  resetBlockRegistry
} from '../src/renderer/src/lib/blocks/registry'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import {
  EXTRAS_FIELD,
  extrasVisible,
  getDecorators,
  getExtras,
  hasDecorators,
  setDecorators,
  setExtras
} from '../src/renderer/src/lib/blocks/palette/functions'
import { FunctionSettingsDialog } from '../src/renderer/src/components/FunctionSettingsDialog'

/**
 * PARAMS, EXTRAS AND DECORATORS IN ONE PLACE (A4, #1218, epic #1206).
 * =============================================================================
 *
 * The extra parameters (#1134) used to be edited in a hidden row on the block
 * and the decorators (#1215) nowhere at all. Both are now written from the
 * block's right-click **Function settings…** dialog.
 *
 * What these tests hold is the part that can be got wrong silently: the
 * WRITING path the dialog uses, which has to leave the generated Python exactly
 * where the row left it — emptying the extras must put the row away, and the
 * signature must still be built from the field's value rather than from
 * anything the dialog knows.
 */

beforeEach(() => {
  resetBlockRegistry()
  installCorePalette()
  installBlockDefinitions()
})

function def(ws: Blockly.Workspace): Blockly.Block {
  const block = ws.newBlock('procedures_defnoreturn')
  block.setFieldValue('blink', 'NAME')
  return block
}

describe('the settings dialog writes what the row wrote', () => {
  it('reads the extras back out, trimmed', () => {
    const block = def(new Blockly.Workspace())
    expect(getExtras(block)).toBe('')
    block.setFieldValue('  times=3  ', EXTRAS_FIELD)
    expect(getExtras(block)).toBe('times=3')
  })

  it('shows the row when extras are set, and puts it away when they are cleared', () => {
    const block = def(new Blockly.Workspace())
    setExtras(block, 'times=3, **kwargs')
    expect(extrasVisible(block)).toBe(true)
    setExtras(block, '   ')
    expect(getExtras(block)).toBe('')
    expect(extrasVisible(block)).toBe(false)
  })

  it('drops a trailing comma, so the signature never ends in one', () => {
    const ws = new Blockly.Workspace()
    const block = def(ws)
    setExtras(block, 'times=3,')
    expect(generateProgram(ws).code).toContain('def blink(times=3):')
  })

  it('writes decorators and extras into the same def', () => {
    const ws = new Blockly.Workspace()
    const block = def(ws)
    setExtras(block, '**kwargs')
    // The dialog's other half — the list the mutation carries (#1215).
    setDecorators(block, ['micropython.native'])
    expect(getDecorators(block)).toEqual(['micropython.native'])
    expect(generateProgram(ws).code).toContain('@micropython.native\ndef blink(**kwargs):')
  })
})

describe('which blocks the dialog is offered on', () => {
  it('is the def blocks and the method block, and nothing else', () => {
    const ws = new Blockly.Workspace()
    for (const type of ['procedures_defnoreturn', 'procedures_defreturn', 'snakie_method']) {
      expect([type, hasDecorators(ws.newBlock(type))]).toEqual([type, true])
    }
    expect(hasDecorators(ws.newBlock('snakie_return'))).toBe(false)
  })
})

describe('the dialog itself', () => {
  const html = (node: Parameters<typeof renderToStaticMarkup>[0]): string =>
    renderToStaticMarkup(node)

  it('shows both sections, with what the block holds in them', () => {
    const out = html(
      <FunctionSettingsDialog
        name="blink"
        canDecorate
        canExtras
        value={{ decorators: ['micropython.native'], extras: 'times=3' }}
        onSave={() => {}}
        onClose={() => {}}
      />
    )
    expect(out).toContain('Decorators')
    expect(out).toContain('Extra parameters')
    expect(out).toContain('micropython.native')
    expect(out).toContain('times=3')
    expect(out).toContain('blink')
  })

  it('leaves out the extras section for a block that has no such row', () => {
    const out = html(
      <FunctionSettingsDialog
        name="go"
        canDecorate
        canExtras={false}
        value={{ decorators: [], extras: '' }}
        onSave={() => {}}
        onClose={() => {}}
      />
    )
    expect(out).toContain('Decorators')
    expect(out).not.toContain('Extra parameters')
    expect(out).toContain('No decorators')
  })
})
