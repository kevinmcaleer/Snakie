import { describe, expect, it } from 'vitest'
import {
  runtimeSwitcherView,
  simSwitcherView,
  switcherRows
} from '../src/renderer/src/components/runtime-switcher'

describe('runtimeSwitcherView', () => {
  it('on auto, shows what the board runs', () => {
    const v = runtimeSwitcherView('auto', 'micropython', 'MicroPython')
    expect(v.label).toBe('MicroPython')
    expect(v.mismatch).toBe(false)
    expect(v.title).toContain('follow it')
  })

  it('on auto with no board, says Auto', () => {
    expect(runtimeSwitcherView('auto', undefined, '').label).toBe('Auto')
  })

  it('pinned with no board shows the pinned Python', () => {
    const v = runtimeSwitcherView('circuitpython', undefined, '')
    expect(v.label).toBe('CircuitPython')
    expect(v.mismatch).toBe(false)
  })

  it('pinned to the Python the board runs shows the board', () => {
    expect(runtimeSwitcherView('micropython', 'micropython', 'MicroPython').label).toBe('MicroPython')
  })

  it('flags hints pinned to a different Python than the board', () => {
    const v = runtimeSwitcherView('circuitpython', 'micropython', 'MicroPython')
    expect(v.label).toBe('CircuitPython hints')
    expect(v.mismatch).toBe(true)
    expect(v.title).toContain('board runs MicroPython')
  })
})

describe('simSwitcherView (#764)', () => {
  it('names the Python the simulator runs, and offers the other', () => {
    const v = simSwitcherView('auto', 'micropython')
    expect(v.label).toBe('MicroPython')
    expect(v.title).toContain('switch it to CircuitPython')
    expect(simSwitcherView('auto', 'circuitpython').label).toBe('CircuitPython')
  })

  it('flags hints pinned to the other Python', () => {
    const v = simSwitcherView('micropython', 'circuitpython')
    expect(v.mismatch).toBe(true)
    expect(v.label).toBe('MicroPython hints')
  })
})

describe('switcherRows', () => {
  const keys = (rows: { key: string }[]): string[] => rows.map((r) => r.key)

  it('on the simulator, switches the simulator itself', () => {
    const rows = switcherRows('simulator', 'auto', 'micropython', 'micropython')
    expect(keys(rows)).toEqual(['sim-micropython', 'sim-circuitpython'])
    expect(rows.find((r) => r.checked)?.key).toBe('sim-micropython')
    expect(rows[1].action).toEqual({ kind: 'sim', dialect: 'circuitpython' })
  })

  it('with nothing connected, picks the Python to write for', () => {
    const rows = switcherRows('none', 'circuitpython', 'circuitpython', undefined)
    expect(keys(rows)).toEqual(['prefer-micropython', 'prefer-circuitpython', 'hints-auto'])
    expect(rows.find((r) => r.checked)?.key).toBe('prefer-circuitpython')
  })

  it('on a MicroPython board, guides to CircuitPython instead of a dead option', () => {
    const rows = switcherRows('board', 'auto', 'micropython', 'micropython')
    expect(keys(rows)).toEqual([
      'hints-auto',
      'hints-micropython',
      'hints-circuitpython',
      'flash-circuitpython',
      'try-circuitpython'
    ])
    expect(rows.at(-1)?.action).toEqual({ kind: 'try-sim', dialect: 'circuitpython' })
  })

  it('on a CircuitPython board, guides to MicroPython', () => {
    const rows = switcherRows('board', 'auto', 'micropython', 'circuitpython')
    expect(keys(rows)).toContain('flash-micropython')
    expect(keys(rows)).not.toContain('flash-circuitpython')
  })
})
