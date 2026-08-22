import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { maxSpan, meshUpAxisFix } from '../src/renderer/src/components/robot-mesh-load'
import { stlMaxDim } from '../src/main/robot/ipc'
import { meshImportScale } from '../src/renderer/src/components/robot-assembly'

/**
 * THE TWO MEASUREMENTS MUST AGREE (#742).
 *
 * An STL's largest span is computed twice on purpose: `maxSpan` (renderer, via
 * three.js) and `stlMaxDim` (main process, hand-rolled — three.js isn't
 * available there). That number picks the mm→m import scale, so if they ever
 * disagree about a file, one path ships a part a thousand times the size of the
 * other. These fixtures are the guard.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const gen = (await import('../scripts/modulino-mesh.mjs')) as any

/** The renderer's measurement, from raw bytes (what `loadStlGeometry` feeds it). */
function rendererSpan(buf: Buffer): number {
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  return maxSpan(new STLLoader().parse(ab))
}

/** A minimal ASCII STL — one triangle spanning `span` along x. */
function asciiStl(span: number): Buffer {
  return Buffer.from(
    [
      'solid test',
      '  facet normal 0 0 1',
      '    outer loop',
      '      vertex 0 0 0',
      `      vertex ${span} 0 0`,
      '      vertex 0 1 0',
      '    endloop',
      '  endfacet',
      'endsolid test'
    ].join('\n'),
    'utf-8'
  )
}

describe('renderer and main-process STL measurement agree', () => {
  it('on a real BINARY STL (the generated Modulino board)', () => {
    const stl = gen.toStl(gen.modulinoGroup()) as Buffer
    const main = stlMaxDim(stl)
    const renderer = rendererSpan(stl)
    expect(main).toBeDefined()
    expect(main!).toBeCloseTo(renderer, 4)
    // …and both see the board's real 41 mm long axis.
    expect(renderer).toBeCloseTo(gen.BOARD.lengthMm, 3)
  })

  it('on a binary STL with a topper (more triangles, same footprint)', () => {
    const stl = gen.toStl(gen.modulinoGroup('knob')) as Buffer
    expect(stlMaxDim(stl)!).toBeCloseTo(rendererSpan(stl), 4)
  })

  it('on an ASCII STL', () => {
    const stl = asciiStl(7.5)
    expect(stlMaxDim(stl)).toBeCloseTo(7.5, 6)
    expect(rendererSpan(stl)).toBeCloseTo(7.5, 6)
  })

  it('on an ASCII STL using exponent notation', () => {
    // The main parser's vertex regex has to accept a negative exponent; three's
    // does natively. This is exactly the sort of file the two could split on.
    const stl = Buffer.from(
      [
        'solid e',
        '  facet normal 0 0 1',
        '    outer loop',
        '      vertex 0 0 0',
        '      vertex 1.5e-3 0 0',
        '      vertex 0 1.0e-3 0',
        '    endloop',
        '  endfacet',
        'endsolid e'
      ].join('\n'),
      'utf-8'
    )
    expect(stlMaxDim(stl)!).toBeCloseTo(rendererSpan(stl), 9)
  })

  it('main returns undefined for a buffer that is not an STL at all', () => {
    expect(stlMaxDim(Buffer.from('not a mesh', 'utf-8'))).toBeUndefined()
    expect(stlMaxDim(Buffer.alloc(0))).toBeUndefined()
  })
})

describe('the mm→m heuristic reads the same either way', () => {
  it('a millimetre-authored board (41 mm span) scales down', () => {
    const stl = gen.toStl(gen.modulinoGroup()) as Buffer
    // Both measurements feed the ONE threshold in meshImportScale.
    expect(meshImportScale({}, stlMaxDim(stl))).toBe(0.001)
    expect(meshImportScale({}, rendererSpan(stl))).toBe(0.001)
  })

  it('a metre-scale mesh is left alone', () => {
    const stl = asciiStl(0.4) // 0.4 m — plausibly already metres
    expect(meshImportScale({}, stlMaxDim(stl))).toBe(1)
    expect(meshImportScale({}, rendererSpan(stl))).toBe(1)
  })

  it('an unmeasurable file falls back to no scaling', () => {
    expect(meshImportScale({}, undefined)).toBe(1)
  })

  it('a declared unit still beats the measurement', () => {
    // The heuristic is the LAST resort — an authored `meshUnits` wins.
    expect(meshImportScale({ meshUnits: 'm' }, 4000)).toBe(1)
    expect(meshImportScale({ meshScale: 0.5 }, 4000)).toBe(0.5)
  })
})

describe('maxSpan', () => {
  it('is the largest of the three axes', () => {
    const geo = new THREE.BoxGeometry(2, 9, 4)
    expect(maxSpan(geo)).toBeCloseTo(9, 6)
  })

  it('is 0 for an empty geometry rather than -Infinity', () => {
    expect(maxSpan(new THREE.BufferGeometry())).toBe(0)
  })
})

/**
 * ONE FRAME FOR BOTH KINDS (#741). A part's `meshRotation` is expressed in the
 * part's own Z-up frame, so a viewer has to get an STL and a DAE into that same
 * frame before applying it — otherwise the same stored numbers would mean two
 * different things depending on which file the user happened to download.
 */
describe('meshUpAxisFix', () => {
  it('leaves an STL alone — no up-axis of its own, so URDF/CAD Z-up applies', () => {
    expect(meshUpAxisFix('/parts/x/model.stl')).toBe(0)
    expect(meshUpAxisFix('/parts/x/MODEL.STL')).toBe(0)
  })

  it('un-does ColladaLoader’s Y-up so a DAE speaks the same Z-up', () => {
    expect(meshUpAxisFix('/parts/x/arm.dae')).toBeCloseTo(Math.PI / 2, 12)
  })

  it('composed with the viewer’s −90° stage, each kind ends where it did before', () => {
    // The stage lays the whole Z-up frame down by −90° for three's Y-up world.
    const stage = -Math.PI / 2
    expect(stage + meshUpAxisFix('m.stl')).toBeCloseTo(-Math.PI / 2, 12) // as PartMeshView always did
    expect(stage + meshUpAxisFix('m.dae')).toBeCloseTo(0, 12) // DAE left alone, as before
  })

  it('treats an unknown kind as already Z-up rather than guessing', () => {
    expect(meshUpAxisFix('m.obj')).toBe(0)
  })
})
