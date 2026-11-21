import { describe, expect, it } from 'vitest'
import { runtimeSwitcherView } from '../src/renderer/src/components/runtime-switcher'

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
