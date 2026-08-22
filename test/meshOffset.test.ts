import { describe, expect, it } from 'vitest'
import {
  CENTRE_ANCHOR,
  MESH_NUDGE_STEPS_MM,
  anchorPoint,
  coerceMeshOffset,
  describeAnchor,
  formatMeshOffset,
  isZeroOffset,
  meshOffsetMetres,
  meshOffsetXyz,
  nudgeMeshOffset,
  setMeshOffsetAxis,
  snapOffsetFor,
  type MeshAnchor,
  type MeshBounds,
  type MeshOffset
} from '../src/shared/mesh-offset'
import { applyMeshRotation, type MeshAxis, type MeshRotation } from '../src/shared/mesh-rotation'

/**
 * POSITIONING A LINKED MESH (#788).
 *
 * The arithmetic is small; what is worth pinning is the two things that could be
 * got subtly wrong and would not show up until a part was placed in Build:
 *
 *   1. **The composition order.** The offset is applied AFTER the rotation, in
 *      the part's frame. That is what makes a nudge move the model along the
 *      axis on the button no matter how the model is turned, and it is what the
 *      URDF `<origin xyz rpy>` already means. A test that only checked
 *      `nudge(x, 1)` gives `[1, 0, 0]` would pass under either order.
 *   2. **Snapping is exact.** "Put this corner on the origin" has one right
 *      answer, and it must land on the origin — not near it, and not somewhere
 *      that depends on where the model already was.
 */

/** The full transform a consumer applies: rotate, then translate. */
function place(
  rotation: MeshRotation | undefined,
  offset: MeshOffset | undefined,
  p: readonly [number, number, number]
): [number, number, number] {
  const r = applyMeshRotation(rotation, p)
  const o = offset ?? [0, 0, 0]
  return [r[0] + o[0], r[1] + o[1], r[2] + o[2]]
}

const round = (v: readonly number[]): number[] => v.map((n) => Math.round(n * 1e6) / 1e6)

/** A 26.5 × 48.5 × 17 mm box sitting on the build plate's corner — an STL
 *  exported the way the 9V battery of #787 was. */
const PLATE_CORNER: MeshBounds = { min: [0, 0, 0], max: [26.5, 48.5, 17] }

describe('coerceMeshOffset — the schema gate', () => {
  it('drops a zero offset, so "back where it started" writes no field', () => {
    // The same rule as meshRotation: absence IS the identity in this schema, and
    // a persisted [0,0,0] would sit in every diff for ever.
    expect(coerceMeshOffset([0, 0, 0])).toBeUndefined()
    expect(coerceMeshOffset([0, -0, 0])).toBeUndefined()
  })

  it('keeps a real offset, tidied', () => {
    expect(coerceMeshOffset([1, -2.5, 0])).toEqual([1, -2.5, 0])
    // Float dust from a snap must not reach parts.yml.
    expect(coerceMeshOffset([13.2500000001, 0, 0])).toEqual([13.25, 0, 0])
  })

  it('never yields a negative zero — it serialises as `-0` and reads as a bug', () => {
    const out = coerceMeshOffset([-0.00001, 5, 0])
    expect(Object.is(out![0], -0)).toBe(false)
  })

  it('rejects anything that is not three finite numbers', () => {
    const bad = [null, undefined, 'x', [1, 2], [1, 2, 3, 4], [1, 2, 'z'], [1, NaN, 3], [1, Infinity, 3]]
    for (const b of bad) expect(coerceMeshOffset(b), JSON.stringify(b)).toBeUndefined()
  })

  it('isZeroOffset treats absence and zero alike', () => {
    expect(isZeroOffset(undefined)).toBe(true)
    expect(isZeroOffset([0, 0, 0])).toBe(true)
    expect(isZeroOffset([0, 0, 0.5])).toBe(false)
  })
})

describe('nudging — a fixed step along a fixed axis', () => {
  const AXES: MeshAxis[] = ['x', 'y', 'z']

  it('offers steps a decade apart, the coarsest being one grid square', () => {
    // The stage draws a 10 mm grid, so the big step is a distance you can watch
    // happen rather than infer.
    expect([...MESH_NUDGE_STEPS_MM]).toEqual([0.1, 1, 10])
  })

  it('moves the model along the PART frame, whatever the rotation is', () => {
    // THE ORDER TEST. A model turned on its side must still travel along the
    // axis on the button — the axes drawn in the scene do not move with it.
    // Under offset-before-rotation this displacement would come out rotated.
    for (const rotation of [undefined, [90, 0, 0], [0, 0, 90], [30, 40, 50]] as (MeshRotation | undefined)[]) {
      for (const axis of AXES) {
        const before = place(rotation, undefined, [3, -4, 12])
        const after = place(rotation, nudgeMeshOffset(undefined, axis, 7), [3, -4, 12])
        const delta = round([after[0] - before[0], after[1] - before[1], after[2] - before[2]])
        const want = [axis === 'x' ? 7 : 0, axis === 'y' ? 7 : 0, axis === 'z' ? 7 : 0]
        expect(delta, `${axis} under ${JSON.stringify(rotation)}`).toEqual(want)
      }
    }
  })

  it('is reversible, and returns to absence rather than to zero', () => {
    for (const axis of AXES) {
      const there = nudgeMeshOffset(undefined, axis, 10)
      expect(there).toBeDefined()
      expect(nudgeMeshOffset(there, axis, -10), axis).toBeUndefined()
    }
  })

  it('accumulates exactly, so N clicks of a step move N × the step', () => {
    // Repeated float addition of 0.1 is the classic way a nudge drifts: ten
    // clicks must be 1 mm, not 0.9999999999999999.
    let o: MeshOffset | undefined
    for (let i = 0; i < 10; i++) o = nudgeMeshOffset(o, 'y', 0.1)
    expect(o).toEqual([0, 1, 0])
  })

  it('touches only the axis it was given', () => {
    expect(nudgeMeshOffset([1, 2, 3], 'y', 5)).toEqual([1, 7, 3])
    expect(setMeshOffsetAxis([1, 2, 3], 'z', -3)).toEqual([1, 2, -3])
    expect(setMeshOffsetAxis([0, 0, 4], 'z', 0)).toBeUndefined()
  })
})

describe('snapping a chosen feature to the origin', () => {
  const AXIS_PICKS = ['min', 'centre', 'max'] as const

  it('lands the chosen feature exactly on the origin, for all 27 anchors', () => {
    // The whole vocabulary — centre, 6 face centres, 12 edge midpoints, 8
    // corners — is one rule, so it is checked as one rule.
    for (const ax of AXIS_PICKS) {
      for (const ay of AXIS_PICKS) {
        for (const az of AXIS_PICKS) {
          const anchor: MeshAnchor = [ax, ay, az]
          const offset = snapOffsetFor(PLATE_CORNER, anchor)
          const feature = anchorPoint(PLATE_CORNER, anchor)
          const landed = round([
            feature[0] + (offset?.[0] ?? 0),
            feature[1] + (offset?.[1] ?? 0),
            feature[2] + (offset?.[2] ?? 0)
          ])
          expect(landed, `${anchor.join('/')}`).toEqual([0, 0, 0])
        }
      }
    }
  })

  it('is idempotent — snapping the same feature twice does not compound', () => {
    // `snapOffsetFor` answers from the box BEFORE any offset, so the answer is a
    // property of the model, not of where it currently sits. A version that took
    // the already-offset box would drift a little further on every click.
    const anchor: MeshAnchor = ['min', 'centre', 'min']
    const once = snapOffsetFor(PLATE_CORNER, anchor)
    expect(snapOffsetFor(PLATE_CORNER, anchor)).toEqual(once)
  })

  it('does the thing this feature exists for: a plate-corner export, centred and sitting on z=0', () => {
    // The common tidy-up in one click — X/Y centred on the part origin, the
    // underside on the ground plane, which is Snakie's stated convention.
    const offset = snapOffsetFor(PLATE_CORNER, ['centre', 'centre', 'min'])
    expect(offset).toEqual([-13.25, -24.25, 0])
  })

  it('returns absence when the feature is already at the origin', () => {
    const centred: MeshBounds = { min: [-5, -5, -5], max: [5, 5, 5] }
    expect(snapOffsetFor(centred, CENTRE_ANCHOR)).toBeUndefined()
    // …but a corner of that same box is not, and does move.
    expect(snapOffsetFor(centred, ['max', 'max', 'max'])).toEqual([-5, -5, -5])
  })

  it('handles a model whose origin is far OUTSIDE it', () => {
    // The reason the field exists: some exporters leave the origin nowhere near
    // the geometry, and nudging there by hand is hopeless.
    const far: MeshBounds = { min: [980, -1020, 4], max: [1006.5, -971.5, 21] }
    const offset = snapOffsetFor(far, CENTRE_ANCHOR)!
    const centre = anchorPoint(far, CENTRE_ANCHOR)
    expect(round([centre[0] + offset[0], centre[1] + offset[1], centre[2] + offset[2]])).toEqual([0, 0, 0])
  })

  it('names what it is about to snap, so the button can say it', () => {
    expect(describeAnchor(CENTRE_ANCHOR)).toBe('centre')
    expect(describeAnchor(['min', 'centre', 'centre'])).toBe('face centre')
    expect(describeAnchor(['min', 'centre', 'max'])).toBe('edge midpoint')
    expect(describeAnchor(['max', 'min', 'max'])).toBe('corner')
  })
})

describe('the URDF boundary', () => {
  it('writes millimetres out as metres, and nothing else', () => {
    // The ONLY conversion between the stored form and the URDF one. Storing
    // millimetres is what keeps it to a single division.
    expect(meshOffsetMetres([26.5, -48.5, 17])).toEqual([0.0265, -0.0485, 0.017])
    expect(meshOffsetXyz([13.25, 0, -2])).toBe('0.01325 0 -0.002')
    expect(meshOffsetXyz(undefined)).toBe('0 0 0')
  })

  it('never emits a negative zero into a URDF attribute', () => {
    expect(meshOffsetXyz([-0, -0, -0])).toBe('0 0 0')
  })

  it('round-trips through the URDF string without losing a micron', () => {
    const o: MeshOffset = [-13.25, 24.125, 0.5]
    const back = meshOffsetXyz(o)
      .split(' ')
      .map((n) => Number(n) * 1000) as MeshOffset
    expect(round(back)).toEqual(round(o))
  })

  it('formatMeshOffset says "none" for the identity', () => {
    expect(formatMeshOffset(undefined)).toBe('none')
    expect(formatMeshOffset([0, 0, 0])).toBe('none')
    expect(formatMeshOffset([0, -12.5, 3])).toBe('0 mm, -12.5 mm, 3 mm')
  })
})
