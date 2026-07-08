import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js'
import URDFLoader from 'urdf-loader'
import type { URDFRobot } from 'urdf-loader'
import { useWorkspace } from '../store/workspace'
import { baseName, dirname, meshKind } from './robot-mesh'
import './RobotView.css'

/**
 * ROBOT VIEW (#311, epic #309) — a 3D panel that renders a URDF robot.
 * =============================================================================
 *
 * Opening a `.urdf` file shows the model in a three.js scene with orbit / pan /
 * zoom. The URDF is parsed from the OPEN FILE's content (so it lives in the
 * workspace, no server); primitives (box / cylinder / sphere) render with no
 * external files — the bundled `examples/demo-arm.urdf` is zero-setup.
 *
 * Phase 1b (#319) adds STL + DAE mesh loading: a real robot references meshes by
 * relative or `package://` path, which we resolve against the URDF's folder and
 * read through the app's fs (binary-safe for STL), so meshes render straight from
 * the workspace with no web server. A mesh that can't load degrades to a small
 * placeholder + a panel note rather than a blank model. Code-split so three.js
 * and the mesh loaders stay out of the initial bundle.
 */
export interface RobotViewProps {
  /** URDF text to render. When omitted, the active editor file is used (opening
   *  a `.urdf`). Provided directly by the docked Robot-mode panel (#320). */
  urdfContent?: string
  /** The URDF's folder — the base for resolving relative / `package://` mesh
   *  refs. When omitted it's derived from the active local file's path. */
  basePath?: string
  /** Compact chrome for the small docked panel (a slimmer HUD). */
  compact?: boolean
}

/** A neutral material for a mesh (e.g. STL) that carries no URDF `<material>`. */
function neutralMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.1, roughness: 0.85 })
}

/** A small wireframe cube standing in for a mesh that failed to load (#319). */
function placeholderMesh(material: THREE.Material | null): THREE.Mesh {
  const mat =
    material ?? new THREE.MeshStandardMaterial({ color: 0xb4544e, wireframe: true })
  return new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.04), mat)
}

export function RobotView({
  urdfContent,
  basePath,
  compact = false
}: RobotViewProps = {}): JSX.Element {
  const { openFiles, activeId } = useWorkspace()
  const activeFile = openFiles.find((f) => f.id === activeId) ?? null
  const content = urdfContent ?? activeFile?.content ?? ''
  // Where to resolve mesh files from: an explicit base (docked panel) else the
  // open local file's folder (opening a `.urdf` from a project).
  const effectiveBase =
    basePath ?? (activeFile && activeFile.source === 'local' ? dirname(activeFile.path) : '')

  const mountRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<{ name: string; joints: number; links: number } | null>(null)
  const [meshNote, setMeshNote] = useState<string | null>(null)

  const isEmpty = !content.trim()

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    if (isEmpty) {
      setError(null)
      setInfo(null)
      setMeshNote(null)
      return
    }

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x191a1d)

    // Isometric ORTHOGRAPHIC camera (#320) — the three axes foreshorten equally
    // and there's no perspective distortion, which reads cleaner for poses. Its
    // frustum is sized from the model bounds below.
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100)
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    mount.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08

    // Lights: soft ambient + a key + a fill so the coloured links read.
    scene.add(new THREE.HemisphereLight(0xffffff, 0x30333a, 0.9))
    const key = new THREE.DirectionalLight(0xffffff, 1.1)
    key.position.set(1.5, 2.5, 1.5)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0x9fb4d0, 0.35)
    fill.position.set(-1.5, 1, -1.2)
    scene.add(fill)

    // Half-height of the ortho frustum (updated by frameModel as bounds change).
    let halfView = 1
    const resize = (): void => {
      const w = mount.clientWidth
      const h = mount.clientHeight
      if (w === 0 || h === 0) return
      // updateStyle defaults true → the canvas CSS size fits the container while
      // the drawing buffer scales by the pixel ratio.
      renderer.setSize(w, h)
      // Orthographic: keep `halfView` world units visible vertically, widen the
      // frustum by the aspect ratio so nothing is squashed.
      const aspect = w / h
      camera.left = -halfView * aspect
      camera.right = halfView * aspect
      camera.top = halfView
      camera.bottom = -halfView
      camera.updateProjectionMatrix()
    }

    // Frame the model isometrically + (re)lay a ground grid under it. Called once
    // up-front (primitives) and again when async meshes arrive and grow the box.
    let grid: THREE.GridHelper | null = null
    const frameModel = (robot: URDFRobot): void => {
      // Flush world matrices BEFORE measuring — a dirty transform frames stale.
      robot.updateMatrixWorld(true)
      const box = new THREE.Box3().setFromObject(robot)
      if (!Number.isFinite(box.min.x) || box.isEmpty()) return
      const size = box.getSize(new THREE.Vector3())
      const centre = box.getCenter(new THREE.Vector3())
      const radius = Math.max(size.x, size.y, size.z, 0.1) * 0.5
      halfView = radius * 1.35 // a little padding around the model
      const isoDir = new THREE.Vector3(1, 0.9, 1).normalize()
      camera.position.copy(centre).addScaledVector(isoDir, radius * 6)
      controls.target.copy(centre)
      controls.update()
      if (grid) {
        scene.remove(grid)
        grid.geometry.dispose()
        ;(grid.material as THREE.Material).dispose()
      }
      const gridSize = Math.max(size.x, size.z) * 3 + 0.4
      grid = new THREE.GridHelper(gridSize, 20, 0x3a3d44, 0x27292e)
      grid.position.y = box.min.y
      scene.add(grid)
      resize()
    }

    let disposed = false
    let robot: URDFRobot | null = null
    let pending = 0 // async meshes still loading
    let ready = false // parse finished (guards mid-parse settles)
    const failed: string[] = []

    // Once the URDF is parsed and all async meshes have settled: reframe (meshes
    // may have grown the model) and surface any that couldn't load.
    const finalize = (): void => {
      if (disposed || !ready || pending > 0 || !robot) return
      frameModel(robot)
      if (failed.length) {
        const shown = failed.slice(0, 3).join(', ')
        const more = failed.length > 3 ? ` +${failed.length - 3} more` : ''
        setMeshNote(
          `${failed.length} mesh${failed.length > 1 ? 'es' : ''} couldn't load (${shown}${more}) — showing placeholders.`
        )
      } else {
        setMeshNote(null)
      }
    }
    const settle = (): void => {
      pending -= 1
      finalize()
    }

    // Resolve meshes against the URDF's folder: a `packages` resolver maps every
    // `package://<pkg>/rel` to `<base>/rel`, and `workingPath` handles plain
    // relative refs. We read the file through the app's fs (binary-safe for STL)
    // — no web server, works straight from the workspace.
    const base = effectiveBase ? effectiveBase.replace(/[/\\]+$/, '') : ''
    const loader = new URDFLoader()
    loader.parseVisual = true
    loader.parseCollision = false
    if (base) {
      loader.packages = () => base
      loader.workingPath = base + '/' // resolves plain relative mesh refs
    }
    loader.loadMeshCb = (path, manager, material, done): void => {
      const mat = (material as THREE.Material | null) ?? null
      pending += 1
      const kind = meshKind(path)
      const ok = (obj: THREE.Object3D): void => {
        if (disposed) return
        done(obj)
        settle()
      }
      const fail = (): void => {
        if (disposed) return
        failed.push(baseName(path))
        done(placeholderMesh(mat))
        settle()
      }
      if (kind === 'stl') {
        window.api.fs
          .readFileBytes(path)
          .then((bytes) => {
            if (disposed) return
            const geo = new STLLoader(manager).parse(bytes.buffer as ArrayBuffer)
            ok(new THREE.Mesh(geo, mat ?? neutralMaterial()))
          })
          .catch(fail)
      } else if (kind === 'dae') {
        window.api.fs
          .readFile(path)
          .then((text) => {
            if (disposed) return
            const dae = new ColladaLoader(manager).parse(text, dirname(path) + '/')
            if (dae?.scene) ok(dae.scene)
            else fail()
          })
          .catch(fail)
      } else {
        fail() // unsupported (.obj/.glb/…) — placeholder + note
      }
    }

    try {
      // URDF is Z-up; rotate into three's Y-up so it stands. `workingPath` (set
      // above) resolves relative mesh refs; loadMeshCb fires (async) during
      // parse, so meshes populate after this returns.
      robot = loader.parse(content)
      if (!robot || Object.keys(robot.links).length === 0) {
        setError('This file has no URDF links to show.')
        setInfo(null)
      } else {
        robot.rotation.x = -Math.PI / 2
        scene.add(robot)
        setError(null)
        setInfo({
          name: robot.robotName || robot.name || 'robot',
          joints: Object.keys(robot.joints).length,
          links: Object.keys(robot.links).length
        })
        frameModel(robot) // frame primitives immediately; reframe when meshes land
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not parse this URDF.')
      setInfo(null)
    }
    ready = true
    finalize() // no meshes (or all failed synchronously) → settle the note now

    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(mount)

    let raf = 0
    const tick = (): void => {
      controls.update()
      renderer.render(scene, camera)
      raf = requestAnimationFrame(tick)
    }
    tick()

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      ro.disconnect()
      controls.dispose()
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (mesh.geometry) mesh.geometry.dispose()
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
        else mat?.dispose()
      })
      renderer.dispose()
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement)
    }
  }, [content, effectiveBase, isEmpty])

  return (
    <div className={`robotview${compact ? ' robotview--compact' : ''}`}>
      <div className="robotview__canvas" ref={mountRef} />
      {error ? (
        <div className="robotview__overlay robotview__overlay--error" role="alert">
          <p className="robotview__overlay-title">Couldn&apos;t show this robot</p>
          <p className="robotview__overlay-msg">{error}</p>
        </div>
      ) : isEmpty ? (
        <div className="robotview__overlay">
          <p className="robotview__overlay-title">Robot View</p>
          <p className="robotview__overlay-msg">Open a .urdf file to see the 3D model.</p>
        </div>
      ) : (
        info && (
          <div className="robotview__hud" aria-hidden="true">
            <strong>{info.name}</strong> · {info.joints} joints · {info.links} links
            {!compact && <span className="robotview__hud-hint">drag to orbit · scroll to zoom</span>}
          </div>
        )
      )}
      {!error && meshNote && (
        <div className="robotview__note" role="status">
          {meshNote}
        </div>
      )}
    </div>
  )
}

export default RobotView
