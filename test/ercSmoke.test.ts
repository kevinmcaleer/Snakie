import { describe, expect, it } from 'vitest'
import { smokingParts, type ErcIssue } from '../src/shared/erc'
import type { Netlist } from '../src/shared/netlist'

const issue = (over: Partial<ErcIssue>): ErcIssue => ({
  rule: 'r',
  severity: 'error',
  title: 't',
  message: 'm',
  why: 'w',
  ...over
})

describe('smokingParts (#618)', () => {
  it('picks the parts an error implicates', () => {
    expect(smokingParts([issue({ parts: ['servo1', 'led2'] })])).toEqual(['servo1', 'led2'])
  })

  it('ignores warnings and infos', () => {
    // Smoke has to mean "you destroyed something". A warning that smokes is a
    // warning nobody believes.
    expect(
      smokingParts([
        issue({ severity: 'warning', parts: ['a'] }),
        issue({ severity: 'info', parts: ['b'] })
      ])
    ).toEqual([])
  })

  it('dedupes a part implicated by several errors', () => {
    expect(
      smokingParts([issue({ parts: ['a', 'b'] }), issue({ parts: ['b', 'c'] })])
    ).toEqual(['a', 'b', 'c'])
  })

  it('keeps first-implicated order, so the animation does not reshuffle', () => {
    const before = smokingParts([issue({ parts: ['x'] }), issue({ parts: ['y'] })])
    const after = smokingParts([
      issue({ parts: ['x'] }),
      issue({ severity: 'warning', parts: ['w'] }),
      issue({ parts: ['y'] })
    ])
    expect(after).toEqual(before)
  })

  it('tolerates issues with no parts, and empty input', () => {
    expect(smokingParts([issue({}), issue({ parts: [] })])).toEqual([])
    expect(smokingParts([])).toEqual([])
  })

  it('skips empty part keys rather than smoking nowhere', () => {
    expect(smokingParts([issue({ parts: ['', 'real'] })])).toEqual(['real'])
  })
})

describe('smokingParts resolves node-located faults (#618)', () => {
  // The rules that matter most locate by NODE, not part: neither `vcc-gnd-short`
  // nor `rail-conflict` populates `parts`. Without this resolution the feature
  // would light nothing for exactly the faults worth showing.
  const netlist = {
    nodes: [
      {
        id: 'N3',
        kind: 'ground',
        terminals: [
          { endpoint: 'board.3V3#1', key: 'board', index: 1, name: '3V3', role: 'pwr' },
          { endpoint: 'servo1.GND#2', key: 'servo1', index: 2, name: 'GND', role: 'gnd' }
        ]
      }
    ]
  } as unknown as Netlist

  it('smokes every subject on a shorted node', () => {
    const out = smokingParts([issue({ rule: 'vcc-gnd-short', nodes: ['N3'] })], netlist)
    expect(out).toEqual(['board', 'servo1'])
  })

  it('includes the board — shorting its rail is its problem', () => {
    expect(smokingParts([issue({ nodes: ['N3'] })], netlist)).toContain('board')
  })

  it('merges part- and node-located issues without duplicates', () => {
    const out = smokingParts(
      [issue({ parts: ['servo1'] }), issue({ nodes: ['N3'] })],
      netlist
    )
    expect(out).toEqual(['servo1', 'board'])
  })

  it('ignores an unknown node id rather than throwing', () => {
    expect(smokingParts([issue({ nodes: ['N99'] })], netlist)).toEqual([])
  })

  it('still works with no netlist supplied', () => {
    expect(smokingParts([issue({ parts: ['a'], nodes: ['N3'] })])).toEqual(['a'])
  })
})
