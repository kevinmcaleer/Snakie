import { describe, it, expect, beforeEach } from 'vitest'
import * as Blockly from 'blockly/core'
import 'blockly/blocks'
import { installBlockDefinitions, resetBlockRegistry } from '../src/renderer/src/lib/blocks/registry'
import { installCorePalette } from '../src/renderer/src/lib/blocks/palette'
import { pythonToBlocks } from '../src/renderer/src/lib/blocks/python-to-blocks'

/**
 * IDENTITY-STABLE RECONVERSION (#1036, epic #1007).
 * =============================================================================
 *
 * #1034 reconverts the code back into blocks every time the learner pauses
 * typing. Before this, the conversion emitted no ids, so Blockly minted fresh
 * random ones on every load and the canvas had no identity from one pause to
 * the next — #1016's hover link dropped its block, #1015's traceback anchors
 * pointed at blocks that no longer existed, and anything dragged aside went
 * back to the layout grid.
 *
 * The fix is an id derived from WHERE A BLOCK IS, so this suite is about one
 * question asked several ways: **after an edit, which ids are still the same?**
 */

beforeEach(() => {
  resetBlockRegistry()
  installCorePalette()
  installBlockDefinitions()
})

const PROGRAM = [
  'import time',
  '',
  'while True:',
  "    print('hi')",
  '    time.sleep(1)',
  '    time.sleep(2)',
  ''
].join('\n')

/** Convert, load into a real workspace, and report `id → type`. */
function loaded(source: string): Map<string, string> {
  const { workspace } = pythonToBlocks(source)
  const ws = new Blockly.Workspace()
  Blockly.serialization.workspaces.load(workspace as never, ws)
  const out = new Map<string, string>()
  for (const block of ws.getAllBlocks(false)) out.set(block.id, block.type)
  return out
}

const idsOf = (source: string): string[] => [...loaded(source).keys()].sort()

describe('a converted block knows where it is (#1036)', () => {
  it('every block has an id, and it reads as a position', () => {
    const ids = loaded(PROGRAM)
    // `r0` is the first root; `.1` its second statement; `:DO.1` the second
    // statement inside that one's body.
    expect(ids.get('r0.0')).toBe('snakie_python_import')
    expect(ids.get('r0.1')).toBe('snakie_forever')
    expect(ids.get('r0.1:DO.0')).toBe('text_print')
    expect(ids.get('r0.1:DO.1')).toBe('snakie_wait_seconds')
    expect(ids.get('r0.1:DO.2')).toBe('snakie_wait_seconds')
  })

  it('Blockly keeps the ids rather than minting its own', () => {
    // The whole scheme rests on this: `serialization.workspaces.load` honours a
    // supplied id. If a Blockly upgrade ever stopped doing that, everything
    // below would still pass while the feature silently did nothing.
    for (const id of idsOf(PROGRAM)) expect(id).toMatch(/^r\d/)
  })

  it('converting the same program twice gives the same ids', () => {
    expect(idsOf(PROGRAM)).toEqual(idsOf(PROGRAM))
  })

  it('nested sockets get ids too, so a shadow cannot churn', () => {
    // `lastLoadedRef` in the canvas compares a re-serialised workspace against
    // the one it pushed in; a random shadow id would make that never match.
    const ids = loaded(PROGRAM)
    expect(ids.get('r0.1:DO.1:SECS.0')).toBe('math_number')
  })
})

describe('what an edit does to the ids (#1036)', () => {
  it('editing a field changes NOTHING — the point of the whole issue', () => {
    // A learner changing `1` to `5` is the commonest edit there is, and it used
    // to rebuild every block on the canvas with a new identity.
    const after = PROGRAM.replace('time.sleep(1)', 'time.sleep(5)')
    expect(idsOf(after)).toEqual(idsOf(PROGRAM))
  })

  it('appending a line leaves every earlier id alone', () => {
    const after = PROGRAM.replace('    time.sleep(2)\n', "    time.sleep(2)\n    print('bye')\n")
    for (const id of idsOf(PROGRAM)) expect(idsOf(after)).toContain(id)
  })

  it('retyping a statement keeps its id, because it is still that statement', () => {
    // The type is deliberately NOT in the key: the learner changed what the
    // third statement is, not which statement it is, and the hover and the
    // traceback should follow it there.
    const after = PROGRAM.replace('    time.sleep(1)\n', "    print('swapped')\n")
    expect(idsOf(after)).toContain('r0.1:DO.1')
    expect(loaded(after).get('r0.1:DO.1')).toBe('text_print')
  })

  it('editing inside a loop does not disturb the statement above it', () => {
    const after = PROGRAM.replace("print('hi')", "print('hello')")
    expect(idsOf(after)).toContain('r0.0')
    expect(idsOf(after)).toContain('r0.1')
  })

  it('a def is a root of its own, and stays one', () => {
    const withDef = ['def wiggle():', "    print('x')", '', 'wiggle()', ''].join('\n')
    const ids = loaded(withDef)
    expect(ids.get('r0.0')).toBe('procedures_defnoreturn')
    // The call is a separate root, below the definition.
    expect([...ids.keys()].some((id) => id.startsWith('r1'))).toBe(true)
  })
})

describe('the round trip still holds with ids attached (#1019)', () => {
  it('convert → generate gives back the program', () => {
    const { workspace } = pythonToBlocks(PROGRAM)
    const ws = new Blockly.Workspace()
    Blockly.serialization.workspaces.load(workspace as never, ws)
    // Imported here rather than at the top so this file reads as the identity
    // suite it is, with the property check as the closing guard.
    return import('../src/renderer/src/lib/blocks/generator').then(({ generateProgram }) => {
      expect(generateProgram(ws).code).toBe(PROGRAM)
    })
  })
})
