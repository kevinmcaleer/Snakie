import { describe, expect, it } from 'vitest'
import { MESH_EXTENSIONS, meshAssetName, resolveMeshTarget } from '../src/shared/part-mesh-file'

/**
 * Where a linked mesh lands (#741).
 *
 * The destination is shared ground — the bundled seeder writes into a part
 * folder, `git` writes into it, and the user writes into it. #750 was paid for
 * by a writer that assumed it was the only author, so the property that matters
 * here is a SAFETY one, asserted directly rather than implied by examples:
 *
 *   an import never claims a name that is already taken, unless that name is
 *   the mesh this very part currently references.
 */

/** A stand-in part folder: a few unrelated files plus one mesh. */
const FOLDER = ['parts.yml', 'help.md', 'image.png', 'model.stl', 'datasheet.pdf']

describe('meshAssetName', () => {
  it('takes the basename off any platform’s path', () => {
    expect(meshAssetName('/Users/kev/Downloads/Battery.stl')).toBe('battery.stl')
    expect(meshAssetName('C:\\Users\\kev\\Desktop\\Battery.STL')).toBe('battery.stl')
    expect(meshAssetName('battery.stl')).toBe('battery.stl')
  })

  it('squeezes the stem to something every filesystem and zip agrees about', () => {
    expect(meshAssetName('/tmp/9V PP3 Battery (v2).stl')).toBe('9v-pp3-battery-v2.stl')
    expect(meshAssetName('/tmp/Ärger…mesh.stl')).toBe('rger-mesh.stl')
    expect(meshAssetName('/tmp/---.stl')).toBe('model.stl')
  })

  it('never produces a name with a separator in it — the containment guard depends on that', () => {
    for (const src of ['../../../etc/passwd.stl', '/a/b/../c.stl', 'x/y\\z.stl']) {
      const name = meshAssetName(src)
      expect(name, src).not.toBeNull()
      expect(name!, src).not.toMatch(/[/\\]/)
      expect(name!, src).not.toContain('..')
    }
  })

  it('accepts exactly the kinds the loader can open, and nothing else', () => {
    for (const ext of MESH_EXTENSIONS) expect(meshAssetName(`m.${ext}`)).toBe(`m.${ext}`)
    for (const bad of ['m.obj', 'm.glb', 'm.step', 'm.png', 'm', '.stl', '']) {
      expect(meshAssetName(bad), bad).toBeNull()
    }
  })

  it('keeps the extension the file actually had', () => {
    expect(meshAssetName('/tmp/arm.dae')).toBe('arm.dae')
    expect(meshAssetName('/tmp/arm.stl')).toBe('arm.stl')
  })
})

describe('resolveMeshTarget', () => {
  it('writes straight in when the name is free', () => {
    expect(resolveMeshTarget({ desired: 'battery.stl', taken: FOLDER })).toEqual({
      name: 'battery.stl',
      write: true
    })
  })

  // THE invariant. Everything else in this module is in service of it.
  it('never overwrites a file it did not author', () => {
    const cases: { desired: string; replaces?: string }[] = [
      { desired: 'model.stl' },
      { desired: 'parts.yml' }, // absurd, but the rule must not depend on taste
      { desired: 'help.md' },
      { desired: 'model.stl', replaces: 'other.stl' }
    ]
    for (const c of cases) {
      const t = resolveMeshTarget({ ...c, taken: FOLDER })
      if (t.write && FOLDER.includes(t.name)) {
        expect.fail(`would have overwritten ${t.name} (desired ${c.desired})`)
      }
    }
  })

  it('side-steps a collision with the next free -N, keeping the extension', () => {
    expect(resolveMeshTarget({ desired: 'model.stl', taken: FOLDER })).toEqual({
      name: 'model-2.stl',
      write: true
    })
    expect(
      resolveMeshTarget({ desired: 'model.stl', taken: [...FOLDER, 'model-2.stl', 'model-3.stl'] })
    ).toEqual({ name: 'model-4.stl', write: true })
  })

  it('replaces THIS part’s own model in place — a Replace button that renames is not one', () => {
    expect(resolveMeshTarget({ desired: 'model.stl', taken: FOLDER, replaces: 'model.stl' })).toEqual({
      name: 'model.stl',
      write: true
    })
  })

  it('re-linking the exact same bytes copies nothing and litters nothing', () => {
    // Idempotence: the answer to "link this file" is the same file, twice over.
    const once = resolveMeshTarget({ desired: 'model.stl', taken: FOLDER, identical: ['model.stl'] })
    expect(once).toEqual({ name: 'model.stl', write: false })
    const twice = resolveMeshTarget({
      desired: 'model.stl',
      taken: FOLDER,
      identical: ['model.stl']
    })
    expect(twice).toEqual(once)
  })

  it('finds an identical file already parked under a -N name', () => {
    expect(
      resolveMeshTarget({
        desired: 'model.stl',
        taken: [...FOLDER, 'model-2.stl'],
        identical: ['model-2.stl']
      })
    ).toEqual({ name: 'model-2.stl', write: false })
  })

  it('re-saving an unchanged current model writes nothing', () => {
    expect(
      resolveMeshTarget({
        desired: 'model.stl',
        taken: FOLDER,
        identical: ['model.stl'],
        replaces: 'model.stl'
      })
    ).toEqual({ name: 'model.stl', write: false })
  })

  it('always answers with the extension it was asked about', () => {
    for (const desired of ['a.stl', 'a.dae']) {
      const ext = desired.slice(desired.lastIndexOf('.'))
      const taken = ['a.stl', 'a.dae', 'a-2.stl', 'a-2.dae']
      expect(resolveMeshTarget({ desired, taken }).name.endsWith(ext), desired).toBe(true)
    }
  })

  it('an empty folder is not a special case', () => {
    expect(resolveMeshTarget({ desired: 'a.stl' })).toEqual({ name: 'a.stl', write: true })
    expect(resolveMeshTarget({ desired: 'a.stl', taken: [] })).toEqual({ name: 'a.stl', write: true })
  })
})
