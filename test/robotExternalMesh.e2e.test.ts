import { describe, it, expect } from 'vitest'
import { promises as fsp } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, extname, join, dirname as pdir } from 'node:path'
import { externalMeshes, rewriteMeshFilename } from '../src/renderer/src/components/robot-assembly'

/**
 * End-to-end (#407): the "copy external meshes into the project" flow exercised
 * against a REAL filesystem. Replicates the main-process collision-safe copy
 * (`copyIntoMeshes`) and the RobotView handler's loop (copy each external ref,
 * rewrite each `<mesh filename>`, once), then proves the URDF is self-contained.
 */

// Mirror of src/main/robot/ipc.ts `copyIntoMeshes` — the code the IPC `src` branch runs.
async function copyIntoMeshes(urdfPath: string, src: string): Promise<{ rel: string; name: string }> {
  const meshesDir = join(pdir(urdfPath), 'meshes')
  await fsp.mkdir(meshesDir, { recursive: true })
  const ext = extname(src)
  const stem = basename(src, ext)
  let name = `${stem}${ext}`
  let n = 1
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await fsp.access(join(meshesDir, name))
      name = `${stem}-${n++}${ext}`
    } catch {
      break
    }
  }
  await fsp.copyFile(src, join(meshesDir, name))
  return { rel: `meshes/${name}`, name }
}

describe('copy external meshes into the project — real fs round-trip (#407)', () => {
  it('copies each out-of-folder mesh in + rewrites the URDF so nothing stays external', async () => {
    const root = await fsp.mkdtemp(join(tmpdir(), 'snakie-407-'))
    const proj = join(root, 'proj')
    const shared = join(root, 'shared')
    const opt = join(root, 'opt')
    await fsp.mkdir(proj, { recursive: true })
    await fsp.mkdir(shared, { recursive: true })
    await fsp.mkdir(opt, { recursive: true })
    // Two external meshes: one reached via `../` and one via an absolute path. One
    // in-folder mesh that must be left alone.
    await fsp.writeFile(join(shared, 'arm.stl'), 'ARM-BYTES')
    await fsp.writeFile(join(opt, 'servo.stl'), 'SERVO-BYTES')
    await fsp.mkdir(join(proj, 'meshes'), { recursive: true })
    await fsp.writeFile(join(proj, 'meshes', 'base.stl'), 'BASE-BYTES')

    const urdfPath = join(proj, 'robot.urdf')
    const urdf = `<?xml version="1.0"?>
<robot name="r">
  <link name="base"><visual><geometry><mesh filename="meshes/base.stl"/></geometry></visual></link>
  <link name="arm"><visual><geometry><mesh filename="../shared/arm.stl"/></geometry></visual></link>
  <link name="servo"><visual><geometry><mesh filename="${join(opt, 'servo.stl')}"/></geometry></visual></link>
</robot>`

    // The handler's loop: resolve externals, copy each in, accumulate rewrites, one commit.
    const externals = externalMeshes(urdf, proj)
    expect(externals.map((e) => e.ref)).toEqual(['../shared/arm.stl', join(opt, 'servo.stl')])

    let next = urdf
    for (const { ref, abs } of externals) {
      const { rel } = await copyIntoMeshes(urdfPath, abs)
      next = rewriteMeshFilename(next, ref, rel)
    }

    // Files landed in the project's meshes/ with their bytes intact.
    expect(await fsp.readFile(join(proj, 'meshes', 'arm.stl'), 'utf-8')).toBe('ARM-BYTES')
    expect(await fsp.readFile(join(proj, 'meshes', 'servo.stl'), 'utf-8')).toBe('SERVO-BYTES')
    // The URDF now points at in-project paths, and the in-folder ref is untouched.
    expect(next).toContain('<mesh filename="meshes/arm.stl"/>')
    expect(next).toContain('<mesh filename="meshes/servo.stl"/>')
    expect(next).toContain('<mesh filename="meshes/base.stl"/>')
    // Nothing is external any more → the offer clears.
    expect(externalMeshes(next, proj)).toEqual([])

    await fsp.rm(root, { recursive: true, force: true })
  })

  it('collision-safe copy: an external mesh whose name already exists lands beside it (-1)', async () => {
    const root = await fsp.mkdtemp(join(tmpdir(), 'snakie-407b-'))
    const proj = join(root, 'proj')
    const other = join(root, 'other')
    await fsp.mkdir(join(proj, 'meshes'), { recursive: true })
    await fsp.mkdir(other, { recursive: true })
    // A DIFFERENT arm.stl already sits in the project; the external one must not clobber it.
    await fsp.writeFile(join(proj, 'meshes', 'arm.stl'), 'ORIGINAL')
    await fsp.writeFile(join(other, 'arm.stl'), 'IMPORTED')

    const urdfPath = join(proj, 'robot.urdf')
    const { rel } = await copyIntoMeshes(urdfPath, join(other, 'arm.stl'))
    expect(rel).toBe('meshes/arm-1.stl')
    expect(await fsp.readFile(join(proj, 'meshes', 'arm.stl'), 'utf-8')).toBe('ORIGINAL')
    expect(await fsp.readFile(join(proj, 'meshes', 'arm-1.stl'), 'utf-8')).toBe('IMPORTED')

    await fsp.rm(root, { recursive: true, force: true })
  })
})
