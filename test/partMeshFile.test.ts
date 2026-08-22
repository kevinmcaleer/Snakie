import { describe, expect, it } from 'vitest'
import {
  MESH_EXTENSIONS,
  MESH_MM_SPAN_THRESHOLD,
  inferMeshUnits,
  meshAssetName,
  resolveMeshTarget
} from '../src/shared/part-mesh-file'
import { meshImportScale } from '../src/renderer/src/components/robot-assembly'

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

/**
 * `meshUnits` AT LINK TIME (#787 fault 2).
 *
 * The 9V battery of #787 saved `mesh:` and `meshRotation:` but no `meshUnits:`.
 * An `.stl` records no units, so nothing downstream can recover them — the part
 * is then at the mercy of a heuristic every consumer re-runs for itself, and a
 * 48 mm battery read as 48 metres arrives 1000× too big.
 *
 * The property that matters is not the threshold but that the LINK-time
 * conclusion and the PLACE-time one are the SAME rule. If they could disagree,
 * writing the field down would make the part worse rather than better.
 */
describe('inferMeshUnits — what the link step writes down', () => {
  it('reads a model measured in the tens or hundreds as millimetres', () => {
    expect(inferMeshUnits(48.5)).toBe('mm') // the 9V battery of #787
    expect(inferMeshUnits(3.5)).toBe('mm')
  })

  it('reads a model well under a metre across as metres', () => {
    expect(inferMeshUnits(0.0485)).toBe('m')
    expect(inferMeshUnits(MESH_MM_SPAN_THRESHOLD)).toBe('m')
  })

  it('declines to guess when the file could not be measured', () => {
    // Absence keeps the existing bbox fallback; a made-up value would not.
    for (const bad of [undefined, 0, -1, NaN, Infinity]) {
      expect(inferMeshUnits(bad as number | undefined), String(bad)).toBeUndefined()
    }
  })

  it('agrees with the scale the PLACEMENT path picks, for every span', () => {
    for (const span of [0.001, 0.05, 1, 2.999, 3, 3.001, 48.5, 250, 1e4]) {
      const units = inferMeshUnits(span)
      expect(units, String(span)).toBeDefined()
      expect(meshImportScale({ meshUnits: units }, span), String(span)).toBe(
        meshImportScale({}, span)
      )
    }
  })
})
