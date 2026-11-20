/**
 * THE ROBOT FRAME (#1321) — a project's robot in a web page, moved by the code.
 *
 * `/embed.html?robot=1&project=<id>` draws the URDF a kevsrobots project
 * carries among its files, with its meshes. When a code frame on the same
 * page runs, `snakie-embed.js` passes on what each pin is doing, and the
 * joints the project's wiring binds to those pins turn: `servo.duty_u16(…)`
 * in the code moves the arm on the page.
 *
 * Deliberately not the app's `RobotView`: that one edits, poses, measures and
 * reads the desktop's parts folders. This only shows and moves.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import URDFLoader from 'urdf-loader'
import type { URDFJoint, URDFRobot } from 'urdf-loader'
import { KR_PROJECTS_API } from '../../../shared/kevsrobots-account'
import type { RobotDefinition, ServoJointBinding } from '../../../shared/robot'
import type { EmbedParams } from './params'
import { jointsFromPins, meshFile, pickUrdf, type PinState, type ProjectFileEntry } from './robot-drive'
import './EmbedApp.css'

const FRAME_H = 420
const PIN_ID_RE = /^[A-Za-z0-9_]{1,16}$/

interface JointInfo {
  name: string
  /** `revolute`, `continuous` or `prismatic`. */
  type: string
  /** Degrees, or mm for a sliding joint. */
  min: number
  max: number
}

type Phase = { kind: 'loading' } | { kind: 'ready'; name: string } | { kind: 'error'; message: string }

function tellHost(params: EmbedParams, message: Record<string, unknown>): void {
  if (window.parent === window) return
  window.parent.postMessage({ source: 'snakie-embed', id: params.id, ...message }, '*')
}

function movable(joint: URDFJoint): boolean {
  return joint.jointType === 'revolute' || joint.jointType === 'continuous' || joint.jointType === 'prismatic'
}

/** A joint's value in the units people use (degrees, mm) → the loader's (radians, metres). */
function toNative(type: string, value: number): number {
  return type === 'prismatic' ? value / 1000 : (value * Math.PI) / 180
}

function jointInfo(robot: URDFRobot): JointInfo[] {
  return Object.values(robot.joints)
    .filter(movable)
    .map((j) => {
      const sliding = j.jointType === 'prismatic'
      const lower = Number(j.limit?.lower ?? 0)
      const upper = Number(j.limit?.upper ?? 0)
      const free = j.jointType === 'continuous' || lower === upper
      return {
        name: j.name,
        type: j.jointType,
        min: free ? -180 : sliding ? lower * 1000 : (lower * 180) / Math.PI,
        max: free ? 180 : sliding ? upper * 1000 : (upper * 180) / Math.PI
      }
    })
}

export function RobotFrame({ params }: { params: EmbedParams }): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const robotRef = useRef<URDFRobot | null>(null)
  const drawRef = useRef<() => void>(() => undefined)
  const bindingsRef = useRef<ServoJointBinding[]>([])
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [joints, setJoints] = useState<JointInfo[]>([])
  const [values, setValues] = useState<Record<string, number>>({})
  const [bound, setBound] = useState<ReadonlySet<string>>(() => new Set())
  const [open, setOpen] = useState(false)
  const jointsRef = useRef<JointInfo[]>([])
  jointsRef.current = joints

  const setJoint = useCallback((name: string, value: number): void => {
    const robot = robotRef.current
    const info = jointsRef.current.find((j) => j.name === name)
    if (!robot || !info || !Number.isFinite(value)) return
    const v = Math.max(info.min, Math.min(info.max, value))
    robot.joints[name]?.setJointValue(toNative(info.type, v))
    setValues((prev) => (prev[name] === v ? prev : { ...prev, [name]: v }))
    drawRef.current()
  }, [])

  // The scene, and the robot in it.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let disposed = false
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    } catch {
      setPhase({ kind: 'error', message: 'This browser can’t draw 3D here.' })
      return
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    host.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(40, 1, 0.001, 100)
    camera.position.set(0.35, 0.3, 0.45)
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f98, 1.6))
    const sun = new THREE.DirectionalLight(0xffffff, 1.6)
    sun.position.set(1, 2, 1.5)
    scene.add(sun)
    const grid = new THREE.GridHelper(1, 20, 0x9aa3ad, 0xc9ced6)
    scene.add(grid)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = false

    let queued = 0
    const draw = (): void => {
      if (queued || disposed) return
      queued = requestAnimationFrame(() => {
        queued = 0
        renderer.render(scene, camera)
      })
    }
    drawRef.current = draw
    controls.addEventListener('change', draw)
    const resize = (): void => {
      const w = host.clientWidth || 1
      const h = host.clientHeight || 1
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      draw()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    resize()

    const frame = (robot: THREE.Object3D): void => {
      const box = new THREE.Box3().setFromObject(robot)
      if (box.isEmpty()) return
      const size = box.getSize(new THREE.Vector3())
      const centre = box.getCenter(new THREE.Vector3())
      const reach = Math.max(size.x, size.y, size.z, 0.02)
      controls.target.copy(centre)
      camera.position.copy(centre).add(new THREE.Vector3(1, 0.8, 1.2).normalize().multiplyScalar(reach * 1.7))
      camera.near = reach / 200
      camera.far = reach * 200
      camera.updateProjectionMatrix()
      grid.scale.setScalar(Math.max(1, Math.ceil(reach * 4)))
      grid.position.y = box.min.y
      controls.update()
      draw()
    }

    const load = async (): Promise<void> => {
      let files: ProjectFileEntry[] = []
      let urdfUrl = params.urdf
      let named: string | null = null
      if (params.project) {
        const base = `${KR_PROJECTS_API}/api/projects/${params.project}`
        const [list, wiring] = await Promise.all([
          fetch(`${base}/files`).then((r) => (r.ok ? r.json() : [])).catch(() => []),
          fetch(`${base}/wiring`).then((r) => (r.ok ? r.json() : null)).catch(() => null)
        ])
        files = Array.isArray(list) ? (list as ProjectFileEntry[]).filter((f) => typeof f?.filename === 'string') : []
        const robotDef = (wiring as { data?: RobotDefinition } | null)?.data
        bindingsRef.current = robotDef?.robot?.servoJointMap ?? []
        named = robotDef?.robot?.urdf ?? null
        if (!urdfUrl) {
          const urdf = pickUrdf(files, named)
          if (urdf) urdfUrl = `${base}/files/${urdf.id}/download?preview=1`
        }
      }
      if (!urdfUrl) throw new Error('This project has no robot model yet. Add its URDF file and meshes to the project’s files.')
      const res = await fetch(urdfUrl)
      if (!res.ok) throw new Error('The robot model couldn’t be loaded.')
      const text = await res.text()
      if (disposed) return

      const manager = new THREE.LoadingManager()
      const loader = new URDFLoader(manager)
      const stl = new STLLoader(manager)
      const base = params.project ? `${KR_PROJECTS_API}/api/projects/${params.project}` : null
      loader.loadMeshCb = (path, _manager, _material, done): void => {
        // In a project, a mesh is the project file of that name; with urdf=, it sits beside the URDF.
        const file = base ? meshFile(path, files) : null
        let url: string | null = file && base ? `${base}/files/${file.id}/download?preview=1` : null
        if (!url && !base) {
          try {
            url = new URL(path.replace(/^package:\/\/[^/]+\//, ''), urdfUrl as string).href
          } catch {
            url = null
          }
        }
        const placeholder = (): void => {
          done(new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.02), new THREE.MeshStandardMaterial({ color: 0xb8bec8 })))
          draw()
        }
        if (!url || !/\.stl$/i.test(path.split(/[?#]/)[0])) return placeholder()
        stl.load(
          url,
          (geometry) => {
            if (disposed) return
            geometry.computeVertexNormals()
            done(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xd9dde3, roughness: 0.75, metalness: 0.05 })))
          },
          undefined,
          placeholder
        )
      }
      const robot = loader.parse(text)
      if (!robot || Object.keys(robot.links).length === 0) throw new Error('That file has no robot in it.')
      // URDF is Z-up; three is Y-up.
      robot.rotation.x = -Math.PI / 2
      scene.add(robot)
      robotRef.current = robot
      const info = jointInfo(robot)
      setJoints(info)
      setValues(Object.fromEntries(info.map((j) => [j.name, 0])))
      setBound(new Set(bindingsRef.current.map((b) => b.joint)))
      setPhase({ kind: 'ready', name: robot.robotName || 'Robot' })
      manager.onLoad = () => !disposed && frame(robot)
      frame(robot)
      // A URDF of boxes and cylinders loads no files, so onLoad never fires.
      window.setTimeout(() => !disposed && frame(robot), 400)
    }
    load().catch((err: unknown) => {
      if (!disposed) setPhase({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    })

    return () => {
      disposed = true
      cancelAnimationFrame(queued)
      observer.disconnect()
      controls.dispose()
      renderer.dispose()
      renderer.domElement.remove()
      robotRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // What the code frame's pins are doing, relayed by the host page.
  useEffect(() => {
    const onMessage = (e: MessageEvent): void => {
      if (e.source !== window.parent || window.parent === window) return
      const data = e.data as { source?: unknown; type?: unknown; states?: unknown } | null
      if (!data || data.source !== 'snakie-embed-host' || data.type !== 'pin-state') return
      const states: Record<string, PinState> = {}
      for (const [pin, st] of Object.entries((data.states ?? {}) as Record<string, Partial<PinState>>)) {
        if (!PIN_ID_RE.test(pin) || !st || (st.kind !== 'p' && st.kind !== 'w')) continue
        if (typeof st.value !== 'number' || !Number.isFinite(st.value)) continue
        states[pin] = { kind: st.kind, value: st.value }
      }
      for (const [joint, value] of Object.entries(jointsFromPins(states, bindingsRef.current))) setJoint(joint, value)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [setJoint])

  useEffect(() => {
    document.title = phase.kind === 'ready' ? `${phase.name} · Snakie` : 'Robot · Snakie'
    tellHost(params, { type: 'height', height: params.height ?? FRAME_H })
  }, [params, phase])

  const shown = useMemo(() => joints.slice(0, 12), [joints])

  return (
    <div className="snk-robot">
      <div className="snk-robot__view" ref={hostRef} role="img" aria-label={phase.kind === 'ready' ? `3D model of ${phase.name}` : 'Robot'} />
      {phase.kind === 'loading' && <div className="snk-robot__message">Loading the robot…</div>}
      {phase.kind === 'error' && (
        <div className="snk-robot__message snk-robot__message--error" role="alert">
          {phase.message}
        </div>
      )}
      {phase.kind === 'ready' && (
        <>
          <div className="snk-robot__bar">
            <span className="snk-robot__name">{phase.name}</span>
            <span className="snk-robot__hint">
              {bound.size > 0 ? 'Run the code to move it. Drag to look around.' : 'Drag to look around.'}
            </span>
            {shown.length > 0 && (
              <button type="button" className="btn btn--sm btn--ghost" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
                Joints
              </button>
            )}
          </div>
          {open && (
            <div className="snk-robot__joints">
              {shown.map((j) => (
                <label key={j.name} className="snk-robot__joint">
                  <span className="snk-robot__joint-name">
                    {j.name}
                    {bound.has(j.name) && <span className="snk-robot__bound">servo</span>}
                  </span>
                  <input
                    type="range"
                    min={j.min}
                    max={j.max}
                    step={1}
                    value={values[j.name] ?? 0}
                    onChange={(e) => setJoint(j.name, Number(e.target.value))}
                  />
                  <span className="snk-robot__joint-value">
                    {Math.round(values[j.name] ?? 0)}
                    {j.type === 'prismatic' ? ' mm' : '°'}
                  </span>
                </label>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default RobotFrame
