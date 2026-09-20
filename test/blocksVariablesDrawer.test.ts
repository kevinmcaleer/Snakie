import { describe, it, expect, beforeEach } from 'vitest'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import {
  installBlockDefinitions,
  resetBlockRegistry
} from '../src/renderer/src/lib/blocks/registry'
import {
  FUNCTIONS_CATEGORY_CALLBACK,
  buildToolbox,
  VARIABLES_CATEGORY_CALLBACK
} from '../src/renderer/src/lib/blocks/toolbox'
import {
  CREATE_VARIABLE_BUTTON,
  variablesFlyout
} from '../src/renderer/src/lib/blocks/variables-drawer'

/**
 * THE VARIABLES DRAWER (#1117, epic #1007).
 * =============================================================================
 *
 * The shelf held three nameless blocks however many variables a learner had
 * made: `score`, `lives` and `speed` all lived inside one dropdown on one `set`
 * block, and there was nothing anywhere that said "make a variable".
 *
 * So this suite is about the two halves of that: every variable is ON the shelf,
 * with its own block, and the way to create one is a button rather than a piece
 * of folklore about renaming the variable inside a set block.
 */

beforeEach(() => {
  resetBlockRegistry()
  installCorePalette()
  installBlockDefinitions()
})

/** A workspace carrying the named variables. */
function withVariables(...names: string[]): Blockly.Workspace {
  const ws = new Blockly.Workspace()
  for (const name of names) ws.getVariableMap().createVariable(name)
  return ws
}

/** The `type` of every block entry in a flyout. */
const types = (items: Record<string, unknown>[]): string[] =>
  items.filter((i) => i.kind === 'block').map((i) => String(i.type))

/** The variable each entry of `type` is bound to, in order. */
const boundTo = (items: Record<string, unknown>[], type: string): string[] =>
  items
    .filter((i) => i.type === type)
    .map((i) => String((i.fields as { VAR?: { name?: string } })?.VAR?.name))

describe('every variable the learner made is on the shelf (#1117)', () => {
  it('offers one getter per variable, named', () => {
    const items = variablesFlyout(withVariables('score', 'lives', 'speed'))
    expect(boundTo(items, 'variables_get')).toEqual(['lives', 'score', 'speed'])
  })

  it('sorts them by name, so a long list is readable', () => {
    const items = variablesFlyout(withVariables('zebra', 'Apple', 'mango'))
    expect(boundTo(items, 'variables_get')).toEqual(['Apple', 'mango', 'zebra'])
  })

  it('offers set and change on the newest variable — the one just made', () => {
    const items = variablesFlyout(withVariables('score', 'lives'))
    expect(boundTo(items, 'variables_set')).toEqual(['lives'])
    expect(boundTo(items, 'math_change')).toEqual(['lives'])
  })

  it('binds `global` to that variable too, rather than a name nobody made', () => {
    // It carries a variable field (#1118), so an unbound copy would put its own
    // default on the learner's shelf the moment they dragged it out.
    const items = variablesFlyout(withVariables('score', 'lives'))
    expect(boundTo(items, 'snakie_global')).toEqual(['lives'])
    expect(types(items).filter((t) => t === 'snakie_global')).toHaveLength(1)
  })

  it('keeps the registry shadows, so a dragged set block arrives holding a 0', () => {
    const items = variablesFlyout(withVariables('score'))
    const set = items.find((i) => i.type === 'variables_set')
    expect(set?.inputs).toEqual({ VALUE: { shadow: { type: 'math_number', fields: { NUM: 0 } } } })
    const change = items.find((i) => i.type === 'math_change')
    expect(change?.inputs).toEqual({
      DELTA: { shadow: { type: 'math_number', fields: { NUM: 1 } } }
    })
  })

  it('never lists the same shape twice — the nameless originals stand down', () => {
    const listed = types(variablesFlyout(withVariables('score', 'lives')))
    expect(listed.filter((t) => t === 'variables_set')).toHaveLength(1)
    expect(listed.filter((t) => t === 'math_change')).toHaveLength(1)
    // One getter per variable and not one more.
    expect(listed.filter((t) => t === 'variables_get')).toHaveLength(2)
  })

  it('a variable created but never used is still on the shelf', () => {
    // The button makes a variable no block refers to yet. `allUsedVarModels`
    // would miss it, which would make the button look like it did nothing.
    const ws = new Blockly.Workspace()
    ws.getVariableMap().createVariable('treasure')
    expect(boundTo(variablesFlyout(ws), 'variables_get')).toEqual(['treasure'])
  })
})

describe('creating a variable is a button, not folklore (#1117)', () => {
  it('the drawer opens with one', () => {
    const [first] = variablesFlyout(withVariables('score'))
    expect(first).toEqual({
      kind: 'button',
      text: '%{BKY_NEW_VARIABLE}',
      callbackkey: CREATE_VARIABLE_BUTTON
    })
  })

  it('and it is there before there are any variables — that is when it matters', () => {
    expect(variablesFlyout(new Blockly.Workspace())[0]).toMatchObject({ kind: 'button' })
  })

  it('the button text is a message reference, so it follows the app language', () => {
    // A literal string here would be English in a Welsh classroom; `locale.ts`
    // loads Blockly's own translations and this resolves through them.
    expect(Blockly.Msg['NEW_VARIABLE']).toBeTruthy()
  })
})

describe('an empty drawer still teaches the shape (#1117)', () => {
  it('shows set, change and get before any variable exists', () => {
    // Blockly's own drawer shows the button and NOTHING else here, which is the
    // empty shelf that sent people hunting through a dropdown to begin with.
    const listed = types(variablesFlyout(new Blockly.Workspace()))
    expect(listed).toContain('variables_set')
    expect(listed).toContain('math_change')
    expect(listed).toContain('variables_get')
  })

  it('and those blocks carry no variable — Blockly names one when they land', () => {
    const set = variablesFlyout(new Blockly.Workspace()).find((i) => i.type === 'variables_set')
    expect(set?.fields).toBeUndefined()
  })
})

describe('the drawer is wired to the category (#1117)', () => {
  it('Variables is a custom category rather than a static list', () => {
    const toolbox = buildToolbox('micropython') as {
      contents: { name: string; custom?: string; contents?: unknown[] }[]
    }
    const variables = toolbox.contents.find((c) => c.name === 'Variables')
    expect(variables?.custom).toBe(VARIABLES_CATEGORY_CALLBACK)
    expect(variables?.contents).toBeUndefined()
  })

  it('and Functions has one of its own (#1220 — ours now, wrapping Blockly’s)', () => {
    const toolbox = buildToolbox('micropython') as { contents: { name: string; custom?: string }[] }
    expect(toolbox.contents.find((c) => c.name === 'Functions')?.custom).toBe(
      FUNCTIONS_CATEGORY_CALLBACK
    )
  })

  it('every other category is still the curated list', () => {
    const toolbox = buildToolbox('micropython') as {
      contents: { name: string; custom?: string; contents?: unknown[] }[]
    }
    for (const category of toolbox.contents) {
      if (category.name === 'Variables' || category.name === 'Functions') continue
      expect(category.custom).toBeUndefined()
      expect(Array.isArray(category.contents)).toBe(true)
    }
  })
})

describe('the blocks the drawer hands out still generate Python (#1117)', () => {
  it('a getter built the way the drawer builds one carries the variable', () => {
    const ws = withVariables('score')
    const entry = variablesFlyout(ws).find((i) => i.type === 'variables_get')
    const block = Blockly.serialization.blocks.append(
      { type: 'variables_get', fields: entry?.fields } as never,
      ws
    )
    expect(block.getFieldValue('VAR')).toBe(ws.getVariableMap().getVariable('score')?.getId())
  })
})
