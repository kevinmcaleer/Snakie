import { describe, it, expect } from 'vitest'
import {
  parseAssembly,
  meshFiles,
  rootLink,
  uniqueLinkName,
  addMeshLink,
  blankUrdf,
  connectJoint,
  orientJoint,
  subtreeOf,
  readAllJoints
} from '../src/renderer/src/components/robot-assembly'

const URDF = `<?xml version="1.0"?>
<robot name="arm">
  <link name="base_link">
    <visual><geometry><box size="0.1 0.1 0.04"/></geometry></visual>
  </link>
  <link name="upper">
    <visual><geometry><mesh filename="meshes/upper.stl"/></geometry></visual>
  </link>
  <link name="tip"/>
  <joint name="j1" type="revolute">
    <parent link="base_link"/><child link="upper"/>
  </joint>
  <joint name="j2" type="fixed">
    <parent link="upper"/><child link="tip"/>
  </joint>
</robot>`

describe('parseAssembly + meshFiles (#309)', () => {
  it('lists links with their geometry kind', () => {
    const a = parseAssembly(URDF)
    expect(a).toEqual([
      { link: 'base_link', kind: 'box' },
      { link: 'upper', kind: 'mesh', mesh: 'meshes/upper.stl' },
      { link: 'tip', kind: 'none' }
    ])
  })
  it('collects distinct mesh files', () => {
    expect(meshFiles(URDF)).toEqual(['meshes/upper.stl'])
  })
})

describe('rootLink + uniqueLinkName (#309)', () => {
  it('finds the link that is never a child', () => {
    expect(rootLink(URDF)).toBe('base_link')
  })
  it('makes a safe, unique link name', () => {
    expect(uniqueLinkName(URDF, 'wheel')).toBe('wheel')
    expect(uniqueLinkName(URDF, 'upper')).toBe('upper_2')
    expect(uniqueLinkName(URDF, 'left wheel!')).toBe('left_wheel')
  })
})

describe('addMeshLink (#309)', () => {
  it('appends a link + fixed joint before </robot>, parented to the root', () => {
    const { urdf, link } = addMeshLink(URDF, { meshRel: 'meshes/wheel.stl', linkBase: 'wheel' })
    expect(link).toBe('wheel')
    expect(urdf).toContain('<mesh filename="meshes/wheel.stl"/>')
    expect(urdf).toContain('<joint name="wheel_joint" type="fixed">')
    expect(urdf).toContain('<parent link="base_link"/>')
    expect(urdf.indexOf('wheel_joint')).toBeLessThan(urdf.indexOf('</robot>'))
    // the new link now parses back out
    expect(parseAssembly(urdf).some((i) => i.link === 'wheel' && i.mesh === 'meshes/wheel.stl')).toBe(
      true
    )
  })
  it('avoids a name collision', () => {
    const { link } = addMeshLink(URDF, { meshRel: 'meshes/upper.stl', linkBase: 'upper' })
    expect(link).toBe('upper_2')
  })
  it('adds just a link (no joint) to an empty robot', () => {
    const empty = `<robot name="e"></robot>`
    const { urdf, link } = addMeshLink(empty, { meshRel: 'meshes/x.stl', linkBase: 'x' })
    expect(link).toBe('x')
    expect(urdf).toContain('<link name="x">')
    expect(urdf).not.toContain('<joint')
  })
})

describe('connectJoint — the Join tool (#354)', () => {
  // base_link → upper → tip. Re-parent `tip` under `base_link`.
  it('re-parents an existing child, rewriting parent + origin, keeping type', () => {
    const out = connectJoint(URDF, { parent: 'base_link', child: 'tip', xyz: [0.01, 0, 0.02] })
    const tipJoint = readAllJoints(out).find((j) => j.child === 'tip')!
    expect(tipJoint.parent).toBe('base_link')
    expect(tipJoint.type).toBe('fixed') // preserved
    expect(tipJoint.xyz).toEqual([0.01, 0, 0.02])
    // The other joint (base_link → upper) is untouched.
    expect(readAllJoints(out).find((j) => j.child === 'upper')!.parent).toBe('base_link')
  })

  it('preserves a revolute joint type when re-parenting to a sibling', () => {
    // base → armA (revolute), base → armB (fixed). Re-home armA under armB.
    const branched = `<?xml version="1.0"?>
<robot name="r">
  <link name="base"/>
  <link name="armA"/>
  <link name="armB"/>
  <joint name="jA" type="revolute"><parent link="base"/><child link="armA"/><axis xyz="0 0 1"/><limit lower="-1" upper="1" effort="1" velocity="1"/></joint>
  <joint name="jB" type="fixed"><parent link="base"/><child link="armB"/></joint>
</robot>`
    const out = connectJoint(branched, { parent: 'armB', child: 'armA' })
    const j = readAllJoints(out).find((x) => x.child === 'armA')!
    expect(j.parent).toBe('armB')
    expect(j.type).toBe('revolute')
  })

  it('refuses a cycle (parent inside the child subtree) — returns unchanged', () => {
    // `tip` is a descendant of `upper`; attaching upper under tip would loop.
    expect(connectJoint(URDF, { parent: 'tip', child: 'base_link' })).toBe(URDF)
    expect(connectJoint(URDF, { parent: 'upper', child: 'base_link' })).toBe(URDF)
  })

  it('refuses a no-op (same link / empty)', () => {
    expect(connectJoint(URDF, { parent: 'upper', child: 'upper' })).toBe(URDF)
    expect(connectJoint(URDF, { parent: '', child: 'tip' })).toBe(URDF)
  })

  it('creates a fixed joint for an orphan child that has none', () => {
    // Two unconnected links (no joints) — `b` is an orphan. Join it under `a`.
    const twoRoots = `<?xml version="1.0"?>
<robot name="r">
  <link name="a"><visual><geometry><box size="0.1 0.1 0.1"/></geometry></visual></link>
  <link name="b"><visual><geometry><box size="0.1 0.1 0.1"/></geometry></visual></link>
</robot>`
    const out = connectJoint(twoRoots, { parent: 'a', child: 'b', xyz: [0, 0, 0.05] })
    const j = readAllJoints(out).find((x) => x.child === 'b')!
    expect(j.parent).toBe('a')
    expect(j.type).toBe('fixed')
    expect(j.xyz).toEqual([0, 0, 0.05])
  })

  it('re-parents a joint authored with the OPEN <parent></parent> form (#354 review)', () => {
    // The self-closing-only regex used to leave this parent untouched.
    const openForm = `<?xml version="1.0"?>
<robot name="r">
  <link name="base_link"/>
  <link name="arm"/>
  <link name="wheel"/>
  <joint name="j_arm" type="fixed"><parent link="base_link"/><child link="arm"/></joint>
  <joint name="j_wheel" type="fixed">
    <parent link="base_link"></parent>
    <child link="wheel"></child>
    <origin xyz="0 0 0" rpy="0 0 0"></origin>
  </joint>
</robot>`
    const out = connectJoint(openForm, { parent: 'arm', child: 'wheel', xyz: [0.01, 0, 0] })
    const j = readAllJoints(out).find((x) => x.child === 'wheel')!
    expect(j.parent).toBe('arm') // actually re-parented, not just moved
    expect(j.xyz).toEqual([0.01, 0, 0])
    // Exactly one origin in the wheel joint (no duplicate).
    const wheelBlock = /<joint name="j_wheel"[\s\S]*?<\/joint>/.exec(out)![0]
    expect((wheelBlock.match(/<origin\b/g) || []).length).toBe(1)
    expect((wheelBlock.match(/<child\b/g) || []).length).toBe(1)
  })

  it('orientJoint swaps parent/child when the chosen order would loop', () => {
    // base → upper → tip. Making `tip` the parent of `upper` would loop.
    expect(orientJoint(URDF, 'tip', 'upper')).toEqual({ parent: 'upper', child: 'tip' })
    // The already-valid order is kept as-is.
    expect(orientJoint(URDF, 'base_link', 'tip')).toEqual({ parent: 'base_link', child: 'tip' })
    // Two unrelated siblings: keep `a` as the parent (either order is fine).
    const branched = `<?xml version="1.0"?>
<robot name="r">
  <link name="base"/><link name="l"/><link name="r"/>
  <joint name="jl" type="fixed"><parent link="base"/><child link="l"/></joint>
  <joint name="jr" type="fixed"><parent link="base"/><child link="r"/></joint>
</robot>`
    expect(orientJoint(branched, 'l', 'r')).toEqual({ parent: 'l', child: 'r' })
  })

  it('supports a CHAIN of joints — a second connect keeps the first (#354 IK chains)', () => {
    // base → a, base → b, base → c (all fixed to base).
    const flat = `<?xml version="1.0"?>
<robot name="r">
  <link name="base"/>
  <link name="a"/>
  <link name="b"/>
  <link name="c"/>
  <joint name="ja" type="fixed"><parent link="base"/><child link="a"/></joint>
  <joint name="jb" type="fixed"><parent link="base"/><child link="b"/></joint>
  <joint name="jc" type="fixed"><parent link="base"/><child link="c"/></joint>
</robot>`
    let out = connectJoint(flat, { parent: 'a', child: 'b' }) // b under a
    out = connectJoint(out, { parent: 'b', child: 'c' }) // c under b (chain a→b→c)
    const js = readAllJoints(out)
    expect(js.find((x) => x.child === 'b')!.parent).toBe('a') // first join intact
    expect(js.find((x) => x.child === 'c')!.parent).toBe('b') // second join
    expect(js.find((x) => x.child === 'a')!.parent).toBe('base') // untouched
    // Still exactly 3 joints (no dupes / drops).
    expect(js.length).toBe(3)
  })

  it('subtreeOf collects a link + its descendants', () => {
    expect([...subtreeOf(URDF, 'base_link')].sort()).toEqual(['base_link', 'tip', 'upper'])
    expect([...subtreeOf(URDF, 'upper')].sort()).toEqual(['tip', 'upper'])
    expect([...subtreeOf(URDF, 'tip')]).toEqual(['tip'])
  })
})

describe('blankUrdf — new robot starter', () => {
  it('is a valid single-link URDF the parser accepts', () => {
    const u = blankUrdf('My Robot!')
    expect(u).toContain('<robot name="My_Robot">') // sanitised name
    const a = parseAssembly(u)
    expect(a).toEqual([{ link: 'base_link', kind: 'box' }])
    expect(rootLink(u)).toBe('base_link')
  })
  it('an imported mesh attaches to its base_link', () => {
    const { urdf, link } = addMeshLink(blankUrdf(), { meshRel: 'meshes/w.stl', linkBase: 'w' })
    expect(link).toBe('w')
    expect(urdf).toContain('<parent link="base_link"/>')
  })
})
