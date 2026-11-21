import { describe, expect, it } from 'vitest'
import { dataUrlBytes, modelFiles, pageTitle, urdfMeshRefs } from '../src/renderer/src/lib/share-project'

const URDF = `<robot name="openduck">
  <link name="body"><visual><geometry><mesh filename="package://openduck/meshes/body.stl" scale="0.001 0.001 0.001"/></geometry></visual></link>
  <link name="leg"><visual><geometry><mesh filename='../stl/leg.STL'/></geometry></visual></link>
  <link name="leg2"><visual><geometry><mesh filename="../stl/leg.STL"/></geometry></visual></link>
  <link name="eye"><visual><geometry><mesh filename="meshes/eye.dae"/></geometry></visual></link>
  <link name="dupe"><visual><geometry><mesh filename="other/body.stl"/></geometry></visual></link>
</robot>`

describe('share project', () => {
  it('lists each mesh a URDF names once', () => {
    expect(urdfMeshRefs(URDF)).toEqual([
      'package://openduck/meshes/body.stl',
      '../stl/leg.STL',
      'meshes/eye.dae',
      'other/body.stl'
    ])
  })

  it('resolves the model files against the URDF folder, by unique name', () => {
    const { files, skipped } = modelFiles('/home/kev/openduck/', 'urdf/openduck.urdf', URDF)
    expect(files).toEqual([
      { path: '/home/kev/openduck/urdf/openduck.urdf', name: 'openduck.urdf' },
      { path: '/home/kev/openduck/urdf/meshes/body.stl', name: 'body.stl' },
      { path: '/home/kev/openduck/stl/leg.STL', name: 'leg.STL' }
    ])
    expect(skipped).toEqual(['meshes/eye.dae'])
  })

  it('handles Windows folders', () => {
    const { files } = modelFiles('C:\\Users\\kev\\openduck', 'urdf\\robot.urdf', '<robot/>')
    expect(files).toEqual([{ path: 'C:/Users/kev/openduck/urdf/robot.urdf', name: 'robot.urdf' }])
  })

  it('gives kevsrobots a long enough title', () => {
    expect(pageTitle('openduck')).toBe('openduck')
    expect(pageTitle('Arm')).toBe('Arm robot')
    expect(pageTitle('  ')).toBe('My Snakie robot')
  })

  it('reads a PNG data URL', () => {
    expect(dataUrlBytes('data:image/png;base64,iVBORw==')).toEqual(new Uint8Array([137, 80, 78, 71]))
    expect(dataUrlBytes(null)).toBeNull()
    expect(dataUrlBytes('nope')).toBeNull()
  })
})
