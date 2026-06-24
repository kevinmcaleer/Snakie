import { describe, it, expect } from 'vitest'
import {
  applyDeadzone,
  applyMapping,
  buildAxesRecord,
  buildButtonRecord,
  clamp,
  defaultMapping,
  isZeroFrame,
  newOutputMapping,
  resolveTeleopFrame,
  roundOutput,
  zeroFrame,
  type ButtonMapping,
  type GamepadSnapshot,
  type OutputMapping
} from '../src/renderer/src/components/gamepad-logic'
import { buildTeleopPayload } from '../src/shared/control'

/** A connected snapshot from raw axis/button arrays. */
function snap(axes: number[], buttons: boolean[] = []): GamepadSnapshot {
  return { connected: true, axes, buttons }
}

/** A plain pass-through mapping (no shaping) for an axis at `index`. */
function plain(name: string, index: number): OutputMapping {
  return { name, kind: 'axis', index, deadzone: 0, invert: false, scale: 1, trim: 0 }
}

describe('clamp', () => {
  it('clamps to the default [-1, 1] envelope', () => {
    expect(clamp(2)).toBe(1)
    expect(clamp(-2)).toBe(-1)
    expect(clamp(0.3)).toBe(0.3)
  })
  it('honours a custom range and maps NaN to lo', () => {
    expect(clamp(5, 0, 3)).toBe(3)
    expect(clamp(Number.NaN)).toBe(-1)
  })
})

describe('applyDeadzone', () => {
  it('zeroes inputs inside the dead band', () => {
    expect(applyDeadzone(0.05, 0.1)).toBe(0)
    expect(applyDeadzone(-0.1, 0.1)).toBe(0)
  })
  it('passes through unchanged when deadzone is 0', () => {
    expect(applyDeadzone(0.42, 0)).toBe(0.42)
  })
  it('rescales surviving travel back to full range (still reaches ±1)', () => {
    expect(applyDeadzone(1, 0.2)).toBeCloseTo(1, 6)
    expect(applyDeadzone(-1, 0.2)).toBeCloseTo(-1, 6)
    // halfway past a 0.2 band → 0.6 / 0.8 = 0.75
    expect(applyDeadzone(0.8, 0.2)).toBeCloseTo(0.75, 6)
  })
  it('zeroes everything when deadzone >= 1', () => {
    expect(applyDeadzone(0.9, 1)).toBe(0)
  })
})

describe('applyMapping', () => {
  it('zeroes a raw value inside the deadzone', () => {
    const m: OutputMapping = { name: 'drive', kind: 'axis', index: 0, deadzone: 0.2, invert: false, scale: 1, trim: 0 }
    expect(applyMapping(0.1, m)).toBe(0)
  })
  it('inverts the sense', () => {
    const m: OutputMapping = { ...plain('drive', 0), invert: true }
    expect(applyMapping(0.5, m)).toBe(-0.5)
  })
  it('applies scale', () => {
    const m: OutputMapping = { ...plain('drive', 0), scale: 0.5 }
    expect(applyMapping(1, m)).toBe(0.5)
  })
  it('applies a trim offset after scaling', () => {
    const m: OutputMapping = { ...plain('servo1', 0), scale: 0.5, trim: 0.2 }
    // 0.4 * 0.5 = 0.2, + 0.2 trim = 0.4
    expect(applyMapping(0.4, m)).toBeCloseTo(0.4, 6)
  })
  it('clamps the shaped output to the ±1 envelope', () => {
    const m: OutputMapping = { ...plain('drive', 0), scale: 3 }
    expect(applyMapping(1, m)).toBe(1)
    expect(applyMapping(-1, m)).toBe(-1)
  })
  it('clamps a trim that would push past the envelope', () => {
    const m: OutputMapping = { ...plain('drive', 0), trim: 0.9 }
    expect(applyMapping(0.5, m)).toBe(1)
  })
  it('combines deadzone + invert + scale + trim in order', () => {
    const m: OutputMapping = { name: 'd', kind: 'axis', index: 0, deadzone: 0.2, invert: true, scale: 0.5, trim: 0.1 }
    // dz(0.8,0.2)=0.75 → invert=-0.75 → *0.5=-0.375 → +0.1=-0.275
    expect(applyMapping(0.8, m)).toBeCloseTo(-0.275, 6)
  })
})

describe('roundOutput', () => {
  it('rounds to 3 dp and strips negative zero', () => {
    expect(roundOutput(0.123456)).toBe(0.123)
    expect(roundOutput(-0.0001)).toBe(0)
    expect(Object.is(roundOutput(-0.0001), -0)).toBe(false)
  })
})

describe('buildAxesRecord', () => {
  it('assembles named outputs from a snapshot + mappings', () => {
    const mappings: OutputMapping[] = [plain('drive', 1), plain('turn', 0)]
    const rec = buildAxesRecord(snap([0.25, -0.5]), mappings)
    expect(rec).toEqual({ drive: -0.5, turn: 0.25 })
  })
  it('reads a button-sourced output as 0/1', () => {
    const m: OutputMapping = { ...newOutputMapping('boost', 2, 'button'), deadzone: 0 }
    expect(buildAxesRecord(snap([], [false, false, true]), [m]).boost).toBe(1)
    expect(buildAxesRecord(snap([], [false, false, false]), [m]).boost).toBe(0)
  })
  it('treats a missing axis index as a safe centred 0', () => {
    const rec = buildAxesRecord(snap([0.5]), [plain('drive', 9)])
    expect(rec.drive).toBe(0)
  })
})

describe('buildButtonRecord', () => {
  it('reports only pressed buttons as true', () => {
    const mappings: ButtonMapping[] = [
      { name: 'fire', index: 0 },
      { name: 'horn', index: 1 }
    ]
    const rec = buildButtonRecord(snap([], [true, false]), mappings)
    expect(rec).toEqual({ fire: true, horn: false })
  })
  it('treats a missing button index as not pressed', () => {
    const rec = buildButtonRecord(snap([], []), [{ name: 'fire', index: 5 }])
    expect(rec.fire).toBe(false)
  })
})

describe('zeroFrame', () => {
  it('zeroes every axis and unsets every button', () => {
    const z = zeroFrame([plain('drive', 0), plain('turn', 1)], [{ name: 'fire', index: 0 }])
    expect(z).toEqual({ axes: { drive: 0, turn: 0 }, buttons: { fire: false } })
  })
})

describe('isZeroFrame', () => {
  it('is true when nothing is moving or pressed', () => {
    expect(isZeroFrame({ axes: { drive: 0 }, buttons: { fire: false } })).toBe(true)
  })
  it('is false when an axis is non-zero', () => {
    expect(isZeroFrame({ axes: { drive: 0.1 }, buttons: {} })).toBe(false)
  })
  it('is false when a button is pressed', () => {
    expect(isZeroFrame({ axes: {}, buttons: { fire: true } })).toBe(false)
  })
})

describe('resolveTeleopFrame — safety model', () => {
  const axisMappings: OutputMapping[] = [plain('drive', 1), plain('turn', 0)]
  const buttonMappings: ButtonMapping[] = [{ name: 'fire', index: 0 }]
  const live = snap([0.5, -0.5], [true])

  it('DEADMAN: no hold ⇒ everything zero even with full input', () => {
    const f = resolveTeleopFrame({ snap: live, axisMappings, buttonMappings, deadmanHeld: false, estop: false })
    expect(f).toEqual({ axes: { drive: 0, turn: 0 }, buttons: { fire: false } })
  })

  it('DEADMAN held ⇒ live mapped values flow through', () => {
    const f = resolveTeleopFrame({ snap: live, axisMappings, buttonMappings, deadmanHeld: true, estop: false })
    expect(f).toEqual({ axes: { drive: -0.5, turn: 0.5 }, buttons: { fire: true } })
  })

  it('E-STOP zeroes everything even while held', () => {
    const f = resolveTeleopFrame({ snap: live, axisMappings, buttonMappings, deadmanHeld: true, estop: true })
    expect(isZeroFrame(f)).toBe(true)
    expect(f.axes).toEqual({ drive: 0, turn: 0 })
    expect(f.buttons).toEqual({ fire: false })
  })

  it('DISCONNECT (snap.connected false) ⇒ everything zero even while held', () => {
    const dead: GamepadSnapshot = { connected: false, axes: [0.9, 0.9], buttons: [true] }
    const f = resolveTeleopFrame({ snap: dead, axisMappings, buttonMappings, deadmanHeld: true, estop: false })
    expect(isZeroFrame(f)).toBe(true)
  })

  it('the only non-zero path is connected + no E-STOP + held', () => {
    const driving = resolveTeleopFrame({ snap: live, axisMappings, buttonMappings, deadmanHeld: true, estop: false })
    expect(isZeroFrame(driving)).toBe(false)
  })
})

describe('end-to-end: resolved frame → teleop wire line', () => {
  it('serialises a held, driving frame into the SNKCMD payload', () => {
    const { axisMappings, buttonMappings } = defaultMapping()
    // left-stick: X (turn) = 0.4, Y (drive, inverted) raw -1 → forward +1
    const f = resolveTeleopFrame({
      snap: snap([0.4, -1], [true]),
      axisMappings,
      buttonMappings,
      deadmanHeld: true,
      estop: false
    })
    const payload = buildTeleopPayload(f.axes, f.buttons)
    // drive inverted from -1 → +1, turn 0.4 (deadzone-rescaled), fire pressed
    expect(payload).toContain('drive:1')
    expect(payload).toContain('btn:fire=1')
    expect(payload.startsWith('axes=')).toBe(true)
  })

  it('a stopped (deadman released) frame serialises to all-zero axes, no buttons', () => {
    const { axisMappings, buttonMappings } = defaultMapping()
    const f = resolveTeleopFrame({
      snap: snap([0.9, 0.9], [true]),
      axisMappings,
      buttonMappings,
      deadmanHeld: false,
      estop: false
    })
    const payload = buildTeleopPayload(f.axes, f.buttons)
    expect(payload).toBe('axes=drive:0,turn:0')
  })
})
