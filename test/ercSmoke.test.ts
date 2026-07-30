import { describe, expect, it } from 'vitest'
import { smokeSites, type ErcIssue } from '../src/shared/erc'
import type { Netlist } from '../src/shared/netlist'

const issue = (over: Partial<ErcIssue>): ErcIssue => ({
  rule: 'r',
  severity: 'error',
  title: 't',
  message: 'm',
  why: 'w',
  ...over
})

/** A shorted node: the board's 3V3 tied to a servo's GND. */
const netlist = {
  nodes: [
    {
      id: 'N3',
      kind: 'ground',
      terminals: [
        { endpoint: 'board.3V3#1', key: 'board', index: 1, name: '3V3', role: 'pwr' },
        { endpoint: 'servo1.GND#2', key: 'servo1', index: 2, name: 'GND', role: 'gnd' }
      ]
    },
    {
      id: 'N7',
      kind: 'power',
      terminals: [{ endpoint: 'led2.A#0', key: 'led2', index: 0, name: 'A', role: 'pwr' }]
    }
  ]
} as unknown as Netlist

describe('smokeSites (#618)', () => {
  it('smokes the PINS that are shorted, not the middle of the part', () => {
    // The fault has a location. Smoke at the body centre points at the component
    // rather than at the mistake.
    expect(smokeSites([issue({ rule: 'vcc-gnd-short', nodes: ['N3'] })], netlist)).toEqual([
      { key: 'board', index: 1 },
      { key: 'servo1', index: 2 }
    ])
  })

  it('gives a plume per node when several things are shorted', () => {
    const out = smokeSites([issue({ nodes: ['N3'] }), issue({ nodes: ['N7'] })], netlist)
    expect(out).toHaveLength(3)
    expect(out).toContainEqual({ key: 'led2', index: 0 })
  })

  it('ignores warnings and infos', () => {
    // Smoke has to mean "you destroyed something", or it stops meaning anything.
    expect(
      smokeSites(
        [
          issue({ severity: 'warning', nodes: ['N3'] }),
          issue({ severity: 'info', parts: ['a'] })
        ],
        netlist
      )
    ).toEqual([])
  })

  it('dedupes a pin implicated by several errors', () => {
    const out = smokeSites([issue({ nodes: ['N3'] }), issue({ nodes: ['N3'] })], netlist)
    expect(out).toHaveLength(2)
  })

  it('falls back to the body when an issue names a part but no node', () => {
    expect(smokeSites([issue({ parts: ['servo1'] })], netlist)).toEqual([
      { key: 'servo1', index: -1 }
    ])
  })

  it('prefers the pin over the body when an issue gives both', () => {
    // Otherwise one issue would smoke the same part twice, once precisely and
    // once vaguely.
    const out = smokeSites([issue({ nodes: ['N3'], parts: ['servo1'] })], netlist)
    expect(out).toContainEqual({ key: 'servo1', index: 2 })
    expect(out).not.toContainEqual({ key: 'servo1', index: -1 })
  })

  it('keeps first-implicated order, so plumes do not reshuffle', () => {
    const before = smokeSites([issue({ nodes: ['N3'] })], netlist)
    const after = smokeSites(
      [issue({ nodes: ['N3'] }), issue({ severity: 'warning', nodes: ['N7'] })],
      netlist
    )
    expect(after).toEqual(before)
  })

  it('tolerates unknown nodes, missing netlist and empty input', () => {
    expect(smokeSites([issue({ nodes: ['N99'] })], netlist)).toEqual([])
    expect(smokeSites([issue({ nodes: ['N3'] })])).toEqual([])
    expect(smokeSites([])).toEqual([])
  })
})
