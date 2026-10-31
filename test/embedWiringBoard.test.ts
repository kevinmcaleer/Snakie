import { describe, expect, it } from 'vitest'
import { withBoard } from '../src/renderer/src/embed/wiring-board'
import type { RobotDefinition } from '../src/shared/robot'

const wired: RobotDefinition = {
  board: 'pico2w',
  parts: [
    { id: 'led', lib: 'kevsrobots', part: 'led' },
    { id: 'btn', lib: 'kevsrobots', part: 'button' }
  ],
  connections: [
    { id: 'w1', from: 'board.3V3#36', to: 'led.A#0' },
    { id: 'w2', from: 'led.K#1', to: 'btn.1#0' },
    { id: 'w3', from: 'btn.2#1', to: 'board.GND#38' }
  ]
}

describe('withBoard', () => {
  it('takes the board away with the wires on its pins', () => {
    const next = withBoard(wired, null)
    expect(next.board).toBeUndefined()
    expect('board' in next).toBe(false)
    expect(next.connections.map((c) => c.id)).toEqual(['w2'])
    expect(next.parts).toBe(wired.parts)
  })

  it('swaps the board, dropping the old board’s wires', () => {
    const next = withBoard(wired, 'xiao-rp2040')
    expect(next.board).toBe('xiao-rp2040')
    expect(next.connections.map((c) => c.id)).toEqual(['w2'])
  })

  it('adds a board to a wiring without one and keeps every wire', () => {
    const bare: RobotDefinition = { parts: wired.parts, connections: [wired.connections[1]] }
    const next = withBoard(bare, 'pico2w')
    expect(next.board).toBe('pico2w')
    expect(next.connections).toEqual(bare.connections)
  })

  it('returns the same wiring when nothing changes', () => {
    expect(withBoard(wired, 'pico2w')).toBe(wired)
    const bare: RobotDefinition = { parts: [], connections: [] }
    expect(withBoard(bare, null)).toBe(bare)
    expect(withBoard(bare, '')).toBe(bare)
  })
})
