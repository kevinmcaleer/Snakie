import { describe, expect, it } from 'vitest'
import { parseEndpoint, wiringWarnings } from '../src/renderer/src/embed/wiring-checks'
import type { PartDefinition } from '../src/shared/part'
import type { RobotDefinition } from '../src/shared/robot'

const board = {
  id: 'pico',
  name: 'Pico',
  family: 'Microcontroller',
  headers: [
    {
      edge: 'left',
      pins: [
        { name: 'GP0', type: 'io' },
        { name: 'GP1', type: 'io' },
        { name: 'GND', type: 'gnd' },
        { name: '3V3', type: 'pwr' },
        { name: 'VBUS', type: 'pwr' }
      ]
    }
  ]
} as unknown as PartDefinition
const servo = {
  id: 'sg90',
  name: 'SG90',
  headers: [
    {
      edge: 'left',
      pins: [
        { name: 'Signal', type: 'io' },
        { name: 'V+', type: 'pwr' },
        { name: 'GND', type: 'gnd' }
      ]
    }
  ]
} as unknown as PartDefinition
const libs = [{ id: 'kevsrobots', parts: [board, servo] }]
const robot = (connections: [string, string][]): RobotDefinition => ({
  board: 'pico',
  parts: [{ id: 'sg90', lib: 'kevsrobots', part: 'sg90' }],
  connections: connections.map(([from, to], i) => ({ id: `w${i}`, from, to }))
})

describe('embedded wiring checks', () => {
  it('reads endpoints', () => {
    expect(parseEndpoint('board.GP0#0')).toEqual({ owner: 'board', name: 'GP0', index: 0 })
    expect(parseEndpoint('sg90.V+')).toEqual({ owner: 'sg90', name: 'V+', index: null })
    expect(parseEndpoint('nonsense')).toBeNull()
  })

  it('is quiet for a sound servo wiring', () => {
    const r = robot([
      ['board.GP0#0', 'sg90.Signal#0'],
      ['board.VBUS#4', 'sg90.V+#1'],
      ['board.GND#2', 'sg90.GND#2']
    ])
    expect(wiringWarnings(r, libs, board)).toEqual([])
  })

  it('finds a short through a part', () => {
    const r = robot([
      ['board.VBUS#4', 'sg90.V+#1'],
      ['sg90.V+#1', 'board.GND#2']
    ])
    const kinds = wiringWarnings(r, libs, board).map((w) => w.kind)
    expect(kinds).toContain('short')
  })

  it('finds joined supplies and joined GPIOs', () => {
    const r = robot([
      ['board.3V3#3', 'board.VBUS#4'],
      ['board.GP0#0', 'sg90.Signal#0'],
      ['board.GP1#1', 'sg90.Signal#0']
    ])
    const w = wiringWarnings(r, libs, board)
    expect(w.find((x) => x.kind === 'rails')?.message).toMatch(/3V3 and VBUS/)
    expect(w.find((x) => x.kind === 'gpio')?.message).toMatch(/GP0 and GP1/)
  })

  it('names unwired power and parts it cannot find', () => {
    const r: RobotDefinition = {
      board: 'pico',
      parts: [
        { id: 'sg90', lib: 'kevsrobots', part: 'sg90' },
        { id: 'x', lib: 'kevsrobots', part: 'gone' }
      ],
      connections: [{ id: 'w', from: 'board.GP0#0', to: 'sg90.Signal#0' }]
    }
    const w = wiringWarnings(r, libs, board)
    expect(w.filter((x) => x.kind === 'unwired').map((x) => x.message)).toEqual([
      "SG90's V+ isn't wired.",
      "SG90's GND isn't wired."
    ])
    expect(w.some((x) => x.kind === 'missing')).toBe(true)
  })
})
