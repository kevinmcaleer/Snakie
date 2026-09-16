import { describe, it, expect } from 'vitest'
import {
  blocksSiblingName,
  blocksSiblingPath,
  countPythonLines,
  graduationMessage,
  planGraduation
} from '../src/renderer/src/lib/blocks/graduate'
import { hasBlocksFooter, stripBlocksFooter, writeBlocksFooter } from '../src/shared/blocks-doc'

/**
 * GRADUATING TO PYTHON (#1016, epic #1007).
 * =============================================================================
 *
 * The step the whole epic is built around, so the thing under test is not the
 * footer strip — that is one line — but everything that makes the step SAFE:
 * where the blocks go, what the file is called, and what the learner is told.
 */

const doc = (code: string): string =>
  writeBlocksFooter(code, { blocks: { languageVersion: 0, blocks: [] } })

describe('keeping the blocks (#1016)', () => {
  it('names the sibling after the file', () => {
    expect(blocksSiblingName('square.py')).toBe('square.blocks.py')
    expect(blocksSiblingName('my robot.py')).toBe('my robot.blocks.py')
  })

  it('does not stack the suffix on a file that already has it', () => {
    // A `.blocks.py` opens, edits and graduates like any other blocks file, and
    // `square.blocks.blocks.py` is a name nobody would choose.
    expect(blocksSiblingName('square.blocks.py')).toBe('square.blocks.py')
  })

  it('keeps the sibling in the same folder, on either separator', () => {
    expect(blocksSiblingPath('/home/kev/Projects/square.py')).toBe(
      '/home/kev/Projects/square.blocks.py'
    )
    expect(blocksSiblingPath('C:\\Users\\kev\\square.py')).toBe('C:\\Users\\kev\\square.blocks.py')
    expect(blocksSiblingPath('square.py')).toBe('square.blocks.py')
  })
})

describe('the plan (#1016)', () => {
  const code = ['import turtle', '', 'for _ in range(4):', '    turtle.forward(100)'].join('\n')

  it('keeps the Python and the whole blocks file', () => {
    const plan = planGraduation(
      { name: 'square.py', path: '/p/square.py', content: doc(code) },
      stripBlocksFooter,
      hasBlocksFooter
    )!
    // A trailing newline, because what lands in the buffer is a `.py` file and
    // a text file ends with one.
    expect(plan.python).toBe(`${code}\n`)
    // The blocks kept are the file EXACTLY as it was — footer and all — so the
    // sibling opens on the canvas the way the original did.
    expect(hasBlocksFooter(plan.blocksContent)).toBe(true)
    expect(plan.blocksPath).toBe('/p/square.blocks.py')
  })

  it('has nowhere to put the sibling for a buffer never saved', () => {
    // It becomes a second unsaved buffer instead. Silently choosing a folder for
    // someone is worse than two unsaved tabs.
    const plan = planGraduation(
      { name: 'untitled.py', path: '', content: doc(code) },
      stripBlocksFooter,
      hasBlocksFooter
    )!
    expect(plan.blocksPath).toBeNull()
    expect(plan.blocksName).toBe('untitled.blocks.py')
  })

  it('refuses a file that is already Python', () => {
    // No footer means no blocks, and a `.blocks.py` sibling holding none would
    // be a file that lies about what it is.
    expect(planGraduation({ name: 'a.py', path: '/a.py', content: code }, stripBlocksFooter, hasBlocksFooter)).toBeNull()
  })
})

describe('what the learner is told (#1016)', () => {
  it('counts the lines they can actually point at', () => {
    // The generator puts blank lines between its sections; counting those would
    // inflate the number the celebration rests on.
    expect(countPythonLines('import turtle\n\nturtle.home()\n')).toBe(2)
    expect(countPythonLines('')).toBe(0)
  })

  it('celebrates rather than warns', () => {
    const plan = planGraduation(
      { name: 'x.py', path: '/x.py', content: doc('print(1)\nprint(2)') },
      stripBlocksFooter,
      hasBlocksFooter
    )!
    expect(graduationMessage(plan)).toBe('You wrote 2 lines of Python.')
  })

  it('gets the singular right', () => {
    const plan = planGraduation(
      { name: 'x.py', path: '/x.py', content: doc('print(1)') },
      stripBlocksFooter,
      hasBlocksFooter
    )!
    expect(graduationMessage(plan)).toBe('You wrote 1 line of Python.')
  })
})
