import { describe, it, expect } from 'vitest'
import { safeUrdfName } from '../src/renderer/src/components/robot-part-mesh'

describe('safeUrdfName — the part-drop URDF write guard (#406)', () => {
  it('accepts a bare in-project relative URDF name', () => {
    expect(safeUrdfName('robot.urdf')).toBe(true)
    expect(safeUrdfName('robot-2.urdf')).toBe(true)
    expect(safeUrdfName('robots/arm.urdf')).toBe(true) // a subfolder is still in-project
  })
  it('rejects an escaping / absolute robot.yml urdf: so a drop can’t write outside the project', () => {
    expect(safeUrdfName('../../evil.urdf')).toBe(false)
    expect(safeUrdfName('a/../../evil.urdf')).toBe(false)
    expect(safeUrdfName('/etc/evil.urdf')).toBe(false)
    expect(safeUrdfName('C:\\evil.urdf')).toBe(false)
    expect(safeUrdfName('..')).toBe(false)
    expect(safeUrdfName('')).toBe(false)
  })
})
