import { describe, expect, it } from 'vitest'
import {
  applyMeshRotation,
  axisMatrix,
  coerceMeshRotation,
  formatMeshRotation,
  isIdentityRotation,
  matrixToRotation,
  meshRotationRadians,
  meshRotationRpy,
  multiplyMat3,
  normaliseAngleDeg,
  rotateMesh,
  rotationMatrix,
  setMeshRotationAxis,
  type Mat3,
  type MeshRotation
} from '../src/shared/mesh-rotation'

/**
 * A part's mesh orientation (#741).
 *
 * The properties that matter are PHYSICAL, not textual: does a "+90° about X"
 * button actually stand the model up, does pressing it four times get you back
 * where you started, and does the stored triple mean the same thing to three.js
 * and to the URDF it is written into? Restating the formula would test nothing —
 * the formula is the thing under suspicion.
 */

/** Where a point ends up under a rotation, rounded so exact turns compare. */
function at(r: MeshRotation | undefined, p: [number, number, number]): number[] {
  return applyMeshRotation(r, p).map((n) => Math.round(n * 1e6) / 1e6)
}

const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]

function expectMatrixClose(a: Mat3, b: Mat3): void {
  a.forEach((n, i) => expect(n).toBeCloseTo(b[i], 9))
}

describe('normaliseAngleDeg', () => {
  it('wraps into (-180, 180] so three quarter-turns read as -90, not 270', () => {
    expect(normaliseAngleDeg(270)).toBe(-90)
    expect(normaliseAngleDeg(-270)).toBe(90)
    expect(normaliseAngleDeg(450)).toBe(90)
    expect(normaliseAngleDeg(0)).toBe(0)
    expect(normaliseAngleDeg(360)).toBe(0)
  })

  it('prefers +180 over -180 (the same turn, one spelling)', () => {
    expect(normaliseAngleDeg(180)).toBe(180)
    expect(normaliseAngleDeg(-180)).toBe(180)
  })

  it('snaps the atan2 dust off a quarter turn but leaves a deliberate 22.5', () => {
    expect(normaliseAngleDeg(89.99999999999999)).toBe(90)
    expect(normaliseAngleDeg(-0.0000001)).toBe(0)
    expect(normaliseAngleDeg(22.5)).toBe(22.5)
    expect(normaliseAngleDeg(-33.75)).toBe(-33.75)
  })

  it('never yields a negative zero (it serialises as `-0` and reads as a bug)', () => {
    expect(Object.is(normaliseAngleDeg(-0), 0)).toBe(true)
    expect(Object.is(normaliseAngleDeg(-360), 0)).toBe(true)
  })

  it('treats a non-number as no rotation rather than propagating NaN', () => {
    expect(normaliseAngleDeg(NaN)).toBe(0)
    expect(normaliseAngleDeg(Infinity)).toBe(0)
  })
})

describe('coerceMeshRotation — the schema gate', () => {
  it('drops the identity, because absent IS the identity everywhere else', () => {
    expect(coerceMeshRotation([0, 0, 0])).toBeUndefined()
    expect(coerceMeshRotation([360, -360, 720])).toBeUndefined()
  })

  it('keeps a real rotation, normalised', () => {
    expect(coerceMeshRotation([90, 0, 0])).toEqual([90, 0, 0])
    expect(coerceMeshRotation([270, 0, 450])).toEqual([-90, 0, 90])
  })

  it('rejects anything that is not three finite numbers', () => {
    for (const bad of [undefined, null, 90, '90', [90], [90, 0], [90, 0, 0, 0], [90, 'x', 0], [90, NaN, 0]]) {
      expect(coerceMeshRotation(bad), JSON.stringify(bad)).toBeUndefined()
    }
  })

  it('isIdentityRotation agrees with it', () => {
    expect(isIdentityRotation(undefined)).toBe(true)
    expect(isIdentityRotation([0, 0, 0])).toBe(true)
    expect(isIdentityRotation([0, 0, 90])).toBe(false)
  })
})

describe('the rotation actually moves the part', () => {
  // The one that matters: a board that arrived standing on its edge — its
  // "up" pointing along +Y instead of +Z — is stood up by +90° about X.
  it('+90° about X takes +Y to +Z', () => {
    expect(at([90, 0, 0], [0, 1, 0])).toEqual([0, 0, 1])
  })

  it('+90° about Y takes +Z to +X', () => {
    expect(at([0, 90, 0], [0, 0, 1])).toEqual([1, 0, 0])
  })

  it('+90° about Z takes +X to +Y', () => {
    expect(at([0, 0, 90], [1, 0, 0])).toEqual([0, 1, 0])
  })

  it('leaves the axis it turns about alone', () => {
    expect(at([90, 0, 0], [1, 0, 0])).toEqual([1, 0, 0])
    expect(at([0, 90, 0], [0, 1, 0])).toEqual([0, 1, 0])
    expect(at([0, 0, 90], [0, 0, 1])).toEqual([0, 0, 1])
  })

  it('is URDF rpy: R = Rz(yaw)·Ry(pitch)·Rx(roll), not some other order', () => {
    const rpy: MeshRotation = [30, 40, 50]
    const byProduct = multiplyMat3(
      axisMatrix('z', rpy[2]),
      multiplyMat3(axisMatrix('y', rpy[1]), axisMatrix('x', rpy[0]))
    )
    expectMatrixClose(rotationMatrix(rpy), byProduct)
  })

  it('preserves length — it is a rotation, not a scale', () => {
    for (const r of [[30, 40, 50], [90, 0, -90], [12.5, -170, 3]] as MeshRotation[]) {
      const p = applyMeshRotation(r, [3, -4, 12])
      expect(Math.hypot(...p)).toBeCloseTo(13, 9)
    }
  })
})

describe('matrix ↔ rpy round-trip', () => {
  const cases: MeshRotation[] = [
    [0, 0, 0],
    [90, 0, 0],
    [-90, 0, 0],
    [180, 0, 0],
    [0, 90, 0], // the gimbal-lock pole
    [0, -90, 0],
    [0, 0, 90],
    [90, 0, 90],
    [30, 40, 50],
    [-135, 22.5, 175]
  ]

  // The round-trip that has to hold is on the MATRIX, not on the angles: rpy is
  // one-to-many (at the poles especially), so a decomposition that returns a
  // different-but-equivalent triple is correct, and asserting on the triple
  // would be asserting on the branch rather than on the rotation.
  it.each(cases)('rotationMatrix(matrixToRotation(m)) === m for %s', (...rpy) => {
    const m = rotationMatrix(rpy as MeshRotation)
    expectMatrixClose(rotationMatrix(matrixToRotation(m)), m)
  })

  it('resolves pitch into [-90, 90] — the branch a person would have typed', () => {
    for (const rpy of cases) {
      const [, pitch] = matrixToRotation(rotationMatrix(rpy))
      expect(Math.abs(pitch)).toBeLessThanOrEqual(90)
    }
  })

  it('pins yaw to 0 at the poles, where roll and yaw are the same turn', () => {
    expect(matrixToRotation(rotationMatrix([40, 90, 25]))[2]).toBe(0)
    expect(matrixToRotation(rotationMatrix([40, -90, 25]))[2]).toBe(0)
  })
})

describe('rotateMesh — what the ±90° buttons do', () => {
  it('reaches the same place as the equivalent single rotation', () => {
    expect(rotateMesh(undefined, 'x', 90)).toEqual([90, 0, 0])
    expect(rotateMesh(undefined, 'z', -90)).toEqual([0, 0, -90])
  })

  it('four quarter turns about any axis come back to no rotation', () => {
    for (const axis of ['x', 'y', 'z'] as const) {
      let r = rotateMesh(undefined, axis, 90)
      r = rotateMesh(r, axis, 90)
      r = rotateMesh(r, axis, 90)
      expect(r, `${axis} after three`).toBeDefined()
      expect(rotateMesh(r, axis, 90), `${axis} after four`).toBeUndefined()
    }
  })

  it('undoes itself — the property a rotate button lives or dies by', () => {
    for (const axis of ['x', 'y', 'z'] as const) {
      const start: MeshRotation = [30, 40, 50]
      const there = rotateMesh(start, axis, 90)
      expectMatrixClose(rotationMatrix(rotateMesh(there, axis, -90)), rotationMatrix(start))
    }
  })

  /**
   * The bug this design exists to avoid. Nudging X twice from a state that
   * already has a Y and Z component must compose properly; naively adding 90 to
   * the X component agrees for the first press and then quietly diverges, which
   * is the classic "the rotate button stops working after a couple of presses".
   */
  it('composes about the PART frame, not by adding to the Euler component', () => {
    const start: MeshRotation = [0, 90, 0]
    const once = rotateMesh(start, 'x', 90)!
    expect(once).not.toEqual([90, 90, 0])
    // The physical truth: turning the already-pitched part about world X.
    expectMatrixClose(
      rotationMatrix(once),
      multiplyMat3(axisMatrix('x', 90), rotationMatrix(start))
    )
  })

  it('a full turn in eighths comes back to where it started, drift and all', () => {
    // Not the identity — the START. Eight 45° nudges is one whole turn on top of
    // whatever was already there, and the accumulated floating-point error must
    // not leave the part visibly askew (or the value un-snapped in `parts.yml`).
    const start: MeshRotation = [45, 0, 0]
    let r: MeshRotation | undefined = start
    for (let i = 0; i < 8; i++) r = rotateMesh(r, 'x', 45)
    expect(r).toEqual(start)
  })

  it('returns undefined rather than a no-op rotation to persist', () => {
    expect(rotateMesh([90, 0, 0], 'x', -90)).toBeUndefined()
    expect(rotateMesh(undefined, 'x', 0)).toBeUndefined()
  })
})

describe('setMeshRotationAxis — the numeric fields', () => {
  it('sets one component and leaves the others', () => {
    expect(setMeshRotationAxis([10, 20, 30], 'y', 45)).toEqual([10, 45, 30])
    expect(setMeshRotationAxis(undefined, 'z', 90)).toEqual([0, 0, 90])
  })

  it('normalises what was typed', () => {
    expect(setMeshRotationAxis(undefined, 'x', 450)).toEqual([90, 0, 0])
  })

  it('collapses back to undefined when every component is zeroed', () => {
    expect(setMeshRotationAxis([0, 0, 90], 'z', 0)).toBeUndefined()
  })
})

describe('the boundaries other code reads it through', () => {
  it('meshRotationRadians converts, and identity is all zeros', () => {
    const [x, y, z] = meshRotationRadians([90, -180, 0])
    expect(x).toBeCloseTo(Math.PI / 2, 12)
    expect(y).toBeCloseTo(-Math.PI, 12)
    expect(z).toBe(0)
    expect(meshRotationRadians(undefined)).toEqual([0, 0, 0])
  })

  it('meshRotationRpy writes URDF radians, tersely and without -0', () => {
    expect(meshRotationRpy([90, 0, 0])).toBe('1.570796 0 0')
    expect(meshRotationRpy(undefined)).toBe('0 0 0')
    expect(meshRotationRpy([-0, -0, -0])).toBe('0 0 0')
  })

  it('the rpy string parses back to the same rotation', () => {
    const r: MeshRotation = [90, 0, -90]
    const back = meshRotationRpy(r)
      .split(' ')
      .map((n) => (Number(n) * 180) / Math.PI) as MeshRotation
    expectMatrixClose(rotationMatrix(matrixToRotation(rotationMatrix(back))), rotationMatrix(r))
  })

  it('formatMeshRotation says "none" for the identity', () => {
    expect(formatMeshRotation(undefined)).toBe('none')
    expect(formatMeshRotation([0, 0, 0])).toBe('none')
    expect(formatMeshRotation([90, 0, -90])).toBe('90°, 0°, -90°')
  })
})

describe('multiplyMat3', () => {
  it('has the identity as its identity', () => {
    const m = rotationMatrix([30, 40, 50])
    expectMatrixClose(multiplyMat3(m, IDENTITY), m)
    expectMatrixClose(multiplyMat3(IDENTITY, m), m)
  })

  it('is associative', () => {
    const a = axisMatrix('x', 33)
    const b = axisMatrix('y', -71)
    const c = axisMatrix('z', 12)
    expectMatrixClose(multiplyMat3(multiplyMat3(a, b), c), multiplyMat3(a, multiplyMat3(b, c)))
  })

  it('a rotation times its inverse is the identity', () => {
    expectMatrixClose(multiplyMat3(axisMatrix('y', 40), axisMatrix('y', -40)), IDENTITY)
  })
})
