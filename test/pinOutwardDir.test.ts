import { describe, it, expect } from 'vitest'
import { pinOutwardDir } from '../src/renderer/src/components/part-body'
import { isPresetServoSignal, normalisePart } from '../src/renderer/src/components/part-editor.util'
import type { PartDefinition } from '../src/shared/part'

/**
 * Which way a pin's label reads (#664).
 *
 * `pinOutwardDir` honours an explicit `rotation` above everything else, because
 * that is the pin inspector's "aim the label this way" override. `servoTrio` used
 * to preset `rotation: 270` on every servo signal pin, which pinned the label to
 * the TOP of the board however far down the header actually sat.
 */
describe('pinOutwardDir (#664)', () => {
  it('falls back to the nearest edge when no rotation is set', () => {
    expect(pinOutwardDir(undefined, 0.5, 0.9)).toBe('bottom')
    expect(pinOutwardDir(undefined, 0.5, 0.1)).toBe('top')
    expect(pinOutwardDir(undefined, 0.05, 0.5)).toBe('left')
    expect(pinOutwardDir(undefined, 0.95, 0.5)).toBe('right')
  })

  it('still obeys an explicit rotation — the inspector control must keep working', () => {
    expect(pinOutwardDir(270, 0.5, 0.9)).toBe('top')
    expect(pinOutwardDir(0, 0.5, 0.9)).toBe('right')
    expect(pinOutwardDir(90, 0.5, 0.1)).toBe('bottom')
    expect(pinOutwardDir(180, 0.5, 0.1)).toBe('left')
  })
})

/** The migration that clears the old preset from already-placed headers (#664). */
describe('isPresetServoSignal migration (#664)', () => {
  const preset = { rotation: 270, shape: 'octagonal', type: 'io', group: 'servo-3' }

  it('matches the servo-header tool"s own output', () => {
    expect(isPresetServoSignal(preset)).toBe(true)
    expect(isPresetServoSignal({ ...preset, group: 'servo-12' })).toBe(true)
  })

  it('leaves a rotation the user aimed by hand alone', () => {
    // Any one mark missing => not ours to clear.
    expect(isPresetServoSignal({ ...preset, rotation: 90 })).toBe(false)
    expect(isPresetServoSignal({ ...preset, shape: 'castellated' })).toBe(false)
    expect(isPresetServoSignal({ ...preset, type: 'pwr' })).toBe(false)
    expect(isPresetServoSignal({ ...preset, group: 'my-header' })).toBe(false)
    expect(isPresetServoSignal({ ...preset, group: undefined })).toBe(false)
    expect(isPresetServoSignal({ rotation: 270 })).toBe(false)
  })

  it('is RE-AIMED by normalisePart along the trio, not cleared (#689)', () => {
    // Superseded #664's clear-it behaviour: clearing fell back to "nearest edge",
    // which threw a row of headers near the left edge sideways. Now the preset is
    // re-aimed to the nearer TOP/BOTTOM edge instead — along the trio's own axis.
    const part = normalisePart({
      id: 'p',
      name: 'P',
      headers: [
        {
          edge: 'bottom',
          pins: [
            { name: 'S1', type: 'io', shape: 'octagonal', rotation: 270, group: 'servo-1', x: 0.3, y: 0.85 },
            // A hand-aimed pin in the same part must survive untouched.
            { name: 'GP2', type: 'io', shape: 'castellated', rotation: 270, x: 0.6, y: 0.85 }
          ]
        }
      ]
    } as unknown as PartDefinition)
    const pins = part.headers[0].pins
    expect(pins[0].rotation).toBe(90) // bottom half -> reads downward
    expect(pins[1].rotation).toBe(270) // untouched
    expect(pinOutwardDir(pins[0].rotation, pins[0].x!, pins[0].y!)).toBe('bottom')
  })
})
