import { describe, it, expect } from 'vitest'
import { blocksMayWrite, holdFor, type BlocksHold } from '../src/renderer/src/lib/blocks/hold'

/**
 * WHEN THE BLOCKS AND THE FILE STOP AGREEING (#1068, epic #1007).
 * =============================================================================
 *
 * Three separate silences, collapsed into one state and one rule: when the two
 * views are not the same program, the blocks do not write the file. The tests
 * that matter are about PRECEDENCE — which hold wins when two apply — since that
 * is the part whose wrong answer still looks right on screen.
 */

/** The everything-agrees baseline, so each test changes exactly one thing. */
const agreed = {
  program: { missing: [], failed: [] },
  opened: null,
  typing: null
} as const

describe('holdFor', () => {
  it('holds nothing when the two views agree', () => {
    expect(holdFor({ ...agreed })).toBeNull()
  })

  it('holds nothing before the canvas has generated anything', () => {
    expect(holdFor({ ...agreed, program: null })).toBeNull()
  })

  it('holds on a block type with no emitter, and names it', () => {
    expect(
      holdFor({ ...agreed, program: { missing: ['snakie_part_bme280_temp'], failed: [] } })
    ).toEqual({ kind: 'incomplete', types: ['snakie_part_bme280_temp'] })
  })

  it('holds on an emitter that threw, which has no type to name', () => {
    // #1068 finding 6: this used to be invisible, so the guard never fired and
    // a program short of a whole stack was written over the file.
    expect(holdFor({ ...agreed, program: { missing: [], failed: ['r0.2'] } })).toEqual({
      kind: 'incomplete',
      types: []
    })
  })

  it('holds on a file whose blocks do not write it back', () => {
    expect(holdFor({ ...agreed, opened: 'lossy' })).toEqual({
      kind: 'unfaithful',
      reason: 'lossy'
    })
  })

  it('holds while they are typing something that will not convert', () => {
    expect(holdFor({ ...agreed, typing: 'lossy' })).toEqual({ kind: 'mid-edit', reason: 'lossy' })
  })
})

describe('which hold wins', () => {
  it('puts an unusable block above a conversion that merely reads badly', () => {
    // A learner whose part came unwired needs to hear that, not a sentence about
    // conversion fidelity — and the blocks are stopped from writing either way.
    expect(
      holdFor({ ...agreed, program: { missing: ['x'], failed: [] }, opened: 'lossy' })
    ).toMatchObject({ kind: 'incomplete' })
  })

  it('puts the file it opened above the line they are typing', () => {
    expect(holdFor({ ...agreed, opened: 'unloadable', typing: 'lossy' })).toMatchObject({
      kind: 'unfaithful'
    })
  })
})

describe('blocksMayWrite', () => {
  const cases: [BlocksHold | null, boolean][] = [
    [null, true],
    // The mildest, the most common, and the only one that is not about the
    // blocks at all — it is about uncommitted text in the other pane, so
    // reaching past it to drag a block is an answer and the blocks may write.
    [{ kind: 'mid-edit', reason: 'lossy' }, true],
    [{ kind: 'incomplete', types: [] }, false],
    [{ kind: 'unfaithful', reason: 'lossy' }, false]
  ]

  for (const [hold, may] of cases) {
    it(`${may ? 'lets' : 'stops'} the blocks write under ${hold?.kind ?? 'no hold'}`, () => {
      expect(blocksMayWrite(hold)).toBe(may)
    })
  }
})
