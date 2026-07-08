import { describe, it, expect } from 'vitest'
import {
  parseAssembly,
  meshFiles,
  rootLink,
  uniqueLinkName,
  addMeshLink,
  blankUrdf
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
