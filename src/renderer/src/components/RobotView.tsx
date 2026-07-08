import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js'
import URDFLoader from 'urdf-loader'
import type { URDFRobot } from 'urdf-loader'
import { useWorkspace } from '../store/workspace'
import { baseName, dirname, meshKind } from './robot-mesh'
import { RobotJointPanel, type NamedPoseLike } from './RobotJointPanel'
import {
  type JointMeta,
  clamp,
  effectiveLimit,
  extractJoints,
  toDisplay,
  toNative
} from './robot-pose'
import { addMeshLink, parseAssembly } from './robot-assembly'
import type { RobotDefinition, RobotModel } from '../../../shared/robot'
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
  const { openFiles, activeId, currentFolder, updateContent, saveFile } = useWorkspace()
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
  // The full-screen (non-compact) view is the Pose tool (#312): a joint sidebar,
  // named poses and a measure tool. The docked mini-panel stays view-only.
  const poseUI = !compact

  const [jointMeta, setJointMeta] = useState<JointMeta[]>([])
  const [values, setValues] = useState<Record<string, number>>({}) // native (rad/m)
  const [overrides, setOverrides] = useState<Record<string, { min?: number; max?: number }>>({})
  const [poses, setPoses] = useState<NamedPoseLike[]>([])
  const [measureActive, setMeasureActive] = useState(false)
  const [measureDist, setMeasureDist] = useState<number | null>(null)
  const [savingLabel, setSavingLabel] = useState<string | null>(null)

  // Refs kept fresh for imperative handlers + the three.js pointer callbacks.
  const robotRef = useRef<URDFRobot | null>(null)
  const defRef = useRef<RobotDefinition | null>(null)
  const metaRef = useRef<JointMeta[]>([])
  const valuesRef = useRef<Record<string, number>>({})
  const overridesRef = useRef<Record<string, { min?: number; max?: number }>>({})
  const defaultPoseRef = useRef<Record<string, number>>({}) // native, non-mimic
  const measureActiveRef = useRef(false)
  const measureApiRef = useRef<{ clear: () => void } | null>(null)
  metaRef.current = jointMeta
  valuesRef.current = values
  overridesRef.current = overrides

  // Set a joint on the live robot (mimic followers update automatically).
  const applyToRobot = (native: Record<string, number>): void => {
    const r = robotRef.current
    if (!r) return
    for (const m of metaRef.current) {
      if (!m.isMimic && typeof native[m.name] === 'number') r.setJointValue(m.name, native[m.name])
    }
  }

  // Merge a patch into robot.yml's `robot:` section and persist (preserving the
  // wiring). Writes to the project folder's robot.yml, else userData.
  const persist = async (mutate: (m: RobotModel) => void): Promise<void> => {
    const def: RobotDefinition = defRef.current ?? { parts: [], connections: [] }
    def.robot = { ...(def.robot ?? {}) }
    mutate(def.robot)
    defRef.current = def
    setSavingLabel('saving…')
    try {
      const res = await window.api.robot.save(currentFolder || undefined, def)
      setSavingLabel(res.ok ? 'saved ✓' : 'save failed')
    } catch {
      setSavingLabel('save failed')
    }
  }

  const handleJointChange = (name: string, native: number): void => {
    robotRef.current?.setJointValue(name, native)
    setValues((v) => ({ ...v, [name]: native }))
  }

  const handleLimitChange = (name: string, raw: { min: number; max: number }): void => {
    const round2 = (n: number): number => Math.round(n * 100) / 100
    const next = { min: round2(raw.min), max: round2(raw.max) }
    setOverrides((o) => ({ ...o, [name]: next }))
    const meta = metaRef.current.find((m) => m.name === name)
    if (meta) {
      const lim = effectiveLimit(meta, next)
      const cur = valuesRef.current[name] ?? 0
      const cl = clamp(cur, lim.lower, lim.upper)
      if (cl !== cur) handleJointChange(name, cl)
    }
    void persist((m) => {
      m.joints = { ...(m.joints ?? {}), [name]: next }
    })
  }

  const handleSavePose = (name: string): void => {
    const vals: Record<string, number> = {}
    for (const m of metaRef.current) {
      if (!m.isMimic) vals[m.name] = Number(toDisplay(m.type, valuesRef.current[m.name] ?? 0).toFixed(2))
    }
    const next = [...poses.filter((p) => p.name !== name), { name, values: vals }]
    setPoses(next)
    void persist((m) => {
      m.poses = next
    })
  }

  const handleRecallPose = (pose: NamedPoseLike): void => {
    const nv = { ...valuesRef.current }
    for (const m of metaRef.current) {
      if (!m.isMimic && typeof pose.values[m.name] === 'number') {
        const lim = effectiveLimit(m, overridesRef.current[m.name])
        nv[m.name] = clamp(toNative(m.type, pose.values[m.name]), lim.lower, lim.upper)
      }
    }
    applyToRobot(nv)
    setValues(nv)
  }

  const handleDeletePose = (name: string): void => {
    const next = poses.filter((p) => p.name !== name)
    setPoses(next)
    void persist((m) => {
      m.poses = next
    })
  }

  const handleResetPose = (): void => {
    const dp = defaultPoseRef.current
    const nv = { ...valuesRef.current }
    for (const m of metaRef.current) {
      if (m.isMimic) continue
      const lim = effectiveLimit(m, overridesRef.current[m.name])
      nv[m.name] = clamp(dp[m.name] ?? 0, lim.lower, lim.upper)
    }
    applyToRobot(nv)
    setValues(nv)
  }

  // The model's links + meshes, for the assembly panel.
  const assembly = useMemo(() => parseAssembly(content), [content])
  // Import is only possible for a saved local `.urdf` (a file we can edit).
  const canImport = poseUI && activeFile?.source === 'local' && !!activeFile.path
  const [importing, setImporting] = useState(false)
  const pendingSaveRef = useRef<string | null>(null)

  // Persist a just-imported URDF once the buffer state has updated (so saveFile
  // writes the new content + clears the dirty flag). Keyed on `content`.
  useEffect(() => {
    const id = pendingSaveRef.current
    if (id) {
      pendingSaveRef.current = null
      void saveFile(id)
    }
  }, [content, saveFile])

  const handleImportStl = async (): Promise<void> => {
    if (!activeFile || activeFile.source !== 'local' || !activeFile.path) return
    setImporting(true)
    try {
      const res = await window.api.robot.importMesh(activeFile.path)
      if (res.cancelled || !res.rel) {
        if (res.error) setSavingLabel(`import failed: ${res.error}`)
        return
      }
      // Add the mesh to the URDF (a new link + fixed joint) so it renders now.
      const linkBase = res.name?.replace(/\.(stl|dae)$/i, '') ?? 'part'
      const next = addMeshLink(content, { meshRel: res.rel, linkBase })
      // Update the buffer (RobotView re-renders + the tab reflects it), then let
      // an effect persist it once the store state is fresh (saveFile() called
      // here would write the stale pre-edit content).
      updateContent(activeFile.id, next.urdf)
      pendingSaveRef.current = activeFile.id
      setSavingLabel(`added ${next.link}`)
    } catch (e) {
      setSavingLabel(`import failed: ${e instanceof Error ? e.message : 'error'}`)
    } finally {
      setImporting(false)
    }
  }

  // Toggling measure off clears the markers + readout.
  useEffect(() => {
    measureActiveRef.current = measureActive
    if (!measureActive) {
      measureApiRef.current?.clear()
      setMeasureDist(null)
    }
  }, [measureActive])

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
    let teardownPose = (): void => {} // set when the pose tool wires up (below)
    robotRef.current = null

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

        if (poseUI) {
          // POSE TOOL (#312): expose the movable joints, seed a neutral pose, then
          // overlay the saved KRF overrides / defaultPose / poses from robot.yml.
          const meta = extractJoints(robot)
          robotRef.current = robot
          const initial: Record<string, number> = {}
          for (const m of meta) {
            if (m.isMimic) continue
            const v = clamp(0, m.lower, m.upper)
            initial[m.name] = v
            robot.setJointValue(m.name, v)
          }
          defaultPoseRef.current = { ...initial }
          setJointMeta(meta)
          setValues(initial)
          setOverrides({})
          setPoses([])
          setMeasureDist(null)

          void (async () => {
            try {
              const def = await window.api.robot.load(currentFolder || undefined)
              if (disposed || !robotRef.current) return
              defRef.current = def
              const model = def.robot ?? {}
              const ov = (model.joints ?? {}) as Record<string, { min?: number; max?: number }>
              const dp = model.defaultPose ?? {}
              const nv = { ...initial }
              for (const m of meta) {
                if (m.isMimic) continue
                const lim = effectiveLimit(m, ov[m.name])
                nv[m.name] =
                  typeof dp[m.name] === 'number'
                    ? clamp(toNative(m.type, dp[m.name]), lim.lower, lim.upper)
                    : clamp(nv[m.name], lim.lower, lim.upper)
                robot.setJointValue(m.name, nv[m.name])
              }
              defaultPoseRef.current = { ...nv } // "Reset" returns to the saved default
              setOverrides(ov)
              setPoses(Array.isArray(model.poses) ? model.poses : [])
              setValues(nv)
            } catch {
              // No robot.yml (or unreadable) — keep the neutral pose.
            }
          })()

          // MEASURE TOOL (#312): click two points on the model → distance readout.
          const raycaster = new THREE.Raycaster()
          const ndc = new THREE.Vector2()
          const pts: THREE.Vector3[] = []
          const markerMat = new THREE.MeshBasicMaterial({ color: 0xc8a24a, depthTest: false })
          const lineMat = new THREE.LineBasicMaterial({ color: 0xc8a24a, depthTest: false })
          const markers: THREE.Mesh[] = []
          let line: THREE.Line | null = null
          const clearMeasure = (): void => {
            pts.length = 0
            markers.forEach((m) => {
              scene.remove(m)
              m.geometry.dispose()
            })
            markers.length = 0
            if (line) {
              scene.remove(line)
              line.geometry.dispose()
              line = null
            }
          }
          measureApiRef.current = { clear: clearMeasure }
          let downX = 0
          let downY = 0
          const onDown = (e: PointerEvent): void => {
            downX = e.clientX
            downY = e.clientY
          }
          const onUp = (e: PointerEvent): void => {
            if (!measureActiveRef.current || !robotRef.current) return
            // Ignore orbit drags — only a near-stationary click places a point.
            if (Math.hypot(e.clientX - downX, e.clientY - downY) > 4) return
            const rect = renderer.domElement.getBoundingClientRect()
            ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
            ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
            raycaster.setFromCamera(ndc, camera)
            const hit = raycaster.intersectObject(robotRef.current, true)[0]
            if (!hit) return
            if (pts.length >= 2) clearMeasure()
            const p = hit.point.clone()
            pts.push(p)
            const dot = new THREE.Mesh(new THREE.SphereGeometry(halfView * 0.03 + 0.002, 12, 12), markerMat)
            dot.position.copy(p)
            dot.renderOrder = 999
            scene.add(dot)
            markers.push(dot)
            if (pts.length === 2) {
              line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat)
              line.renderOrder = 998
              scene.add(line)
              setMeasureDist(pts[0].distanceTo(pts[1]) * 1000)
            } else {
              setMeasureDist(null)
            }
          }
          renderer.domElement.addEventListener('pointerdown', onDown)
          renderer.domElement.addEventListener('pointerup', onUp)
          teardownPose = () => {
            renderer.domElement.removeEventListener('pointerdown', onDown)
            renderer.domElement.removeEventListener('pointerup', onUp)
            clearMeasure()
            markerMat.dispose()
            lineMat.dispose()
            measureApiRef.current = null
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not parse this URDF.')
      setInfo(null)
      if (poseUI) {
        setJointMeta([])
        setValues({})
      }
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
      robotRef.current = null
      teardownPose()
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
  }, [content, effectiveBase, isEmpty, poseUI, currentFolder])

  const showPanel = poseUI && !error && !isEmpty

  return (
    <div className={`robotview${compact ? ' robotview--compact' : ''}${poseUI ? ' robotview--pose' : ''}`}>
      <div className="robotview__stage">
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
      {showPanel && (
        <RobotJointPanel
          joints={jointMeta}
          values={values}
          overrides={overrides}
          onJointChange={handleJointChange}
          onLimitChange={handleLimitChange}
          poses={poses}
          onSavePose={handleSavePose}
          onRecallPose={handleRecallPose}
          onDeletePose={handleDeletePose}
          onResetPose={handleResetPose}
          measureActive={measureActive}
          onToggleMeasure={() => setMeasureActive((a) => !a)}
          measureDistance={measureDist}
          savingLabel={savingLabel}
          assembly={assembly}
          onImportStl={() => void handleImportStl()}
          canImport={!!canImport}
          importing={importing}
        />
      )}
    </div>
  )
}

export default RobotView
