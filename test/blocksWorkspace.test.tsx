import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { blocksFacts } from '../src/renderer/src/store/workspace'
import { BlocksCanvasView, countBlocks } from '../src/renderer/src/components/BlocksCanvas'
import { parseBlocksFooter, writeBlocksFooter } from '../src/shared/blocks-doc'

const WS = {
  blocks: {
    languageVersion: 0,
    blocks: [
      {
        type: 'snakie_led_on',
        id: 'a'.repeat(20),
        fields: { PIN: '15' },
        next: { block: { type: 'snakie_sleep', id: 'b'.repeat(20), fields: { SECS: 0.5 } } }
      }
    ]
  }
}
const CODE = 'from snakie import Led\n\nLed(15).on()'
const BLOCKS_FILE = writeBlocksFooter(CODE, WS)

/**
 * The store's side of #1008: how a buffer's text becomes the two facts the tab
 * strip and the editor router act on. Every path that fills a buffer (open,
 * external reload, a generated buffer) goes through this one function, so one
 * suite covers all three.
 */
describe('blocksFacts — deriving isBlocks from the buffer (#1008)', () => {
  it('a blocks file is blocks, with no conflict', () => {
    expect(blocksFacts(BLOCKS_FILE)).toEqual({ isBlocks: true, blocksConflict: false })
  })

  it('an ordinary .py is not, and carries no conflict field to reason about', () => {
    expect(blocksFacts('print("hi")\n')).toEqual({ isBlocks: false })
    expect(blocksFacts('')).toEqual({ isBlocks: false })
  })

  it('hand-edited Python under an unchanged footer is blocks, in conflict', () => {
    const edited = BLOCKS_FILE.replace('Led(15).on()', 'Led(16).on()')
    expect(blocksFacts(edited)).toEqual({ isBlocks: true, blocksConflict: true })
  })

  it('a footer from a newer Snakie is NOT blocks — it opens in Monaco intact', () => {
    // Routing it to a canvas we can't populate would strand the file; Monaco
    // shows every byte and saving preserves the footer for the newer build.
    const future = BLOCKS_FILE.replace('snakie-blocks v1', 'snakie-blocks v99')
    expect(blocksFacts(future)).toEqual({ isBlocks: false })
  })

  it('a corrupt footer is NOT blocks', () => {
    const broken = BLOCKS_FILE.replace(/\n# [A-Za-z0-9+/=]{20,}/, '\n# @@@@@@@@')
    expect(blocksFacts(broken)).toEqual({ isBlocks: false })
  })
})

/**
 * Session restore (#266) persists PATHS, not content — so a blocks file
 * round-trips because reopening re-reads the file and re-derives the facts.
 * This pins that: nothing about restore needs to know blocks exist, and the
 * reopened buffer must come back as blocks.
 */
describe('session restore round-trips a blocks file (#1008)', () => {
  it('reopening the same bytes re-derives the same facts', () => {
    const first = blocksFacts(BLOCKS_FILE)
    // What a relaunch does: read the path off disk again, derive again.
    const reopened = blocksFacts(BLOCKS_FILE)
    expect(reopened).toEqual(first)
    expect(reopened.isBlocks).toBe(true)
  })

  it('and the workspace survives the trip', () => {
    expect(parseBlocksFooter(BLOCKS_FILE)!.workspace).toEqual(WS)
  })
})

describe('countBlocks (#1008)', () => {
  it('counts a next-chain', () => {
    expect(countBlocks(WS)).toBe(2)
  })

  it('counts nested inputs and shadows', () => {
    expect(
      countBlocks({ type: 'a', inputs: { X: { shadow: { type: 'b' } }, Y: { block: { type: 'c' } } } })
    ).toBe(3)
  })

  it('ignores JSON that isn\'t blocks', () => {
    expect(countBlocks({ variables: [{ name: 'n', id: 'x' }] })).toBe(0)
    expect(countBlocks(null)).toBe(0)
  })
})

describe('BlocksCanvasView (#1008)', () => {
  const doc = parseBlocksFooter(BLOCKS_FILE)!

  it('says how many blocks the file really holds', () => {
    const out = renderToStaticMarkup(
      <BlocksCanvasView name="square.py" doc={doc} conflict={false} />
    )
    expect(out).toContain('2 blocks saved in this file')
    expect(out).not.toContain('role="alert"')
  })

  it('offers the conflict choice, and says nothing has been changed', () => {
    const out = renderToStaticMarkup(
      <BlocksCanvasView name="square.py" doc={doc} conflict onKeepPython={() => {}} />
    )
    expect(out).toContain('role="alert"')
    expect(out).toContain('Nothing has been changed')
    expect(out).toContain('Keep the Python, drop the blocks')
  })

  it('does not offer a "keep the blocks" button it cannot honour yet', () => {
    // #1010 brings the generator; until then the alternative is described, not
    // offered — a button that silently does nothing is worse than the gap.
    const out = renderToStaticMarkup(
      <BlocksCanvasView name="square.py" doc={doc} conflict onKeepPython={() => {}} />
    )
    expect(out.match(/<button/g)).toHaveLength(1)
    expect(out).toContain('arrives with the generator')
  })

  it('degrades when nothing readable is open', () => {
    const out = renderToStaticMarkup(<BlocksCanvasView name={null} doc={null} conflict={false} />)
    expect(out).toContain('No blocks file is open')
  })
})
