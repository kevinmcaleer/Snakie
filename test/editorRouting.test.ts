import { describe, it, expect } from 'vitest'
import { showsBlocksCanvas } from '../src/renderer/src/components/editor-routing'

/**
 * WHERE THE BLOCK SHELF IS ALLOWED TO APPEAR (#1066).
 * =============================================================================
 *
 * Reported as "the blocks shelf is appearing in the Build workspace", and it
 * was: Build's preset collapses the centre column to nothing so the URDF editor
 * can have the screen, the canvas stayed mounted in that zero-width column, and
 * Blockly's toolbox takes no hint from a host with no width. The shelf painted
 * itself over Build's robot tree and its Export buttons.
 */

const blocksFile = { name: 'square.py', isBlocks: true }
const plainPy = { name: 'main.py' }

describe('the workspaces that show a canvas', () => {
  it('Blocks and Code do', () => {
    expect(showsBlocksCanvas('blocks', blocksFile)).toBe(true)
    // Code shows the canvas only in the split (the switcher's dot).
    expect(showsBlocksCanvas('code', blocksFile, true)).toBe(true)
  })

  it('Build and Electronics do NOT, whatever the file is', () => {
    // Both collapse the centre column; neither is about the program.
    expect(showsBlocksCanvas('robot', blocksFile)).toBe(false)
    expect(showsBlocksCanvas('board', blocksFile)).toBe(false)
    expect(showsBlocksCanvas('robot', plainPy)).toBe(false)
    expect(showsBlocksCanvas('board', plainPy)).toBe(false)
  })
})

describe('the files that are blocks files', () => {
  it('a footer no longer changes Code: every .py opens in the code editor', () => {
    // Every file is MicroPython; the footer only remembers where blocks sat.
    expect(showsBlocksCanvas('code', blocksFile)).toBe(false)
    expect(showsBlocksCanvas('code', plainPy)).toBe(false)
  })

  it('the dot (both) brings the canvas into Code for any .py', () => {
    expect(showsBlocksCanvas('code', blocksFile, true)).toBe(true)
    expect(showsBlocksCanvas('code', plainPy, true)).toBe(true)
    expect(showsBlocksCanvas('code', { name: 'data.csv' }, true)).toBe(false)
  })

  it('any .py at all is one in the Blocks workspace (#1034)', () => {
    // Pressing Blocks on a file Snakie did not write shows you blocks, rather
    // than appearing to ignore you.
    expect(showsBlocksCanvas('blocks', plainPy)).toBe(true)
    expect(showsBlocksCanvas('blocks', { name: 'MAIN.PY' })).toBe(true)
  })

  it('but a plain .py in Code is just code', () => {
    // Code is where text lives.
    expect(showsBlocksCanvas('code', plainPy)).toBe(false)
  })

  it('a non-Python file is never one', () => {
    expect(showsBlocksCanvas('blocks', { name: 'robot.urdf' })).toBe(false)
    expect(showsBlocksCanvas('blocks', { name: 'data.csv' })).toBe(false)
  })

  it('no file open is no canvas', () => {
    expect(showsBlocksCanvas('blocks', null)).toBe(false)
  })
})
