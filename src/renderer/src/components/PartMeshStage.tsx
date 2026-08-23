import { useEffect, useRef, useState, type JSX } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { loadMeshObject, meshUpAxisFix, neutralMaterial } from './robot-mesh-load'
import { meshRotationRadians, type MeshRotation } from '../../../shared/mesh-rotation'
import type { MeshBounds, MeshOffset } from '../../../shared/mesh-offset'
import './PartMeshStage.css'

/**
 * THE PART EDITOR'S 3-D WORKBENCH (#741) — unique `pms__` BEM prefix.
 * =============================================================================
 *
 * Deliberately NOT `PartMeshView` (#748). That one is a shop window: it frames a
 * model on its own bounding box precisely so `meshUnits` / `meshScale` cannot
 * make it look wrong. This is the opposite instrument — the place you come to
 * BECAUSE something is wrong, so it must show:
 *
 *  - the model at its **effective scale**, in millimetres, against the part's
 *    declared `dimensions` drawn as a ghost footprint on the ground plane. A
 *    mesh authored in metres then reads as a speck and one in inches as a
 *    monster, which is #657's "obvious immediately";
 *  - **which way is up**. A ground grid at z = 0 and an axis triad, because
 *    "the correct orientation" means nothing without saying what correct is.
 *    Snakie's convention: board flat in XY, Z up, underside resting on z = 0.
 *
 * ## The frames, and their order
 *
 * Exactly the order the URDF uses, so what you square up here is what gets
 * placed in Build:
 *
 *   1. `meshUpAxisFix` puts the LOADED object into the part's own Z-up frame
 *      (an STL is already there; a DAE has been Y-upped by its loader);
 *   2. `scaled` applies millimetres-per-mesh-unit;
 *   3. `oriented` applies the part's stored `meshRotation` — a `THREE.Euler` in
 *      `'ZYX'` order, which is three's spelling of URDF's `rpy` product — AND
 *      its `meshOffset` as that same group's `position`. One group carries both
 *      deliberately: three composes an object's matrix as `T · R · S`, so the
 *      translation lands AFTER the rotation, in the part's frame — exactly what
 *      URDF's `<origin xyz rpy>` means and what `mesh-offset.ts` specifies;
 *   4. `root` lays the whole Z-up stage down −90° about X for three's Y-up world.
 *
 * Because step 4 is a quarter turn it PERMUTES axes rather than skewing them, so
 * a world-space bounding box converts back to part-space exactly — which is how
 * {@link measurePartFrame} reports a size in the part's own X/Y/Z.
 *
 * Imported lazily by the Part Editor, so three.js and the mesh parsers stay out
 * of the main renderer chunk.
 */

export interface PartMeshStageProps {
  /** Absolute path to the mesh file inside the part's own folder. */
  path: string
  /** The part's stored orientation correction (#741), degrees. */
  rotation?: MeshRotation | null
  /** The part's stored position correction (#788), millimetres in the part
   *  frame, applied AFTER the rotation. */
  offset?: MeshOffset | null
  /** Millimetres per mesh unit — the part's effective scale × 1000. */
  scaleMm: number
  /** The part's declared footprint in millimetres, for the ghost outline. */
  dimensions?: { width: number; height: number }
  /** What the model is OF, for the accessible name. */
  label: string
  /** What the loaded model measures, or `null` when it could not be loaded. */
  onMeasured?: (m: MeshMeasurement | null) => void
  /** Bump to re-frame the camera on the model. */
  fitSignal?: number
}

/** What the stage can tell the panel about the model it loaded. */
export interface MeshMeasurement {
  /** Largest bounding-box span in the mesh's OWN units — what the mm-vs-m
   *  heuristic (`meshImportScale`) is thresholded on. Independent of the applied
   *  scale, so feeding it back in is not circular. */
  rawSpan: number
  /** The model's size in the PART frame, millimetres, at the applied scale and
   *  AFTER the orientation correction — i.e. what you are looking at. */
  sizeMm: [number, number, number] | null
  /**
   * The model's extent in the PART frame, millimetres, rotated and scaled but
   * with the OFFSET TAKEN BACK OUT — the box `snapOffsetFor` works from (#788).
   *
   * Un-offset on purpose: snapping then answers from a property of the model
   * rather than from wherever it currently sits, so snapping the same corner
   * twice gives the same offset instead of compounding.
   */
  boundsMm: MeshBounds | null
}

type Phase = 'loading' | 'ready' | 'error'

/** Fallback stage extent (mm) when neither the part nor the mesh says otherwise. */
const DEFAULT_EXTENT_MM = 50

/** Everything the effects need to reach after the scene is built. */
interface StageHandle {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  /** Z-up: the part's own frame. Everything physical hangs off this. */
  root: THREE.Group
  /** Carries `meshRotation`. */
  oriented: THREE.Group
  /** Carries millimetres-per-mesh-unit. */
  scaled: THREE.Group
  /** The ground grid + footprint ghost + axis triad, rebuilt as sizes change. */
  reference: THREE.Group
  model: THREE.Object3D | null
  /** The model's part-frame size in mm, or null before/without a model. */
  size: [number, number, number] | null
  /** Its largest span in its OWN units, measured before any scale is applied. */
  rawSpan: number
}

/** Dispose every geometry/material under `obj` — a 3-D tab that leaks its GPU
 *  buffers stops working part-way through a session. */
function disposeTree(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const m = o as THREE.Mesh
    m.geometry?.dispose?.()
    const mat = m.material
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
    else mat?.dispose?.()
  })
}

/**
 * The model's bounding box expressed in the PART frame (mm).
 *
 * `Box3.setFromObject` only works in world space, and world is the part frame
 * turned −90° about X — which maps part `(x, y, z)` to world `(x, z, -y)`. A
 * quarter turn permutes the axes, so an axis-aligned box stays axis-aligned and
 * the conversion is exact rather than an approximation.
 */
function measurePartFrame(model: THREE.Object3D): {
  size: [number, number, number]
  min: [number, number, number]
} | null {
  const box = new THREE.Box3().setFromObject(model)
  if (box.isEmpty()) return null
  const size = new THREE.Vector3()
  box.getSize(size)
  if (![size.x, size.y, size.z].every((n) => Number.isFinite(n))) return null
  return {
    size: [size.x, size.z, size.y],
    // part y = -world z, so the part-frame minimum in y comes from world max z.
    min: [box.min.x, -box.max.z, box.min.y]
  }
}

/**
 * The measured box with the applied offset taken back out — the box a snap
 * works from (#788). A pure translation, so this is exact rather than an
 * approximation, and it is why snapping is idempotent.
 */
function unoffsetBounds(
  measured: { size: [number, number, number]; min: [number, number, number] },
  offset: readonly [number, number, number]
): MeshBounds {
  const min: [number, number, number] = [
    measured.min[0] - offset[0],
    measured.min[1] - offset[1],
    measured.min[2] - offset[2]
  ]
  return { min, max: [min[0] + measured.size[0], min[1] + measured.size[1], min[2] + measured.size[2]] }
}

/** Read a CSS custom property off the mount as a three colour (theme-aware at
 *  mount time), falling back when the token is missing or unparsable. */
function tokenColour(el: HTMLElement, name: string, fallback: number): THREE.Color {
  const raw = getComputedStyle(el).getPropertyValue(name).trim()
  if (!raw) return new THREE.Color(fallback)
  try {
    return new THREE.Color(raw)
  } catch {
    return new THREE.Color(fallback)
  }
}

export function PartMeshStage({
  path,
  rotation,
  offset,
  scaleMm,
  dimensions,
  label,
  onMeasured,
  fitSignal = 0
}: PartMeshStageProps): JSX.Element {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<StageHandle | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  // Everything the effects depend on is unpacked to PLAIN NUMBERS here, so an
  // effect re-runs when a value changes rather than when a parent re-render
  // hands back an equal-but-new array — which would rebuild the grid and the
  // ghost footprint on every keystroke in the panel beside it.
  const [rx, ry, rz] = meshRotationRadians(rotation)
  const [ox, oy, oz] = offset ?? [0, 0, 0]
  const width = dimensions && dimensions.width > 0 ? dimensions.width : 0
  const depth = dimensions && dimensions.height > 0 ? dimensions.height : 0
  // The latest callback without making it a dependency (a parent's inline arrow
  // is a new function every render).
  const measuredRef = useRef(onMeasured)
  measuredRef.current = onMeasured

  // --- 1) The scene, built once ------------------------------------------
  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    } catch {
      setPhase('error') // no WebGL (software renderer / disabled GPU)
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 5000)

    scene.add(new THREE.HemisphereLight(0xffffff, 0x6d7370, 1.0))
    const key = new THREE.DirectionalLight(0xffffff, 1.15)
    key.position.set(120, 200, 150)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0xc9d6cf, 0.4)
    fill.position.set(-150, 70, -120)
    scene.add(fill)

    // Z-up part frame → three's Y-up world.
    const root = new THREE.Group()
    root.rotation.x = -Math.PI / 2
    const oriented = new THREE.Group()
    const scaled = new THREE.Group()
    const reference = new THREE.Group()
    oriented.add(scaled)
    root.add(oriented)
    root.add(reference)
    scene.add(root)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.09

    const handle: StageHandle = {
      renderer,
      scene,
      camera,
      controls,
      root,
      oriented,
      scaled,
      reference,
      model: null,
      size: null,
      rawSpan: 0
    }
    stageRef.current = handle

    const resize = (): void => {
      const w = Math.max(1, mount.clientWidth)
      const h = Math.max(1, mount.clientHeight)
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(mount)

    let raf = 0
    const tick = (): void => {
      raf = requestAnimationFrame(tick)
      controls.update()
      renderer.render(scene, camera)
    }
    tick()

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      controls.dispose()
      disposeTree(scene)
      renderer.dispose()
      renderer.domElement.remove()
      stageRef.current = null
    }
  }, [])

  // --- 2) The model -------------------------------------------------------
  useEffect(() => {
    const stage = stageRef.current
    // No scene means the one above bailed — no WebGL. Say so rather than sitting
    // on "Loading…" for ever, which is what overwriting its `error` would do.
    if (!stage) {
      setPhase('error')
      return
    }
    setPhase('loading')
    let cancelled = false

    void loadMeshObject(path, { material: neutralMaterial() })
      .then((obj) => {
        if (cancelled || !stageRef.current) return
        if (!obj) {
          setPhase('error')
          measuredRef.current?.(null)
          return
        }
        if (stage.model) {
          stage.scaled.remove(stage.model)
          disposeTree(stage.model)
        }
        // Step 1: the loaded object into the part's own Z-up frame.
        obj.rotation.x = meshUpAxisFix(path)
        // Measure in the mesh's OWN units BEFORE it inherits a scale — this is
        // the number the mm-vs-m heuristic reads, and taking it here is what
        // stops "what scale?" and "how big is it?" chasing each other.
        const raw = measurePartFrame(obj)
        stage.rawSpan = raw ? Math.max(...raw.size) : 0
        stage.scaled.add(obj)
        stage.model = obj
        setPhase('ready')
      })
      .catch(() => {
        if (cancelled) return
        setPhase('error')
        measuredRef.current?.(null)
      })

    return () => {
      cancelled = true
    }
  }, [path])

  // --- 3) Orientation + scale, and everything that follows from them -------
  // One effect, because the reference geometry and the camera framing both
  // depend on the size the model ENDS UP, which only exists after both are set.
  useEffect(() => {
    const stage = stageRef.current
    const mount = mountRef.current
    if (!stage || !mount) return

    // 'ZYX' is three's spelling of URDF's rpy product, Rz·Ry·Rx. The offset goes
    // on the SAME group's position, because three composes `T · R · S` — so the
    // translation is applied after the rotation, in the part's frame, exactly as
    // URDF's `<origin xyz rpy>` and `mesh-offset.ts` both define it.
    stage.oriented.rotation.set(rx, ry, rz, 'ZYX')
    stage.oriented.position.set(ox, oy, oz)
    const s = Number.isFinite(scaleMm) && scaleMm > 0 ? scaleMm : 1
    stage.scaled.scale.setScalar(s)
    stage.root.updateMatrixWorld(true)

    const measured = stage.model ? measurePartFrame(stage.model) : null
    stage.size = measured?.size ?? null
    if (stage.model) {
      measuredRef.current?.({
        rawSpan: stage.rawSpan,
        sizeMm: stage.size,
        // Reported WITHOUT the offset, so a snap answers from the model rather
        // than from where it currently sits (#788).
        boundsMm: measured ? unoffsetBounds(measured, [ox, oy, oz]) : null
      })
    }

    // --- the reference geometry: grid, ghost footprint, axis triad ---------
    const w = width
    const d = depth
    const extent =
      Math.max(w, d, measured?.size[0] ?? 0, measured?.size[1] ?? 0, measured?.size[2] ?? 0) ||
      DEFAULT_EXTENT_MM

    for (const child of [...stage.reference.children]) {
      stage.reference.remove(child)
      disposeTree(child)
    }
    // A 10 mm grid, rounded out past whatever is biggest, so the squares are a
    // ruler rather than decoration.
    const half = Math.max(20, Math.ceil((extent * 0.9) / 10) * 10)
    const grid = new THREE.GridHelper(half * 2, (half * 2) / 10, 0x5c6a72, 0x323b41)
    // GridHelper lies in ITS OWN XZ plane; +90° puts it in the part frame's XY,
    // which the root's −90° then returns to the world ground plane.
    grid.rotation.x = Math.PI / 2
    ;(grid.material as THREE.Material).transparent = true
    ;(grid.material as THREE.Material).opacity = 0.55
    stage.reference.add(grid)

    // The part's REAL footprint, centred on the origin at z = 0 — the thing a
    // wrong-units mesh is instantly obviously wrong against.
    if (w > 0 && d > 0) {
      const accent = tokenColour(mount, '--accent', 0xd6a23f)
      const pts = [
        new THREE.Vector3(-w / 2, -d / 2, 0),
        new THREE.Vector3(w / 2, -d / 2, 0),
        new THREE.Vector3(w / 2, d / 2, 0),
        new THREE.Vector3(-w / 2, d / 2, 0)
      ]
      const ghost = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: accent })
      )
      stage.reference.add(ghost)
    }

    const axes = new THREE.AxesHelper(Math.max(extent * 0.6, 10))
    ;(axes.material as THREE.Material).depthTest = false
    axes.renderOrder = 2
    stage.reference.add(axes)
    stage.root.updateMatrixWorld(true)
  }, [rx, ry, rz, ox, oy, oz, scaleMm, width, depth, phase])

  // --- 4) Framing ---------------------------------------------------------
  // Separate so a rotation nudge does NOT yank the camera: you are judging the
  // model against a fixed viewpoint, and re-framing under you defeats that.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage || phase !== 'ready') return
    const extent = Math.max(width, depth, ...(stage.size ?? [0, 0, 0])) || DEFAULT_EXTENT_MM
    const dist = extent * 2.1
    stage.camera.near = Math.max(0.1, dist / 500)
    stage.camera.far = dist * 40
    stage.camera.position.set(dist * 0.62, dist * 0.52, dist * 0.78)
    stage.camera.updateProjectionMatrix()
    stage.controls.target.set(0, (stage.size?.[2] ?? extent * 0.2) / 2, 0)
    stage.controls.update()
    // `phase` re-frames once when the model first arrives; `fitSignal` on demand.
  }, [fitSignal, phase, path, width, depth])

  return (
    <div className="pms">
      <div className="pms__stage" ref={mountRef} role="img" aria-label={`3-D model of ${label}`} />
      {phase === 'loading' && <div className="pms__note">Loading the 3-D model…</div>}
      {phase === 'error' && (
        <div className="pms__note pms__note--error">
          This model could not be loaded — Snakie reads STL and DAE files.
        </div>
      )}
      {phase === 'ready' && (
        <>
          {/* What the coloured lines mean. HTML rather than 3-D text: it stays
              crisp, needs no font, and reads the same in both skins. */}
          <ul className="pms__legend" aria-label="Axes">
            <li className="pms__axis pms__axis--x">X</li>
            <li className="pms__axis pms__axis--y">Y</li>
            <li className="pms__axis pms__axis--z">Z — up</li>
          </ul>
          <div className="pms__hint">Drag to orbit · scroll to zoom · grid squares are 10&nbsp;mm</div>
        </>
      )}
    </div>
  )
}

export default PartMeshStage
