import { describe, it, expect } from 'vitest'
import {
  collectBlockTypes,
  unknownBlockTypes
} from '../src/renderer/src/lib/blocks/workspace-check'

/**
 * The guard that stands between "I can't show your program" and "I deleted your
 * program" (#1009).
 *
 * Before this existed, a file carrying block types this build doesn't have
 * cleared the canvas on load — and the next change event serialised that EMPTY
 * workspace back over the file. Verified in a browser: opening such a file and
 * pressing Save replaced its workspace with whatever happened to be on screen.
 * So the walk has to find EVERY type, including the ones nested where nobody
 * looked.
 */
describe('collectBlockTypes (#1009)', () => {
  it('finds a top-level block', () => {
    expect(collectBlockTypes({ blocks: { blocks: [{ type: 'a' }] } })).toEqual(['a'])
  })

  it('follows a next-chain', () => {
    expect(
      collectBlockTypes({ blocks: { blocks: [{ type: 'a', next: { block: { type: 'b' } } }] } })
    ).toEqual(['a', 'b'])
  })

  it('follows inputs, shadows and nested statement bodies', () => {
    const ws = {
      blocks: {
        blocks: [
          {
            type: 'repeat',
            inputs: {
              TIMES: { shadow: { type: 'math_number' } },
              DO: { block: { type: 'move', next: { block: { type: 'turn' } } } }
            }
          }
        ]
      }
    }
    expect(collectBlockTypes(ws).sort()).toEqual(['math_number', 'move', 'repeat', 'turn'])
  })

  it('walks shapes it has never seen — the schema grows every release', () => {
    // A walker that knew Blockly's schema would miss the branch added last
    // year, and missing one is how a block gets deleted.
    expect(collectBlockTypes({ some: { future: [{ nesting: { type: 'z' } }] } })).toEqual(['z'])
  })

  it('deduplicates, and survives the empty and the absurd', () => {
    expect(collectBlockTypes({ a: { type: 'x' }, b: { type: 'x' } })).toEqual(['x'])
    expect(collectBlockTypes({})).toEqual([])
    expect(collectBlockTypes(null)).toEqual([])
    expect(collectBlockTypes([1, 'two', true])).toEqual([])
  })

  it('ignores a non-string `type` rather than reporting a bogus block', () => {
    expect(collectBlockTypes({ type: 42, inner: { type: 'real' } })).toEqual(['real'])
  })
})

describe('unknownBlockTypes (#1009)', () => {
  const known = (set: string[]) => (t: string): boolean => set.includes(t)

  it('names exactly what this build cannot render', () => {
    const ws = { blocks: { blocks: [{ type: 'known', next: { block: { type: 'from_a_plugin' } } }] } }
    expect(unknownBlockTypes(ws, known(['known']))).toEqual(['from_a_plugin'])
  })

  it('is empty for a workspace we can read — the canvas mounts', () => {
    const ws = { blocks: { blocks: [{ type: 'known' }] } }
    expect(unknownBlockTypes(ws, known(['known']))).toEqual([])
  })

  it('is empty for an empty workspace, so a new file opens normally', () => {
    expect(unknownBlockTypes({ blocks: { languageVersion: 0, blocks: [] } }, known([]))).toEqual([])
  })
})
