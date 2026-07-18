/**
 * BONE MODE (#536, epic #533 §1) — a toggleable skeleton overlay for Robot View.
 * When on, the robot's meshes render solid-grey at ~80% transparency (opacity
 * ≈0.2, depthWrite off) and a scene-level overlay draws, per frame:
 *   • BONES — coloured lines joint-origin → joint-origin (depth-test off, so
 *     they're never occluded by the mesh), each labelled with its length in mm
 *     (the distances IK needs).
 *   • COMPASSES — at each revolute/continuous joint: an arc from the joint's
 *     min → max limit, a needle at the current angle, and a live "name angle°"
 *     readout whose colour shifts green → amber → red approaching a limit.
 *   • RULERS — a prismatic joint gets a linear gauge along its slide axis
 *     (travel line + end ticks + marker at the current position, mm readout).
 * The overlay reads the live URDFRobot every frame, so sliders / Motion Studio
 * playback / servo telemetry all animate it for free, and it composes with the
 * existing overlays (measure, Join-tool markers) because it's a separate,
 * raycast-inert scene child. Pure maths/formatting helpers live at the top so
 * they're unit-testable without a renderer.
 */
import * as THREE from 'three'
import type { URDFJoint, URDFRobot } from 'urdf-loader'

// ── Pure helpers (unit-tested in test/robotBoneMode.test.ts) ─────────────────

/** The minimum a joint needs to place it in the skeleton topology. */
export interface BoneJointInfo {
  name: string
  parentLink: string
  childLink: string
}

/** One bone: from the PARENT joint's origin (null = the robot base origin) to
 *  this joint's origin. */
export interface BoneSegment {
  from: string | null
  to: string
}

/**
 * The skeleton's bones from the joint list: each joint contributes one bone
 * whose far end is the joint that OWNS its parent link (the joint whose child
 * link is this joint's parent link), or the robot base when there is none.
 */
export function boneSegments(joints: BoneJointInfo[]): BoneSegment[] {
  const ownerOfLink = new Map<string, string>() // child link → the joint above it
  for (const j of joints) ownerOfLink.set(j.childLink, j.name)
  return joints.map((j) => ({ from: ownerOfLink.get(j.parentLink) ?? null, to: j.name }))
}

/** Straight-line bone length in mm between two world points (URDF metres). */
export function boneLengthMm(
  a: readonly [number, number, number],
  b: readonly [number, number, number]
): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const dz = b[2] - a[2]
  return Math.sqrt(dx * dx + dy * dy + dz * dz) * 1000
}

/** Bone-label formatter: whole mm from 10 mm up, one decimal below (`7.3 mm`). */
export function formatMm(mm: number): string {
  const v = Math.abs(mm) >= 10 ? Math.round(mm) : Math.round(mm * 10) / 10
  return `${v} mm`
}

/** Live angle readout: native radians → whole degrees (`-35°`). */
export function formatAngleDeg(rad: number): string {
  const deg = Math.round((rad * 180) / Math.PI)
  return `${deg === 0 ? 0 : deg}°` // normalise -0 → 0
}

/**
 * How close a value sits to its NEAREST limit, as 0…1: 0 outside the warning
 * zone (the outer `zoneFrac` of the range at each end), rising to 1 AT the
 * limit. A degenerate range (upper ≤ lower) reports 0 — nothing to warn about.
 */
export function limitProximity(
  value: number,
  lower: number,
  upper: number,
  zoneFrac = 0.15
): number {
  const range = upper - lower
  if (!(range > 0)) return 0
  const zone = range * zoneFrac
  if (!(zone > 0)) return 0
  const dist = Math.min(value - lower, upper - value) // negative when past a limit
  const t = 1 - dist / zone
  return t < 0 ? 0 : t > 1 ? 1 : t
}

/** Blend two `#rrggbb` colours (t=0 → a, t=1 → b). */
export function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  const k = t < 0 ? 0 : t > 1 ? 1 : t
  const ch = (sh: number): number =>
    Math.round(((pa >> sh) & 0xff) + (((pb >> sh) & 0xff) - ((pa >> sh) & 0xff)) * k)
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`
}

const LIMIT_OK = '#6ee76e' // comfortably inside the range
const LIMIT_WARN = '#ffd23f' // entering the warning zone
const LIMIT_HOT = '#ff5a5a' // at / past a limit

/** Needle/readout colour for a limit proximity (0…1): green → amber → red. */
export function limitColorHex(prox: number): string {
  return prox <= 0.5 ? mixHex(LIMIT_OK, LIMIT_WARN, prox * 2) : mixHex(LIMIT_WARN, LIMIT_HOT, (prox - 0.5) * 2)
}

/** The names that appear more than once (each listed once, first-seen order) —
 *  URDF requires unique joint names; the view surfaces these as a friendly error. */
export function duplicateNames(names: string[]): string[] {
  const seen = new Set<string>()
  const dups = new Set<string>()
  const out: string[] = []
  for (const n of names) {
    if (seen.has(n) && !dups.has(n)) {
      dups.add(n)
      out.push(n)
    }
    seen.add(n)
  }
  return out
}

/** Distinct bone colours, cycled in skeleton order. */
export const BONE_PALETTE = [
  '#ff5a8a',
  '#4aa3ff',
  '#ffd23f',
  '#6ee76e',
  '#c792ea',
  '#ff9f43',
  '#4adcd2',
  '#f45b69'
] as const

export function boneColor(i: number): string {
  return BONE_PALETTE[((i % BONE_PALETTE.length) + BONE_PALETTE.length) % BONE_PALETTE.length]
}

// ── Three.js overlay ─────────────────────────────────────────────────────────

const GHOST_COLOR = 0x8b9099 // solid-looking grey…
const GHOST_OPACITY = 0.2 // …at ~80% transparency
const ORDER_BONES = 1001 // above the snap handles (998) so the skeleton always reads
const ORDER_GAUGES = 1002
const ORDER_LABELS = 1003

type SavedMat = { color: number | null; opacity: number; transparent: boolean; depthWrite: boolean }

/** A billboarded text pill (canvas sprite) — JetBrains Mono, dark rounded bg,
 *  depth-test off. Regenerates its texture only when text/colour change. */
class OverlayLabel {
  readonly sprite: THREE.Sprite
  private readonly canvas = document.createElement('canvas')
  private tex: THREE.CanvasTexture | null = null
  private last = ''
  private height: number

  constructor(height: number) {
    this.height = height
    const mat = new THREE.SpriteMaterial({ depthTest: false, depthWrite: false, transparent: true })
    this.sprite = new THREE.Sprite(mat)
    this.sprite.renderOrder = ORDER_LABELS
    this.sprite.raycast = () => {}
    this.sprite.frustumCulled = false
  }

  setText(text: string, color: string): void {
    const key = `${text}|${color}`
    if (key === this.last) return
    this.last = key
    const ctx = this.canvas.getContext('2d')
    if (!ctx) return
    const font = '600 26px "JetBrains Mono", ui-monospace, monospace'
    ctx.font = font
    const w = Math.ceil(ctx.measureText(text).width)
    const padX = 14
    const H = 44
    this.canvas.width = w + padX * 2
    this.canvas.height = H
    ctx.clearRect(0, 0, this.canvas.width, H)
    ctx.font = font // canvas resize resets state
    const r = 10
    ctx.beginPath()
    ctx.roundRect(1, 1, this.canvas.width - 2, H - 2, r)
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
    this.applyScale()
  }

  setHeight(h: number): void {
    if (h !== this.height) {
      this.height = h
      this.applyScale()
    }
  }

  private applyScale(): void {
    const aspect = this.canvas.height > 0 ? this.canvas.width / this.canvas.height : 3
    this.sprite.scale.set(this.height * aspect, this.height, 1)
  }

  dispose(): void {
    this.tex?.dispose()
    ;(this.sprite.material as THREE.SpriteMaterial).dispose()
  }
}

interface JointInternals {
  origPosition?: THREE.Vector3 | null
  origQuaternion?: THREE.Quaternion | null
}

interface BoneEntry {
  from: URDFJoint | null // null → the robot base origin
  to: URDFJoint
  geo: THREE.BufferGeometry
  label: OverlayLabel
}

interface GaugeEntry {
  joint: URDFJoint
  kind: 'compass' | 'ruler'
  /** Placed at the joint's STATIC (angle-independent) frame every frame. */
  group: THREE.Group
  /** Compass: rotated to the live angle. Ruler: translated to the live travel. */
  needle: THREE.Object3D
  needleMat: THREE.LineBasicMaterial
  label: OverlayLabel
  hasLimit: boolean
}

export interface BoneModeHandle {
  setEnabled(on: boolean): void
  /** Per-frame: ghost/restore materials + track the live joint state. */
  update(): void
  dispose(): void
}

const isURDFLink = (o: THREE.Object3D | null): boolean =>
  !!(o as { isURDFLink?: boolean } | null)?.isURDFLink

/** Walk up from a joint to the link that owns it (its parent link). */
const parentLinkName = (joint: URDFJoint, robot: URDFRobot): string => {
  let o: THREE.Object3D | null = joint.parent
  while (o && o !== robot && !isURDFLink(o)) o = o.parent
  return (o as { urdfName?: string } | null)?.urdfName ?? ''
}

/** The joint's child link (its direct URDFLink child). */
const childLinkName = (joint: URDFJoint): string => {
  for (const c of joint.children) {
    if (isURDFLink(c)) return (c as unknown as { urdfName?: string }).urdfName ?? ''
  }
  return ''
}

const lineMaterial = (color: string | number, opacity = 1): THREE.LineBasicMaterial =>
  new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthTest: false,
    depthWrite: false
  })

/** Mark an overlay object raycast-inert + never frustum-culled (its geometry
 *  moves every frame, so a stale bounding sphere must not cull it). */
const inert = <T extends THREE.Object3D>(o: T, order: number): T => {
  o.raycast = () => {}
  o.frustumCulled = false
  o.renderOrder = order
  return o
}

export function createBoneMode(scene: THREE.Scene, getRobot: () => URDFRobot | null): BoneModeHandle {
  const root = new THREE.Group()
  root.visible = false
  scene.add(root)

  let enabled = false
  let builtFor: URDFRobot | null = null
  let builtJointCount = -1
  let scaleBuilt = 0
  let frame = 0
  let bones: BoneEntry[] = []
  let gauges: GaugeEntry[] = []
  let disposables: { dispose(): void }[] = []
  let labels: OverlayLabel[] = []
  const saved = new Map<THREE.Material, SavedMat>()

  const vA = new THREE.Vector3()
  const vB = new THREE.Vector3()
  const mTmp = new THREE.Matrix4()
  const ONE = new THREE.Vector3(1, 1, 1)

  // ── Ghosting — mutate (never swap) the robot's materials so the highlight
  // tint / colour-edit machinery that swaps mesh.material stays undisturbed.
  // Runs every frame while enabled, so meshes that finish loading async (STL/
  // DAE) get ghosted the moment they appear.
  const ghostMaterials = (robot: URDFRobot): void => {
    robot.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const m of mats) {
        if (!m || saved.has(m)) continue
        const col = (m as THREE.MeshStandardMaterial).color
        saved.set(m, {
          color: col ? col.getHex() : null,
          opacity: m.opacity,
          transparent: m.transparent,
          depthWrite: m.depthWrite
        })
        if (col) col.setHex(GHOST_COLOR)
        m.opacity = GHOST_OPACITY
        m.transparent = true
        m.depthWrite = false
        m.needsUpdate = true
      }
    })
  }

  const restoreMaterials = (): void => {
    for (const [m, s] of saved) {
      const col = (m as THREE.MeshStandardMaterial).color
      if (col && s.color != null) col.setHex(s.color)
      m.opacity = s.opacity
      m.transparent = s.transparent
      m.depthWrite = s.depthWrite
      m.needsUpdate = true
    }
    saved.clear()
  }

  const clearOverlay = (): void => {
    root.clear()
    for (const d of disposables) d.dispose()
    for (const l of labels) l.dispose()
    disposables = []
    labels = []
    bones = []
    gauges = []
  }

  const robotMaxDim = (robot: URDFRobot): number => {
    const size = new THREE.Box3().setFromObject(robot).getSize(vA)
    const d = Math.max(size.x, size.y, size.z)
    return Number.isFinite(d) && d > 1e-6 ? d : 0.2
  }

  const makeLabel = (h: number): OverlayLabel => {
    const l = new OverlayLabel(h)
    labels.push(l)
    root.add(l.sprite)
    return l
  }

  // The joint's static (angle-independent) local transform: urdf-loader stashes
  // the parse-time position/quaternion in origPosition/origQuaternion on the
  // first setJointValue; before that the live ones ARE the originals.
  const staticLocal = (joint: URDFJoint): { p: THREE.Vector3; q: THREE.Quaternion } => {
    const inner = joint as unknown as JointInternals
    return { p: inner.origPosition ?? joint.position, q: inner.origQuaternion ?? joint.quaternion }
  }

  const buildCompass = (joint: URDFJoint, radius: number, labelH: number): void => {
    const group = new THREE.Group()
    group.matrixAutoUpdate = false
    // Inner frame: +Z aligned to the joint axis, so angles live in its XY plane
    // and 0° sits along its +X (the joint's rest direction).
    const axis = joint.axis.lengthSq() > 1e-12 ? joint.axis.clone().normalize() : new THREE.Vector3(0, 0, 1)
    const inner = new THREE.Group()
    inner.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis)
    group.add(inner)

    const lim = joint.limit
    const hasLimit = joint.jointType === 'revolute' && lim.upper > lim.lower
    const a0 = hasLimit ? lim.lower : -Math.PI
    const a1 = hasLimit ? lim.upper : Math.PI
    const arcPts: THREE.Vector3[] = []
    const steps = 64
    for (let i = 0; i <= steps; i++) {
      const t = a0 + ((a1 - a0) * i) / steps
      arcPts.push(new THREE.Vector3(Math.cos(t) * radius, Math.sin(t) * radius, 0))
    }
    const arcGeo = new THREE.BufferGeometry().setFromPoints(arcPts)
    const arcMat = lineMaterial('#8fb7ff', 0.85)
    disposables.push(arcGeo, arcMat)
    inner.add(inert(new THREE.Line(arcGeo, arcMat), ORDER_GAUGES))

    // End ticks at the min/max limits (skipped on a full continuous circle).
    if (hasLimit) {
      const tickMat = lineMaterial(LIMIT_HOT, 0.9)
      disposables.push(tickMat)
      for (const a of [a0, a1]) {
        const g = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(Math.cos(a) * radius * 0.82, Math.sin(a) * radius * 0.82, 0),
          new THREE.Vector3(Math.cos(a) * radius * 1.14, Math.sin(a) * radius * 1.14, 0)
        ])
        disposables.push(g)
        inner.add(inert(new THREE.Line(g, tickMat), ORDER_GAUGES))
      }
    }

    // Needle: a line along +X, rotated about the inner Z to the live angle.
    const needleGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(radius * 1.05, 0, 0)
    ])
    const needleMat = lineMaterial(LIMIT_OK, 1)
    disposables.push(needleGeo, needleMat)
    const needle = inert(new THREE.Line(needleGeo, needleMat), ORDER_GAUGES)
    inner.add(needle)

    root.add(group)
    gauges.push({ joint, kind: 'compass', group, needle, needleMat, label: makeLabel(labelH), hasLimit })
  }

  const buildRuler = (joint: URDFJoint, radius: number, labelH: number): void => {
    const group = new THREE.Group()
    group.matrixAutoUpdate = false
    const axis = joint.axis.lengthSq() > 1e-12 ? joint.axis.clone().normalize() : new THREE.Vector3(0, 0, 1)
    const inner = new THREE.Group()
    inner.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis)
    group.add(inner)

    const lim = joint.limit
    const hasLimit = lim.upper > lim.lower
    const lo = hasLimit ? lim.lower : 0
    const hi = hasLimit ? lim.upper : Math.max(radius, 0.02)
    const railGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, lo),
      new THREE.Vector3(0, 0, hi)
    ])
    const railMat = lineMaterial('#8fb7ff', 0.85)
    disposables.push(railGeo, railMat)
    inner.add(inert(new THREE.Line(railGeo, railMat), ORDER_GAUGES))
    const tickMat = lineMaterial(LIMIT_HOT, 0.9)
    disposables.push(tickMat)
    const t = radius * 0.35
    for (const z of [lo, hi]) {
      const g = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-t, 0, z),
        new THREE.Vector3(t, 0, z)
      ])
      disposables.push(g)
      inner.add(inert(new THREE.Line(g, tickMat), ORDER_GAUGES))
    }

    // Marker at the current travel: a small diamond that slides along the rail.
    const markGeo = new THREE.OctahedronGeometry(radius * 0.18)
    const markMat = new THREE.MeshBasicMaterial({
      color: LIMIT_OK,
      transparent: true,
      depthTest: false,
      depthWrite: false
    })
    disposables.push(markGeo, markMat)
    const marker = inert(new THREE.Mesh(markGeo, markMat), ORDER_GAUGES)
    inner.add(marker)

    root.add(group)
    gauges.push({
      joint,
      kind: 'ruler',
      group,
      needle: marker,
      needleMat: markMat as unknown as THREE.LineBasicMaterial,
      label: makeLabel(labelH),
      hasLimit
    })
  }

  const rebuild = (robot: URDFRobot): void => {
    clearOverlay()
    builtFor = robot
    const names = Object.keys(robot.joints)
    builtJointCount = names.length
    const maxDim = robotMaxDim(robot)
    scaleBuilt = maxDim
    const radius = Math.min(Math.max(maxDim * 0.085, 0.012), 0.09)
    const labelH = Math.min(Math.max(maxDim * 0.045, 0.008), 0.05)
    const dotR = Math.min(Math.max(maxDim * 0.012, 0.002), 0.012)

    const infos: BoneJointInfo[] = names.map((name) => {
      const j = robot.joints[name]
      return { name, parentLink: parentLinkName(j, robot), childLink: childLinkName(j) }
    })
    const segs = boneSegments(infos)

    const dotGeo = new THREE.SphereGeometry(dotR, 10, 10)
    const dotMat = new THREE.MeshBasicMaterial({
      color: 0xf2f4f8,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false
    })
    disposables.push(dotGeo, dotMat)

    segs.forEach((seg, i) => {
      const to = robot.joints[seg.to]
      const from = seg.from ? robot.joints[seg.from] : null
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()])
      const mat = lineMaterial(boneColor(i), 1)
      disposables.push(geo, mat)
      root.add(inert(new THREE.Line(geo, mat), ORDER_BONES))
      bones.push({ from, to, geo, label: makeLabel(labelH * 0.85) })
      // A joint-origin dot makes the articulation points read even mid-bone.
      const dot = inert(new THREE.Mesh(dotGeo, dotMat), ORDER_BONES)
      dot.userData.joint = seg.to
      root.add(dot)
    })

    for (const name of names) {
      const j = robot.joints[name]
      if (j.jointType === 'revolute' || j.jointType === 'continuous') buildCompass(j, radius, labelH)
      else if (j.jointType === 'prismatic') buildRuler(j, radius, labelH)
    }
  }

  const update = (): void => {
    const robot = getRobot()
    if (!enabled || !robot) {
      root.visible = false
      if (!enabled && saved.size) restoreMaterials()
      return
    }
    root.visible = true
    frame++
    // Rebuild on a new robot / joint-count change; re-fit sizes when async
    // meshes have materially grown the model (checked once a second-ish).
    if (
      robot !== builtFor ||
      Object.keys(robot.joints).length !== builtJointCount ||
      (frame % 60 === 0 && Math.abs(robotMaxDim(robot) - scaleBuilt) > scaleBuilt * 0.25)
    ) {
      rebuild(robot)
    }
    ghostMaterials(robot)
    robot.updateWorldMatrix(true, true)

    // Bones + labels + joint dots.
    for (const b of bones) {
      if (b.from) vA.setFromMatrixPosition(b.from.matrixWorld)
      else vA.setFromMatrixPosition(robot.matrixWorld)
      vB.setFromMatrixPosition(b.to.matrixWorld)
      const pos = b.geo.getAttribute('position') as THREE.BufferAttribute
      pos.setXYZ(0, vA.x, vA.y, vA.z)
      pos.setXYZ(1, vB.x, vB.y, vB.z)
      pos.needsUpdate = true
      const mm = boneLengthMm([vA.x, vA.y, vA.z], [vB.x, vB.y, vB.z])
      b.label.setText(formatMm(mm), '#cdd2d9')
      b.label.sprite.position.set((vA.x + vB.x) / 2, (vA.y + vB.y) / 2, (vA.z + vB.z) / 2)
      b.label.sprite.visible = mm > 0.5 // co-located joints → no zero-length noise
    }
    for (const o of root.children) {
      const jname = (o.userData as { joint?: string }).joint
      if (jname && robot.joints[jname]) o.position.setFromMatrixPosition(robot.joints[jname].matrixWorld)
    }

    // Gauges: pin each to its joint's STATIC frame, then animate needle/marker.
    for (const g of gauges) {
      const parent = g.joint.parent
      if (!parent) continue
      parent.updateWorldMatrix(true, false)
      const s = staticLocal(g.joint)
      mTmp.compose(s.p, s.q, ONE)
      g.group.matrix.copy(parent.matrixWorld).multiply(mTmp)
      g.group.matrixWorldNeedsUpdate = true

      const value = g.joint.jointValue[0] ?? 0
      const lim = g.joint.limit
      const prox = g.hasLimit ? limitProximity(value, lim.lower, lim.upper) : 0
      const color = limitColorHex(prox)
      if (g.kind === 'compass') {
        g.needle.rotation.z = value
        g.needleMat.color.set(color)
        g.label.setText(`${g.joint.urdfName || g.joint.name} ${formatAngleDeg(value)}`, color)
      } else {
        g.needle.position.z = value
        ;(g.needleMat as unknown as THREE.MeshBasicMaterial).color.set(color)
        g.label.setText(`${g.joint.urdfName || g.joint.name} ${formatMm(value * 1000)}`, color)
      }
      vA.setFromMatrixPosition(g.joint.matrixWorld)
      const lift = Math.min(Math.max(scaleBuilt * 0.11, 0.015), 0.11)
      g.label.sprite.position.set(vA.x, vA.y + lift, vA.z)
    }
  }

  return {
    setEnabled(on: boolean): void {
      enabled = on
      if (!on) {
        root.visible = false
        restoreMaterials()
      }
    },
    update,
    dispose(): void {
      restoreMaterials()
      clearOverlay()
      scene.remove(root)
    }
  }
}
