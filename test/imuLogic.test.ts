import { describe, it, expect } from 'vitest'
import {
  applyCalibration,
  eulerToCssTransform,
  eulerToMatrix,
  formatAngle,
  IMU_SENTINEL,
  NEUTRAL_EULER,
  parseImu,
  quaternionToEuler,
  readingToEuler,
  wrapDeg,
  type Euler
} from '../src/renderer/src/components/imu-logic'

/** Assert two angles equal within a small tolerance (degrees). */
function close(a: number, b: number, eps = 1e-6): void {
  expect(Math.abs(a - b)).toBeLessThan(eps)
}

describe('imu-logic parseImu — IMU (Euler)', () => {
  it('parses a roll/pitch/yaw line', () => {
    expect(parseImu('SNK IMU board 10 -20 30')).toEqual({
      kind: 'imu',
      ch: 'board',
      roll: 10,
      pitch: -20,
      yaw: 30
    })
  })

  it('tolerates leading whitespace and runs of spaces', () => {
    expect(parseImu('   SNK   IMU   imu0   1.5   2.5   3.5 ')).toEqual({
      kind: 'imu',
      ch: 'imu0',
      roll: 1.5,
      pitch: 2.5,
      yaw: 3.5
    })
  })

  it('rejects a line missing an angle', () => {
    expect(parseImu('SNK IMU board 10 20')).toBeNull()
  })

  it('rejects a non-numeric angle', () => {
    expect(parseImu('SNK IMU board 10 nope 30')).toBeNull()
  })
})

describe('imu-logic parseImu — IMUQ (quaternion)', () => {
  it('parses a w/x/y/z line', () => {
    expect(parseImu('SNK IMUQ q 1 0 0 0')).toEqual({
      kind: 'imuq',
      ch: 'q',
      w: 1,
      x: 0,
      y: 0,
      z: 0
    })
  })

  it('parses negative + fractional quaternion components', () => {
    expect(parseImu('SNK IMUQ q 0.7071 0 -0.7071 0')).toEqual({
      kind: 'imuq',
      ch: 'q',
      w: 0.7071,
      x: 0,
      y: -0.7071,
      z: 0
    })
  })

  it('rejects a quaternion missing a component', () => {
    expect(parseImu('SNK IMUQ q 1 0 0')).toBeNull()
  })
})

describe('imu-logic parseImu — rejection', () => {
  it('ignores a non-SNK line', () => {
    expect(parseImu('roll:10 pitch:20')).toBeNull()
  })

  it('ignores SCOPE/METER/PLOT telemetry (not this panel’s)', () => {
    expect(parseImu('SNK SCOPE pwm 0.5')).toBeNull()
    expect(parseImu('SNK METER adc0 1.65 V')).toBeNull()
    expect(parseImu('SNK PLOT a=1 b=2')).toBeNull()
  })

  it('ignores an unknown SNK sub-command', () => {
    expect(parseImu('SNK WAT board 1 2 3')).toBeNull()
  })

  it('does not match an embedded SNK later in the line', () => {
    expect(parseImu('value is SNK IMU board 1 2 3')).toBeNull()
  })

  it('returns null for empty / bare sentinel input', () => {
    expect(parseImu('')).toBeNull()
    expect(parseImu(IMU_SENTINEL)).toBeNull()
  })
})

describe('imu-logic quaternionToEuler — known quaternions', () => {
  it('identity quaternion → neutral (all zero)', () => {
    const e = quaternionToEuler(1, 0, 0, 0)
    close(e.roll, 0)
    close(e.pitch, 0)
    close(e.yaw, 0)
  })

  it('90° roll about X', () => {
    // q = (cos45, sin45, 0, 0)
    const h = Math.SQRT1_2
    const e = quaternionToEuler(h, h, 0, 0)
    close(e.roll, 90, 1e-4)
    close(e.pitch, 0, 1e-4)
    close(e.yaw, 0, 1e-4)
  })

  it('90° yaw about Z', () => {
    const h = Math.SQRT1_2
    const e = quaternionToEuler(h, 0, 0, h)
    close(e.roll, 0, 1e-4)
    close(e.pitch, 0, 1e-4)
    close(e.yaw, 90, 1e-4)
  })

  it('45° pitch about Y', () => {
    const a = (45 / 2) * (Math.PI / 180)
    const e = quaternionToEuler(Math.cos(a), 0, Math.sin(a), 0)
    close(e.roll, 0, 1e-4)
    close(e.pitch, 45, 1e-4)
    close(e.yaw, 0, 1e-4)
  })

  it('normalises an unnormalised quaternion', () => {
    // (2,0,0,0) is just a scaled identity → still neutral.
    const e = quaternionToEuler(2, 0, 0, 0)
    close(e.roll, 0)
    close(e.pitch, 0)
    close(e.yaw, 0)
  })

  it('clamps pitch at the +90° gimbal-lock pole', () => {
    // q = (cos45, 0, sin45, 0) is exactly 90° pitch; sinp == 1.
    const h = Math.SQRT1_2
    const e = quaternionToEuler(h, 0, h, 0)
    close(e.pitch, 90, 1e-4)
  })

  it('zero quaternion → neutral (no NaN)', () => {
    expect(quaternionToEuler(0, 0, 0, 0)).toEqual(NEUTRAL_EULER)
  })

  it('round-trips an Euler orientation through matrix-free quat conversion', () => {
    // Build a quaternion for a known 30/15/60 ZYX orientation and read it back.
    const toRad = Math.PI / 180
    const cr = Math.cos((30 * toRad) / 2)
    const sr = Math.sin((30 * toRad) / 2)
    const cp = Math.cos((15 * toRad) / 2)
    const sp = Math.sin((15 * toRad) / 2)
    const cy = Math.cos((60 * toRad) / 2)
    const sy = Math.sin((60 * toRad) / 2)
    const w = cr * cp * cy + sr * sp * sy
    const x = sr * cp * cy - cr * sp * sy
    const y = cr * sp * cy + sr * cp * sy
    const z = cr * cp * sy - sr * sp * cy
    const e = quaternionToEuler(w, x, y, z)
    close(e.roll, 30, 1e-4)
    close(e.pitch, 15, 1e-4)
    close(e.yaw, 60, 1e-4)
  })
})

describe('imu-logic readingToEuler', () => {
  it('passes Euler readings straight through', () => {
    const e = readingToEuler({ kind: 'imu', ch: 'b', roll: 5, pitch: 6, yaw: 7 })
    expect(e).toEqual({ roll: 5, pitch: 6, yaw: 7 })
  })

  it('converts quaternion readings to Euler', () => {
    const h = Math.SQRT1_2
    const e = readingToEuler({ kind: 'imuq', ch: 'q', w: h, x: h, y: 0, z: 0 })
    close(e.roll, 90, 1e-4)
  })
})

describe('imu-logic wrapDeg', () => {
  it('leaves in-range angles unchanged', () => {
    close(wrapDeg(0), 0)
    close(wrapDeg(179), 179)
    close(wrapDeg(-179), -179)
  })

  it('wraps past +180 into the negative half', () => {
    close(wrapDeg(190), -170)
    close(wrapDeg(360), 0)
    close(wrapDeg(540), 180)
  })

  it('wraps past -180 into the positive half', () => {
    close(wrapDeg(-190), 170)
    close(wrapDeg(-360), 0)
  })

  it('maps exactly -180 to +180', () => {
    close(wrapDeg(-180), 180)
  })

  it('non-finite → 0', () => {
    expect(wrapDeg(NaN)).toBe(0)
    expect(wrapDeg(Infinity)).toBe(0)
  })
})

describe('imu-logic applyCalibration', () => {
  it('subtracts the offset per axis', () => {
    const cur: Euler = { roll: 30, pitch: 20, yaw: 10 }
    const off: Euler = { roll: 5, pitch: 5, yaw: 5 }
    expect(applyCalibration(cur, off)).toEqual({ roll: 25, pitch: 15, yaw: 5 })
  })

  it('levels the board: capturing the current orientation zeroes it', () => {
    const cur: Euler = { roll: 12.3, pitch: -7.5, yaw: 88 }
    expect(applyCalibration(cur, cur)).toEqual({ roll: 0, pitch: 0, yaw: 0 })
  })

  it('wraps the result so a near-180 offset stays continuous', () => {
    const out = applyCalibration({ roll: 170, pitch: 0, yaw: 0 }, { roll: -170, pitch: 0, yaw: 0 })
    // 170 - (-170) = 340 → wraps to -20
    close(out.roll, -20)
  })
})

describe('imu-logic eulerToCssTransform', () => {
  it('emits ZYX (yaw→pitch→roll) order with deg units', () => {
    const s = eulerToCssTransform({ roll: 1, pitch: 2, yaw: 3 })
    expect(s).toBe('rotateZ(3.000deg) rotateX(2.000deg) rotateY(1.000deg)')
  })

  it('handles the neutral orientation', () => {
    expect(eulerToCssTransform(NEUTRAL_EULER)).toBe(
      'rotateZ(0.000deg) rotateX(0.000deg) rotateY(0.000deg)'
    )
  })

  it('rounds tiny float jitter to a stable 3-dp string', () => {
    const s = eulerToCssTransform({ roll: 1.23456, pitch: 0, yaw: 0 })
    expect(s).toContain('rotateY(1.235deg)')
  })

  it('non-finite components fall back to 0', () => {
    const s = eulerToCssTransform({ roll: NaN, pitch: 0, yaw: 0 })
    expect(s).toContain('rotateY(0.000deg)')
  })
})

describe('imu-logic eulerToMatrix', () => {
  it('neutral orientation → identity matrix', () => {
    const m = eulerToMatrix(NEUTRAL_EULER)
    const id = [1, 0, 0, 0, 1, 0, 0, 0, 1]
    m.forEach((v, i) => close(v, id[i], 1e-9))
  })

  it('produces an orthonormal (rotation) matrix', () => {
    const m = eulerToMatrix({ roll: 25, pitch: -40, yaw: 110 })
    // Each row is a unit vector.
    for (let r = 0; r < 3; r++) {
      const [a, b, c] = [m[r * 3], m[r * 3 + 1], m[r * 3 + 2]]
      close(a * a + b * b + c * c, 1, 1e-9)
    }
    // determinant == +1 (proper rotation, no reflection).
    const det =
      m[0] * (m[4] * m[8] - m[5] * m[7]) -
      m[1] * (m[3] * m[8] - m[5] * m[6]) +
      m[2] * (m[3] * m[7] - m[4] * m[6])
    close(det, 1, 1e-9)
  })
})

describe('imu-logic formatAngle', () => {
  it('signs positive / negative / zero', () => {
    expect(formatAngle(12.34)).toBe('+12.3°')
    expect(formatAngle(-4)).toBe('−4.0°')
    expect(formatAngle(0)).toBe(' 0.0°')
  })

  it('non-finite renders as zero', () => {
    expect(formatAngle(NaN)).toBe(' 0.0°')
  })
})

describe('imu-logic NEUTRAL_EULER', () => {
  it('is all-zero (the no-data / level pose)', () => {
    expect(NEUTRAL_EULER).toEqual({ roll: 0, pitch: 0, yaw: 0 })
  })
})
