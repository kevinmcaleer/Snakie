/**
 * MESH LOADING (#742) — the ONE place a mesh file becomes geometry, a measurement
 * or a scene object.
 *
 * This existed three times before: twice in `RobotView` (once to MEASURE an
 * imported STL for the mm→m scale guess, once to LOAD meshes for the URDF
 * renderer) and once hand-rolled in the main process (`stlMaxDim` in
 * `src/main/robot/ipc.ts`). Two of those computed the same number by different
 * code, and that number drives the import scale — the thing that produces a part
 * a thousand times too big when it disagrees.
 *
 * The main-process twin STAYS: it runs where three.js isn't available, so the
 * import heuristic works without the renderer. It is the deliberate second
 * implementation of {@link maxSpan}, and `test/meshMeasure.test.ts` holds the two
 * against the same fixtures so a file they disagree about fails CI.
 *
 * Separate from `robot-mesh.ts` on purpose: that module is pure path logic and
 * deliberately three-free (cheap to unit-test, no three.js dragged into other
 * bundles). The heavy parsers live here, imported only from the lazily-loaded
 * views that actually render.
 */
import * as THREE from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js'
import { dirname, meshKind } from './robot-mesh'

/** The default surface for a mesh whose URDF declares no material (#319). */
export function neutralMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.1, roughness: 0.85 })
}

/**
 * The X-rotation (radians) that puts a LOADED object into the part's own **Z-up**
 * frame — the frame URDF works in, and the one a part's `meshRotation` (#741) is
 * expressed in.
 *
 * The two loaders hand back objects in different frames and that difference has
 * to be spent somewhere:
 *
 *  - an **STL** carries no up-axis, and URDF/CAD convention makes it Z-up
 *    already → no correction;
 *  - a **DAE** declares its own `up_axis` and `ColladaLoader` has already applied
 *    it, leaving the scene Y-up like three itself → rotate it BACK by +90° so it
 *    speaks the same Z-up as everything else.
 *
 * A viewer then lays the whole Z-up stage down by −90° once, for three's Y-up
 * world. Net result for each kind is exactly what the views did before this
 * existed; the gain is that there is now a single frame in which a rotation
 * means the same thing for both.
 */
export function meshUpAxisFix(path: string): number {
  return meshKind(path) === 'dae' ? Math.PI / 2 : 0
}

/** A small wireframe cube standing in for a mesh that failed to load (#319). */
export function placeholderMesh(material: THREE.Material | null): THREE.Mesh {
  const mat = material ?? new THREE.MeshStandardMaterial({ color: 0xb4544e, wireframe: true })
  return new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.04), mat)
}

/**
 * The largest bounding-box span of a geometry, in the mesh's OWN units — the
 * number the mm→m import heuristic is thresholded on (see `meshImportScale` in
 * `robot-assembly.ts`, which owns that threshold). `0` for an empty geometry.
 */
export function maxSpan(geo: THREE.BufferGeometry): number {
  geo.computeBoundingBox()
  const size = new THREE.Vector3()
  geo.boundingBox?.getSize(size)
  const span = Math.max(size.x, size.y, size.z)
  return Number.isFinite(span) ? span : 0
}

/** Read + parse an STL into geometry. Rejects if the file can't be read/parsed. */
export async function loadStlGeometry(
  path: string,
  manager?: THREE.LoadingManager
): Promise<THREE.BufferGeometry> {
  const bytes = await window.api.fs.readFileBytes(path)
  return new STLLoader(manager).parse(bytes.buffer as ArrayBuffer)
}

/**
 * The largest span of the mesh at `path`, or `undefined` when it can't be
 * measured — a kind we don't parse, or an unreadable/undecodable file. Feed the
 * result to `meshImportScale(…, span)`, which turns it into a scale; `undefined`
 * there means "no measurement", leaving the declared units (or 1) to decide.
 */
export async function measureMeshFile(path: string): Promise<number | undefined> {
  if (meshKind(path) !== 'stl') return undefined
  try {
    return maxSpan(await loadStlGeometry(path))
  } catch {
    return undefined // unreadable / malformed — the caller falls back
  }
}

/**
 * Load a mesh file for RENDERING: an STL becomes a `Mesh` (given `material`, or
 * a neutral one), a DAE its parsed scene. Returns `null` for everything that
 * can't be shown — an unsupported kind (`.obj`/`.glb`), an unreadable file, a
 * parse failure, or a DAE with no scene — so one branch covers every failure and
 * the CALLER owns what a failure looks like (a placeholder, a note, a retry).
 */
export async function loadMeshObject(
  path: string,
  opts: { manager?: THREE.LoadingManager; material?: THREE.Material | null } = {}
): Promise<THREE.Object3D | null> {
  const kind = meshKind(path)
  try {
    if (kind === 'stl') {
      const geo = await loadStlGeometry(path, opts.manager)
      return new THREE.Mesh(geo, opts.material ?? neutralMaterial())
    }
    if (kind === 'dae') {
      const text = await window.api.fs.readFile(path)
      const dae = new ColladaLoader(opts.manager).parse(text, dirname(path) + '/')
      return dae?.scene ?? null
    }
    return null // unsupported kind
  } catch {
    return null
  }
}
