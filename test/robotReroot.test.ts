import { describe, it, expect } from 'vitest'
import { addPrimitive, blankUrdf, rootLink, readJoint, readAllJoints } from '../src/renderer/src/components/robot-assembly'
import { reRoot, canReRoot } from '../src/renderer/src/components/robot-reroot'

/** base_link → arm → hand (a 3-link chain of fixed joints). */
function chain(): string {
  let u = addPrimitive(blankUrdf('bot'), { kind: 'box', linkBase: 'arm', parent: 'base_link' }).urdf
  u = addPrimitive(u, { kind: 'box', linkBase: 'hand', parent: 'arm' }).urdf
  return u
}

describe('reRoot (#309 base object)', () => {
  it('makes a child the root, reversing the joint + negating its origin', () => {
    const u = reRoot(chain(), 'arm')
    expect(rootLink(u)).toBe('arm')
    const j = readAllJoints(u).find((x) => x.name === 'arm_joint')!
    expect(j.parent).toBe('arm') // was base_link → arm
    expect(j.child).toBe('base_link')
    expect(j.xyz).toEqual([-0.06, 0, 0]) // origin negated (rpy=0)
  })

  it('re-roots the deepest link, reversing the whole chain', () => {
    const u = reRoot(chain(), 'hand')
    expect(rootLink(u)).toBe('hand')
    const byName = new Map(readAllJoints(u).map((j) => [j.name, j]))
    expect(byName.get('hand_joint')!.parent).toBe('hand') // hand → arm
    expect(byName.get('hand_joint')!.child).toBe('arm')
    expect(byName.get('arm_joint')!.parent).toBe('arm') // arm → base_link
    expect(byName.get('arm_joint')!.child).toBe('base_link')
  })

  it('leaves off-path sub-trees hanging where they were', () => {
    // base_link has TWO children: arm and leg. Re-root at arm.
    const two = addPrimitive(chain(), { kind: 'box', linkBase: 'leg', parent: 'base_link' }).urdf
    const u = reRoot(two, 'arm')
    expect(rootLink(u)).toBe('arm')
    const byName = new Map(readAllJoints(u).map((j) => [j.name, j]))
    expect(byName.get('leg_joint')!.parent).toBe('base_link') // untouched
    expect(byName.get('hand_joint')!.parent).toBe('arm') // untouched (already below arm)
  })

  it('keeps a movable joint on the path movable (type/axis/limit survive)', () => {
    const j0 = readJoint(chain(), 'arm')! // fixed
    let u = chain()
    // Make arm_joint a hinge, then re-root at arm.
    u = u.replace(
      '<joint name="arm_joint" type="fixed">',
      '<joint name="arm_joint" type="revolute">'
    ).replace('</joint>', '  <axis xyz="0 0 1"/>\n    <limit lower="-1" upper="1" effort="1" velocity="1"/>\n  </joint>')
    const r = readAllJoints(reRoot(u, 'arm')).find((x) => x.name === 'arm_joint')!
    expect(j0.type).toBe('fixed')
    expect(r.type).toBe('revolute')
    expect(r.axis).toEqual([0, 0, 1])
    expect(r.limit).toEqual({ lower: -1, upper: 1 })
  })

  it('round-trips a joint with a non-zero rpy (three.js inversion is exact)', () => {
    const urdf = `<robot name="r"><link name="a"/><link name="b"/>
      <joint name="j" type="fixed"><parent link="a"/><child link="b"/>
        <origin xyz="0.1 0.2 0.3" rpy="0.1 -0.2 0.35"/></joint></robot>`
    const back = reRoot(reRoot(urdf, 'b'), 'a') // there and back
    const j = readJoint(back, 'b')!
    expect(j.xyz[0]).toBeCloseTo(0.1, 4)
    expect(j.xyz[1]).toBeCloseTo(0.2, 4)
    expect(j.xyz[2]).toBeCloseTo(0.3, 4)
    expect(j.rpy[0]).toBeCloseTo(0.1, 4)
    expect(j.rpy[1]).toBeCloseTo(-0.2, 4)
    expect(j.rpy[2]).toBeCloseTo(0.35, 4)
  })

  it('canReRoot / reRoot are no-ops for the root, unknown links and cycles', () => {
    const u = chain()
    expect(canReRoot(u, 'base_link')).toBe(false) // already the root
    expect(canReRoot(u, 'ghost')).toBe(false)
    expect(canReRoot(u, 'arm')).toBe(true)
    expect(reRoot(u, 'base_link')).toBe(u)
    expect(reRoot(u, 'ghost')).toBe(u)
  })
})
