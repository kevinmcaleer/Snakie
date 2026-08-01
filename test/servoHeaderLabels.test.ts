import { describe, it, expect } from 'vitest'
import {
  normalisePart,
  pinLabelHidden,
  servoSignalRotation
} from '../src/renderer/src/components/part-editor.util'
import { pinOutwardDir } from '../src/renderer/src/components/part-body'
import type { PartDefinition } from '../src/shared/part'

/**
 * Servo header labels (#689): only the signal is named, and it reads to the
 * nearer TOP/BOTTOM edge — along the trio's own axis, never sideways.
 */
const trio = (gid: string, x: number, y: number): unknown[] => [
  { name: 'S1', type: 'io', shape: 'octagonal', group: gid, x, y },
  { name: 'V1', type: 'pwr', shape: 'octagonal', group: gid, x, y: y + 0.05 },
  { name: 'G1', type: 'gnd', shape: 'octagonal', group: gid, x, y: y + 0.1 }
]
const board = (y = 0.1): PartDefinition =>
  ({
    id: 'p',
    name: 'P',
    headers: [{ edge: 'left', pins: trio('servo-1', 0.2, y) }],
    groups: [{ id: 'servo-1', name: 'Servo 1', housing: { kind: 'dupont', x: 0.2, y: y + 0.05 } }]
  }) as unknown as PartDefinition

describe('only the signal label shows (#689)', () => {
  const part = board()
  const [sig, vcc, gnd] = part.headers[0].pins

  it('hides V+ and GND on a servo header, keeps the signal', () => {
    expect(pinLabelHidden(part, sig)).toBe(false)
    expect(pinLabelHidden(part, vcc)).toBe(true)
    expect(pinLabelHidden(part, gnd)).toBe(true)
  })

  it('is a display rule, so headers already placed pick it up', () => {
    // Nothing is stored on the pins — no migration, nothing rewritten on disk.
    expect(vcc.labelHidden).toBeUndefined()
    expect(gnd.labelHidden).toBeUndefined()
  })

  it('an explicit labelHidden still wins in both directions', () => {
    const shown = { ...vcc, labelHidden: false }
    const hidden = { ...sig, labelHidden: true }
    expect(pinLabelHidden(part, shown)).toBe(false)
    expect(pinLabelHidden(part, hidden)).toBe(true)
  })

  it('leaves power and ground alone outside a servo housing', () => {
    const loose = { ...board(), groups: [{ id: 'servo-1', name: 'Servo 1' }] } as unknown as PartDefinition
    expect(pinLabelHidden(loose, loose.headers[0].pins[1])).toBe(false)
    // ...and a QWIIC group's rails are worth printing — you wire to them.
    const qwiic = {
      ...board(),
      groups: [{ id: 'servo-1', housing: { kind: 'qwiic', x: 0.2, y: 0.15 } }]
    } as unknown as PartDefinition
    expect(pinLabelHidden(qwiic, qwiic.headers[0].pins[1])).toBe(false)
  })
})

describe('the signal label reads along the trio, to the nearer edge (#689)', () => {
  it('points UP in the top half and DOWN in the bottom half', () => {
    expect(servoSignalRotation(0.1)).toBe(270)
    expect(servoSignalRotation(0.9)).toBe(90)
    expect(pinOutwardDir(servoSignalRotation(0.1), 0.05, 0.1)).toBe('top')
    expect(pinOutwardDir(servoSignalRotation(0.9), 0.05, 0.9)).toBe('bottom')
  })

  it('never reads sideways, even hard against the left edge', () => {
    // The reported bug: a row of headers near the left edge threw every label
    // left, because "nearest edge" ignored which way the trio runs.
    for (const x of [0.01, 0.05, 0.5, 0.99]) {
      const dir = pinOutwardDir(servoSignalRotation(0.15), x, 0.15)
      expect(dir).toBe('top')
    }
  })
})

describe('boards authored with the old fixed preset are re-aimed (#689)', () => {
  const old = (y: number): PartDefinition =>
    ({
      id: 'p',
      name: 'P',
      headers: [
        {
          edge: 'left',
          pins: [{ name: 'S1', type: 'io', shape: 'octagonal', rotation: 270, group: 'servo-1', x: 0.2, y }]
        }
      ],
      groups: [{ id: 'servo-1' }]
    }) as unknown as PartDefinition

  it('re-aims a bottom-half header downward instead of at the top of the board', () => {
    expect(normalisePart(old(0.9)).headers[0].pins[0].rotation).toBe(90)
  })

  it('leaves a top-half header pointing up', () => {
    expect(normalisePart(old(0.1)).headers[0].pins[0].rotation).toBe(270)
  })

  it('converges — normalising twice is the same as once', () => {
    for (const y of [0.1, 0.9]) {
      const once = normalisePart(old(y))
      expect(normalisePart(once).headers[0].pins[0].rotation).toBe(once.headers[0].pins[0].rotation)
    }
  })
})
