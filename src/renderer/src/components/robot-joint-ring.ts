/**
 * JOINT RING — turn ONE joint by dragging a ring around it (Animate mode).
 * =============================================================================
 * Dragging a part poses the whole chain behind it (the Grab tool). That is the
 * quick way to rough a pose in; the ring is the precise way. Point at a part and
 * a ring appears on the joint that moves it:
 *
 *  - the pale ring is the joint's full circle,
 *  - the amber arc is how far it is allowed to turn (its limits),
 *  - the amber dot is where it is now — drag the ring to turn it.
 *
 * It is a raycast-inert scene child driven from RobotView's per-frame tick, like
 * the Bone Mode overlay and the IK goal gizmo it sits beside. The angle maths is
 * in `robot-animate.ts` (pure, unit-tested); this file is the three.js drawing
 * and pointer wiring.
 */
import * as THREE from 'three'
import type { URDFRobot } from 'urdf-loader'
import { shortArc } from './robot-animate'

const ORDER = 1006 // above the IK goal gizmo (1004/1005)
const RING_COLOR = '#8d9296'
const ARC_COLOR = '#d99a1c' // Flat amber — "the thing you are changing now"

export interface JointRingReadout {
  joint: string
  native: number
  clientX: number
  clientY: number
}

export interface JointRingDeps {
  getRobot: () => URDFRobot | null
  camera: THREE.Camera
  /** OrbitControls (or anything with `.enabled`) — disabled during a drag. */
  controls: { enabled: boolean }
  dom: HTMLElement
  /** Rings only show, and only take the pointer, while this is true. */
  isActive: () => boolean
  /** The joint that moves `link`: the nearest turnable joint at or above it. */
  jointForLink: (link: string) => string | null
  /** Effective native limits (rad) for a joint. */
  getLimit: (joint: string) => { lower: number; upper: number }
  /** A drag is starting (checkpoint for undo). */
  onBegin?: () => void
  /** Per drag-frame, after the joint is turned. */
  onLive?: (joint: string, native: number) => void
  /** On release. */
  onCommit?: (joint: string, native: number) => void
  /** The live angle read-out beside the pointer (null = hide it). */
  onReadout?: (r: JointRingReadout | null) => void
  /** The joint the ring is on changed (null = no ring). */
  onFocus?: (joint: string | null) => void
}

export interface JointRingHandle {
  /** Put the ring on a joint from outside (the Joints panel), or clear it. */
  setJoint(joint: string | null): void
  /** Hide the ring for a render that must show only the robot (a thumbnail). */
  setSuppressed(on: boolean): void
  update(): void
  dispose(): void
}

interface RingJoint extends THREE.Object3D {
  axis: THREE.Vector3
  angle: number
}

const inert = (o: THREE.Object3D): void => {
  o.raycast = () => {}
  o.renderOrder = ORDER
  o.frustumCulled = false
}

const ownerLinkName = (obj: THREE.Object3D | null): string | null => {
  let o = obj
  while (o && !(o as unknown as { isURDFLink?: boolean }).isURDFLink) o = o.parent
  return (o as unknown as { urdfName?: string } | null)?.urdfName ?? null
}

export function createJointRing(scene: THREE.Scene, deps: JointRingDeps): JointRingHandle {
  const root = new THREE.Group()
  root.visible = false
  scene.add(root)

  const flat = (color: string, opacity: number): THREE.MeshBasicMaterial =>
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false })
  const ringMat = flat(RING_COLOR, 0.55)
  const arcMat = flat(ARC_COLOR, 0.95)
  const dotMat = flat(ARC_COLOR, 1)
  const dotEdgeMat = flat('#ffffff', 1)
  const hitMat = new THREE.MeshBasicMaterial({ visible: false })

  const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.03, 8, 72), ringMat)
  inert(ring)
  let arc = new THREE.Mesh(new THREE.TorusGeometry(1, 0.055, 8, 48, Math.PI), arcMat)
  inert(arc)
  const dotEdge = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), dotEdgeMat)
  inert(dotEdge)
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), dotMat)
  inert(dot)
  dot.renderOrder = ORDER + 1
  // The ring is thin on screen; this fat invisible twin is what the pointer hits.
  const hit = new THREE.Mesh(new THREE.TorusGeometry(1, 0.2, 6, 36), hitMat)
  root.add(ring, arc, dotEdge, dot, hit)

  let joint: string | null = null
  let suppressed = false
  let arcKey = ''
  let phi0 = 0 // ring-frame direction of the child part at angle 0
  let radius = 0.03
  let sizedFor: URDFRobot | null = null
  let maxDim = 0.3

  const ray = new THREE.Raycaster()
  const ndc = new THREE.Vector2()
  const tmpQ = new THREE.Quaternion()
  const alignQ = new THREE.Quaternion()
  const Z = new THREE.Vector3(0, 0, 1)
  const box = new THREE.Box3()
  const v = new THREE.Vector3()

  const jointObj = (name: string | null): RingJoint | null => {
    const j = name ? (deps.getRobot()?.joints?.[name] as unknown as RingJoint | undefined) : undefined
    return j && j.axis ? j : null
  }

  const setJoint = (name: string | null): void => {
    const next = name && jointObj(name) ? name : null
    if (next === joint) return
    joint = next
    arcKey = ''
    if (!drag) deps.onFocus?.(joint)
    if (!joint) root.visible = false
  }

  /** Where the child part sits around the axis, so the dot rides the limb. */
  const measurePhi0 = (j: RingJoint): number => {
    box.makeEmpty()
    for (const c of j.children) box.expandByObject(c)
    if (box.isEmpty()) return 0
    box.getCenter(v)
    j.worldToLocal(v) // the part's centre in the joint's own (turning) frame
    v.applyQuaternion(alignQ.clone().invert()) // → the ring's frame, as at angle 0
    return Math.hypot(v.x, v.y) > 1e-5 ? Math.atan2(v.y, v.x) : 0
  }

  const update = (): void => {
    const j = deps.isActive() && !suppressed ? jointObj(joint) : null
    if (!j) {
      root.visible = false
      return
    }
    const robot = deps.getRobot()
    if (robot && robot !== sizedFor) {
      sizedFor = robot
      box.setFromObject(robot)
      box.getSize(v)
      maxDim = Math.max(v.x, v.y, v.z) || 0.3
    }
    radius = Math.min(Math.max(maxDim * 0.11, 0.012), 0.2)

    // The joint's frame with its own turn taken back out: the ring stays put
    // while the dot (and the part) swing around it.
    const axis = v.copy(j.axis).normalize().clone()
    alignQ.setFromUnitVectors(Z, axis)
    j.updateWorldMatrix(true, false)
    j.getWorldPosition(root.position)
    j.getWorldQuaternion(root.quaternion)
    root.quaternion.multiply(tmpQ.setFromAxisAngle(axis, -j.angle)).multiply(alignQ)
    root.scale.setScalar(radius)

    const lim = deps.getLimit(joint as string)
    const span = Math.min(Math.max(lim.upper - lim.lower, 0), Math.PI * 2)
    const key = `${joint}|${lim.lower.toFixed(4)}|${span.toFixed(4)}`
    if (key !== arcKey) {
      arcKey = key
      phi0 = measurePhi0(j)
      root.remove(arc)
      arc.geometry.dispose()
      arc = new THREE.Mesh(new THREE.TorusGeometry(1, 0.055, 8, 48, Math.max(span, 0.001)), arcMat)
      inert(arc)
      root.add(arc)
    }
    arc.rotation.z = phi0 + lim.lower
    const a = phi0 + j.angle
    dot.position.set(Math.cos(a), Math.sin(a), 0)
    dotEdge.position.copy(dot.position)
    root.visible = true
  }

  // ── pointer wiring ────────────────────────────────────────────────────────
  type Drag = {
    joint: string
    value: number // unclamped running angle, so pushing past a limit comes back cleanly
    last: number | null // last pointer angle in the ring's plane (null = edge-on fallback)
    lastX: number
    pivot: THREE.Vector3
    axis: THREE.Vector3
    u: THREE.Vector3
    w: THREE.Vector3
    plane: THREE.Plane
  }
  let drag: Drag | null = null

  const aim = (e: PointerEvent): void => {
    const r = deps.dom.getBoundingClientRect()
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    ray.setFromCamera(ndc, deps.camera)
  }
  /** The pointer's angle around the joint, or null when the ring is edge-on. */
  const pointerAngle = (d: Drag): number | null => {
    if (Math.abs(ray.ray.direction.dot(d.axis)) < 0.2) return null
    const p = new THREE.Vector3()
    if (!ray.ray.intersectPlane(d.plane, p)) return null
    p.sub(d.pivot)
    return Math.atan2(p.dot(d.w), p.dot(d.u))
  }

  const onDown = (e: PointerEvent): void => {
    if (e.button !== 0 || !deps.isActive() || !root.visible || !joint) return
    const j = jointObj(joint)
    if (!j) return
    aim(e)
    root.updateMatrixWorld(true)
    if (!ray.intersectObjects([hit, dot], false).length) return
    e.stopImmediatePropagation() // ours — not a part grab, not an orbit
    const pivot = j.getWorldPosition(new THREE.Vector3())
    const axis = Z.clone().applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion())).normalize()
    const u = new THREE.Vector3(1, 0, 0).applyQuaternion(root.quaternion).normalize()
    const w = new THREE.Vector3().crossVectors(axis, u).normalize()
    drag = {
      joint,
      value: j.angle,
      last: null,
      lastX: e.clientX,
      pivot,
      axis,
      u,
      w,
      plane: new THREE.Plane().setFromNormalAndCoplanarPoint(axis, pivot)
    }
    drag.last = pointerAngle(drag)
    deps.controls.enabled = false
    deps.dom.setPointerCapture?.(e.pointerId)
    deps.onBegin?.()
    deps.onReadout?.({ joint, native: j.angle, clientX: e.clientX, clientY: e.clientY })
  }

  const onMove = (e: PointerEvent): void => {
    if (!deps.isActive()) return
    aim(e)
    if (!drag) {
      // Hover: the ring follows the part under the pointer, and stays on the last
      // one while the pointer crosses empty space (so the ring itself is reachable).
      if (e.buttons !== 0) return
      const robot = deps.getRobot()
      if (!robot) return
      const h = ray.intersectObject(robot, true).find((x) => x.face)
      const link = h ? ownerLinkName(h.object) : null
      if (link) {
        const name = deps.jointForLink(link)
        if (name) setJoint(name)
      }
      return
    }
    e.stopImmediatePropagation()
    const robot = deps.getRobot()
    const lim = deps.getLimit(drag.joint)
    const now = pointerAngle(drag)
    if (now !== null && drag.last !== null) drag.value += shortArc(drag.last, now)
    else drag.value += (e.clientX - drag.lastX) * 0.012 // edge-on: a sideways drag turns it
    drag.last = now
    drag.lastX = e.clientX
    // Leaning on a limit must not wind up a hidden overshoot.
    drag.value = Math.min(lim.upper + 0.35, Math.max(lim.lower - 0.35, drag.value))
    const native = Math.min(lim.upper, Math.max(lim.lower, drag.value))
    robot?.setJointValue(drag.joint, native)
    robot?.updateMatrixWorld(true)
    deps.onLive?.(drag.joint, native)
    deps.onReadout?.({ joint: drag.joint, native, clientX: e.clientX, clientY: e.clientY })
  }

  const end = (e?: PointerEvent): void => {
    if (!drag) return
    const d = drag
    drag = null
    deps.controls.enabled = true
    if (e) {
      e.stopImmediatePropagation()
      deps.dom.releasePointerCapture?.(e.pointerId)
    }
    const j = jointObj(d.joint)
    deps.onReadout?.(null)
    if (j) deps.onCommit?.(d.joint, j.angle)
  }
  const onUp = (e: PointerEvent): void => end(e)
  const onCancel = (): void => end()

  deps.dom.addEventListener('pointerdown', onDown)
  deps.dom.addEventListener('pointermove', onMove)
  deps.dom.addEventListener('pointerup', onUp)
  deps.dom.addEventListener('pointercancel', onCancel)

  return {
    setJoint,
    setSuppressed(on: boolean): void {
      suppressed = on
    },
    update,
    dispose(): void {
      deps.dom.removeEventListener('pointerdown', onDown)
      deps.dom.removeEventListener('pointermove', onMove)
      deps.dom.removeEventListener('pointerup', onUp)
      deps.dom.removeEventListener('pointercancel', onCancel)
      scene.remove(root)
      root.traverse((o) => (o as THREE.Mesh).geometry?.dispose())
      ;[ringMat, arcMat, dotMat, dotEdgeMat, hitMat].forEach((m) => m.dispose())
    }
  }
}
