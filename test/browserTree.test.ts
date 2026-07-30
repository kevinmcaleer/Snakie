import { describe, expect, it } from 'vitest'
import { BOARD_KEY, browserTree, countNodes } from '../src/renderer/src/components/browser-tree'
import type { RobotPart } from '../src/shared/robot'

/**
 * Project-browser hierarchy (#649). The interesting cases are the degenerate ones:
 * a dangling `mountedOn` must not make a part disappear from the browser, and a
 * cycle must not hang the renderer.
 */

const part = (id: string, over?: Partial<RobotPart>): RobotPart => ({
  id,
  lib: 'snakie-standard',
  part: id,
  ...over
})

describe('browserTree', () => {
  it('keeps a flat project flat, board first', () => {
    const tree = browserTree({ board: 'Pico', parts: [part('a'), part('b')] })
    expect(tree.map((n) => n.key)).toEqual([BOARD_KEY, 'a', 'b'])
    expect(tree.every((n) => n.children.length === 0)).toBe(true)
  })

  it('nests a docked part under its carrier', () => {
    const tree = browserTree({
      parts: [part('base'), part('servo1', { mountedOn: 'base' })]
    })
    expect(tree.map((n) => n.key)).toEqual(['base'])
    expect(tree[0].children.map((n) => n.key)).toEqual(['servo1'])
  })

  it('nests the MCU under the carrier it is seated in', () => {
    // The XIAO-in-an-expansion-base case: the microcontroller is the CHILD.
    const tree = browserTree({
      board: 'XIAO RP2350',
      boardMountedOn: 'base1',
      parts: [part('base1', { label: 'XIAO Expansion Base' })]
    })
    expect(tree.map((n) => n.label)).toEqual(['XIAO Expansion Base'])
    expect(tree[0].children.map((n) => n.label)).toEqual(['XIAO RP2350'])
    expect(tree[0].children[0].isBoard).toBe(true)
  })

  it('nests more than one level deep', () => {
    const tree = browserTree({
      parts: [part('a'), part('b', { mountedOn: 'a' }), part('c', { mountedOn: 'b' })]
    })
    expect(tree[0].children[0].children.map((n) => n.key)).toEqual(['c'])
  })

  it('prefers a part label over the library part id', () => {
    const tree = browserTree({ parts: [part('p1', { label: 'Left wheel', part: 'n20-motor' })] })
    expect(tree[0].label).toBe('Left wheel')
    const bare = browserTree({ parts: [part('p1', { part: 'n20-motor' })] })
    expect(bare[0].label).toBe('n20-motor')
  })

  it('keeps a part whose carrier does not exist at the top level', () => {
    // A dangling reference (the carrier was deleted) must not hide the part —
    // it would be un-selectable and un-deletable from the browser.
    const tree = browserTree({ parts: [part('orphan', { mountedOn: 'gone' })] })
    expect(tree.map((n) => n.key)).toEqual(['orphan'])
  })

  it('ignores a part mounted on itself', () => {
    const tree = browserTree({ parts: [part('self', { mountedOn: 'self' })] })
    expect(tree.map((n) => n.key)).toEqual(['self'])
    expect(tree[0].children).toEqual([])
  })

  it('survives a two-part cycle without recursing', () => {
    const tree = browserTree({
      parts: [part('a', { mountedOn: 'b' }), part('b', { mountedOn: 'a' })]
    })
    // Both stay at the top level; neither is lost and nothing hangs.
    expect(tree.map((n) => n.key).sort()).toEqual(['a', 'b'])
    expect(countNodes(tree)).toBe(2)
  })

  it('survives a longer cycle', () => {
    const tree = browserTree({
      parts: [
        part('a', { mountedOn: 'c' }),
        part('b', { mountedOn: 'a' }),
        part('c', { mountedOn: 'b' })
      ]
    })
    expect(countNodes(tree)).toBe(3)
  })

  it('loses nothing: every row appears exactly once', () => {
    const parts = [
      part('base'),
      part('mcuish', { mountedOn: 'base' }),
      part('loose'),
      part('orphan', { mountedOn: 'nope' })
    ]
    const tree = browserTree({ board: 'Pico', boardMountedOn: 'base', parts })
    expect(countNodes(tree)).toBe(parts.length + 1)
    const keys: string[] = []
    const walk = (ns: typeof tree): void => {
      for (const n of ns) {
        keys.push(n.key)
        walk(n.children)
      }
    }
    walk(tree)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('omits the board row when no board is chosen', () => {
    const tree = browserTree({ parts: [part('a')] })
    expect(tree.some((n) => n.isBoard)).toBe(false)
  })

  it('ignores boardMountedOn when it names a missing part', () => {
    const tree = browserTree({ board: 'Pico', boardMountedOn: 'gone', parts: [] })
    expect(tree.map((n) => n.key)).toEqual([BOARD_KEY])
  })
})

describe('countNodes', () => {
  it('counts every depth, not just the roots', () => {
    const tree = browserTree({
      parts: [part('a'), part('b', { mountedOn: 'a' }), part('c', { mountedOn: 'b' })]
    })
    expect(tree).toHaveLength(1)
    expect(countNodes(tree)).toBe(3)
  })
})
