import { describe, it, expect } from 'vitest'
import {
  dirname,
  baseName,
  meshKind,
  isAbsolutePath,
  resolveMeshPath,
  isExternalMeshRef
} from '../src/renderer/src/components/robot-mesh'

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

describe('mesh path resolution + external classification (#407)', () => {
  it('isAbsolutePath spots POSIX, Windows-drive and UNC paths', () => {
    expect(isAbsolutePath('/home/x.stl')).toBe(true)
    expect(isAbsolutePath('C:\\r\\x.stl')).toBe(true)
    expect(isAbsolutePath('C:/r/x.stl')).toBe(true)
    expect(isAbsolutePath('\\\\srv\\share\\x.stl')).toBe(true)
    expect(isAbsolutePath('meshes/x.stl')).toBe(false)
    expect(isAbsolutePath('../x.stl')).toBe(false)
  })

  it('resolveMeshPath joins + normalises against the base (POSIX)', () => {
    expect(resolveMeshPath('/home/kev/proj', 'meshes/x.stl')).toBe('/home/kev/proj/meshes/x.stl')
    expect(resolveMeshPath('/home/kev/proj', './meshes/./x.stl')).toBe('/home/kev/proj/meshes/x.stl')
    expect(resolveMeshPath('/home/kev/proj', '../shared/x.stl')).toBe('/home/kev/shared/x.stl')
    expect(resolveMeshPath('/home/kev/proj', '/other/x.stl')).toBe('/other/x.stl') // absolute wins
    expect(resolveMeshPath('/home/kev/proj', 'meshes/x.stl?v=2')).toBe('/home/kev/proj/meshes/x.stl')
  })

  it('resolveMeshPath handles Windows separators + drive roots', () => {
    expect(resolveMeshPath('C:\\robots\\arm', 'meshes\\x.stl')).toBe('C:/robots/arm/meshes/x.stl')
    expect(resolveMeshPath('C:\\robots\\arm', '..\\shared\\x.stl')).toBe('C:/robots/shared/x.stl')
  })

  it('isExternalMeshRef: in-folder relatives + package:// + unrenderable kinds are NOT external', () => {
    const base = '/home/kev/proj'
    expect(isExternalMeshRef('meshes/x.stl', base)).toBe(false)
    expect(isExternalMeshRef('./x.dae', base)).toBe(false)
    expect(isExternalMeshRef('package://robot/meshes/x.stl', base)).toBe(false)
    expect(isExternalMeshRef('/home/kev/proj/meshes/x.stl', base)).toBe(false) // absolute, but inside
    expect(isExternalMeshRef('../other/x.obj', base)).toBe(false) // .obj can't render → left untouched
    expect(isExternalMeshRef('meshes/x.stl', '')).toBe(false) // no known folder → can't classify
  })

  it('isExternalMeshRef: paths escaping the folder subtree ARE external', () => {
    const base = '/home/kev/proj'
    expect(isExternalMeshRef('../shared/x.stl', base)).toBe(true)
    expect(isExternalMeshRef('/elsewhere/x.stl', base)).toBe(true)
    expect(isExternalMeshRef('/home/kev/proj-2/x.stl', base)).toBe(true) // sibling, not a prefix match
    expect(isExternalMeshRef('../shared/x.dae', base)).toBe(true)
  })

  it('isExternalMeshRef: an absolute in-folder ref counts as in-folder despite case (Win/macOS FS)', () => {
    // Case-insensitive filesystems: a differently-cased but in-folder absolute ref must
    // NOT be flagged external (which would spuriously offer to copy an in-project file).
    expect(isExternalMeshRef('/Users/kev/Proj/meshes/x.stl', '/Users/kev/proj')).toBe(false)
    // …but a genuine sibling is still external (the trailing-slash guard holds under fold).
    expect(isExternalMeshRef('/Users/kev/proj-backup/x.stl', '/Users/kev/proj')).toBe(true)
  })
})
