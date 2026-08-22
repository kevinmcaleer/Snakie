import { useEffect, useRef, useState, type JSX } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { loadMeshObject, meshUpAxisFix, neutralMaterial } from './robot-mesh-load'
import { meshRotationRadians, type MeshRotation } from '../../../shared/mesh-rotation'
import type { MeshOffset } from '../../../shared/mesh-offset'
import './PartMeshView.css'

/**
 * A PART'S 3-D MODEL (#748) — a small, self-contained turntable.
 * =============================================================================
 *
 * Deliberately NOT `RobotView`: that is ~5,600 lines carrying the whole URDF
 * editor (joints, IK, bone mode, stereo, the view cube…), none of which a catalog
 * page wants. This is one canvas over {@link loadMeshObject}: light it, frame it,
 * let it turn.
 *
 * Because the model is framed from its own bounding box, the part's `meshUnits` /
 * `meshScale` are irrelevant HERE — they exist to place a mesh correctly in the
 * URDF world (metres), and a preview that fills its frame either way doesn't need
 * them. Orientation is the part that does matter: `meshUpAxisFix` puts the loaded
 * object into the part's Z-up frame, the part's stored `meshRotation` (#741) is
 * applied in THAT frame, and the whole stage is then laid down −90° for three's
 * Y-up world — the same three steps, in the same order, as the Part Editor's 3-D
 * view and as the URDF a placed part gets. A part squared up in the editor
 * therefore looks square here too.
 *
 * `meshOffset` (#788) is applied in that same chain, on the same group as the
 * rotation and therefore after it — but be clear about what it does here:
 * **nothing visible**, and necessarily so. This view normalises the model onto a
 * unit box centred on its own bounding-box centre, and a pure translation cannot
 * survive that any more than a scale can. It is carried anyway so the transform
 * chain is identical in all three consumers, which is what stops the three
 * drifting apart; the place to judge an offset is the editor's stage, which
 * draws the origin, the grid and the part's footprint to judge it against.
 *
 * Imported lazily by the details view, so three.js and the STL/DAE parsers stay
 * out of the main renderer chunk.
 */

export interface PartMeshViewProps {
  /** Absolute path to the mesh file — from `partMeshRef`, which has already
   *  checked it is a parsable kind inside the part's own folder. */
  path: string
  /** What the model is OF, for the accessible name. */
  label: string
  /** The part's stored orientation correction (#741), degrees. Absent ⇒ none. */
  rotation?: MeshRotation | null
  /** The part's stored position correction (#788), millimetres, applied after
   *  the rotation. Carried for consistency; see the note above about why a
   *  bounding-box-framed preview cannot show a translation. */
  offset?: MeshOffset | null
}

type Phase = 'loading' | 'ready' | 'error'

/** How far back to sit from a model normalised to a unit box. */
const CAMERA_DISTANCE = 2.6
/** Idle turntable speed (radians/second). Stops for good on first interaction. */
const SPIN_RATE = 0.35

export function PartMeshView({ path, label, rotation, offset }: PartMeshViewProps): JSX.Element {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  // Converted OUT HERE, so the effect depends on plain numbers rather than on
  // the arrays' identity: a parent re-render handing back an equal `[90, 0, 0]`
  // must not tear the scene down and reload the STL.
  const [rx, ry, rz] = meshRotationRadians(rotation)
  const [ox, oy, oz] = offset ?? [0, 0, 0]

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    setPhase('loading')

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
    const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100)
    camera.position.set(CAMERA_DISTANCE * 0.62, CAMERA_DISTANCE * 0.52, CAMERA_DISTANCE * 0.78)

    // Soft ambient + a key + a fill, so an unpainted grey model still reads as a
    // solid object rather than a silhouette.
    scene.add(new THREE.HemisphereLight(0xffffff, 0x6d7370, 1.0))
    const key = new THREE.DirectionalLight(0xffffff, 1.15)
    key.position.set(1.6, 2.4, 1.8)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0xc9d6cf, 0.4)
    fill.position.set(-1.8, 0.8, -1.4)
    scene.add(fill)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.09
    controls.target.set(0, 0, 0)

    // The turntable is an invitation, not an animation to sit through: the first
    // drag/zoom ends it for good. Honour reduced-motion by never starting.
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    let spinning = !reduceMotion
    const stopSpin = (): void => {
      spinning = false
    }
    controls.addEventListener('start', stopSpin)

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

    let cancelled = false
    // The MODEL turns, not the scene: spinning the scene would carry the lights
    // round with it, leaving the shading fixed and the object looking inert.
    let model: THREE.Object3D | null = null

    let raf = 0
    const clock = new THREE.Clock()
    const tick = (): void => {
      raf = requestAnimationFrame(tick)
      const dt = clock.getDelta()
      if (spinning && model) model.rotation.y += SPIN_RATE * dt
      controls.update()
      renderer.render(scene, camera)
    }
    tick()

    void loadMeshObject(path, { material: neutralMaterial() })
      .then((obj) => {
        if (cancelled) return
        if (!obj) {
          setPhase('error')
          return
        }
        // Three frames, one nesting — the same order the URDF uses (#741, #788):
        //   1. the loaded object → the part's Z-up frame (`meshUpAxisFix`);
        //   2. the part's stored corrections, applied in THAT frame — rotation
        //      then offset, which is what a group's `T · R · S` composition
        //      gives when both ride on the same object;
        //   3. the whole stage laid down −90° for three's Y-up world.
        obj.rotation.x = meshUpAxisFix(path)
        const oriented = new THREE.Group()
        // 'ZYX' is three's spelling of URDF's rpy product, Rz·Ry·Rx.
        oriented.rotation.set(rx, ry, rz, 'ZYX')
        oriented.position.set(ox, oy, oz)
        oriented.add(obj)
        const stage = new THREE.Group()
        stage.rotation.x = -Math.PI / 2
        stage.add(oriented)

        // Normalise to a unit box centred on the origin, so framing is the same
        // whether the file is authored in millimetres or metres — and measured
        // AFTER the rotation, so a corrected part frames on what you now see.
        const box = new THREE.Box3().setFromObject(stage)
        const size = new THREE.Vector3()
        const centre = new THREE.Vector3()
        box.getSize(size)
        box.getCenter(centre)
        const span = Math.max(size.x, size.y, size.z)
        const holder = new THREE.Group()
        if (Number.isFinite(span) && span > 0) {
          const s = 1 / span
          stage.position.sub(centre)
          holder.scale.setScalar(s)
        }
        holder.add(stage)
        scene.add(holder)
        model = holder
        setPhase('ready')
      })
      .catch(() => {
        if (!cancelled) setPhase('error')
      })

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      ro.disconnect()
      controls.removeEventListener('start', stopSpin)
      controls.dispose()
      if (model) scene.remove(model)
      // Release every GPU buffer this view created — a catalog can open a dozen
      // parts in a session, and a leaked context is how the 3-D tab stops working
      // halfway through one.
      scene.traverse((o) => {
        const m = o as THREE.Mesh
        m.geometry?.dispose?.()
        const mat = m.material
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
        else mat?.dispose?.()
      })
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [path, rx, ry, rz, ox, oy, oz])

  return (
    <div className="pmv">
      <div className="pmv__stage" ref={mountRef} role="img" aria-label={`3-D model of ${label}`} />
      {phase === 'loading' && <div className="pmv__note">Loading the 3-D model…</div>}
      {phase === 'error' && (
        <div className="pmv__note pmv__note--error">This part&rsquo;s 3-D model could not be loaded.</div>
      )}
      {phase === 'ready' && <div className="pmv__hint">Drag to orbit · scroll to zoom</div>}
    </div>
  )
}

export default PartMeshView
