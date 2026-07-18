/**
 * INTERACTIVE IK GOAL GIZMO (#540, epic #533 §5) — a draggable end-effector goal
 * for Robot View. When armed it drops a handle at the selected chain's end
 * effector; dragging it runs the shared PLANAR solver (`src/shared/ik`, via
 * `robot-ik-planar.ts`) every frame, poses the live URDF model, and reports the
 * solved joint angles so the caller can stream them to a connected board and
 * commit them as a Motion Studio pose ("Capture Pose").
 *
 * It COMPOSES with Bone Mode (#536): a separate, raycast-inert scene child driven
 * from the same per-frame tick, reading the same live URDF joints. The goal is
 * dragged WITHIN the chain's working plane (the shared solver is planar), which
 * also makes the reachable-workspace shading — a limit-shaped point cloud in that
 * plane — line up with what the solver can actually reach.
 *
 * All the maths lives in `robot-ik-planar.ts` (pure, unit-tested); this file is
 * just the three.js gizmo + pointer wiring, mirroring the Bone Mode overlay and
 * the Grab-tool drag patterns already in RobotView.
 */
import * as THREE from 'three'
import type { URDFRobot } from 'urdf-loader'
import {
  planarizeChain,
  planarToWorld,
  sampleWorkspace,
  solveChainTarget,
  type ChainJoint,
  type ChainSolveResult,
  type PlanarChainMap
} from './robot-ik-planar'
import type { IkStatus } from '../../../shared/ik'

const ORDER_WORKSPACE = 999
const ORDER_GOAL = 1004 // above the bone-mode overlay (labels at 1003)

// Status → colour (matches the Bone Mode limit palette family).
const STATUS_COLOR: Record<IkStatus, string> = {
  reached: '#6ee76e',
  blocked_by_limits: '#ffd23f',
  out_of_reach: '#ff5a5a'
}
const IDLE_COLOR = '#8fb7ff' // armed, not yet dragged
const NONPLANAR_COLOR = '#c792ea' // the chain isn't really planar — best-effort

/** A joint chain to pose: base-first movable joints + the end-effector link. */
export interface IkChainRef {
  joints: string[]
  endLink: string
}

export interface IkGizmoDeps {
  getRobot: () => URDFRobot | null
  camera: THREE.Camera
  /** OrbitControls (or anything with `.enabled`) — disabled during a drag. */
  controls: { enabled: boolean }
  dom: HTMLElement
  /** Base-first movable chain for the current target, or null when none. */
  getChain: () => IkChainRef | null
  /** Effective native limits (rad) for a joint. */
  getLimit: (joint: string) => { lower: number; upper: number }
  /** Per drag-frame, after the model is posed — stream to a board, etc. */
  onLive?: (nativeByJoint: Record<string, number>) => void
  /** On drag release — commit the solved pose into React state. */
  onCommit?: (nativeByJoint: Record<string, number>) => void
}

export interface IkGizmoHandle {
  setArmed(on: boolean): void
  update(): void
  /** Joint names the current goal chain drives (Capture Pose include-set). */
  chainJoints(): string[]
  /** Status of the most recent solve, for UI (null before any drag). */
  status(): IkStatus | null
  dispose(): void
}

/** A tiny billboarded status pill (canvas sprite), JetBrains Mono, depth-off. */
class StatusLabel {
  readonly sprite: THREE.Sprite
  private readonly canvas = document.createElement('canvas')
  private tex: THREE.CanvasTexture | null = null
  private last = ''
  private height = 0.03

  constructor() {
    const mat = new THREE.SpriteMaterial({ depthTest: false, depthWrite: false, transparent: true })
    this.sprite = new THREE.Sprite(mat)
    this.sprite.renderOrder = ORDER_GOAL + 1
    this.sprite.raycast = () => {}
    this.sprite.frustumCulled = false
  }

  set(text: string, color: string, height: number): void {
    this.height = height
    const key = `${text}|${color}`
    if (key !== this.last) {
      this.last = key
      const ctx = this.canvas.getContext('2d')
      if (!ctx) return
      const font = '600 26px "JetBrains Mono", ui-monospace, monospace'
      ctx.font = font
      const w = Math.ceil(ctx.measureText(text).width)
      const H = 44
      this.canvas.width = w + 28
      this.canvas.height = H
      ctx.font = font
      ctx.beginPath()
      ctx.roundRect(1, 1, this.canvas.width - 2, H - 2, 10)
      ctx.fillStyle = 'rgba(12, 14, 18, 0.78)'
      ctx.fill()
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.fillStyle = color
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(text, this.canvas.width / 2, H / 2 + 1)
      this.tex?.dispose()
      this.tex = new THREE.CanvasTexture(this.canvas)
      this.tex.colorSpace = THREE.SRGBColorSpace
      const m = this.sprite.material as THREE.SpriteMaterial
      m.map = this.tex
      m.needsUpdate = true
    }
    const aspect = this.canvas.height > 0 ? this.canvas.width / this.canvas.height : 3
    this.sprite.scale.set(this.height * aspect, this.height, 1)
  }

  dispose(): void {
    this.tex?.dispose()
    ;(this.sprite.material as THREE.SpriteMaterial).dispose()
  }
}

const STATUS_TEXT: Record<IkStatus, string> = {
  reached: 'reached',
  blocked_by_limits: 'blocked by limits',
  out_of_reach: 'out of reach'
}

export function createIkGizmo(scene: THREE.Scene, deps: IkGizmoDeps): IkGizmoHandle {
  const root = new THREE.Group()
  root.visible = false
  scene.add(root)

  // Goal handle: a filled sphere + a bright ring (always-on-top), raycast-HITTABLE.
  const goal = new THREE.Group()
  goal.renderOrder = ORDER_GOAL
  const ballGeo = new THREE.SphereGeometry(1, 20, 16)
  const ballMat = new THREE.MeshBasicMaterial({
    color: IDLE_COLOR,
    transparent: true,
    opacity: 0.5,
    depthTest: false,
    depthWrite: false
  })
  const ball = new THREE.Mesh(ballGeo, ballMat)
  ball.renderOrder = ORDER_GOAL
  goal.add(ball)
  const ringGeo = new THREE.RingGeometry(1.25, 1.55, 28)
  const ringMat = new THREE.MeshBasicMaterial({
    color: IDLE_COLOR,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false
  })
  const ring = new THREE.Mesh(ringGeo, ringMat)
  ring.renderOrder = ORDER_GOAL
  ring.raycast = () => {}
  goal.add(ring)
  root.add(goal)

  const label = new StatusLabel()
  root.add(label.sprite)

  // Reachable-workspace point cloud, in the chain's working plane.
  const wsGeo = new THREE.BufferGeometry()
  const wsMat = new THREE.PointsMaterial({
    color: 0x4aa3ff,
    size: 4,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0.28,
    depthTest: false,
    depthWrite: false
  })
  const workspace = new THREE.Points(wsGeo, wsMat)
  workspace.renderOrder = ORDER_WORKSPACE
  workspace.raycast = () => {}
  workspace.frustumCulled = false
  root.add(workspace)

  let armed = false
  let dragging = false
  const dragPlane = new THREE.Plane()
  let scale = 0.02
  let wsKey = '' // chain identity the workspace cloud was built for
  let lastStatus: IkStatus | null = null
  let lastNative: Record<string, number> = {}
  let currentChain: IkChainRef | null = null

  const raycaster = new THREE.Raycaster()
  const ndc = new THREE.Vector2()
  const tmpP = new THREE.Vector3()
  const tmpA = new THREE.Vector3()
  const tmpTarget = new THREE.Vector3()

  const setNdc = (e: PointerEvent): void => {
    const r = deps.dom.getBoundingClientRect()
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
  }

  const robotMaxDim = (robot: URDFRobot): number => {
    const size = new THREE.Box3().setFromObject(robot).getSize(tmpP)
    const d = Math.max(size.x, size.y, size.z)
    return Number.isFinite(d) && d > 1e-6 ? d : 0.2
  }

  /** Build base-first world-space chain joints from the live robot. */
  const chainJointsOf = (robot: URDFRobot, names: string[]): ChainJoint[] =>
    names.map((name) => {
      const j = robot.joints[name]
      j.getWorldPosition(tmpP)
      tmpA.copy(j.axis).transformDirection(j.matrixWorld).normalize()
      const lim = deps.getLimit(name)
      return {
        name,
        pivot: [tmpP.x, tmpP.y, tmpP.z],
        axis: [tmpA.x, tmpA.y, tmpA.z],
        angle: j.angle,
        lower: lim.lower,
        upper: lim.upper
      }
    })

  const effectorWorld = (robot: URDFRobot, endLink: string): THREE.Vector3 => {
    const link = robot.links[endLink]
    if (link) link.getWorldPosition(tmpTarget)
    return tmpTarget.clone()
  }

  /** Planarize the current chain from the live pose (null when not posable). */
  const planarizeNow = (): PlanarChainMap | null => {
    const robot = deps.getRobot()
    const chain = deps.getChain()
    currentChain = chain
    if (!robot || !chain || chain.joints.length === 0) return null
    robot.updateMatrixWorld(true)
    const joints = chainJointsOf(robot, chain.joints)
    return planarizeChain(joints, effectorWorld(robot, chain.endLink).toArray() as [number, number, number])
  }

  const applyStatus = (status: IkStatus | null, planarity: number): void => {
    lastStatus = status
    const color =
      status == null
        ? IDLE_COLOR
        : planarity > 0.2
          ? NONPLANAR_COLOR
          : STATUS_COLOR[status]
    ballMat.color.set(color)
    ringMat.color.set(color)
    const text =
      status == null ? 'IK goal' : planarity > 0.2 ? `${STATUS_TEXT[status]} · non-planar` : STATUS_TEXT[status]
    label.set(text, color, scale * 1.6)
  }

  /** Rebuild the workspace cloud for a chain (once per chain identity change). */
  const rebuildWorkspace = (map: PlanarChainMap): void => {
    const sample = sampleWorkspace(map.chain)
    const arr = new Float32Array(sample.points.length * 3)
    sample.points.forEach((p, i) => {
      const w = planarToWorld(p, map.frame)
      arr[i * 3] = w[0]
      arr[i * 3 + 1] = w[1]
      arr[i * 3 + 2] = w[2]
    })
    wsGeo.setAttribute('position', new THREE.BufferAttribute(arr, 3))
    wsGeo.computeBoundingSphere()
  }

  const placeGoalAt = (w: THREE.Vector3): void => {
    goal.position.copy(w)
    goal.scale.setScalar(scale)
  }

  // ── Pointer drag ────────────────────────────────────────────────────────────
  const onDown = (e: PointerEvent): void => {
    if (!armed || dragging || e.button !== 0) return
    if (!goal.visible) return
    setNdc(e)
    raycaster.setFromCamera(ndc, deps.camera)
    // Only the goal ball is hittable; a miss leaves the event for orbit/other tools.
    if (!raycaster.intersectObject(ball, false).length) return
    const map = planarizeNow()
    if (!map) return
    // Freeze the working plane (base pivot is fixed, so it stays valid mid-drag).
    const n = new THREE.Vector3(map.frame.normal[0], map.frame.normal[1], map.frame.normal[2])
    const o = new THREE.Vector3(map.frame.origin[0], map.frame.origin[1], map.frame.origin[2])
    dragPlane.setFromNormalAndCoplanarPoint(n, o)
    dragging = true
    deps.controls.enabled = false
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    e.stopImmediatePropagation()
  }

  const onMove = (e: PointerEvent): void => {
    if (!dragging) return
    const robot = deps.getRobot()
    setNdc(e)
    raycaster.setFromCamera(ndc, deps.camera)
    if (!raycaster.ray.intersectPlane(dragPlane, tmpTarget)) return
    placeGoalAt(tmpTarget)
    // Re-planarize from the CURRENT pose each frame (base pivot fixed) and solve —
    // the incremental re-solve converges like the Grab tool's re-snapshotting.
    const map = planarizeNow()
    if (!robot || !map) return
    const res: ChainSolveResult = solveChainTarget(map, [tmpTarget.x, tmpTarget.y, tmpTarget.z], {
      maxIterations: 24
    })
    for (const name of map.jointNames) robot.setJointValue(name, res.nativeByJoint[name])
    robot.updateMatrixWorld(true)
    lastNative = res.nativeByJoint
    applyStatus(res.status, res.planarity)
    deps.onLive?.(res.nativeByJoint)
    e.stopImmediatePropagation()
  }

  const onUp = (e: PointerEvent): void => {
    if (!dragging) return
    dragging = false
    deps.controls.enabled = true
    ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
    if (Object.keys(lastNative).length) deps.onCommit?.(lastNative)
  }

  deps.dom.addEventListener('pointerdown', onDown)
  deps.dom.addEventListener('pointermove', onMove)
  deps.dom.addEventListener('pointerup', onUp)

  const update = (): void => {
    const robot = deps.getRobot()
    if (!armed || !robot) {
      root.visible = false
      return
    }
    const chain = deps.getChain()
    currentChain = chain
    if (!chain || chain.joints.length === 0) {
      root.visible = false
      return
    }
    root.visible = true
    scale = Math.min(Math.max(robotMaxDim(robot) * 0.03, 0.006), 0.05)

    // While NOT dragging, snap the goal handle to the live end effector and keep
    // the workspace cloud current for this chain.
    if (!dragging) {
      const map = planarizeNow()
      if (!map) {
        root.visible = false
        return
      }
      placeGoalAt(effectorWorld(robot, chain.endLink))
      const key = `${chain.joints.join('>')}|${map.chain.boneLengths.map((l) => l.toFixed(4)).join(',')}`
      if (key !== wsKey) {
        wsKey = key
        rebuildWorkspace(map)
      }
      if (lastStatus == null) applyStatus(null, map.planarity)
    }
    ring.quaternion.copy(deps.camera.quaternion) // billboard the ring toward the camera
    goal.updateMatrixWorld(true)
    goal.getWorldPosition(tmpP)
    label.sprite.position.set(tmpP.x, tmpP.y + scale * 2.4, tmpP.z)
  }

  return {
    setArmed(on: boolean): void {
      armed = on
      if (!on) {
        root.visible = false
        dragging = false
        deps.controls.enabled = true
        lastStatus = null
      }
    },
    update,
    chainJoints(): string[] {
      return currentChain?.joints ?? []
    },
    status(): IkStatus | null {
      return lastStatus
    },
    dispose(): void {
      deps.dom.removeEventListener('pointerdown', onDown)
      deps.dom.removeEventListener('pointermove', onMove)
      deps.dom.removeEventListener('pointerup', onUp)
      label.dispose()
      ballGeo.dispose()
      ballMat.dispose()
      ringGeo.dispose()
      ringMat.dispose()
      wsGeo.dispose()
      wsMat.dispose()
      scene.remove(root)
    }
  }
}
