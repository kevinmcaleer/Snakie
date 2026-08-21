import { describe, expect, it } from 'vitest'
import {
  addBoxLink,
  blankUrdf,
  connectJoint,
  danglingJoints,
  parseAssembly,
  pruneDanglingJoints,
  readAllJoints,
  removeLink
} from '../src/renderer/src/components/robot-assembly'

/**
 * NO JOINT WITHOUT ITS CHILD LINK (#782 fault 3).
 *
 * The reported document carried `<joint name="SMARS_Chassis_1_joint">` whose
 * `<child link="SMARS_Chassis_1"/>` named a link that wasn't in the file. That
 * isn't a cosmetic flaw: a URDF is a tree built from its joints, so one
 * unresolvable child fails the WHOLE model in every consumer — the user loses
 * the robot, not the part.
 *
 * The rule enforced here is "prefer emitting neither over a dangling
 * reference", in both directions: nothing MINTS a joint for a link that isn't
 * there, and the write choke point PRUNES one it finds — because a URDF is
 * written by several surfaces (the placement bridge, the sync reconcile, the
 * 3-D builder, a hand edit) and only the write is common to all of them.
 */

/** base_link + one jointed body — what the placement bridge produces. */
function withBody(): string {
  return addBoxLink(blankUrdf('bot'), { linkBase: 'SMARS Chassis 1', size: [0.1, 0.06, 0.02] }).urdf
}

/** The reported shape: the joint survived, the link it attaches did not. */
function orphanedJoint(): string {
  const urdf = withBody()
  const start = urdf.indexOf('<link name="SMARS_Chassis_1">')
  const end = urdf.indexOf('</link>', start) + '</link>'.length
  return urdf.slice(0, start) + urdf.slice(end)
}

describe('danglingJoints — spotting the invalid document (#782)', () => {
  it('reports a joint whose child link is missing, and names it', () => {
    const found = danglingJoints(orphanedJoint())
    expect(found.map((j) => j.name)).toEqual(['SMARS_Chassis_1_joint'])
    expect(found[0].child).toBe('SMARS_Chassis_1')
  })
  it('reports a joint whose PARENT link is missing too — either end breaks the tree', () => {
    const urdf = withBody().replace('<link name="base_link">', '<link name="renamed_base">')
    expect(danglingJoints(urdf).map((j) => j.child)).toEqual(['SMARS_Chassis_1'])
  })
  it('a well-formed document has none', () => {
    expect(danglingJoints(withBody())).toEqual([])
    expect(danglingJoints(blankUrdf('bot'))).toEqual([])
  })
})

describe('pruneDanglingJoints — the write-time repair (#782)', () => {
  it('drops the stranded joint and leaves everything else byte-identical', () => {
    const broken = orphanedJoint()
    const fixed = pruneDanglingJoints(broken)
    expect(danglingJoints(fixed)).toEqual([])
    expect(readAllJoints(fixed)).toEqual([])
    // The surviving links are untouched — a repair must not cost the user
    // anything beyond the unloadable fragment.
    expect(parseAssembly(fixed).map((i) => i.link)).toEqual(['base_link'])
  })

  it('is the identity on a document that needs no repair', () => {
    // Safe to run on EVERY write: an untouched document must hash the same, or
    // the change bus fires on writes that changed nothing.
    for (const urdf of [blankUrdf('bot'), withBody(), '']) {
      expect(pruneDanglingJoints(urdf)).toBe(urdf)
    }
  })

  it('is idempotent, and keeps every joint whose ends both exist', () => {
    const two = addBoxLink(withBody(), { linkBase: 'Wheel', size: [0.03, 0.03, 0.03] }).urdf
    const once = pruneDanglingJoints(two)
    expect(once).toBe(two)
    expect(pruneDanglingJoints(once)).toBe(once)
    expect(readAllJoints(once).map((j) => j.child)).toEqual(['SMARS_Chassis_1', 'Wheel'])
  })

  it('leaves a joint it cannot parse alone rather than eating it', () => {
    // A joint with no readable parent/child is a hand-edit we don't understand.
    // Deleting it would be its own data loss; only DANGLING refs are pruned.
    const odd = withBody().replace(
      '</robot>',
      '  <joint name="mystery" type="fixed"></joint>\n</robot>'
    )
    expect(pruneDanglingJoints(odd)).toBe(odd)
  })
})

describe('connectJoint refuses to mint a joint for a link that is not there (#782)', () => {
  it('returns the document unchanged when the child does not exist', () => {
    const urdf = withBody()
    expect(connectJoint(urdf, { parent: 'base_link', child: 'never_made' })).toBe(urdf)
  })
  it('returns the document unchanged when the parent does not exist', () => {
    const urdf = withBody()
    expect(connectJoint(urdf, { parent: 'never_made', child: 'SMARS_Chassis_1' })).toBe(urdf)
  })
  it('still joins two links that do exist', () => {
    const urdf = addBoxLink(withBody(), { linkBase: 'Wheel', size: [0.03, 0.03, 0.03] }).urdf
    const out = connectJoint(urdf, { parent: 'SMARS_Chassis_1', child: 'Wheel', xyz: [0, 0.02, 0] })
    expect(readAllJoints(out).find((j) => j.child === 'Wheel')?.parent).toBe('SMARS_Chassis_1')
    expect(danglingJoints(out)).toEqual([])
  })
})

describe('the invariant holds across add/remove sequences (#782)', () => {
  it('no build-and-teardown order leaves a joint without its child', () => {
    // The property over the real editing ops: whatever you add and remove, and
    // in whatever order, the document never carries an unresolvable reference.
    const names = ['Chassis', 'Wheel', 'Arm', 'Gripper']
    for (const removeFirst of names) {
      let urdf = blankUrdf('bot')
      for (const n of names) {
        urdf = addBoxLink(urdf, { linkBase: n, size: [0.02, 0.02, 0.02] }).urdf
      }
      // Chain them so removals take subtrees with them.
      urdf = connectJoint(urdf, { parent: 'Chassis', child: 'Wheel' })
      urdf = connectJoint(urdf, { parent: 'Wheel', child: 'Arm' })
      urdf = connectJoint(urdf, { parent: 'Arm', child: 'Gripper' })
      expect(danglingJoints(urdf)).toEqual([])
      urdf = removeLink(urdf, removeFirst)
      expect(danglingJoints(urdf)).toEqual([])
      urdf = removeLink(urdf, 'base_link')
      expect(danglingJoints(urdf)).toEqual([])
    }
  })
})
