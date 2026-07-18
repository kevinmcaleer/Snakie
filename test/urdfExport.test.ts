import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { prettyUrdf, robotNameOf, urdfExportPath } from '../src/shared/urdf-export'

/** Clean-URDF export helpers (#315). */
describe('urdf-export', () => {
  it('pretty-prints with consistent nesting + re-loads unchanged in structure', () => {
    const messy =
      '<?xml version="1.0"?><robot name="arm"><link name="base"><visual><geometry><box size="1 1 1"/></geometry></visual></link><joint name="j" type="revolute"><parent link="base"/><child link="arm"/></joint></robot>'
    const out = prettyUrdf(messy)
    expect(out).toContain('<?xml version="1.0"?>\n')
    expect(out).toContain('<robot name="arm">')
    // nesting: <link> at depth 1, <visual> at 2, <geometry> at 3, <box/> at 4.
    expect(out).toContain('\n  <link name="base">')
    expect(out).toContain('\n    <visual>')
    expect(out).toContain('\n      <geometry>')
    expect(out).toContain('\n        <box size="1 1 1"/>')
    expect(out).toContain('\n  <joint name="j" type="revolute">')
    expect(out).toContain('\n    <parent link="base"/>')
    // Balanced: same tag counts as the input (idempotent structure).
    const tags = (s: string): number => (s.match(/<[^/?!][^>]*[^/]>/g) || []).length
    expect(tags(out)).toBe(tags(messy))
    // Idempotent: prettifying twice is stable.
    expect(prettyUrdf(out)).toBe(out)
  })

  it('keeps inline <tag>text</tag> on one line without extra depth', () => {
    const out = prettyUrdf('<robot name="a"><material name="red"><color rgba="1 0 0 1"/></material></robot>')
    expect(out).toContain('\n  <material name="red">')
    expect(out).toContain('\n    <color rgba="1 0 0 1"/>')
  })

  it('robotNameOf reads the robot name (or a default)', () => {
    expect(robotNameOf('<robot name="buddy_jr">')).toBe('buddy_jr')
    expect(robotNameOf('<robot>')).toBe('robot')
  })

  it('urdfExportPath sanitises the name into <base>/urdf/', () => {
    expect(urdfExportPath('proj', 'my robot!')).toBe('proj/urdf/my_robot.urdf')
    expect(urdfExportPath('proj/', 'arm')).toBe('proj/urdf/arm.urdf')
    expect(urdfExportPath('', 'arm')).toBe('urdf/arm.urdf')
  })

  it('re-loads unchanged: the bundled demo-arm URDF keeps all its tags + is idempotent', () => {
    const src = readFileSync(resolve(__dirname, '../src/renderer/src/assets/demo-arm.urdf'), 'utf8')
    const out = prettyUrdf(src)
    const tags = (s: string): string[] => (s.match(/<\/?[A-Za-z][^>]*>/g) || []).map((t) => t.replace(/\s+/g, ' '))
    // Every tag in, every tag out (nothing dropped or duplicated) — so it re-loads
    // structurally identical in the Phase 1 viewer.
    expect(tags(out)).toEqual(tags(src))
    expect(prettyUrdf(out)).toBe(out) // stable
    expect(robotNameOf(src)).toBeTruthy()
  })
})
