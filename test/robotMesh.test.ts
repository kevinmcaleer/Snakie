import { describe, it, expect } from 'vitest'
import { dirname, baseName, meshKind } from '../src/renderer/src/components/robot-mesh'

describe('robot-mesh path helpers (#319)', () => {
  it('dirname returns the folder (POSIX + Windows), empty at root', () => {
    expect(dirname('/home/kev/robot/arm.urdf')).toBe('/home/kev/robot')
    expect(dirname('C:\\robots\\arm.urdf')).toBe('C:\\robots')
    expect(dirname('arm.urdf')).toBe('')
  })

  it('baseName returns the final segment', () => {
    expect(baseName('/home/kev/robot/meshes/link.stl')).toBe('link.stl')
    expect(baseName('C:\\robots\\base.STL')).toBe('base.STL')
    expect(baseName('link.dae')).toBe('link.dae')
  })

  it('meshKind classifies stl/dae case-insensitively, null otherwise', () => {
    expect(meshKind('meshes/link.stl')).toBe('stl')
    expect(meshKind('meshes/LINK.STL')).toBe('stl')
    expect(meshKind('package://r/meshes/body.dae')).toBe('dae')
    expect(meshKind('meshes/body.DAE')).toBe('dae')
    // unsupported / no extension → null (caller shows a placeholder)
    expect(meshKind('meshes/body.obj')).toBe(null)
    expect(meshKind('meshes/body.glb')).toBe(null)
    expect(meshKind('meshes/body')).toBe(null)
  })

  it('meshKind tolerates a trailing query/fragment', () => {
    expect(meshKind('link.stl?v=2')).toBe('stl')
    expect(meshKind('body.dae#scene')).toBe('dae')
  })
})
