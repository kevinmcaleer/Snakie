import { describe, it, expect } from 'vitest'
import { classifyFace, snapDimension, resizeFromDrag } from '../src/renderer/src/components/robot-build'
import {
  addPrimitive,
  setPrimitiveSize,
  setVisualOrigin,
  setJointOrigin,
  readPrimitive,
  removeLink,
  parseAssembly,
  blankUrdf
} from '../src/renderer/src/components/robot-assembly'

describe('robot-build face maths (#315a)', () => {
  it('classifies a box face by dominant axis + sign', () => {
    expect(classifyFace([0.98, 0.1, 0.1], 'box')).toEqual({ axis: 0, sign: 1, dim: 0, symmetric: false })
    expect(classifyFace([0, -1, 0], 'box')).toEqual({ axis: 1, sign: -1, dim: 1, symmetric: false })
  })
  it('classifies a cylinder cap (z) as length, side as symmetric radius', () => {
    expect(classifyFace([0, 0, 1], 'cylinder')).toEqual({ axis: 2, sign: 1, dim: 1, symmetric: false })
    expect(classifyFace([1, 0, 0], 'cylinder')).toEqual({ axis: 0, sign: 1, dim: 0, symmetric: true })
  })
  it('a sphere face always edits the (symmetric) radius', () => {
    expect(classifyFace([0, 0.3, -0.95], 'sphere')).toEqual({ axis: 2, sign: -1, dim: 0, symmetric: true })
  })
  it('snaps to a grid', () => {
    expect(snapDimension(0.043, 0.005)).toBeCloseTo(0.045)
    expect(snapDimension(0.041, 0.005)).toBeCloseTo(0.04)
  })
  it('resizes a box face and keeps the OPPOSITE face fixed', () => {
    // +X face pulled out ~20mm: x 40→60mm; origin shifts +10mm so the −X face stays put.
    const face = classifyFace([1, 0, 0], 'box')
    const r = resizeFromDrag([0.04, 0.04, 0.04], [0, 0, 0], face, 0.02)
    expect(r.dims[0]).toBeCloseTo(0.06)
    expect(r.origin[0]).toBeCloseTo(0.01) // +sign * (0.06-0.04)/2
    // the fixed (−X) face: centre − size/2 unchanged
    expect(r.origin[0] - r.dims[0] / 2).toBeCloseTo(0 - 0.04 / 2)
  })
  it('a −face shift is negative; a symmetric (radius) drag never shifts the origin', () => {
    const neg = resizeFromDrag([0.04, 0.04, 0.04], [0, 0, 0], classifyFace([-1, 0, 0], 'box'), 0.02)
    expect(neg.origin[0]).toBeCloseTo(-0.01)
    const rad = resizeFromDrag([0.02, 0.06], [0, 0, 0], classifyFace([1, 0, 0], 'cylinder'), 0.01)
    expect(rad.dims[0]).toBeCloseTo(0.025)
    expect(rad.origin).toEqual([0, 0, 0]) // symmetric → no shift
  })
  it('clamps to a minimum', () => {
    const r = resizeFromDrag([0.04, 0.04, 0.04], [0, 0, 0], classifyFace([1, 0, 0], 'box'), -1)
    expect(r.dims[0]).toBe(0.002)
  })
})

describe('URDF primitive text helpers (#315a)', () => {
  const base = blankUrdf('bot') // one base_link box

  it('adds a primitive as a link + fixed joint onto the selected parent', () => {
    const { urdf, link } = addPrimitive(base, { kind: 'box', parent: 'base_link' })
    expect(link).toBe('box')
    expect(urdf).toContain('<joint name="box_joint" type="fixed">')
    expect(urdf).toContain('<parent link="base_link"/>')
    const a = parseAssembly(urdf)
    expect(a.find((i) => i.link === 'box')?.kind).toBe('box')
  })

  it('cylinder + sphere primitives round-trip via readPrimitive', () => {
    let u = base
    u = addPrimitive(u, { kind: 'cylinder' }).urdf
    u = addPrimitive(u, { kind: 'sphere' }).urdf
    expect(readPrimitive(u, 'cylinder')).toEqual({ kind: 'cylinder', dims: [0.02, 0.06], origin: [0, 0, 0] })
    expect(readPrimitive(u, 'sphere')).toEqual({ kind: 'sphere', dims: [0.03], origin: [0, 0, 0] })
  })

  it('setPrimitiveSize rewrites ONLY the target link, leaving siblings byte-identical', () => {
    const two = addPrimitive(base, { kind: 'box', linkBase: 'arm' }).urdf
    const before = two
    const after = setPrimitiveSize(two, 'arm', [0.1, 0.02, 0.02])
    expect(readPrimitive(after, 'arm')?.dims).toEqual([0.1, 0.02, 0.02])
    // base_link's box is untouched
    expect(readPrimitive(after, 'base_link')?.dims).toEqual(readPrimitive(before, 'base_link')?.dims)
    // the file still parses to the same links
    expect(parseAssembly(after).map((i) => i.link)).toEqual(parseAssembly(before).map((i) => i.link))
  })

  it('setVisualOrigin inserts then updates the visual origin', () => {
    const u = setVisualOrigin(base, 'base_link', [0.01, 0, 0])
    expect(readPrimitive(u, 'base_link')?.origin).toEqual([0.01, 0, 0])
    const u2 = setVisualOrigin(u, 'base_link', [0.02, 0, 0])
    expect(readPrimitive(u2, 'base_link')?.origin).toEqual([0.02, 0, 0])
    expect((u2.match(/<origin/g) || []).length).toBe(1) // not duplicated
  })

  it('setJointOrigin moves a part (patches only its joint)', () => {
    const u = addPrimitive(base, { kind: 'box', linkBase: 'head' }).urdf
    const moved = setJointOrigin(u, 'head', [0, 0, 0.1])
    expect(moved).toContain('<origin xyz="0 0 0.1" rpy="0 0 0"/>')
    expect(moved).toContain('<child link="head"/>')
  })

  it('removeLink drops the link AND its owning joint', () => {
    const u = addPrimitive(base, { kind: 'sphere', linkBase: 'eye' }).urdf
    const rm = removeLink(u, 'eye')
    expect(parseAssembly(rm).map((i) => i.link)).not.toContain('eye')
    expect(rm).not.toContain('eye_joint')
    expect(parseAssembly(rm).map((i) => i.link)).toContain('base_link') // sibling survives
  })

  it('removeLink CASCADES a non-leaf block (no dangling joint that crashes the loader)', () => {
    // base_link → arm → hand ; deleting arm must also drop hand + both joints.
    let u = addPrimitive(base, { kind: 'box', linkBase: 'arm', parent: 'base_link' }).urdf
    u = addPrimitive(u, { kind: 'box', linkBase: 'hand', parent: 'arm' }).urdf
    const rm = removeLink(u, 'arm')
    const links = parseAssembly(rm).map((i) => i.link)
    expect(links).toEqual(['base_link'])
    expect(rm).not.toContain('link="arm"') // no dangling parent/child ref
    expect(rm).not.toMatch(/hand/)
  })

  it('setPrimitiveSize / readPrimitive ignore a sibling <collision> geometry', () => {
    const withCollision = `<?xml version="1.0"?>\n<robot name="c">\n  <link name="base_link">\n    <visual><origin xyz="0 0 0"/><geometry><box size="0.04 0.04 0.04"/></geometry></visual>\n    <collision><geometry><box size="0.9 0.9 0.9"/></geometry></collision>\n  </link>\n</robot>\n`
    expect(readPrimitive(withCollision, 'base_link')?.dims).toEqual([0.04, 0.04, 0.04]) // NOT the collision box
    const resized = setPrimitiveSize(withCollision, 'base_link', [0.1, 0.04, 0.04])
    expect(resized).toContain('<box size="0.9 0.9 0.9"/>') // collision untouched
    expect(readPrimitive(resized, 'base_link')?.dims).toEqual([0.1, 0.04, 0.04])
  })

  it('reads a cylinder written in open/close form', () => {
    const u = `<robot name="c"><link name="base_link"><visual><geometry><cylinder radius="0.02" length="0.06"></cylinder></geometry></visual></link></robot>`
    expect(readPrimitive(u, 'base_link')).toEqual({ kind: 'cylinder', dims: [0.02, 0.06], origin: [0, 0, 0] })
  })

  it('preserves comments + materials across an edit', () => {
    const withComment = `<?xml version="1.0"?>\n<!-- keep me -->\n<robot name="c">\n  <material name="steel"><color rgba="0.6 0.6 0.6 1"/></material>\n  <link name="base_link"><visual><geometry><box size="0.04 0.04 0.04"/></geometry></visual></link>\n</robot>\n`
    const edited = setPrimitiveSize(addPrimitive(withComment, { kind: 'box' }).urdf, 'base_link', [0.08, 0.04, 0.04])
    expect(edited).toContain('<!-- keep me -->')
    expect(edited).toContain('<material name="steel">')
  })
})
