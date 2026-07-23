import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js'
import URDFLoader from 'urdf-loader'
import type { URDFRobot } from 'urdf-loader'
import { useWorkspace } from '../store/workspace'
import { useWorkspaceLayout } from '../store/layout'
import { baseName, dirname, meshKind } from './robot-mesh'
import {
  type JointMeta,
  type NamedPoseLike,
  capturePoseValues,
  clamp,
  effectiveLimit,
  extractJoints,
  normPin,
  poseTargetNative,
  servoToJointNative,
  toDisplay,
  toNative,
  uniquePoseName
} from './robot-pose'
import { solveCCD, type IkJoint } from './robot-ik'
import { createIkGizmo, type IkChainRef, type IkGizmoHandle } from './robot-ik-gizmo'
import {
  addMeshLink,
  addPrimitive,
  connectJoint,
  externalMeshes,
  rewriteMeshFilename,
  jointNames,
  jointDisplayLimits,
  looseLinks,
  parseAssembly,
  readAllJoints,
  readJoint,
  readPrimitive,
  readVisualOrigin,
  readInertial,
  setInertial,
  removeInertial,
  removeJoint,
  removeLink,
  renameLink,
  renameJoint,
  setJoint,
  setJointOrigin,
  orientJoint,
  subtreeOf,
  setPrimitiveSize,
  setLinkColor,
  readLinkColor,
  collectLinkColors,
  setVisualOrigin,
  type JointDef,
  type JointSpec,
  type JointType,
  type PrimitiveGeom
} from './robot-assembly'
import { canReRoot, reRoot } from './robot-reroot'
import { createBoneMode, duplicateNames, type BoneModeHandle } from './robot-bone-mode'
import { createComOverlay, poseBalance, type ComOverlayHandle, type ComStatus } from './robot-com-overlay'
import { readLinkMasses } from './robot-com'
import type { StabilityState } from './robot-support'
import { usePrompt } from './PromptModal'
import { createViewCube } from './robot-viewcube'
import {
  historyInit,
  historyPush,
  historyUndo,
  historyRedo,
  canUndo as histCanUndo,
  canRedo as histCanRedo,
  type History
} from './use-history'
import {
  classifyFace,
  faceSnapPoints,
  movedJointOrigin,
  resizeFromDrag,
  SNAP_PX,
  catchPx,
  snapRoleLabel,
  type BuildTool,
  type FaceEdit,
  type PrimitiveKind,
  type Vec3
} from './robot-build'
import { RobotBuildPanel } from './RobotBuildPanel'
import { detectSnapCentres } from './robot-holes'
import { jointFromPicks } from './robot-joint-frame'
import { RobotPropertiesDialog, type PropsContext } from './RobotPropertiesDialog'
import { RobotToolbar } from './RobotToolbar'
import { loadPin, savePin, PIN_KEYS } from './pin-overlay'
import { RobotTimeline } from './RobotTimeline'
import { RobotSequencer } from './RobotSequencer'
import { RobotControls } from './RobotControls'
import { RobotMotionDock } from './RobotMotionDock'
import {
  autoMirrorPairs,
  deleteKey,
  dropPose,
  duplicateKey,
  duplicatePose,
  generateMicroPython,
  mirrorTracks,
  moveKey,
  poseSequenceToManagedSteps,
  samplePoseSequence,
  sampleControl,
  sampleTimeline,
  sequenceDuration,
  upsertKey
} from '../../../shared/robot-timeline'
import {
  writeManagedBlocks,
  selectManagedMotionFile,
  type ManagedMotion,
  type ManagedServo,
  type ManagedSequenceStep
} from '../../../shared/managed-blocks'
import { jointToServo } from '../../../shared/krf'
import { prettyUrdf, robotNameOf, urdfExportPath } from '../../../shared/urdf-export'
import { explodeDirections, explodeProgress, easeInOutCubic, orbitPosition, compensateAncestors, hierarchyDepths, resolveOverlaps, probeRecorderMime, extForMime, videoBytesLookValid, type PartBox } from './robot-explode'
import { recordCanvasMp4, createGifSink } from './robot-video'
import { buildServosPayload } from '../../../shared/control'
import { bindableServos, bindServoJoint, type BindableServo } from './servo-bind'
import { onServoDrive } from './servo-drive-bus'
import type { PartLibraryWithParts } from '../../../preload/index.d'
import { useTelemetryStream } from './instrument-telemetry-subscribe'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
import type {
  MirrorPair,
  MotionEasing,
  MotionSequence,
  MotionTimeline,
  PoseStep,
  PuppetControl,
  RobotConnection,
  RobotDefinition,
  RobotModel,
  RobotPart,
  ServoJointBinding
} from '../../../shared/robot'
import type { PartDefinition } from '../../../preload/index.d'
import {
  ExplodeIcon,
  ClapperIcon,
  BoneIcon,
  BalanceIcon,
  TargetIcon,
  CameraIcon,
  RulerIcon,
  LockIcon
} from './ui-icons'
import {
  estimateFromMesh,
  estimateWarning,
  gramsToKg,
  kgToGrams,
  mmToM,
  mToMm,
  summariseMass,
  DEFAULT_MATERIAL,
  DEFAULT_INFILL,
  type MassEstimate,
  type MassBreakdown
} from './robot-mass'
import type { MassEditorProps, ContactsEditorProps } from './RobotPropertiesDialog'
import type { MeshTriangles } from './robot-mass-geometry'
import { addContact, removeContact, setContact } from './robot-contacts'
import './RobotView.css'

/** An empty motion clip (2 s, ease-in-out, looping). */
const EMPTY_TIMELINE: MotionTimeline = { duration: 2, easing: 'easeInOut', loop: true, fps: 20, tracks: [] }

/** An empty pose sequence (#415) — looping, no steps yet. */
const EMPTY_SEQUENCE: MotionSequence = { name: 'sequence', loop: true, fps: 20, steps: [] }

// Camera view per robot, kept at MODULE scope so it survives the RobotView unmounting
// when you switch to a non-URDF editor tab — otherwise the orbit is lost and the view
// resets to the default framing on return (#399). Keyed by the same `frameKey` the
// in-run preservation uses (the active file, or the base link for the compact viewer).
type CamState = { pos: THREE.Vector3; target: THREE.Vector3; zoom: number; halfView: number }
const cameraCache = new Map<string, CamState>()

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
  /** Open at the HOME (zoomed-to-fit isometric) view instead of restoring the
   *  preserved camera. Set for the Build workspace so switching to it always
   *  frames the model fresh rather than keeping a stale camera (#615). */
  homeOnMount?: boolean
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

/** The `urdfName` of the URDFLink an object belongs to, or null (#555). */
function ownerLink(obj: THREE.Object3D | null): string | null {
  let o = obj
  while (o && !(o as unknown as { isURDFLink?: boolean }).isURDFLink) o = o.parent
  return (o as unknown as { urdfName?: string } | null)?.urdfName ?? null
}

/**
 * Extract a link's OWN mesh triangles in its LOCAL frame, in metres (#555).
 *
 * A joined child nests under its parent in the scene graph, so we keep only
 * meshes this link actually owns (`ownerLink`). Each vertex is pushed through
 * `mesh.matrixWorld` then back into the link's local frame, which bakes in the
 * mesh's `scale` (mm→m etc.) — so the caller measures volume in metres and
 * converts with a fixed unitScaleToMm of 1000, regardless of authored units.
 * Returns null when the link has no triangle geometry (a primitive-only link
 * is handled elsewhere; a bare/empty link has no mesh to estimate from).
 */
function linkLocalTriangles(robot: URDFRobot, link: string): MeshTriangles | null {
  const linkObj = robot.links[link]
  if (!linkObj) return null
  robot.updateMatrixWorld(true)
  const toLocal = new THREE.Matrix4().copy(linkObj.matrixWorld).invert()
  const positions: number[] = []
  const v = new THREE.Vector3()
  linkObj.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || ownerLink(mesh) !== link) return
    const geom = mesh.geometry as THREE.BufferGeometry
    const pos = geom.getAttribute('position') as THREE.BufferAttribute | undefined
    if (!pos) return
    const toLinkLocal = new THREE.Matrix4().multiplyMatrices(toLocal, mesh.matrixWorld)
    const index = geom.getIndex()
    const emit = (i: number): void => {
      v.fromBufferAttribute(pos, i).applyMatrix4(toLinkLocal)
      positions.push(v.x, v.y, v.z)
    }
    if (index) for (let i = 0; i < index.count; i++) emit(index.getX(i))
    else for (let i = 0; i < pos.count; i++) emit(i)
  })
  return positions.length >= 9 ? { positions } : null
}

/**
 * The link's LOCAL-frame point that sits lowest in the WORLD (#557) — the
 * natural spot to seed a ground-contact for a foot. Scans the link's own mesh
 * vertices, tracks the one with the smallest world Y (Snakie's up axis), and
 * returns it back in link-local coordinates. Null when the link has no mesh.
 */
function lowestLinkPointLocal(robot: URDFRobot, link: string): [number, number, number] | null {
  const linkObj = robot.links[link]
  if (!linkObj) return null
  robot.updateMatrixWorld(true)
  const toWorld = new THREE.Matrix4().copy(linkObj.matrixWorld)
  const toLocal = new THREE.Matrix4().copy(toWorld).invert()
  const world = new THREE.Vector3()
  let best: THREE.Vector3 | null = null
  let bestY = Infinity
  linkObj.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || ownerLink(mesh) !== link) return
    const geom = mesh.geometry as THREE.BufferGeometry
    const pos = geom.getAttribute('position') as THREE.BufferAttribute | undefined
    if (!pos) return
    for (let i = 0; i < pos.count; i++) {
      world.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld)
      if (world.y < bestY) {
        bestY = world.y
        best = world.clone()
      }
    }
  })
  if (!best) return null
  const local = (best as THREE.Vector3).applyMatrix4(toLocal)
  return [local.x, local.y, local.z]
}

export function RobotView({
  urdfContent,
  basePath,
  compact = false,
  homeOnMount = false
}: RobotViewProps = {}): JSX.Element {
  // Read inside the once-per-mount 3-D effect without adding it to the deps.
  const homeOnMountRef = useRef(homeOnMount)
  homeOnMountRef.current = homeOnMount
  const { openFiles, activeId, currentFolder, updateContent, saveFile, openBuffer, openFile } =
    useWorkspace()
  const activeFile = openFiles.find((f) => f.id === activeId) ?? null
  const content = urdfContent ?? activeFile?.content ?? ''
  // Where to resolve mesh files from: an explicit base (docked panel) else the
  // open local file's folder (opening a `.urdf` from a project).
  const effectiveBase =
    basePath ?? (activeFile && activeFile.source === 'local' ? dirname(activeFile.path) : '')

  const mountRef = useRef<HTMLDivElement>(null)
  const cubeMountRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<{ name: string; joints: number; links: number } | null>(null)
  const [meshNote, setMeshNote] = useState<string | null>(null)
  const prompt = usePrompt() // in-app modal (window.prompt is dead in the renderer)

  const isEmpty = !content.trim()
  // The full-screen (non-compact) view is the Pose tool (#312): a joint sidebar,
  // named poses and a measure tool. The docked mini-panel stays view-only.
  const poseUI = !compact

  const [jointMeta, setJointMeta] = useState<JointMeta[]>([])
  const [values, setValues] = useState<Record<string, number>>({}) // native (rad/m)
  const [overrides, setOverrides] = useState<Record<string, { min?: number; max?: number }>>({})
  const [poses, setPoses] = useState<NamedPoseLike[]>([])
  const posesRef = useRef<NamedPoseLike[]>([])
  // Per-link ground-contact points (#557), link-local metres — mirrors robot.yml
  // `contacts`, kept reactive so the inspector reflects edits immediately.
  const [contacts, setContacts] = useState<Record<string, [number, number, number][]>>({})
  const contactsRef = useRef<Record<string, [number, number, number][]>>({})
  contactsRef.current = contacts
  // The scene ground-plane Y (the grid's height) + the per-link masses, held in
  // refs so the CoM overlay's per-frame getData reads them without re-closing (#558).
  const groundYRef = useRef(0)
  const linkMassesRef = useRef<ReturnType<typeof readLinkMasses>>({})
  posesRef.current = poses
  // Managed sequences (#413) parsed from an opened motion.py — round-tripped
  // losslessly on re-export even though the sequence editor UI (#415) is pending.
  const managedSequencesRef = useRef<Record<string, ManagedSequenceStep[]>>({})
  // Files whose managed blocks last failed to parse (a broken hand-edit): sync is
  // paused so we neither re-read nor silently clobber their intentional edits.
  const suspendedSyncRef = useRef<Set<string>>(new Set())
  // Guards the one-time managed-block seed per focused file id.
  const seededManagedRef = useRef<string>('')
  const [measureActive, setMeasureActive] = useState(false)
  const [boneMode, setBoneMode] = useState(false) // skeleton overlay (#536)
  const boneModeRef = useRef(false)
  const boneApiRef = useRef<BoneModeHandle | null>(null)
  const [comMode, setComMode] = useState(false) // CoM + support-polygon overlay (#558)
  const comModeRef = useRef(false)
  const comApiRef = useRef<ComOverlayHandle | null>(null)
  const [comStatus, setComStatus] = useState<ComStatus | null>(null)
  // Interactive IK goal gizmo (#540, epic #533 §5): a draggable end-effector goal
  // that live-solves the selected chain (shared planar solver).
  const [ikGoal, setIkGoal] = useState(false)
  const ikGoalRef = useRef(false)
  const ikApiRef = useRef<IkGizmoHandle | null>(null)
  const [measureDist, setMeasureDist] = useState<number | null>(null)
  const [savingLabel, setSavingLabel] = useState<string | null>(null)
  // True while a running program's `SNK SERVO` telemetry is actively driving a
  // mapped joint (#414) — so the pose editor can show a "Live ●" hint that a
  // Capture reads the hardware/simulator posture. Clears ~1.2s after it stops.
  const [poseLive, setPoseLive] = useState(false)
  const poseLiveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Refs kept fresh for imperative handlers + the three.js pointer callbacks.
  const robotRef = useRef<URDFRobot | null>(null)
  const defRef = useRef<RobotDefinition | null>(null)
  const metaRef = useRef<JointMeta[]>([])
  const valuesRef = useRef<Record<string, number>>({})
  const overridesRef = useRef<Record<string, { min?: number; max?: number }>>({})
  const defaultPoseRef = useRef<Record<string, number>>({}) // native, non-mimic
  const jointRollRef = useRef<Record<string, number>>({}) // joint name → absolute roll (deg)
  const jointNormalRef = useRef<Record<string, [number, number, number]>>({}) // joint → mating normal (parent frame)
  const measureActiveRef = useRef(false)
  const measureApiRef = useRef<{ clear: () => void } | null>(null)
  const highlightApiRef = useRef<{ apply: (link: string | null) => void } | null>(null)
  // Imperative zoom API (the buttons live in React; the ortho camera lives in the
  // three.js effect) + the live zoom % for the readout.
  const zoomApiRef = useRef<{
    in: () => void
    out: () => void
    fit: () => void
    toggle: () => void
    home: () => void
    focusLink: (name: string) => void
    /** Exploded view (#499): set the separation factor (0 = assembled). */
    setExplode: (f: number) => void
    /** Animate 0→f→0 with easing; optionally orbit the camera one full turn. */
    animateExplode: (f: number, orbit: boolean, onDone?: () => void) => void
    /** Record the explode animation off the canvas → downloads an mp4/webm. */
    recordExplode: (f: number, orbit: boolean) => Promise<boolean>
  } | null>(null)
  const [zoomPct, setZoomPct] = useState(100)
  // Exploded view UI (#499): popover open, separation slider, orbit toggle, busy.
  const [explodeOpen, setExplodeOpen] = useState(false)
  const [explodeF, setExplodeF] = useState(0.6)
  const [explodeOrbit, setExplodeOrbit] = useState(true)
  const [explodeBusy, setExplodeBusy] = useState(false)
  // Camera projection — PERSPECTIVE is the default view (the ViewCube dropdown
  // toggles it). Changing it rebuilds the 3-D effect + re-frames.
  const [projection, setProjection] = useState<'ortho' | 'persp'>('persp')
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
    // Never overwrite an existing robot.yml with a blank: load it first if we
    // haven't captured the full definition yet (preserves wiring + urdf ref).
    let def = defRef.current
    if (!def) {
      try {
        def = await window.api.robot.load(currentFolder || undefined)
      } catch {
        def = { parts: [], connections: [] }
      }
    }
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


  // Capture the live posture as a named pose (#414). `include` (when given) makes
  // it a PARTIAL pose — only those joints are stored, so a face-only capture
  // leaves the legs out of `values`. Works whether the sliders OR a running
  // program's `SNK SERVO` telemetry are driving the joints (both update `values`).
  const handleSavePose = (name: string, include?: string[]): void => {
    // A partial capture with nothing ticked would persist a dead, empty pose — refuse it.
    if (include && include.length === 0) return
    const vals = capturePoseValues(metaRef.current, valuesRef.current, include)
    const next = [...poses.filter((p) => p.name !== name), { name, values: vals }]
    setPoses(next)
    void persist((m) => {
      m.poses = next
    })
    // Advance the editor to the just-saved pose so it flips from "new" to edit mode
    // (Recall/Delete appear, the name locks in), instead of a stale new-pose draft.
    if (name) setDialogCtx({ kind: 'pose', name })
  }

  // The IK goal gizmo's target chain (#540): the movable revolute/continuous
  // joints from the selected link UP to the root, BASE-first (the shared planar
  // solver's convention). Reused for both the gizmo and Capture Pose.
  const ikGoalChain = (endLink: string | null): IkChainRef | null => {
    if (!endLink) return null
    const byChild = new Map(readAllJoints(contentRef.current).map((j) => [j.child, j]))
    const names: string[] = []
    const seen = new Set<string>()
    let cur: string | undefined = endLink
    while (cur && !seen.has(cur)) {
      seen.add(cur)
      const j = byChild.get(cur) // the joint whose child is `cur` (its parent joint)
      if (!j) break
      const m = metaRef.current.find((x) => x.name === j.name)
      if (m && !m.isMimic && (m.type === 'revolute' || m.type === 'continuous')) names.push(j.name)
      cur = j.parent
    }
    if (!names.length) return null
    names.reverse() // walk was tip→base; the solver wants base→tip
    return { joints: names, endLink }
  }

  // Capture the current IK-solved posture as a Motion Studio pose (#540) — a
  // PARTIAL pose of just the chain the gizmo drove, so it composes with the rest.
  const handleCaptureIkPose = async (): Promise<void> => {
    const joints = ikApiRef.current?.chainJoints() ?? []
    if (!joints.length) return
    const name = await prompt('Name this IK pose', uniquePoseName('ik pose', posesRef.current.map((p) => p.name)))
    if (name && name.trim()) handleSavePose(name.trim(), joints)
  }
  // Refs so the (stable-deps) three.js scene effect can call the latest chain
  // resolver + board streamer without re-subscribing the whole scene each render.
  const ikGoalChainRef = useRef(ikGoalChain)
  ikGoalChainRef.current = ikGoalChain

  // Duplicate a pose under a unique "<name> copy" name, keeping the original and
  // never clobbering an existing entry (#414). Opens the copy for editing.
  const handleDuplicatePose = (name: string): void => {
    const src = poses.find((p) => p.name === name)
    if (!src) return
    const copyName = uniquePoseName(name, poses.map((p) => p.name))
    const next = [...poses, { name: copyName, values: { ...src.values } }]
    setPoses(next)
    void persist((m) => {
      m.poses = next
    })
    setDialogCtx({ kind: 'pose', name: copyName })
  }

  // Recall a pose by smoothly EASING the model from its current joints to the saved
  // ones (#409/#409-follow-up), rather than snapping — used EVERYWHERE a pose is
  // selected (the compact preview dropdown, the Poses list, and the pose dialog's
  // Recall). Self-contained rAF (the scene renders every frame anyway); re-picking
  // mid-tween re-targets smoothly from the live joint angles. `values` is settled at
  // the end so the sidebar sliders land on the pose.
  const poseTweenRef = useRef<number | null>(null)
  const handleRecallPose = (pose: NamedPoseLike): void => {
    const r = robotRef.current
    if (!r) return
    // Partial poses leave omitted joints where they are (#414) — see poseTargetNative.
    const target = poseTargetNative(metaRef.current, valuesRef.current, pose.values, overridesRef.current)
    const start: Record<string, number> = {}
    for (const m of metaRef.current) {
      if (m.isMimic) continue
      const a = (r.joints?.[m.name] as { angle?: number } | undefined)?.angle
      start[m.name] = typeof a === 'number' ? a : valuesRef.current[m.name] ?? 0
    }
    if (poseTweenRef.current !== null) cancelAnimationFrame(poseTweenRef.current)
    const DURATION = 380
    const t0 = performance.now()
    // easeInOutCubic
    const ease = (x: number): number => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)
    const step = (): void => {
      // Robot torn down / replaced (effect re-run or unmount) → abandon the tween.
      if (robotRef.current !== r) {
        poseTweenRef.current = null
        return
      }
      const k = Math.min(1, (performance.now() - t0) / DURATION)
      const e = ease(k)
      for (const m of metaRef.current) {
        if (m.isMimic) continue
        const a = start[m.name] ?? 0
        const b = target[m.name] ?? a
        r.setJointValue(m.name, a + (b - a) * e)
      }
      if (k < 1) {
        poseTweenRef.current = requestAnimationFrame(step)
      } else {
        poseTweenRef.current = null
        setValues(target) // settle state so the next recall starts from the right base
      }
    }
    poseTweenRef.current = requestAnimationFrame(step)
  }

  const handleDeletePose = (name: string): void => {
    const next = poses.filter((p) => p.name !== name)
    setPoses(next)
    // Degrade any puppet control that referenced this pose: drop the ref (#416). A
    // control left with <2 poses can't blend and (unlike the sanitiser's silent
    // drop on reload) has no UI to recover, so remove it outright — in-memory and
    // persisted state stay in step. Never throws.
    const cur = controlsRef.current
    const pruned = cur
      .map((c) => ({ ...c, poses: c.poses.filter((p) => p !== name) }))
      .filter((c) => c.poses.length >= 2)
    const controlsChanged = pruned.length !== cur.length || pruned.some((c, i) => c.poses.length !== cur[i].poses.length)
    if (controlsChanged) setControls(pruned)
    void persist((m) => {
      m.poses = next
      if (controlsChanged) m.controls = pruned
    })
  }

  // Rename a pose (#353 pose dialog): keep its captured values. REFUSE a name that
  // already belongs to a DIFFERENT pose — overwriting would silently destroy that
  // pose's captured values (persisted to robot.yml, outside the URDF undo history).
  const handleRenamePose = (oldName: string, newName: string): void => {
    const target = newName.trim()
    const pose = poses.find((p) => p.name === oldName)
    if (!pose || !target || target === oldName) return
    if (poses.some((p) => p.name === target)) {
      setSavingLabel(`A pose named “${target}” already exists`)
      return
    }
    const next = [...poses.filter((p) => p.name !== oldName), { name: target, values: pose.values }]
    setPoses(next)
    // Cascade the rename into any puppet control that references the pose (#416).
    const cur = controlsRef.current
    const renamed = cur.map((c) =>
      c.poses.includes(oldName) ? { ...c, poses: c.poses.map((p) => (p === oldName ? target : p)) } : c
    )
    const controlsChanged = renamed.some((c, i) => c !== cur[i])
    if (controlsChanged) setControls(renamed)
    void persist((m) => {
      m.poses = next
      if (controlsChanged) m.controls = renamed
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
  // The model's joints, for the hierarchy's Joints branch (#353).
  const joints = useMemo(() => readAllJoints(content), [content])
  // Bone Mode (#536) needs unique joint names (IK keys on them) — URDF requires
  // it, but a hand-edited file can break it; surface a friendly error.
  const dupJointNames = useMemo(() => duplicateNames(jointNames(content)), [content])
  // Import is only possible for a saved local `.urdf` (a file we can edit).
  const canImport = poseUI && activeFile?.source === 'local' && !!activeFile.path
  const [importing, setImporting] = useState(false)
  // Meshes this URDF points at that live OUTSIDE the project folder (#407) — they
  // load now but go missing if the project is moved/shared. Offer to copy them in.
  const externalMeshRefs = useMemo(
    () => (canImport ? externalMeshes(content, effectiveBase) : []),
    [canImport, content, effectiveBase]
  )
  const [copyingMeshes, setCopyingMeshes] = useState(false)
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

  // ── Block builder (#315a) ──────────────────────────────────────────────────
  // The build menu defaults to PINNED OPEN (first run / no stored preference).
  const [buildPinned, setBuildPinned] = useState(() =>
    loadPin(window.localStorage, PIN_KEYS.builder, true)
  )
  const [buildOpen, setBuildOpen] = useState(() =>
    loadPin(window.localStorage, PIN_KEYS.builder, true)
  )
  const [selectedLink, setSelectedLink] = useState<string | null>(null)
  // The link the user designated as the base (root) of the chain, from robot.yml.
  // Distinguishes the intended base from other still-unconnected imported parts (#354).
  const [chosenBase, setChosenBase] = useState<string | null>(null)
  // The hierarchy node whose context dialog (#353) is open — a block/mesh, a
  // joint, a servo binding or a pose. `editLink` (the block whose URDF is being
  // edited + highlighted in 3-D) is DERIVED from it (link + joint contexts).
  const [dialogCtx, setDialogCtx] = useState<PropsContext | null>(null)
  const editLink =
    dialogCtx?.kind === 'link' ? dialogCtx.link : dialogCtx?.kind === 'joint' ? dialogCtx.child : null
  // `text` is a ReactNode, not a string: the "locked" label carries an inline
  // padlock ICON (#549) — an emoji there is invisible on Linux without an
  // emoji font. Every other producer still passes a plain string.
  const [buildDim, setBuildDim] = useState<{ x: number; y: number; text: ReactNode } | null>(null)
  // Join tool (#354): the two points picked in 3-D. Non-null = pick mode is armed.
  // `local` + `normal` are in the link's LOCAL frame (the point + its face normal).
  type JointPickPt = {
    link: string
    local: [number, number, number]
    normal: [number, number, number]
    role: string
  }
  const [jointPick, setJointPick] = useState<{
    step: 'parent' | 'child'
    parent: JointPickPt | null
    child: JointPickPt | null
  } | null>(null)
  // Refs the three.js pointer callbacks read (avoids re-subscribing on each edit).
  const buildOpenRef = useRef(false)
  const selectedLinkRef = useRef<string | null>(null)
  const editLinkRef = useRef<string | null>(null)
  // Join-tool bridges: pick mode state for the effect, the pick callback, + a
  // handle to clear the 3-D pick markers. `parentLink`/`childLink` let the pick
  // handler reject a same-block pick BEFORE it draws a marker.
  const jointPickRef = useRef<{
    active: boolean
    step: 'parent' | 'child'
    parentLink: string | null
    childLink: string | null
  }>({ active: false, step: 'parent', parentLink: null, childLink: null })
  jointPickRef.current = {
    active: !!jointPick,
    step: jointPick?.step ?? 'parent',
    parentLink: jointPick?.parent?.link ?? null,
    childLink: jointPick?.child?.link ?? null
  }
  // The full pick state (with local coords) for the effect to REDRAW markers after
  // a rebuild mid-pick (deps change) — otherwise the dialog shows picks but 3-D is bare.
  const jointPickStateRef = useRef(jointPick)
  jointPickStateRef.current = jointPick
  const onJointPickRef = useRef<
    | ((
        link: string,
        local: [number, number, number],
        normal: [number, number, number],
        role: string
      ) => void)
    | null
  >(null)
  const jointPickApiRef = useRef<{
    clear: () => void
    dim: (link: string | null) => void
  } | null>(null)
  buildOpenRef.current = buildOpen && poseUI
  selectedLinkRef.current = selectedLink
  editLinkRef.current = editLink
  // Editing needs a real saved file (so the URDF text can be written next to it).
  const canEdit = poseUI && activeFile?.source === 'local' && !!activeFile.path
  const canEditRef = useRef(false)
  canEditRef.current = canEdit
  const [buildTool, setBuildTool] = useState<BuildTool>('select')
  const buildToolRef = useRef<BuildTool>('select')
  buildToolRef.current = buildTool
  const onSetTool = (t: BuildTool): void => {
    setBuildTool(t)
    setMeasureActive(false) // the two canvas interaction modes are exclusive
  }
  // Camera state preserved across the content re-parse (so an edit never jumps
  // the view); keyed by the open file so a NEW robot still auto-frames.
  const cameraStateRef = useRef<{
    pos: THREE.Vector3
    target: THREE.Vector3
    zoom: number
    halfView: number
  } | null>(null)
  const framedKeyRef = useRef<string | null>(null)
  // Set before an ADD (primitive / STL) so the next re-parse RE-FRAMES to reveal
  // the new object at the origin, instead of preserving the camera like an edit.
  const refitNextRef = useRef(false)

  const editGeom: PrimitiveGeom | null = useMemo(
    () => (editLink ? readPrimitive(content, editLink) : null),
    [content, editLink]
  )
  const editJoint: JointDef | null = useMemo(
    () => (editLink ? readJoint(content, editLink) : null),
    [content, editLink]
  )
  const allJointNames = useMemo(() => jointNames(content), [content])
  // Each joint's real travel (deg / mm), to seed a new servo binding's joint range
  // from the joint's limits instead of a flat 0…180 (which clamped the 3-D model).
  const jointLimits = useMemo(() => jointDisplayLimits(content), [content])
  // The edited link's colour + the palette of colours already on the robot (#405).
  const editLinkColor = useMemo(
    () => (editLink ? readLinkColor(content, editLink) ?? undefined : undefined),
    [content, editLink]
  )
  const usedLinkColors = useMemo(
    () => collectLinkColors(content, editLink ?? undefined),
    [content, editLink]
  )
  // A link is recolourable if it's a primitive (has editable geometry) OR an STL mesh
  // (no baked material, so the inline <material> shows). DAE/Collada keep their own
  // materials — no colour control for those (#405).
  const editColorable = useMemo(() => {
    if (!editLink) return false
    if (readPrimitive(content, editLink)) return true
    const it = parseAssembly(content).find((i) => i.link === editLink)
    return it?.kind === 'mesh' && /\.stl$/i.test(it.mesh ?? '')
  }, [content, editLink])
  // Valid parents for the part being edited: every link EXCEPT itself and its own
  // descendants (attaching onto its own branch would loop) — the "Attaches to" picker.
  const parentOptions = useMemo(() => {
    if (!editLink) return []
    const banned = subtreeOf(content, editLink) // includes editLink itself
    return parseAssembly(content)
      .map((i) => i.link)
      .filter((l) => !banned.has(l))
  }, [content, editLink])
  // The effective base for the hierarchy's ★ marker: the user's chosen base if it's
  // still a root, else the sole root of a single-tree robot, else null — meaning
  // several loose parts and no base picked yet (the panel then prompts to pick one).
  const effectiveBaseLink = useMemo(() => {
    const roots = looseLinks(content) // every childless link
    if (chosenBase && roots.includes(chosenBase)) return chosenBase
    if (roots.length === 1) return roots[0] // a single-tree robot: its sole root
    // Several roots + no explicit choice: honour the conventional `base_link` (the
    // new-robot starter's base) if present, else prompt the user to pick one.
    return roots.includes('base_link') ? 'base_link' : null
  }, [content, chosenBase])

  const setBuildPinnedPersist = (p: boolean): void => {
    setBuildPinned(p)
    savePin(window.localStorage, PIN_KEYS.builder, p)
  }

  const contentRef = useRef(content)
  contentRef.current = content

  // ── Undo/redo (#338) ──────────────────────────────────────────────────────
  // Every builder action funnels through commitUrdf, so checkpointing the
  // pre-edit text there gives undo over ALL of them. The URDF's "present" lives
  // in the workspace store (and can also change via a Monaco text edit), so we
  // sync `present` from the live content before each op — an interleaved text
  // edit is still captured. Reuses the pure #187 stack ops.
  const histRef = useRef<History<string>>(historyInit(content))
  const [, bumpHist] = useReducer((n: number) => n + 1, 0)
  const syncPresent = (): void => {
    if (histRef.current.present !== contentRef.current) {
      // An out-of-band content change is a fresh checkpoint: fold it in AND clear
      // the redo stack (like any undo manager) so a later Redo can't resurrect a
      // stale future state on top of it.
      histRef.current = historyPush(histRef.current, contentRef.current, 50)
    }
  }
  // Low-level: patch the buffer + schedule the deferred save. NO checkpoint.
  const applyUrdf = (next: string): void => {
    if (!activeFile || activeFile.source !== 'local' || !activeFile.path) return
    updateContent(activeFile.id, next)
    pendingSaveRef.current = activeFile.id
  }
  // Commit a builder edit (the one choke point → one undo step per action).
  const commitUrdf = (next: string): void => {
    if (next === contentRef.current) return
    if (!activeFile || activeFile.source !== 'local' || !activeFile.path) return
    syncPresent()
    histRef.current = historyPush(histRef.current, next, 50)
    applyUrdf(next)
    bumpHist()
  }
  const undoUrdf = (): void => {
    syncPresent()
    if (!histCanUndo(histRef.current)) return
    histRef.current = historyUndo(histRef.current)
    applyUrdf(histRef.current.present)
    bumpHist()
  }
  const redoUrdf = (): void => {
    syncPresent()
    if (!histCanRedo(histRef.current)) return
    histRef.current = historyRedo(histRef.current)
    applyUrdf(histRef.current.present)
    bumpHist()
  }
  // Latest undo/redo for the (stable-deps) keyboard listener.
  const undoRedoRef = useRef({ undo: (): void => {}, redo: (): void => {} })
  undoRedoRef.current = { undo: undoUrdf, redo: redoUrdf }
  const commitUrdfRef = useRef<((next: string) => void) | null>(null)
  commitUrdfRef.current = commitUrdf

  // Undo history is per-file — reset it when the open file changes.
  useEffect(() => {
    histRef.current = historyInit(contentRef.current)
    bumpHist()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFile?.id])
  // Cmd/Ctrl+Z = undo, +Shift (or Ctrl+Y) = redo — only in the full builder view,
  // and never while typing in a field or the Monaco editor (it has its own undo).
  useEffect(() => {
    if (!poseUI) return
    const onKey = (e: KeyboardEvent): void => {
      const k = e.key.toLowerCase()
      if (!(e.metaKey || e.ctrlKey) || (k !== 'z' && k !== 'y')) return
      const el = document.activeElement as HTMLElement | null
      if (
        el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.isContentEditable ||
          el.closest('.monaco-editor'))
      )
        return
      e.preventDefault()
      if (k === 'y' || e.shiftKey) undoRedoRef.current.redo()
      else undoRedoRef.current.undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [poseUI])

  const handleAddPrimitive = (kind: PrimitiveKind): void => {
    if (!canEdit) return // needs a saved project file — don't set a phantom selection
    // Bring a new block in at the WORKSPACE ORIGIN, attached to the base (never
    // auto-stuck onto the selected part — that placement can't be guessed). The
    // user then moves/joins it. Reframe so it's actually in view.
    refitNextRef.current = true
    const { urdf, link } = addPrimitive(content, { kind, jointXyz: [0, 0, 0] })
    commitUrdf(urdf)
    setSelectedLink(link)
    setDialogCtx({ kind: 'link', link })
    if (!buildOpen) setBuildOpen(true)
  }
  // Open a different robot model (.urdf) via the native file picker — lets you
  // switch robots from the pose tool, including when it's popped out full-screen.
  const handleOpenRobotFile = async (): Promise<void> => {
    const path = await window.api.fs.openFileDialog({
      filters: [
        { name: 'Robot model', extensions: ['urdf', 'xacro'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (path) await openFile('local', path)
  }
  const handleSetSize = (link: string, dims: number[]): void => {
    commitUrdf(setPrimitiveSize(content, link, dims))
  }

  // ── Per-link mass (#555, epic #535 §1) ────────────────────────────────────
  // The value lives in the URDF <inertial>; the estimate settings (material +
  // infill) live in robot.yml so the estimate stays reproducible. Material/infill
  // are held in React state, seeded from robot.yml when the open link changes, so
  // dragging the infill slider re-estimates live.
  const [massMaterial, setMassMaterial] = useState(DEFAULT_MATERIAL)
  const [massInfill, setMassInfill] = useState(DEFAULT_INFILL)
  useEffect(() => {
    const lm = editLink ? defRef.current?.robot?.linkMass?.[editLink] : undefined
    setMassMaterial(lm?.material ?? DEFAULT_MATERIAL)
    setMassInfill(typeof lm?.infill === 'number' ? lm.infill : DEFAULT_INFILL)
    // editLink is the only real dependency; the ref read is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editLink])

  /** Estimate the open link's mass from its mesh, in the current material/infill. */
  const estimateLink = useCallback(
    (link: string, material: string, infill: number): MassEstimate | null => {
      const robot = robotRef.current
      if (!robot) return null
      const tris = linkLocalTriangles(robot, link)
      if (!tris) return null
      return estimateFromMesh(tris, { material, infill, unitScaleToMm: 1000 })
    },
    []
  )

  /** The CoM (URDF metres) to store with a mass: an existing one wins, else the
   *  estimate's centroid, else the origin. */
  const comForLink = (link: string, est: MassEstimate | null): [number, number, number] => {
    const existing = readInertial(contentRef.current, link)
    if (existing) return existing.com
    if (est) return [mmToM(est.centroidMm[0]), mmToM(est.centroidMm[1]), mmToM(est.centroidMm[2])]
    return [0, 0, 0]
  }

  const handleSetMeasured = (link: string, grams: number | null): void => {
    if (grams === null) {
      commitUrdf(removeInertial(contentRef.current, link))
      void persist((m) => {
        if (m.linkMass) delete m.linkMass[link]
      })
      return
    }
    commitUrdf(setInertial(contentRef.current, link, { mass: gramsToKg(grams), com: comForLink(link, null) }))
    void persist((m) => {
      m.linkMass = { ...(m.linkMass ?? {}), [link]: { source: 'measured' } }
    })
  }

  const handleUseEstimate = (link: string): void => {
    const est = estimateLink(link, massMaterial, massInfill)
    if (!est) return
    const com: [number, number, number] = [
      mmToM(est.centroidMm[0]),
      mmToM(est.centroidMm[1]),
      mmToM(est.centroidMm[2])
    ]
    commitUrdf(setInertial(contentRef.current, link, { mass: gramsToKg(est.grams), com }))
    void persist((m) => {
      m.linkMass = {
        ...(m.linkMass ?? {}),
        [link]: { source: 'estimated', material: massMaterial, infill: massInfill }
      }
    })
  }

  /** Persist new estimate settings; if this link's mass IS the estimate, re-apply
   *  it so the stored value tracks the sliders. */
  const handleSetMassSettings = (link: string, material: string, infill: number): void => {
    const wasEstimate = defRef.current?.robot?.linkMass?.[link]?.source === 'estimated'
    if (wasEstimate) {
      const est = estimateLink(link, material, infill)
      if (est) {
        const com: [number, number, number] = [
          mmToM(est.centroidMm[0]),
          mmToM(est.centroidMm[1]),
          mmToM(est.centroidMm[2])
        ]
        commitUrdf(setInertial(contentRef.current, link, { mass: gramsToKg(est.grams), com }))
      }
    }
    void persist((m) => {
      const prev = m.linkMass?.[link]
      m.linkMass = { ...(m.linkMass ?? {}), [link]: { source: prev?.source ?? 'none', material, infill } }
    })
  }

  // Live mass estimate for the open link (#555). Recomputes when the link, the
  // material/infill, or the geometry (content) changes; robotRef is populated by
  // the time a link dialog is open.
  const editMassEstimate = useMemo<MassEstimate | null>(() => {
    if (!editLink || dialogCtx?.kind !== 'link') return null
    return estimateLink(editLink, massMaterial, massInfill)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editLink, dialogCtx, massMaterial, massInfill, content, estimateLink])

  const massEditor = useMemo<MassEditorProps | null>(() => {
    if (!editLink || dialogCtx?.kind !== 'link') return null
    const inertial = readInertial(content, editLink)
    const provenance = defRef.current?.robot?.linkMass?.[editLink]
    // The URDF <inertial> holds the authoritative value; provenance labels it.
    const grams = inertial ? kgToGrams(inertial.mass) : 0
    const source = inertial ? provenance?.source ?? 'measured' : 'none'
    const comMm: [number, number, number] | undefined = inertial
      ? [mToMm(inertial.com[0]), mToMm(inertial.com[1]), mToMm(inertial.com[2])]
      : editMassEstimate?.centroidMm
    return {
      grams,
      source,
      estimateG: editMassEstimate?.grams,
      material: massMaterial,
      infill: massInfill,
      warning: editMassEstimate ? estimateWarning(editMassEstimate) : null,
      comMm,
      onSetMeasured: (g) => handleSetMeasured(editLink, g),
      onUseEstimate: () => handleUseEstimate(editLink),
      onSetMaterial: (m) => {
        setMassMaterial(m)
        handleSetMassSettings(editLink, m, massInfill)
      },
      onSetInfill: (i) => {
        setMassInfill(i)
        handleSetMassSettings(editLink, massMaterial, i)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editLink, dialogCtx, content, editMassEstimate, massMaterial, massInfill])

  // The whole-robot mass breakdown (#555 part 2): each link's stored <inertial>
  // mass + its provenance, totalled and sorted for the Build panel's table. Reads
  // the authoritative persisted value (not a live estimate), so it's pure over
  // `content`; the source label comes from robot.yml provenance.
  const massSummary = useMemo<MassBreakdown | null>(() => {
    const linkNames = parseAssembly(content).map((i) => i.link)
    if (linkNames.length === 0) return null
    const lm = defRef.current?.robot?.linkMass
    const rows = linkNames.map((link) => {
      const inertial = readInertial(content, link)
      const grams = inertial ? kgToGrams(inertial.mass) : 0
      const source = inertial ? lm?.[link]?.source ?? 'measured' : 'none'
      return { link, grams, source }
    })
    // Sort order is irrelevant now only the total is shown (#567), but the
    // breakdown is kept for a future stats surface; default (by mass) is fine.
    return summariseMass(rows)
  }, [content])

  // Per-link masses for the CoM overlay (#558) — recomputed only on edit, held in
  // a ref so the render loop reads them without re-parsing the URDF every frame.
  useEffect(() => {
    linkMassesRef.current = readLinkMasses(content, parseAssembly(content).map((i) => i.link))
  }, [content])

  // ── Ground-contact points (#557, epic #535 §2) ───────────────────────────
  const persistContacts = (next: Record<string, [number, number, number][]>): void => {
    setContacts(next)
    void persist((m) => {
      if (Object.keys(next).length) m.contacts = next
      else delete m.contacts
    })
  }
  const handleAddContact = (link: string): void => {
    const robot = robotRef.current
    const local = robot ? lowestLinkPointLocal(robot, link) : null
    persistContacts(addContact(contacts, link, local ?? [0, 0, 0]))
  }
  const handleRemoveContact = (link: string, index: number): void => {
    persistContacts(removeContact(contacts, link, index))
  }
  const handleSetContactMm = (link: string, index: number, mm: [number, number, number]): void => {
    persistContacts(setContact(contacts, link, index, [mmToM(mm[0]), mmToM(mm[1]), mmToM(mm[2])]))
  }

  const contactsEditor = useMemo<ContactsEditorProps | null>(() => {
    if (!editLink || dialogCtx?.kind !== 'link') return null
    const pointsMm = (contacts[editLink] ?? []).map(
      (p): [number, number, number] => [mToMm(p[0]), mToMm(p[1]), mToMm(p[2])]
    )
    return {
      pointsMm,
      onAdd: () => handleAddContact(editLink),
      onRemove: (i) => handleRemoveContact(editLink, i),
      onSet: (i, mm) => handleSetContactMm(editLink, i, mm)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editLink, dialogCtx, contacts])

  // Colour a link (#405) — an inline URDF <material>, so it round-trips + undoes like
  // any other build edit; urdf-loader renders it, recolouring only this link.
  const handleSetColor = (link: string, hex: string): void => {
    commitUrdf(setLinkColor(content, link, hex))
  }
  const handleSetJoint = (link: string, spec: JointSpec): void => {
    commitUrdf(setJoint(content, link, spec))
  }
  // Reposition an existing joint's origin (keep its orientation) — the Offset fields
  // on the joint editor.
  const handleSetJointOrigin = (child: string, xyz: [number, number, number]): void => {
    const j = readJoint(content, child)
    if (j) commitUrdf(setJointOrigin(content, child, xyz, j.rpy))
  }
  // Explicit re-parent (#354): move `child` under `newParent` in the chain WITHOUT
  // moving it on screen (topology only). Keeps the joint TYPE/axis/limit (connectJoint
  // preserves them) and computes a REST-pose-preserving origin. The origin is derived
  // by PURE forward-kinematics over the authored joint origins (not the live/articulated
  // matrixWorld) — so re-parenting while the robot is posed can't bake a transient
  // articulation into the saved rest pose. The base has no parent (use Make base).
  const handleReparent = (child: string, newParent: string): void => {
    if (!child || !newParent || child === newParent || child === effectiveBaseLink) return
    if (subtreeOf(content, child).has(newParent)) return // would form a loop
    const old = readJoint(content, child) // null for a loose/rootless part
    if (old && old.parent === newParent) return // already there
    const joints = readAllJoints(content)
    const parentJointOf = new Map(joints.map((j) => [j.child, j]))
    // A link's REST world transform = product of authored joint origins from the root
    // down to it. Pose-independent; the robot's root rotation is a common prefix that
    // cancels in the newParent⁻¹·old relative, so we can ignore it. Cycle-guarded.
    const restWorld = (link: string): THREE.Matrix4 => {
      const chain: JointDef[] = []
      const seen = new Set<string>()
      let cur: string | undefined = link
      while (cur && parentJointOf.has(cur) && !seen.has(cur)) {
        seen.add(cur)
        const j = parentJointOf.get(cur)!
        chain.push(j)
        cur = j.parent
      }
      const m = new THREE.Matrix4()
      for (let i = chain.length - 1; i >= 0; i--) {
        const j = chain[i]
        m.multiply(
          new THREE.Matrix4().compose(
            new THREE.Vector3(j.xyz[0], j.xyz[1], j.xyz[2]),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(j.rpy[0], j.rpy[1], j.rpy[2], 'ZYX')),
            new THREE.Vector3(1, 1, 1)
          )
        )
      }
      return m
    }
    // The child's authored origin frame in the robot frame (rest). For a loose part its
    // own link frame IS that frame (restWorld walks no joints → identity/its position).
    const childRestWorld = old ? restWorld(old.parent).multiply(
      new THREE.Matrix4().compose(
        new THREE.Vector3(old.xyz[0], old.xyz[1], old.xyz[2]),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(old.rpy[0], old.rpy[1], old.rpy[2], 'ZYX')),
        new THREE.Vector3(1, 1, 1)
      )
    ) : restWorld(child)
    const local = restWorld(newParent).invert().multiply(childRestWorld)
    const p = new THREE.Vector3()
    const q = new THREE.Quaternion()
    local.decompose(p, q, new THREE.Vector3())
    const e = new THREE.Euler().setFromQuaternion(q, 'ZYX') // URDF rpy order
    const xyz: [number, number, number] = [p.x, p.y, p.z]
    const rpy: [number, number, number] = [e.x, e.y, e.z]
    let next = connectJoint(content, { parent: newParent, child, xyz })
    if (next === content) return // refused (cycle / no-op) — backstop to the guard above
    next = setJointOrigin(next, child, xyz, rpy) // connectJoint keeps the OLD rpy; set ours
    commitUrdf(next)
    setSelectedLink(child)
    // The stored mating normal lived in the OLD parent frame → now stale. Reset the roll
    // baseline to 0 and drop the normal (mirrors handleDeleteJoint); the world-preserving
    // rpy already holds the real orientation, so nothing moves — only the roll baseline.
    const jn = readJoint(next, child)?.name
    if (jn) {
      jointRollRef.current = { ...jointRollRef.current, [jn]: 0 }
      const norm = { ...jointNormalRef.current }
      delete norm[jn]
      jointNormalRef.current = norm
      void persist((m) => {
        m.jointRoll = { ...(m.jointRoll ?? {}), [jn]: 0 }
        const mn = { ...(m.jointNormal ?? {}) }
        delete mn[jn]
        m.jointNormal = mn
      })
    }
  }
  // Set an existing joint's ABSOLUTE roll about the MATING NORMAL — the same axis the
  // Add-Joint mate rolled about (the parent's picked face normal, stored per joint since
  // it can't be recovered from the finished rpy). Keeps position; applied as a DELTA on
  // the rpy (pre-multiply, in the parent frame, to match jointFromPicks). The absolute
  // value is remembered in robot.yml so the field shows the stored roll on reopen. A
  // joint with no stored normal (mated before this shipped) falls back to its local Z —
  // re-run Add Joint on it to capture the normal.
  const setJointRoll = (child: string, absDeg: number): void => {
    const j = readJoint(content, child)
    if (!j) return
    const prev = jointRollRef.current[j.name] ?? 0
    jointRollRef.current = { ...jointRollRef.current, [j.name]: absDeg }
    void persist((m) => {
      m.jointRoll = { ...(m.jointRoll ?? {}), [j.name]: absDeg }
    })
    const delta = absDeg - prev
    if (!delta) return
    const R = new THREE.Quaternion().setFromEuler(new THREE.Euler(j.rpy[0], j.rpy[1], j.rpy[2], 'ZYX'))
    const spin = new THREE.Quaternion()
    const n = jointNormalRef.current[j.name]
    if (n) {
      // Roll about the mating normal in the PARENT frame → pre-multiply (matches the mate).
      spin.setFromAxisAngle(new THREE.Vector3(n[0], n[1], n[2]).normalize(), (delta * Math.PI) / 180)
      R.premultiply(spin)
    } else {
      // No stored normal — fall back to the joint's local Z (post-multiply).
      spin.setFromAxisAngle(new THREE.Vector3(0, 0, 1), (delta * Math.PI) / 180)
      R.multiply(spin)
    }
    const e = new THREE.Euler().setFromQuaternion(R, 'ZYX')
    commitUrdf(setJointOrigin(content, child, j.xyz, [e.x, e.y, e.z]))
  }
  const handleDeleteLink = (link: string): void => {
    // Deleting the base would cascade-remove the whole tree → an empty, unusable
    // URDF. The UI disables it; guard here too. (A loose, unconnected part is fine
    // to delete — it just removes that one link.)
    if (link === effectiveBaseLink) return
    commitUrdf(removeLink(content, link))
    setSelectedLink(null)
    setDialogCtx(null)
  }
  const handleMakeBase = (link: string): void => {
    // A link can become the base only if it's already a root (a loose part) or it can
    // be re-rooted up to the current root. A link stuck in a SEPARATE, still-detached
    // sub-assembly can't yet — persisting it would leave robot.yml pointing at a base
    // the UI will never honour. Guide the user to connect it first instead.
    const isRoot = looseLinks(content).includes(link)
    if (!isRoot && !canReRoot(content, link)) {
      setSavingLabel('connect this part to the rest first to make it the base')
      return
    }
    // Record the choice in robot.yml AND re-root the tree onto it (a no-op flip when
    // the link is already a loose root; flips the joint chain when it isn't).
    setChosenBase(link)
    void persist((m) => {
      m.baseLink = link
    })
    commitUrdf(reRoot(content, link))
  }
  const handleRenameLink = (link: string, to: string): void => {
    const { urdf, name } = renameLink(content, link, to)
    if (name === link) return // unchanged / no-op
    commitUrdf(urdf)
    if (selectedLink === link) setSelectedLink(name)
    // Follow the rename through the base bookkeeping so the anchor + robot.yml stay in
    // sync — keyed on the EFFECTIVE base (which may be the implicit `base_link` fallback,
    // with chosenBase still null) so renaming the base never silently loses it.
    if (link === effectiveBaseLink || chosenBase === link) {
      setChosenBase(name)
      void persist((m) => {
        m.baseLink = name
      })
    }
    // Follow it through an open properties dialog so it doesn't orphan onto the old name.
    setDialogCtx((c) => {
      if (c?.kind === 'link' && c.link === link) return { kind: 'link', link: name }
      if (c?.kind === 'joint' && c.child === link) return { ...c, child: name }
      return c
    })
  }
  // Rename a JOINT (#): rewrite the URDF, then cascade every store that keys by joint
  // NAME (servo map, poses, timeline tracks, mirror pairs, per-joint config/roll/
  // normal, defaultPose) so the servo keeps driving it and its poses still apply.
  const handleRenameJoint = (oldName: string, to: string): void => {
    const { urdf, name } = renameJoint(content, oldName, to)
    if (name === oldName) return
    commitUrdf(urdf)
    const rekey = <T,>(rec: Record<string, T> | undefined): Record<string, T> | undefined => {
      if (!rec || !(oldName in rec)) return rec
      const { [oldName]: v, ...rest } = rec
      return { ...rest, [name]: v }
    }
    setBindings((bs) => bs.map((b) => (b.joint === oldName ? { ...b, joint: name } : b)))
    setPoses((ps) => ps.map((p) => (oldName in p.values ? { ...p, values: rekey(p.values)! } : p)))
    setTimeline((tl) => ({ ...tl, tracks: tl.tracks.map((t) => (t.joint === oldName ? { ...t, joint: name } : t)) }))
    setMirrorPairs((ms) =>
      ms.map((mp) => ({ ...mp, a: mp.a === oldName ? name : mp.a, b: mp.b === oldName ? name : mp.b }))
    )
    void persist((m) => {
      if (m.servoJointMap) m.servoJointMap = m.servoJointMap.map((b) => (b.joint === oldName ? { ...b, joint: name } : b))
      if (m.poses) m.poses = m.poses.map((p) => (oldName in p.values ? { ...p, values: rekey(p.values)! } : p))
      m.defaultPose = rekey(m.defaultPose)
      m.joints = rekey(m.joints)
      m.jointRoll = rekey(m.jointRoll)
      m.jointNormal = rekey(m.jointNormal)
      if (m.timeline) m.timeline = { ...m.timeline, tracks: m.timeline.tracks.map((t) => (t.joint === oldName ? { ...t, joint: name } : t)) }
      if (m.mirror) m.mirror = m.mirror.map((mp) => ({ ...mp, a: mp.a === oldName ? name : mp.a, b: mp.b === oldName ? name : mp.b }))
    })
    // Follow an open joint dialog to the new name.
    setDialogCtx((c) => (c?.kind === 'joint' && c.joint === oldName ? { ...c, joint: name } : c))
  }

  // Properties dialog (#352 / #353): clicking a node opens its context here. For a
  // block/mesh/joint we snapshot the URDF so Cancel can revert the live edits; OK
  // keeps them. Servo/pose contexts hold their own drafts (committed on OK).
  const editSnapshotRef = useRef<string | null>(null)
  // Live joint values captured when the pose editor opens (it recalls the pose onto
  // the model) — restored on Cancel so opening a pose to peek/rename can be undone.
  const poseRevertRef = useRef<Record<string, number> | null>(null)
  // Opening a DIFFERENT node while a link/joint edit is live keeps that edit
  // (Fusion-style — it's already a step in the undo history, so ⌘Z still discards
  // it). We just re-base the snapshot to the current content so the NEW node's
  // Cancel only ever reverts the NEW node's edits, never the previous node's.
  const openContext = (ctx: PropsContext | null, snapshot: string | null): void => {
    editSnapshotRef.current = snapshot
    setDialogCtx(ctx)
    if (ctx?.kind !== 'addjoint') {
      setJointPick(null) // leaving the Join tool disarms picking + clears markers
      jointPickApiRef.current?.clear()
    }
  }
  const handleOpenProps = (link: string | null): void => {
    if (link) {
      setSelectedLink(link)
      openContext({ kind: 'link', link }, contentRef.current)
    } else {
      openContext(null, null)
    }
  }
  const handleOpenJoint = (child: string, joint: string): void => {
    setSelectedLink(child) // highlight the joint's child block in 3-D
    openContext({ kind: 'joint', child, joint }, contentRef.current)
  }
  const handleOpenServo = (pin: string): void => {
    openContext({ kind: 'servo', pin }, null) // servo edits are drafted, not URDF
  }
  const handleOpenPose = (name: string): void => {
    // Recall the pose so the editor's sliders start on its saved values — snapshot the
    // current live posture first so Cancel can put it back.
    const p = poses.find((x) => x.name === name)
    poseRevertRef.current = { ...valuesRef.current }
    if (p) handleRecallPose(p)
    openContext({ kind: 'pose', name }, null)
  }
  // "+ Pose" — open the editor for a NEW pose: keep the current joint values so the
  // user tweaks the live posture, names it, and Saves.
  const handleNewPose = (): void => {
    poseRevertRef.current = null // a new pose starts from the live posture — no revert
    openContext({ kind: 'pose', name: '' }, null)
  }
  // Add Joint (#354): the toolbar opens the dialog + ARMS picking. The user clicks
  // a point on each block in 3-D (onJointPick), picks a type + offset, then Add.
  const handleAddJoint = (): void => {
    setMeasureActive(false) // picking + measuring both own clicks — don't double-fire
    jointPickApiRef.current?.clear()
    setJointPick({ step: 'parent', parent: null, child: null })
    // Snapshot the PRE-mate URDF so the live preview always mates from a clean base
    // (the mate re-origins the child, so it's not idempotent) and Cancel reverts it.
    openContext({ kind: 'addjoint' }, contentRef.current)
    if (!buildOpen) setBuildOpen(true)
  }
  // The live-preview mate is debounced so rapid typing in the dialog doesn't thrash the
  // (mesh-reloading) scene rebuild.
  const previewTimerRef = useRef<number | null>(null)
  const clearPreviewTimer = (): void => {
    if (previewTimerRef.current != null) {
      clearTimeout(previewTimerRef.current)
      previewTimerRef.current = null
    }
  }
  // A 3-D pick landed (the effect resolved the click → link + local snap point + face normal).
  const onJointPick = (
    link: string,
    local: [number, number, number],
    normal: [number, number, number],
    role: string
  ): void => {
    setJointPick((jp) => {
      if (!jp) return jp
      const pt: JointPickPt = { link, local, normal, role }
      if (jp.step === 'parent') return { ...jp, parent: pt, step: 'child' }
      if (jp.parent && link === jp.parent.link) return jp // can't join a block to itself
      return { ...jp, child: pt }
    })
  }
  onJointPickRef.current = onJointPick
  // Re-arm picking for one component (its 3-D marker is replaced on the next click).
  const handleRepick = (which: 'parent' | 'child'): void => {
    clearPreviewTimer()
    // Un-mate any live preview first, so the re-pick lands on the parts at their ORIGINAL
    // positions (the preview moved + re-origined the child; picking it mated would capture
    // points in the wrong frame).
    const snap = editSnapshotRef.current
    if (snap && snap !== contentRef.current) commitUrdf(snap)
    setJointPick((jp) =>
      jp
        ? which === 'parent'
          ? { ...jp, step: 'parent', parent: null }
          : { ...jp, step: 'child', child: null }
        : jp
    )
  }
  // Swap which pick is the parent vs the child (the dialog's ⇅ button) — so you can
  // flip the hierarchy without re-picking both points.
  const handleSwapPicks = (): void => {
    setJointPick((jp) => (jp && jp.parent && jp.child ? { ...jp, parent: jp.child, child: jp.parent } : jp))
  }
  // The mate math (#354), PURE: from a base URDF + the two picks + params, return the
  // mated URDF (child's picked face flush against the parent's, re-parented, typed, pivot
  // re-origined onto the mating point) + the child + the mating normal. No commit/persist.
  // It re-origins the child so it is NOT idempotent — always compute from the pre-mate
  // snapshot. Shared by the live preview and the final Add.
  const computeMate = (
    base: string,
    jp: { parent: JointPickPt | null; child: JointPickPt | null },
    type: JointType,
    offsetMm: [number, number, number],
    rotation: { minDeg: number; maxDeg: number; defaultDeg: number } | undefined,
    angleDeg: number
  ): { urdf: string; child: string; parentNormal: [number, number, number] } | null => {
    if (!jp.parent || !jp.child) return null
    // orientJoint honours pick order (Component 1 = parent); the base's connected structure
    // is never re-homed onto a disconnected part (would float it off the base).
    const baseTree = effectiveBaseLink ? subtreeOf(base, effectiveBaseLink) : new Set<string>()
    let o = orientJoint(base, jp.parent.link, jp.child.link)
    if (o.child !== o.parent && baseTree.has(o.child) && !baseTree.has(o.parent)) {
      o = { parent: o.child, child: o.parent }
    }
    const [parent, child] = o.parent === jp.parent.link ? [jp.parent, jp.child] : [jp.child, jp.parent]
    const { rpy } = jointFromPicks(parent.local, parent.normal, child.local, child.normal, offsetMm, angleDeg)
    const xyz: [number, number, number] = [
      parent.local[0] + offsetMm[0],
      parent.local[1] + offsetMm[1],
      parent.local[2] + offsetMm[2]
    ]
    let next = connectJoint(base, { parent: parent.link, child: child.link, xyz })
    if (next === base) return null // cycle / invalid
    const rad = (d: number): number => (d * Math.PI) / 180
    // Fusion-style single axis (#399): a movable joint rotates/slides about the MATED
    // NORMAL, so the user needn't guess. In the joint (child) frame that IS the child's
    // picked face normal — the same axis the roll turns about. (Fixed joints have none.)
    const cnv = new THREE.Vector3(child.normal[0], child.normal[1], child.normal[2])
    if (cnv.lengthSq() > 1e-9) cnv.normalize()
    else cnv.set(0, 0, 1)
    const axis: [number, number, number] = [cnv.x, cnv.y, cnv.z]
    next =
      type === 'fixed'
        ? setJoint(next, child.link, { type })
        : rotation && type === 'revolute'
          ? setJoint(next, child.link, { type, axis, lower: rad(rotation.minDeg), upper: rad(rotation.maxDeg) })
          : setJoint(next, child.link, { type, axis })
    next = setJointOrigin(next, child.link, xyz, rpy)
    // Re-origin the child onto its picked point so the geometry stays put while the link
    // origin (the pivot) lands on the mating point; shift its own sub-joints to match.
    const cl = child.local
    const shift = (v: readonly number[]): [number, number, number] => [v[0] - cl[0], v[1] - cl[1], v[2] - cl[2]]
    const ov = readVisualOrigin(base, child.link) ?? { xyz: [0, 0, 0], rpy: [0, 0, 0] }
    next = setVisualOrigin(next, child.link, shift(ov.xyz), ov.rpy as [number, number, number])
    for (const j of readAllJoints(next)) {
      if (j.parent === child.link) next = setJointOrigin(next, j.child, shift(j.xyz), j.rpy)
    }
    return { urdf: next, child: child.link, parentNormal: parent.normal as [number, number, number] }
  }
  // Live preview: as soon as both points are picked (and whenever type/offset/roll change),
  // mate the child so the user SEES the result before pressing Add — and can tell whether
  // they need to roll it. Debounced + always from the pre-mate snapshot (no commit spam,
  // no double-apply). Cancel/Add revert or finalize via editSnapshotRef.
  const handleMatePreview = (
    type: JointType,
    offsetMm: [number, number, number],
    rotation: { minDeg: number; maxDeg: number; defaultDeg: number } | undefined,
    angleDeg: number
  ): void => {
    clearPreviewTimer()
    previewTimerRef.current = window.setTimeout(() => {
      previewTimerRef.current = null
      const snap = editSnapshotRef.current
      const jp = jointPickStateRef.current
      if (!snap || !jp?.parent || !jp?.child) return
      const r = computeMate(snap, jp, type, offsetMm, rotation, angleDeg)
      if (r) commitUrdf(r.urdf) // preview only — no persist, keep the snapshot
    }, 150)
  }
  // Add: finalize the mate from the pre-mate snapshot (so a live preview isn't applied
  // twice), then persist the roll / mating-normal / default angle. handlePropsOk closes +
  // clears the snapshot, so Cancel afterwards can't revert it.
  const handleConnectPicked = (
    type: JointType,
    offsetMm: [number, number, number],
    rotation?: { minDeg: number; maxDeg: number; defaultDeg: number },
    angleDeg = 0
  ): boolean => {
    clearPreviewTimer()
    const jp = jointPick
    if (!jp?.parent || !jp?.child) return false
    const r = computeMate(editSnapshotRef.current ?? contentRef.current, jp, type, offsetMm, rotation, angleDeg)
    if (r === null) return false // cycle / invalid — keep the dialog open
    commitUrdf(r.urdf)
    setSelectedLink(r.child)
    const jn = readJoint(r.urdf, r.child)?.name
    if (jn) {
      jointRollRef.current = { ...jointRollRef.current, [jn]: angleDeg }
      jointNormalRef.current = { ...jointNormalRef.current, [jn]: r.parentNormal }
      void persist((m) => {
        m.jointRoll = { ...(m.jointRoll ?? {}), [jn]: angleDeg }
        m.jointNormal = { ...(m.jointNormal ?? {}), [jn]: r.parentNormal }
      })
    }
    if (jn && rotation && type === 'revolute' && rotation.defaultDeg) {
      const dd = rotation.defaultDeg
      void persist((m) => {
        m.defaultPose = { ...(m.defaultPose ?? {}), [jn]: dd }
      })
    }
    return true
  }
  // Delete a joint (#354): detach the child from its parent, then RE-ATTACH it to the
  // base as a LOOSE fixed joint — NUDGED to a clear, staggered spot beside the base
  // (like a fresh import), not left on top of its old parent where it's hard to pick.
  // It must NOT be left rootless — the loader collapses every rootless link into the
  // base's single scene node, so freed parts would co-highlight and you couldn't pick
  // one to re-join it. Its whole sub-assembly comes with it (descendant joints are
  // relative to the child link, so the freed part relocates as a unit).
  const handleDeleteJoint = (child: string): void => {
    const before = content
    const base = effectiveBaseLink
    if (!base || child === base) {
      setDialogCtx(null) // can't detach the base itself
      return
    }
    const oldJointName = readJoint(before, child)?.name
    let next = removeJoint(before, child)
    if (next === before) {
      setDialogCtx(null) // no such joint
      return
    }
    // A clear loose spot BEYOND every part already parked directly on the base, along X —
    // so successive detaches (which don't change the link count) don't stack on the same
    // spot. Placed just past the current max so it's off its old parent, upright + pickable.
    const baseChildX = readAllJoints(next)
      .filter((j) => j.parent === base)
      .map((j) => j.xyz[0])
    const looseXyz: [number, number, number] = [Math.max(0, ...baseChildX) + 0.08, 0, 0]
    next = connectJoint(next, { parent: base, child, xyz: looseXyz })
    next = setJointOrigin(next, child, looseXyz, [0, 0, 0])
    commitUrdf(next)
    // Fresh loose attachment → its orientation is the new zero-roll baseline. Drop the
    // old joint's remembered roll + mating normal (its name is gone, and the loose fixed
    // joint has no mate) so the maps don't accrete cruft.
    const jn = readJoint(next, child)?.name
    if (jn || oldJointName) {
      const roll = { ...jointRollRef.current }
      const norm = { ...jointNormalRef.current }
      if (oldJointName) {
        delete roll[oldJointName]
        delete norm[oldJointName]
      }
      if (jn) {
        roll[jn] = 0
        delete norm[jn]
      }
      jointRollRef.current = roll
      jointNormalRef.current = norm
      void persist((m) => {
        const mr = { ...(m.jointRoll ?? {}) }
        const mn = { ...(m.jointNormal ?? {}) }
        if (oldJointName) {
          delete mr[oldJointName]
          delete mn[oldJointName]
        }
        if (jn) {
          mr[jn] = 0
          delete mn[jn]
        }
        m.jointRoll = mr
        m.jointNormal = mn
      })
    }
    setDialogCtx(null)
    setSelectedLink(child)
  }
  const handlePropsOk = (): void => {
    clearPreviewTimer()
    editSnapshotRef.current = null
    poseRevertRef.current = null
    setDialogCtx(null)
    setJointPick(null)
    jointPickApiRef.current?.clear()
  }
  const handlePropsCancel = (): void => {
    clearPreviewTimer()
    const snap = editSnapshotRef.current
    editSnapshotRef.current = null
    if (snap != null && snap !== contentRef.current) commitUrdf(snap) // discard edits
    // Put the model back to the posture it had before the pose editor recalled a pose.
    const revert = poseRevertRef.current
    poseRevertRef.current = null
    if (revert) {
      applyToRobot(revert)
      setValues(revert)
    }
    setDialogCtx(null)
    setJointPick(null)
    jointPickApiRef.current?.clear()
  }

  // Re-apply the selection outline when the picked block changes (no re-parse).
  useEffect(() => {
    highlightApiRef.current?.apply(selectedLink)
  }, [selectedLink])

  // Join tool (#354): fade the first-picked block while choosing the second, so
  // it's obviously "taken" (Fusion-style). Cleared when both/neither are picked.
  useEffect(() => {
    const dim = jointPick?.parent && !jointPick?.child ? jointPick.parent.link : null
    jointPickApiRef.current?.dim(dim)
  }, [jointPick])

  // Popping the robot out full-screen (the dock's Pop-out enters focus mode) should
  // open in the HOME view — but a RobotView already mounted for this file keeps its
  // preserved camera. Re-frame home on the transition into focus (full-screen only).
  const { focus: layoutFocus } = useWorkspaceLayout()
  const prevFocusRef = useRef(layoutFocus)
  useEffect(() => {
    if (poseUI && layoutFocus && !prevFocusRef.current) zoomApiRef.current?.home()
    prevFocusRef.current = layoutFocus
  }, [layoutFocus, poseUI])

  // ── Servo → joint binding + code-driven simulation (#313) ──────────────────
  // The KRF servo↔joint map, loaded from robot.yml. Kept in a ref for the
  // telemetry callback (which must not re-subscribe on every binding edit).
  const [bindings, setBindings] = useState<ServoJointBinding[]>([])
  const bindingsRef = useRef<ServoJointBinding[]>([])
  bindingsRef.current = bindings

  // The breadboard servos + wiring (from robot.yml) and the installed libraries, for
  // the "bindable servos" list (#) — servos placed on the board that this URDF editor
  // can bind to a joint. Reloads when the Board window edits robot.yml.
  const [placedParts, setPlacedParts] = useState<RobotPart[]>([])
  const [placedConns, setPlacedConns] = useState<RobotConnection[]>([])
  const [partLibs, setPartLibs] = useState<PartLibraryWithParts[]>([])
  const [robotSyncNonce, setRobotSyncNonce] = useState(0)
  useEffect(() => window.api.robot.onChanged(() => setRobotSyncNonce((n) => n + 1)), [])
  useEffect(() => {
    window.api.parts.listLibraries().then(setPartLibs).catch(() => setPartLibs([]))
  }, [])
  const resolvePartDef = useCallback(
    (p: RobotPart): PartDefinition | undefined =>
      partLibs.find((l) => l.id === p.lib)?.parts.find((d) => d.id === p.part),
    [partLibs]
  )
  const servoList = useMemo<BindableServo[]>(
    () => bindableServos(placedParts, placedConns, resolvePartDef),
    [placedParts, placedConns, resolvePartDef]
  )

  // Load the servo map whenever the project folder changes — for the docked mini
  // viewer too, so it animates on Run. (The full pose tool also refreshes it in
  // its model load below.)
  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const def = await window.api.robot.load(currentFolder || undefined)
        if (!live) return
        defRef.current = def // seed so persist() never clobbers an unloaded robot.yml
        setBindings(def.robot?.servoJointMap ?? [])
        setControls(def.robot?.controls ?? []) // puppet controls (#416)
        setContacts(def.robot?.contacts ?? {}) // ground contacts (#557)
        setPlacedParts(def.parts ?? []) // breadboard parts (for the bindable-servos list)
        setPlacedConns(def.connections ?? [])
      } catch {
        if (live) {
          setBindings([])
          setControls([])
          setPlacedParts([])
          setPlacedConns([])
        }
      }
    })()
    return () => {
      live = false
    }
  }, [currentFolder, robotSyncNonce])

  // A running program's servo writes drive the mapped joints in real time. This
  // works headless: the simulator runs the Python and `inst.servo_on(pin).angle`
  // emits `SNK SERVO <pin> <deg>` — no board required.
  useTelemetryStream((r) => {
    if (r.kind !== 'servo') return
    const res = servoToJointNative(bindingsRef.current, metaRef.current, r.pin, r.angle)
    if (!res || !robotRef.current) return
    robotRef.current.setJointValue(res.joint, res.native)
    setValues((v) => (v[res.joint] === res.native ? v : { ...v, [res.joint]: res.native }))
    // Flag "live" so the pose editor knows a Capture reads the hardware posture.
    setPoseLive(true)
    if (poseLiveTimer.current) clearTimeout(poseLiveTimer.current)
    poseLiveTimer.current = setTimeout(() => setPoseLive(false), 1200)
  })
  useEffect(() => () => void (poseLiveTimer.current && clearTimeout(poseLiveTimer.current)), [])

  // A dock instrument (the Pose bench) can drive the model directly — no running
  // program needed. It emits pin→angle batches on the in-renderer servo-drive bus;
  // apply each the same way as `SNK SERVO` telemetry so sliders/pose presses move
  // the 3-D model live (the instrument also streams to hardware separately).
  useEffect(
    () =>
      onServoDrive((byPin) => {
        if (!robotRef.current) return
        const updates: Record<string, number> = {}
        for (const [pin, angle] of Object.entries(byPin)) {
          const res = servoToJointNative(bindingsRef.current, metaRef.current, pin, angle)
          if (!res) continue
          robotRef.current.setJointValue(res.joint, res.native)
          updates[res.joint] = res.native
        }
        if (Object.keys(updates).length > 0) setValues((v) => ({ ...v, ...updates }))
      }),
    []
  )

  // Round-trip managed Motion Studio blocks (#413): when the user focuses a local
  // .py carrying Snakie-managed blocks in the full Robot View, read its pose
  // library + servo map back via the Python host and MERGE them into the live
  // state (additive by pose name / pin), persisting so they stick. Seeds once per
  // focused file. A broken/hand-edited block pauses sync + warns via the status
  // bar; no Python skips the round-trip gracefully. The compact mini-viewer never
  // seeds (it's preview-only).
  // The project's exported motion.py (scoped to currentFolder), if open. The full
  // Robot View only mounts for a .urdf active file, so the motion source is a
  // SEPARATE open buffer — this is what the round-trip reads FROM, not activeFile.
  const managedMotionFile = selectManagedMotionFile(openFiles, currentFolder)
  useEffect(() => {
    if (!poseUI || compact) return
    const mf = managedMotionFile
    if (!mf) return
    if (seededManagedRef.current === mf.id) return
    let live = true
    void (async () => {
      try {
        const res = await window.api.plugins.motionRead(mf.content)
        if (!live) return
        if (res.pythonFound === false) {
          setSavingLabel('install Python to sync poses')
          return
        }
        if (!res.ok) {
          suspendedSyncRef.current.add(mf.id)
          window.dispatchEvent(
            new CustomEvent('snakie:status', {
              detail: {
                text: `${mf.name}: ${res.error ?? 'managed block broken'} — pose sync paused`,
                priority: 6
              }
            })
          )
          return
        }
        seededManagedRef.current = mf.id
        suspendedSyncRef.current.delete(mf.id)
        managedSequencesRef.current = res.sequences ?? {}

        const parsedPoses = res.poses ?? {}
        const parsedServos = res.servos ?? []
        let nextPoses: NamedPoseLike[] | null = null
        let nextServos: ServoJointBinding[] | null = null

        if (Object.keys(parsedPoses).length) {
          const byName = new Map(posesRef.current.map((p) => [p.name, p]))
          for (const [name, values] of Object.entries(parsedPoses)) byName.set(name, { name, values })
          nextPoses = [...byName.values()]
          setPoses(nextPoses)
        }
        if (parsedServos.length) {
          const byPin = new Map(bindingsRef.current.map((b) => [normPin(b.pin), b]))
          for (const s of parsedServos) {
            // Mirror buildManagedMotion's conditionality so the round trip is
            // shape-preserving: only materialise servoMin/servoMax when the file
            // actually carries them (else leave them at the mapping default).
            byPin.set(normPin(s.pin), {
              pin: s.pin,
              joint: s.joint,
              jointMin: s.jointMin ?? 0,
              jointMax: s.jointMax ?? 180,
              ...(typeof s.servoMin === 'number' ? { servoMin: s.servoMin } : {}),
              ...(typeof s.servoMax === 'number' ? { servoMax: s.servoMax } : {}),
              ...(s.invert ? { invert: true } : {})
            })
          }
          nextServos = [...byPin.values()]
          setBindings(nextServos)
        }
        if (nextPoses || nextServos) {
          void persist((m) => {
            if (nextPoses) m.poses = nextPoses
            if (nextServos) m.servoJointMap = nextServos
          })
          const bits: string[] = []
          if (nextPoses) bits.push(`${Object.keys(parsedPoses).length} pose${Object.keys(parsedPoses).length > 1 ? 's' : ''}`)
          if (nextServos) bits.push(`${parsedServos.length} servo${parsedServos.length > 1 ? 's' : ''}`)
          setSavingLabel(`synced ${bits.join(' + ')} from ${mf.name}`)
        }
        if (res.warnings?.length) {
          window.dispatchEvent(
            new CustomEvent('snakie:status', { detail: { text: `${mf.name}: ${res.warnings[0]}`, priority: 5 } })
          )
        }
      } catch {
        /* non-fatal — a failed round-trip must never disrupt the Robot View */
      }
    })()
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs carry current poses/bindings; seed once per motion file
  }, [poseUI, compact, currentFolder, managedMotionFile?.id])

  const handleAddBinding = (pin: string, joint: string): void => {
    const m = metaRef.current.find((j) => j.name === joint)
    const lim = m ? effectiveLimit(m, overridesRef.current[joint]) : null
    // Default the joint range to its limits (display units) + servo 0..180.
    const binding: ServoJointBinding = {
      pin,
      joint,
      servoMin: 0,
      servoMax: 180,
      jointMin: m && lim ? Math.round(toDisplay(m.type, lim.lower)) : 0,
      jointMax: m && lim ? Math.round(toDisplay(m.type, lim.upper)) : 180
    }
    const next = [...bindings.filter((b) => b.pin !== pin), binding]
    setBindings(next)
    void persist((mm) => {
      mm.servoJointMap = next
    })
  }
  // "+ Servo" — bind the next free pin to the first movable joint, then open its
  // editor (the pose sidebar's add-servo, moved to the build panel — #312).
  const handleNewServo = (): void => {
    if (movableNames.length === 0) return // nothing to drive — no valid binding
    const used = new Set(bindings.map((b) => normPin(b.pin)))
    let pin = 0
    while (used.has(normPin(String(pin)))) pin++
    handleAddBinding(String(pin), movableNames[0])
    handleOpenServo(String(pin))
  }

  const handleUpdateBinding = (pin: string, patch: Partial<ServoJointBinding>): void => {
    const next = bindings.map((b) => (b.pin === pin ? { ...b, ...patch } : b))
    setBindings(next)
    void persist((mm) => {
      mm.servoJointMap = next
    })
  }

  const handleDeleteBinding = (pin: string): void => {
    const next = bindings.filter((b) => b.pin !== pin)
    setBindings(next)
    void persist((mm) => {
      mm.servoJointMap = next
    })
  }

  // Bind a breadboard servo's GPIO to a joint from the URDF editor (#) — the same
  // servoJointMap the Board View writes; '' unbinds. Mirrors the board-side picker.
  const handleBindServo = (pin: string, joint: string): void => {
    const next = bindServoJoint(bindingsRef.current, pin, joint, jointLimits[joint])
    setBindings(next)
    void persist((mm) => {
      mm.servoJointMap = next
    })
  }

  // ── Motion timeline (#314, epic #309 Phase 4) ──────────────────────────────
  const [timeline, setTimeline] = useState<MotionTimeline>(EMPTY_TIMELINE)
  const [mirrorPairs, setMirrorPairs] = useState<MirrorPair[]>([])
  const [playing, setPlaying] = useState(false)
  const [playhead, setPlayhead] = useState(0)
  const [selectedKey, setSelectedKey] = useState<{ joint: string; t: number } | null>(null)
  const timelineRef = useRef<MotionTimeline>(EMPTY_TIMELINE)
  const playheadRef = useRef(0)
  const lastPlayheadPush = useRef(0)
  const timelineSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingTimelineSave = useRef<(() => Promise<void>) | null>(null)
  const timelineLoadedFolder = useRef<string | null>(null)
  timelineRef.current = timeline

  const movableNames = jointMeta.filter((m) => !m.isMimic).map((m) => m.name)
  // Poses that actually apply to the DISPLAYED robot — at least one of their joints
  // exists here. Guards the compact dropdown against a robot.yml whose poses belong to
  // a different model (e.g. RobotDockPanel's demo-arm fallback), where recall is a no-op
  // and the list is confusing (#409). Empty ⇒ no dropdown.
  const dockPoses = compact
    ? poses.filter((p) => movableNames.some((n) => typeof p.values[n] === 'number'))
    : []

  // Drive the robot from a DISPLAY-unit pose IMPERATIVELY (mimics auto-follow), the
  // shared inner loop of every motion source — timeline, sequence, and puppet
  // control (#416). `commitState` also pushes the sliders (scrub/stop/drag; never
  // per playback frame). Each joint is clamped to its effective limit.
  const applyDisplayPose = (display: Record<string, number>, commitState = false): void => {
    const r = robotRef.current
    if (!r) return
    const patch: Record<string, number> = {}
    for (const m of metaRef.current) {
      if (m.isMimic) continue
      const disp = display[m.name]
      if (typeof disp !== 'number') continue
      const lim = effectiveLimit(m, overridesRef.current[m.name])
      const native = clamp(toNative(m.type, disp), lim.lower, lim.upper)
      r.setJointValue(m.name, native)
      patch[m.name] = native
    }
    if (commitState) setValues((v) => ({ ...v, ...patch }))
  }

  // Apply a sampled timeline frame (`commitState` on scrub/stop only).
  const applyTimelineAt = (t: number, commitState = false): void => {
    applyDisplayPose(sampleTimeline(timelineRef.current, t), commitState)
  }

  // Motion Studio stability strip (#559, epic #535 §3): sample the timeline at N
  // points and classify each pose's static stability, for a green/amber/red
  // heat-strip beside the tracks. Poses the robot to each sample WITHOUT React
  // churn (applyDisplayPose commit=false) and restores the live pose after.
  // Recomputes only when the timeline / contacts / masses change — never per
  // frame. Empty when nothing is weighed (no meaningful stability).
  const [stabilityStrip, setStabilityStrip] = useState<StabilityState[]>([])
  useEffect(() => {
    const r = robotRef.current
    const tl = timelineRef.current
    if (!r || tl.tracks.length === 0 || tl.duration <= 0) {
      setStabilityStrip([])
      return
    }
    const links = parseAssembly(contentRef.current).map((i) => i.link)
    const masses = readLinkMasses(contentRef.current, links)
    if (Object.keys(masses).length === 0) {
      setStabilityStrip([])
      return
    }
    const contactsNow = contactsRef.current
    const matOf = (l: string): THREE.Matrix4 | null => r.links[l]?.matrixWorld ?? null
    const N = 48
    const states: StabilityState[] = []
    for (let i = 0; i < N; i++) {
      applyDisplayPose(sampleTimeline(tl, tl.duration * (i / (N - 1))), false)
      r.updateMatrixWorld(true)
      const balance = poseBalance(matOf, masses, contactsNow)
      states.push(balance ? balance.stability.state : 'none')
    }
    // Restore the live pose (native joint values) the sampling perturbed.
    for (const m of metaRef.current) {
      if (m.isMimic) continue
      const v = valuesRef.current[m.name]
      if (typeof v === 'number') r.setJointValue(m.name, v)
    }
    r.updateMatrixWorld(true)
    setStabilityStrip(states)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline, contacts, content])

  // Playback: a rAF loop drives setJointValue every frame; the scrubber/playhead
  // React state is throttled to ~20 Hz so it never causes a per-frame re-render.
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const start = performance.now() - playheadRef.current * 1000
    const tick = (): void => {
      const tl = timelineRef.current
      const elapsed = (performance.now() - start) / 1000
      let t: number
      if (tl.loop) {
        t = tl.duration > 0 ? elapsed % tl.duration : 0
      } else {
        t = Math.min(elapsed, tl.duration)
        if (elapsed >= tl.duration) {
          applyTimelineAt(t, true)
          playheadRef.current = t
          setPlayhead(t)
          setPlaying(false)
          return
        }
      }
      applyTimelineAt(t)
      playheadRef.current = t
      const now = performance.now()
      if (now - lastPlayheadPush.current > 50) {
        lastPlayheadPush.current = now
        setPlayhead(t)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs carry the rest
  }, [playing])

  // Persist the motion state (keyframe timeline + pose sequence, #314/#415) with a
  // SINGLE debounced, folder-snapshotting save. Both editors sit together at the
  // bottom of the pose tool, so routing them through one saver (reading the latest
  // refs) means a sequence edit can never clobber a concurrent timeline edit, or
  // vice-versa. A field is written only once its own load-seed has run for this
  // folder, so an early edit can't wipe a not-yet-loaded disk value; loading a
  // FRESH def keeps a fast folder switch from writing into another project. defRef
  // is kept in sync so a later persist() (poses/servos) never reverts motion.
  const scheduleMotionSave = (): void => {
    const folder = currentFolder || undefined
    const folderKey = currentFolder || ''
    pendingTimelineSave.current = async (): Promise<void> => {
      pendingTimelineSave.current = null
      try {
        const def = await window.api.robot.load(folder)
        def.robot = { ...(def.robot ?? {}) }
        if (timelineLoadedFolder.current === folderKey) def.robot.timeline = timelineRef.current
        if (seqLoadedFolder.current === folderKey)
          def.robot.sequences = sequenceRef.current.steps.length ? [sequenceRef.current] : []
        await window.api.robot.save(folder, def)
      } catch {
        // best-effort — a motion save failing is non-fatal
      }
    }
    if (timelineSaveTimer.current) clearTimeout(timelineSaveTimer.current)
    timelineSaveTimer.current = setTimeout(() => void pendingTimelineSave.current?.(), 400)
  }

  const commitTimeline = (next: MotionTimeline): void => {
    timelineRef.current = next
    setTimeline(next)
    if (defRef.current) defRef.current.robot = { ...(defRef.current.robot ?? {}), timeline: next }
    scheduleMotionSave()
  }

  // Flush a pending motion save on unmount so the last edit isn't lost (and the
  // timer can't fire after unmount). Runs once.
  useEffect(
    () => () => {
      if (timelineSaveTimer.current) clearTimeout(timelineSaveTimer.current)
      void pendingTimelineSave.current?.()
    },
    []
  )

  const seek = (t: number): void => {
    setPlaying(false)
    const cl = Math.max(0, Math.min(timelineRef.current.duration, t))
    playheadRef.current = cl
    setPlayhead(cl)
    applyTimelineAt(cl, true)
  }

  const handlePlayPause = (): void => {
    setPlaying((p) => {
      if (p) {
        applyTimelineAt(playheadRef.current, true) // pausing → sync the sliders to the pose
        return false
      }
      setSeqPlaying(false) // keyframe + sequence playback are mutually exclusive
      // Starting: rewind a FINISHED one-shot clip so it replays from the top.
      const tl = timelineRef.current
      if (!tl.loop && playheadRef.current >= tl.duration) {
        playheadRef.current = 0
        setPlayhead(0)
      }
      return true
    })
  }

  // ── Pose-step sequences (#415) ─────────────────────────────────────────────
  const [sequence, setSequence] = useState<MotionSequence>(EMPTY_SEQUENCE)
  const [seqPlaying, setSeqPlaying] = useState(false)
  const [seqPlayhead, setSeqPlayhead] = useState(0)
  const [seqLive, setSeqLive] = useState(false)
  const sequenceRef = useRef<MotionSequence>(EMPTY_SEQUENCE)
  const seqPlayheadRef = useRef(0)
  const lastSeqPush = useRef(0)
  const lastLiveSend = useRef(0)
  const seqLoadedFolder = useRef<string | null>(null)
  const seqLiveRef = useRef(false)
  sequenceRef.current = sequence
  seqLiveRef.current = seqLive
  // Pose name → its saved DISPLAY values, for the sampler (kept fresh for rAF).
  const posesByNameRef = useRef<Record<string, Record<string, number>>>({})
  posesByNameRef.current = Object.fromEntries(poses.map((p) => [p.name, p.values]))

  // ── Puppet controls (#416) ────────────────────────────────────────────────
  const [controls, setControls] = useState<PuppetControl[]>([])
  const controlsRef = useRef<PuppetControl[]>([])
  controlsRef.current = controls
  const [controlVals, setControlVals] = useState<Record<string, number>>({}) // id → t (0..1)
  const controlIdSeq = useRef(0) // in-session counter for collision-free control ids
  // Board streaming for puppet controls is EXPLICITLY armed (like the sequencer's
  // Live), so dragging a slider previews on the model without surprising the
  // hardware until the user opts in.
  const [controlsLive, setControlsLive] = useState(false)
  const controlsLiveRef = useRef(false)
  controlsLiveRef.current = controlsLive
  // Trailing-edge flush for streamServos so the final drag position always lands.
  const pendingServoSend = useRef<string | null>(null)
  const servoFlushTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const deviceStatus = useDeviceStatus()
  const canSeqLive = deviceStatus.state === 'connected' && bindings.length > 0
  // Degrade gracefully: if the board disconnects (or its bindings vanish) while Live
  // is on, drop back to preview-only rather than streaming into the void.
  useEffect(() => {
    if (!canSeqLive && seqLive) setSeqLive(false)
    if (!canSeqLive && controlsLive) setControlsLive(false)
  }, [canSeqLive, seqLive, controlsLive])
  // Stop the trailing-flush timer firing after unmount.
  useEffect(() => () => void (servoFlushTimer.current && clearTimeout(servoFlushTimer.current)), [])

  // Stream a DISPLAY-unit pose's servo angles to a connected board over the reverse
  // SNKCMD control channel (#415/#416): one "SNKCMD servos <pin>:<deg> …" line — a
  // program running `inst.control` (its `servos` handler) mirrors it onto the
  // physical servos. Throttled (~25 Hz) + best-effort — a disconnect / write error
  // is swallowed so preview never breaks. Shared by the sequence Live preview and
  // the puppet-control drag.
  const streamServos = (display: Record<string, number>): void => {
    const byPin: Record<string, number> = {}
    for (const b of bindingsRef.current) {
      const disp = display[b.joint]
      if (typeof disp === 'number') byPin[b.pin] = jointToServo(b, disp)
    }
    const payload = buildServosPayload(byPin)
    if (!payload) return
    const send = (p: string): void => void window.api.device.sendControl('servos', p).catch(() => undefined)
    const now = performance.now()
    if (now - lastLiveSend.current >= 40) {
      // Leading edge — send now, cancel any queued trailing flush (it's superseded).
      lastLiveSend.current = now
      if (servoFlushTimer.current) {
        clearTimeout(servoFlushTimer.current)
        servoFlushTimer.current = null
      }
      send(payload)
    } else {
      // Throttled — remember the LATEST and schedule a trailing flush so the final
      // slider position (on drag-release) always lands on the board, never one stale.
      pendingServoSend.current = payload
      if (!servoFlushTimer.current) {
        servoFlushTimer.current = setTimeout(() => {
          servoFlushTimer.current = null
          if (pendingServoSend.current) {
            lastLiveSend.current = performance.now()
            send(pendingServoSend.current)
            pendingServoSend.current = null
          }
        }, 40)
      }
    }
  }
  // Ref so the scene effect (stable deps) can stream the latest bindings/board.
  const streamServosRef = useRef(streamServos)
  streamServosRef.current = streamServos

  // Apply a sampled sequence frame (mirrors auto-follow); `commitState` syncs the
  // sliders (scrub/pause only). Streams to the board when Live.
  const applySequenceAt = (t: number, commitState = false): void => {
    const sampled = samplePoseSequence(sequenceRef.current, posesByNameRef.current, t)
    applyDisplayPose(sampled, commitState)
    if (seqLiveRef.current && robotRef.current) streamServos(sampled)
  }

  // rAF playback loop (mirrors the timeline's at :1410) — drives setJointValue each
  // frame; the scrubber state is throttled to ~20 Hz so it never re-renders per frame.
  useEffect(() => {
    if (!seqPlaying) return
    let raf = 0
    const start = performance.now() - seqPlayheadRef.current * 1000
    const tick = (): void => {
      const seq = sequenceRef.current
      const total = sequenceDuration(seq)
      const elapsed = (performance.now() - start) / 1000
      let t: number
      if (seq.loop) {
        t = total > 0 ? elapsed % total : 0
      } else {
        t = Math.min(elapsed, total)
        if (elapsed >= total) {
          applySequenceAt(t, true)
          seqPlayheadRef.current = t
          setSeqPlayhead(t)
          setSeqPlaying(false)
          return
        }
      }
      applySequenceAt(t)
      seqPlayheadRef.current = t
      const now = performance.now()
      if (now - lastSeqPush.current > 50) {
        lastSeqPush.current = now
        setSeqPlayhead(t)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs carry the rest
  }, [seqPlaying])

  // Update the sequence + persist via the shared motion saver (which also carries
  // the timeline, so the two can't clobber each other). defRef is kept in sync so a
  // later persist() (poses/servos) never reverts the sequence.
  const commitSequence = (next: MotionSequence): void => {
    sequenceRef.current = next
    setSequence(next)
    if (defRef.current)
      defRef.current.robot = { ...(defRef.current.robot ?? {}), sequences: next.steps.length ? [next] : [] }
    scheduleMotionSave()
  }

  const seqSeek = (t: number): void => {
    setSeqPlaying(false)
    const cl = Math.max(0, Math.min(sequenceDuration(sequenceRef.current), t))
    seqPlayheadRef.current = cl
    setSeqPlayhead(cl)
    applySequenceAt(cl, true)
  }
  const handleSeqPlayPause = (): void => {
    setSeqPlaying((p) => {
      if (p) {
        applySequenceAt(seqPlayheadRef.current, true)
        return false
      }
      setPlaying(false) // sequence + keyframe playback are mutually exclusive (both drive setJointValue)
      const seq = sequenceRef.current
      if (!seq.loop && seqPlayheadRef.current >= sequenceDuration(seq)) {
        seqPlayheadRef.current = 0
        setSeqPlayhead(0)
      }
      return true
    })
  }
  const handleAddStep = (pose: string): void => {
    commitSequence({ ...sequenceRef.current, steps: [...sequenceRef.current.steps, { pose, duration: 0.5, easing: 'easeInOut' }] })
  }
  const handleRemoveStep = (index: number): void => {
    commitSequence({ ...sequenceRef.current, steps: sequenceRef.current.steps.filter((_, i) => i !== index) })
  }
  const handleMoveStep = (index: number, dir: -1 | 1): void => {
    const steps = [...sequenceRef.current.steps]
    const j = index + dir
    if (j < 0 || j >= steps.length) return
    ;[steps[index], steps[j]] = [steps[j], steps[index]]
    commitSequence({ ...sequenceRef.current, steps })
  }
  const patchStep = (index: number, patch: Partial<PoseStep>): void => {
    commitSequence({
      ...sequenceRef.current,
      steps: sequenceRef.current.steps.map((s, i) => (i === index ? { ...s, ...patch } : s))
    })
  }

  // Drive a puppet control at slider position `t` (#416): blend its poses, drive
  // the live model, and stream the servos to a connected board — all in real time.
  const handleControlChange = (id: string, t: number): void => {
    setControlVals((v) => ({ ...v, [id]: t }))
    const c = controlsRef.current.find((x) => x.id === id)
    if (!c) return
    setPlaying(false) // a manual drag is exclusive with timeline / sequence playback
    setSeqPlaying(false)
    const display = sampleControl(c, posesByNameRef.current, t)
    applyDisplayPose(display, true)
    if (controlsLiveRef.current) streamServos(display) // only when board streaming is armed
  }
  const handleCreateControl = (name: string, posesSel: string[]): void => {
    if (!name.trim() || posesSel.length < 2) return
    const id = `ctl-${Date.now().toString(36)}-${controlIdSeq.current++}` // unique across reloads
    const next = [...controlsRef.current, { id, name: name.trim(), poses: posesSel }]
    setControls(next)
    void persist((mm) => {
      mm.controls = next
    })
  }
  const handleRenameControl = (id: string, name: string): void => {
    const next = controlsRef.current.map((c) => (c.id === id ? { ...c, name } : c))
    setControls(next)
    void persist((mm) => {
      mm.controls = next
    })
  }
  const handleDeleteControl = (id: string): void => {
    const next = controlsRef.current.filter((c) => c.id !== id)
    setControls(next)
    void persist((mm) => {
      mm.controls = next
    })
  }

  const handleCapture = (): void => {
    // A keyframe for every movable joint at the playhead, from the live pose.
    let next = timelineRef.current
    for (const m of metaRef.current) {
      if (m.isMimic) continue
      next = upsertKey(next, m.name, playheadRef.current, toDisplay(m.type, valuesRef.current[m.name] ?? 0))
    }
    commitTimeline(next)
  }

  const handleImportPose = (pose: NamedPoseLike): void => {
    commitTimeline(dropPose(timelineRef.current, pose.values, playheadRef.current, movableNames))
  }

  const handleMirror = (halfCycle: boolean): void => {
    // Neutral = each joint's mid-limit (display units) so an inverted mirror
    // reflects about the middle, not a hard 0.
    const neutral: Record<string, number> = {}
    for (const m of metaRef.current) {
      const lim = effectiveLimit(m, overridesRef.current[m.name])
      neutral[m.name] = toDisplay(m.type, (lim.lower + lim.upper) / 2)
    }
    commitTimeline(mirrorTracks(timelineRef.current, mirrorPairs, { phase: halfCycle, neutral }))
    void persist((m) => {
      m.mirror = mirrorPairs
    })
  }

  // The current pose library + servo map + sequence as managed-block data (#413/
  // #415), so an export carries a round-trippable source of truth the app reads
  // back. `sequences` is included when the editor has steps (or a hand-authored
  // block was parsed on open); when there's nothing to write we OMIT the field so
  // writeManagedBlocks leaves any existing SNAKIE_SEQUENCES block untouched.
  const buildManagedMotion = (): ManagedMotion => {
    const m: ManagedMotion = {
      poses: Object.fromEntries(posesRef.current.map((p) => [p.name, p.values])),
      servos: bindingsRef.current.map((b) => {
        const s: ManagedServo = { pin: b.pin, joint: b.joint, jointMin: b.jointMin, jointMax: b.jointMax }
        if (typeof b.servoMin === 'number') s.servoMin = b.servoMin
        if (typeof b.servoMax === 'number') s.servoMax = b.servoMax
        if (b.invert) s.invert = true
        return s
      })
    }
    const seq = sequenceRef.current
    const carried = managedSequencesRef.current
    if (seq.steps.length || Object.keys(carried).length) {
      // Preserve any other hand-authored sequences; the editor's sequence wins on its name.
      m.sequences = { ...carried }
      if (seq.steps.length) m.sequences[seq.name || 'sequence'] = poseSequenceToManagedSteps(seq)
    }
    return m
  }

  const handleExport = (): void => {
    const ex = generateMicroPython(timelineRef.current, bindingsRef.current, {
      robotName: info?.name,
      fps: timelineRef.current.fps
    })
    // Reuse an already-open motion.py from THIS project (never a stale tab from
    // another folder) so a re-export rewrites ONLY our managed blocks — the user's
    // own code + the FRAMES runtime survive; else seed a fresh buffer from the
    // generated scaffold. writeManagedBlocks is byte-exact outside the markers.
    const inProject = (f: { source: string; name: string; path: string }): boolean =>
      f.source === 'local' &&
      f.name === 'motion.py' &&
      (f.path === '' || dirname(f.path) === (currentFolder ?? ''))
    const open = openFiles.find(inProject)
    const { text } = writeManagedBlocks(open ? open.content : ex.code, buildManagedMotion())
    if (open) updateContent(open.id, text)
    else openBuffer('motion.py', text)
    setSavingLabel(
      ex.warnings.length ? `exported (${ex.warnings.length} note${ex.warnings.length > 1 ? 's' : ''})` : 'exported motion.py'
    )
  }

  const handleSelectKey = (joint: string, t: number): void => {
    setSelectedKey({ joint, t })
    seek(t)
  }
  const handleMoveKey = (joint: string, fromT: number, toT: number): void => {
    commitTimeline(moveKey(timelineRef.current, joint, fromT, toT))
    setSelectedKey({ joint, t: Math.max(0, Math.min(timelineRef.current.duration, toT)) })
  }
  const handleDeleteKey = (joint: string, t: number): void => {
    commitTimeline(deleteKey(timelineRef.current, joint, t))
    setSelectedKey(null)
  }
  // Duplicate (#332): the selected keyframe → a nudge later, else the whole pose
  // at the playhead → a nudge later (a visible copy the user can then drag).
  const handleDuplicate = (): void => {
    const tl = timelineRef.current
    const dt = Math.max(0.05, tl.duration * 0.1)
    if (selectedKey) {
      // The copy may land in a gap or extend the clip, so its exact time isn't
      // `t+dt` — leave the selection on the source key rather than guess.
      commitTimeline(duplicateKey(tl, selectedKey.joint, selectedKey.t, dt))
    } else {
      commitTimeline(duplicatePose(tl, playheadRef.current, dt, movableNames))
    }
  }
  // Toggle a mirror pair's invert (#332): reflect the value about neutral for an
  // opposite-facing partner. Persist so the next Mirror uses it.
  const handleToggleInvert = (index: number): void => {
    const next = mirrorPairs.map((p, i) => (i === index ? { ...p, invert: !p.invert } : p))
    setMirrorPairs(next)
    void persist((m) => {
      m.mirror = next
    })
  }
  const handleAddKey = (joint: string, t: number): void => {
    const m = metaRef.current.find((x) => x.name === joint)
    if (!m || m.isMimic) return
    commitTimeline(upsertKey(timelineRef.current, joint, t, toDisplay(m.type, valuesRef.current[joint] ?? 0)))
    setSelectedKey({ joint, t })
  }

  // Export a clean, tidy copy of the current URDF into the project's `urdf/`
  // folder (#315). Re-loads unchanged in the viewer; just consistently formatted.
  const canExport = !!activeFile && activeFile.source === 'local' && !!activeFile.path && !!content.trim()
  const handleExportUrdf = async (): Promise<void> => {
    if (!activeFile || activeFile.source !== 'local' || !activeFile.path) return
    const name = robotNameOf(content)
    const path = urdfExportPath(dirname(activeFile.path), name)
    const dir = path.slice(0, path.lastIndexOf('/'))
    try {
      await window.api.fs.mkdir(dir)
    } catch {
      /* already exists — fine */
    }
    try {
      await window.api.fs.writeFile(path, prettyUrdf(content))
      setSavingLabel(`exported → urdf/${name}.urdf`)
    } catch (err) {
      setSavingLabel(`export failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const handleImportStl = async (): Promise<void> => {
    if (!activeFile || activeFile.source !== 'local' || !activeFile.path) return
    setImporting(true)
    try {
      const res = await window.api.robot.importMesh(activeFile.path)
      if (res.cancelled || !res.rel) {
        if (res.error) setSavingLabel(`import failed: ${res.error}`)
        return
      }
      // Normalise scale: the URDF world is metres, but STLs are commonly authored
      // in millimetres (they'd load 1000× too big). Measure the mesh and, if its
      // largest dimension is implausibly large for a metre-scale part, scale mm→m.
      let scale = 1
      if (/\.stl$/i.test(res.rel)) {
        try {
          const bytes = await window.api.fs.readFileBytes(`${dirname(activeFile.path)}/${res.rel}`)
          const geo = new STLLoader().parse(bytes.buffer as ArrayBuffer)
          geo.computeBoundingBox()
          const size = new THREE.Vector3()
          geo.boundingBox?.getSize(size)
          if (Math.max(size.x, size.y, size.z) > 3) scale = 0.001
        } catch {
          /* leave scale 1 if the mesh can't be measured */
        }
      }
      // Add the mesh attached to the base with a movable joint, staggered so it lands
      // beside the base (not on top of it). Select it + reframe so the user can see it.
      const linkBase = res.name?.replace(/\.(stl|dae)$/i, '') ?? 'part'
      const next = addMeshLink(content, {
        meshRel: res.rel,
        linkBase,
        scale,
        parent: effectiveBaseLink ?? undefined
      })
      refitNextRef.current = true
      // Route through the choke point so the import is ONE undoable step and the
      // history stays in sync (commitUrdf updates the buffer + schedules the save).
      commitUrdf(next.urdf)
      setSelectedLink(next.link)
      setDialogCtx({ kind: 'link', link: next.link })
      if (!buildOpen) setBuildOpen(true)
      setSavingLabel(
        scale !== 1
          ? `added ${next.link} (scaled mm→m) — drag to place, or Add Joint to articulate`
          : `added ${next.link} — drag to place, or Add Joint to articulate`
      )
    } catch (e) {
      setSavingLabel(`import failed: ${e instanceof Error ? e.message : 'error'}`)
    } finally {
      setImporting(false)
    }
  }

  // Copy the URDF's out-of-project meshes into `<urdf-folder>/meshes/` and rewrite
  // each `<mesh filename>` to the copied path (#407), so the robot is self-contained.
  // One commitUrdf (⇒ one undo step + one save); the banner clears as refs re-resolve.
  const handleCopyExternalMeshes = async (): Promise<void> => {
    if (!activeFile?.path || externalMeshRefs.length === 0 || copyingMeshes) return
    setCopyingMeshes(true)
    try {
      const rewrites: { ref: string; rel: string }[] = []
      let failed = 0
      const total = externalMeshRefs.length
      for (const { ref, abs } of externalMeshRefs) {
        setSavingLabel(`copying meshes… ${rewrites.length + failed + 1}/${total}`)
        const res = await window.api.robot.importMesh(activeFile.path, abs)
        if (res.error || !res.rel) {
          failed += 1
          continue
        }
        rewrites.push({ ref, rel: res.rel })
      }
      if (rewrites.length) {
        // Rebase onto the CURRENT buffer (not the click-time snapshot) so an edit that
        // landed during the async copies survives; the rewrites are keyed on the mesh
        // ref, so applying them to the latest text is a no-op for any ref that changed.
        let next = contentRef.current
        for (const { ref, rel } of rewrites) next = rewriteMeshFilename(next, ref, rel)
        commitUrdf(next) // one undoable step; pendingSaveRef → saveFile persists it
      }
      const done = rewrites.length
      setSavingLabel(
        failed === 0
          ? `copied ${done} mesh${done === 1 ? '' : 'es'} into the project ✓`
          : `copied ${done}, ${failed} couldn't be copied`
      )
    } catch (e) {
      setSavingLabel(`copy failed: ${e instanceof Error ? e.message : 'error'}`)
    } finally {
      setCopyingMeshes(false)
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

  // Bone Mode toggle (#536): ghost/unghost via the overlay api, then re-apply the
  // selection highlight so its tint is cloned from the CURRENT (ghosted or
  // restored) materials rather than a stale swap.
  useEffect(() => {
    boneModeRef.current = boneMode
    boneApiRef.current?.setEnabled(boneMode)
    highlightApiRef.current?.apply(selectedLinkRef.current)
  }, [boneMode])

  // CoM + support-polygon overlay toggle (#558). Live status is pushed to the HUD
  // from the render loop (only when it changes), so just arm/disarm here.
  const comStatusRef = useRef<string>('')
  useEffect(() => {
    comModeRef.current = comMode
    comApiRef.current?.setEnabled(comMode)
    if (!comMode) {
      comStatusRef.current = ''
      setComStatus(null)
    }
  }, [comMode])

  // Arm/disarm the interactive IK goal gizmo (#540).
  useEffect(() => {
    ikGoalRef.current = ikGoal
    ikApiRef.current?.setArmed(ikGoal)
  }, [ikGoal])

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
    // Light theme? Decided from the --text luminance (light themes use dark text)
    // so it's robust to any skin. Drives the bg + grid colours.
    const themeIsLight = (): boolean => {
      const text = getComputedStyle(document.documentElement).getPropertyValue('--text').trim()
      const m = /#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(text)
      const lum = m ? 0.299 * parseInt(m[1], 16) + 0.587 * parseInt(m[2], 16) + 0.114 * parseInt(m[3], 16) : 200
      return lum < 128
    }

    // Ground grid: a faint MINOR grid + a slightly stronger MAJOR grid (blueprint
    // style) + red-X / blue-Z origin lines. Colours follow the theme (light + a lot
    // subtler than before). Rebuilt on frame/edit and on theme change.
    let gridGroup: THREE.Group | null = null
    let gridParams: { size: number; minY: number } | null = null
    const disposeGrid = (): void => {
      if (!gridGroup) return
      scene.remove(gridGroup)
      gridGroup.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (mesh.geometry) mesh.geometry.dispose()
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
        else mat?.dispose()
      })
      gridGroup = null
    }
    const layGrid = (size: number, minY: number): void => {
      disposeGrid()
      gridParams = { size, minY }
      groundYRef.current = minY // feed the CoM overlay's ground plane (#558)
      const light = themeIsLight()
      const minorC = light ? 0xd7d3c6 : 0x2b2d32
      const majorC = light ? 0xbcb6a4 : 0x40434a
      const group = new THREE.Group()
      const minor = new THREE.GridHelper(size, 48, minorC, minorC)
      ;(minor.material as THREE.LineBasicMaterial).transparent = true
      ;(minor.material as THREE.LineBasicMaterial).opacity = light ? 0.6 : 0.5
      const major = new THREE.GridHelper(size, 8, majorC, majorC)
      group.add(minor, major)
      const half = size / 2
      const originLine = (a: THREE.Vector3, b: THREE.Vector3, color: number): THREE.Line => {
        const ln = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([a, b]),
          new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 })
        )
        ln.renderOrder = 1
        return ln
      }
      group.add(originLine(new THREE.Vector3(-half, 0, 0), new THREE.Vector3(half, 0, 0), 0xd0483a)) // X
      group.add(originLine(new THREE.Vector3(0, 0, -half), new THREE.Vector3(0, 0, half), 0x3f78d8)) // Z
      group.position.y = minY
      gridGroup = group
      scene.add(group)
    }

    // Background follows the theme: white in light, black in dark. Also re-lay the
    // grid (its colours are theme-dependent) once one exists.
    const applyBg = (): void => {
      scene.background = new THREE.Color(themeIsLight() ? 0xffffff : 0x000000)
      if (gridParams) layGrid(gridParams.size, gridParams.minY)
    }
    applyBg()
    const themeObserver = new MutationObserver(applyBg)
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    // Isometric ORTHOGRAPHIC camera (#320) — the three axes foreshorten equally
    // and there's no perspective distortion, which reads cleaner for poses. Its
    // frustum is sized from the model bounds below.
    const camera: THREE.OrthographicCamera | THREE.PerspectiveCamera =
      projection === 'persp'
        ? new THREE.PerspectiveCamera(45, 1, 0.01, 100)
        : new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100)
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

    // Bone Mode overlay (#536): built once per scene, driven per-frame in tick().
    const boneModeApi = createBoneMode(scene, () => robotRef.current)
    boneApiRef.current = boneModeApi
    boneModeApi.setEnabled(boneModeRef.current)

    // CoM + support-polygon overlay (#558): also built once, driven per-frame.
    // Composes with Bone Mode. getData reads live refs so it tracks every edit.
    const comOverlayApi = createComOverlay(scene, () => robotRef.current, () => ({
      masses: linkMassesRef.current,
      contacts: contactsRef.current,
      groundY: groundYRef.current,
      marginFrac: 0.1
    }))
    comApiRef.current = comOverlayApi
    comOverlayApi.setEnabled(comModeRef.current)

    // Interactive IK goal gizmo (#540): drag a goal, the shared planar solver
    // poses the chain live, streams to a connected board, and feeds Capture Pose.
    const ikGizmoApi = createIkGizmo(scene, {
      getRobot: () => robotRef.current,
      camera,
      controls,
      dom: renderer.domElement,
      getChain: () => ikGoalChainRef.current(selectedLinkRef.current),
      getLimit: (name) => {
        const m = metaRef.current.find((x) => x.name === name)
        return m ? effectiveLimit(m, overridesRef.current[name]) : { lower: -Math.PI, upper: Math.PI }
      },
      // Per drag-frame: mirror the solved angles to a connected board (best-effort;
      // no board / no bindings → a harmless no-op, same channel the puppet uses).
      onLive: (native) => {
        const disp: Record<string, number> = {}
        for (const [name, val] of Object.entries(native)) {
          const m = metaRef.current.find((x) => x.name === name)
          if (m) disp[name] = toDisplay(m.type, val)
        }
        streamServosRef.current(disp)
      },
      // On release: commit the solved angles into React so the sliders + Save Pose
      // reflect the new posture (native units, mirrors the Grab tool's finishGrab).
      onCommit: (native) => setValues((v) => ({ ...v, ...native }))
    })
    ikApiRef.current = ikGizmoApi
    ikGizmoApi.setArmed(ikGoalRef.current)

    // Navigation cube (top-right): mirrors the camera; a face-click snaps the
    // view to that orthographic direction. Its own canvas → no OrbitControls clash.
    const snapView = (dir: THREE.Vector3): void => {
      const dist = camera.position.distanceTo(controls.target) || 1
      // Keep "up" sane for straight top/bottom views (else the view is degenerate).
      camera.up.set(0, 1, 0)
      if (Math.abs(dir.y) > 0.9) camera.up.set(0, 0, dir.y > 0 ? -1 : 1)
      const toP = controls.target.clone().addScaledVector(dir, dist)
      flyTo(toP, controls.target.clone(), camera.zoom, halfView, dist)
    }
    // Drag the cube → orbit the camera (spherical around the target), same feel
    // as dragging the viewport.
    const cubeSph = new THREE.Spherical()
    const cubeOffset = new THREE.Vector3()
    const orbitBy = (dxPx: number, dyPx: number): void => {
      cubeOffset.copy(camera.position).sub(controls.target)
      cubeSph.setFromVector3(cubeOffset)
      cubeSph.theta -= dxPx * 0.01
      cubeSph.phi = Math.max(0.01, Math.min(Math.PI - 0.01, cubeSph.phi - dyPx * 0.01))
      cubeOffset.setFromSpherical(cubeSph)
      camera.position.copy(controls.target).add(cubeOffset)
      controls.update()
      recordCamera()
    }
    const viewCube = cubeMountRef.current
      ? createViewCube({ size: 144, onPick: snapView, onOrbit: orbitBy })
      : null
    if (viewCube && cubeMountRef.current) cubeMountRef.current.appendChild(viewCube.dom)

    // Half-height of the ortho frustum (updated by frameModel as bounds change).
    let halfView = 1
    // Camera→target distance at "100%" — perspective zooms by dollying (distance),
    // not camera.zoom, so the % readout is derived from this (set when framing).
    let zoomBase = 1
    const resize = (): void => {
      const w = mount.clientWidth
      const h = mount.clientHeight
      if (w === 0 || h === 0) return
      // updateStyle defaults true → the canvas CSS size fits the container while
      // the drawing buffer scales by the pixel ratio.
      renderer.setSize(w, h)
      const aspect = w / h
      if (camera instanceof THREE.OrthographicCamera) {
        // Keep `halfView` world units visible vertically, widen by the aspect.
        camera.left = -halfView * aspect
        camera.right = halfView * aspect
        camera.top = halfView
        camera.bottom = -halfView
      } else {
        camera.aspect = aspect
      }
      camera.updateProjectionMatrix()
    }

    // Bracket the near/far planes around the framed model so a large or offset
    // model never gets sliced ("letterbox" clipping). `radius` = model half-size,
    // `d` = camera→target distance. Fixed far=100 clipped big/scaled-off meshes.
    const setClip = (radius: number): void => {
      const d = camera.position.distanceTo(controls.target)
      camera.near = Math.max(0.001, d - radius * 8)
      camera.far = d + radius * 8 + 0.5
      camera.updateProjectionMatrix()
    }
    // The camera-preservation key: the active file (or the base link for the compact
    // dock viewer). Defined early so the orbit/record handlers can key the module cache.
    const frameKey = compact ? effectiveBase : activeFile?.id ?? ''
    // Snapshot the camera as the PRESERVED state so a later re-parse / async mesh-settle
    // restores THIS view instead of re-framing the whole model — and stash it in the
    // MODULE cache so it also survives the view unmounting on an editor-tab switch (#399).
    // Called by manual camera actions (zoom, fit, home, focus, cube) AND on orbit/pan end.
    const recordCamera = (): void => {
      const state: CamState = {
        pos: camera.position.clone(),
        target: controls.target.clone(),
        zoom: camera.zoom,
        halfView
      }
      cameraStateRef.current = state
      if (frameKey) {
        cameraCache.set(frameKey, {
          pos: state.pos.clone(),
          target: state.target.clone(),
          zoom: state.zoom,
          halfView: state.halfView
        })
      }
    }

    // Smoothly FLY the camera to a destination (discrete navigation — cube click,
    // hierarchy focus, home, fit) so the user sees where they came from + went to.
    // The tick loop advances it; frameModel-on-load stays instant.
    let anim: {
      fromP: THREE.Vector3
      toP: THREE.Vector3
      fromT: THREE.Vector3
      toT: THREE.Vector3
      fromZoom: number
      toZoom: number
      fromHV: number
      toHV: number
      t0: number
      dur: number
    } | null = null
    const flyTo = (toP: THREE.Vector3, toT: THREE.Vector3, toZoom: number, toHV: number, clipRadius: number): void => {
      // Bracket near/far around BOTH ends of the flight so nothing clips. NEAR must
      // use the CLOSEST distance (min) — using max clipped the model when flying in
      // from a far view (near plane ended up beyond the model → first-fit clipping).
      const dFrom = camera.position.distanceTo(controls.target)
      const dTo = toP.distanceTo(toT)
      camera.near = Math.max(0.001, Math.min(dFrom, dTo) - clipRadius * 4)
      camera.far = Math.max(dFrom, dTo) + clipRadius * 4 + 0.5
      camera.updateProjectionMatrix()
      anim = {
        fromP: camera.position.clone(),
        toP: toP.clone(),
        fromT: controls.target.clone(),
        toT: toT.clone(),
        fromZoom: camera.zoom,
        toZoom,
        fromHV: halfView,
        toHV,
        t0: performance.now(),
        dur: 320
      }
    }
    const stepAnim = (): void => {
      if (!anim) return
      const u = Math.min(1, (performance.now() - anim.t0) / anim.dur)
      const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2 // easeInOutQuad
      camera.position.lerpVectors(anim.fromP, anim.toP, e)
      controls.target.lerpVectors(anim.fromT, anim.toT, e)
      camera.zoom = anim.fromZoom + (anim.toZoom - anim.fromZoom) * e
      halfView = anim.fromHV + (anim.toHV - anim.fromHV) * e
      resize() // applies halfView (ortho) / aspect + updateProjectionMatrix
      syncZoomPct()
      if (u >= 1) {
        anim = null
        recordCamera()
      }
    }

    // ── Zoom controls (mirrors the node-graph viewport cluster) ──
    const syncZoomPct = (): void => {
      let z = camera.zoom
      if (camera instanceof THREE.PerspectiveCamera) {
        // Perspective "zoom" is dolly distance: closer = bigger. Combine with any
        // camera.zoom (from the +/- buttons) so both scroll and buttons move the %.
        const d = camera.position.distanceTo(controls.target)
        if (d > 0) z *= zoomBase / d
      }
      setZoomPct(Math.round(z * 100))
    }
    const applyZoom = (z: number): void => {
      camera.zoom = Math.min(8, Math.max(0.2, z))
      camera.updateProjectionMatrix()
      syncZoomPct()
      recordCamera()
    }
    // Zoom-to-fit: recentre on the model + size the frustum to its bounds, keeping
    // the current orbit orientation (zoom multiplier back to 1).
    const fitView = (): void => {
      const robot = robotRef.current
      if (!robot) return
      robot.updateMatrixWorld(true)
      const box = new THREE.Box3().setFromObject(robot)
      if (box.isEmpty() || !Number.isFinite(box.min.x)) return
      const size = box.getSize(new THREE.Vector3())
      const centre = box.getCenter(new THREE.Vector3())
      const radius = Math.max(size.x, size.y, size.z, 0.1) * 0.5
      const dir = camera.position.clone().sub(controls.target).normalize()
      const dist =
        camera instanceof THREE.PerspectiveCamera
          ? (radius * 1.4) / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))
          : camera.position.distanceTo(controls.target) || radius * 6
      zoomBase = dist
      flyTo(centre.clone().addScaledVector(dir, dist), centre, 1, radius * 1.35, radius)
    }
    // Zoom-to-fit a SINGLE link's bounds (clicking a block in the hierarchy).
    const focusLink = (name: string): void => {
      const robot = robotRef.current
      const link = robot?.links[name]
      if (!robot || !link) return
      robot.updateMatrixWorld(true)
      const box = new THREE.Box3().setFromObject(link)
      if (box.isEmpty() || !Number.isFinite(box.min.x)) return
      const size = box.getSize(new THREE.Vector3())
      const centre = box.getCenter(new THREE.Vector3())
      const radius = Math.max(size.x, size.y, size.z, 0.03) * 0.5
      const dir = camera.position.clone().sub(controls.target).normalize()
      const dist =
        camera instanceof THREE.PerspectiveCamera
          ? (radius * 1.6) / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))
          : camera.position.distanceTo(controls.target) || radius * 6
      zoomBase = dist
      // Clip generously around the WHOLE model so focusing one small link doesn't
      // clip the others (e.g. a 2nd imported STL hiding the 1st).
      const whole = new THREE.Box3().setFromObject(robot).getSize(new THREE.Vector3())
      const wholeRadius = Math.max(whole.x, whole.y, whole.z, radius) * 0.5
      flyTo(centre.clone().addScaledVector(dir, dist), centre, 1, radius * 1.6, wholeRadius * 2)
    }
    // ── Exploded view (#499) ──────────────────────────────────────────────
    // Each link is translated outward from the assembly centre along its own
    // world-space direction (converted into its parent's local space so joint
    // hierarchies don't skew it). f=0 restores the assembled pose exactly.
    type ExplodeEntry = { obj: THREE.Object3D; base: THREE.Vector3; dir: THREE.Vector3 }
    let explodeEntries: ExplodeEntry[] | null = null
    let explodeScale = 0.5
    let explodeFitRadius = 0 // world radius of the FULLY exploded bounds (for framing)
    let explodeRaf = 0
    const buildExplode = (): ExplodeEntry[] => {
      const r = robotRef.current
      const entries: ExplodeEntry[] = []
      if (!r) return entries
      r.updateMatrixWorld(true)
      const whole = new THREE.Box3().setFromObject(r)
      if (whole.isEmpty() || !Number.isFinite(whole.min.x)) return entries
      const centre = whole.getCenter(new THREE.Vector3())
      const size = whole.getSize(new THREE.Vector3())
      explodeScale = Math.max(size.x, size.y, size.z, 0.1) * 0.55
      const links = (r as unknown as { links?: Record<string, THREE.Object3D> }).links ?? {}
      const centroids = new Map<string, { x: number; y: number; z: number }>()
      const objs = new Map<string, THREE.Object3D>()
      for (const [name, link] of Object.entries(links)) {
        const box = new THREE.Box3().setFromObject(link)
        if (box.isEmpty() || !Number.isFinite(box.min.x)) continue
        const c = box.getCenter(new THREE.Vector3())
        centroids.set(name, { x: c.x, y: c.y, z: c.z })
        objs.set(name, link)
      }
      const fallback = explodeDirections(centroids, { x: centre.x, y: centre.y, z: centre.z })
      // Reverse map + nearest exploded ANCESTOR per link (for the straight-line
      // compensation — see compensateAncestors in robot-explode.ts).
      const nameByObj = new Map<THREE.Object3D, string>()
      for (const [name, obj] of objs) nameByObj.set(obj, name)
      const parentOf = new Map<string, string | null>()
      for (const [name, obj] of objs) {
        let p = obj.parent
        let found: string | null = null
        while (p && p !== (r as unknown as THREE.Object3D)) {
          const pn = nameByObj.get(p)
          if (pn) {
            found = pn
            break
          }
          p = p.parent
        }
        parentOf.set(name, found)
      }
      // Depth-scaled magnitudes: parts nearest the root move least, leaves move
      // most — so a chain sharing one direction still separates part-from-part.
      const depths = hierarchyDepths(parentOf)
      let maxDepth = 0
      for (const dv of depths.values()) maxDepth = Math.max(maxDepth, dv)
      // DESIRED world direction per link, frozen at build time: the KRF joint
      // normal (the face the part was joined on) → the joint's origin offset →
      // centroid-from-centre fallback. The base link stays anchored so parts
      // read as coming OFF the chassis in straight lines.
      const desired = new Map<string, { x: number; y: number; z: number }>()
      for (const [name, obj] of objs) {
        if (parentOf.get(name) === null && obj.parent === (r as unknown as THREE.Object3D)) {
          desired.set(name, { x: 0, y: 0, z: 0 })
          continue
        }
        let dir: THREE.Vector3 | null = null
        const joint = obj.parent as (THREE.Object3D & { isURDFJoint?: boolean }) | null
        if (joint?.isURDFJoint) {
          const parentLink = joint.parent
          const q = new THREE.Quaternion()
          parentLink?.getWorldQuaternion(q)
          const n = jointNormalRef.current[joint.name]
          if (n) dir = new THREE.Vector3(n[0], n[1], n[2]).applyQuaternion(q)
          else if (joint.position.lengthSq() > 1e-10) dir = joint.position.clone().applyQuaternion(q)
          // A normal/origin can point either way — flip toward "away from the
          // parent part" so exploding always separates.
          if (dir && dir.lengthSq() > 1e-10) {
            const pName = parentOf.get(name)
            const c = centroids.get(name)
            const pc = pName ? centroids.get(pName) : undefined
            if (c && pc) {
              const away = new THREE.Vector3(c.x - pc.x, c.y - pc.y, c.z - pc.z)
              if (away.lengthSq() > 1e-10 && dir.dot(away) < 0) dir.negate()
            }
          }
        }
        if (!dir || dir.lengthSq() < 1e-10) {
          const f = fallback.get(name)
          dir = f ? new THREE.Vector3(f.x, f.y, f.z) : new THREE.Vector3(0, 1, 0)
        }
        dir.normalize()
        const w = maxDepth > 0 ? Math.max(0.3, (depths.get(name) ?? 1) / maxDepth) : 1
        desired.set(name, { x: dir.x * w, y: dir.y * w, z: dir.z * w })
      }
      // Overlap solve (#499): at the FINAL exploded position no two parts may
      // intersect — any clashing pair pushes the deeper part further along its
      // own line until clear. Solved on rest-pose world AABBs (translate-only).
      const partBoxes: PartBox[] = []
      for (const [name, obj] of objs) {
        const c = centroids.get(name)
        const d = desired.get(name)
        if (!c || !d) continue
        const box = new THREE.Box3().setFromObject(obj)
        const half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5)
        const len = Math.hypot(d.x, d.y, d.z)
        partBoxes.push({
          name,
          centre: c,
          half: { x: half.x, y: half.y, z: half.z },
          dir: len > 1e-9 ? { x: d.x / len, y: d.y / len, z: d.z / len } : { x: 0, y: 0, z: 0 },
          travel: len * explodeScale,
          depth: depths.get(name) ?? 0
        })
      }
      const solvedTravel = resolveOverlaps(partBoxes, Math.max(size.x, size.y, size.z) * 0.015)
      for (const pb of partBoxes) {
        const t = solvedTravel.get(pb.name)
        if (t === undefined) continue
        desired.set(pb.name, {
          x: (pb.dir.x * t) / explodeScale,
          y: (pb.dir.y * t) / explodeScale,
          z: (pb.dir.z * t) / explodeScale
        })
      }
      // Exact FINAL bounds (post-solve): union of each part's AABB translated to
      // its full-explode position — drives the camera fit so nothing leaves shot.
      const fitBox = new THREE.Box3()
      for (const pb of partBoxes) {
        const t = solvedTravel.get(pb.name) ?? 0
        const cx = pb.centre.x + pb.dir.x * t
        const cy = pb.centre.y + pb.dir.y * t
        const cz = pb.centre.z + pb.dir.z * t
        fitBox.expandByPoint(new THREE.Vector3(cx - pb.half.x, cy - pb.half.y, cz - pb.half.z))
        fitBox.expandByPoint(new THREE.Vector3(cx + pb.half.x, cy + pb.half.y, cz + pb.half.z))
      }
      if (!fitBox.isEmpty()) {
        const fs = fitBox.getSize(new THREE.Vector3())
        explodeFitRadius = Math.max(fs.x, fs.y, fs.z, 0.1) * 0.5
      }
      // Straight world-space paths: subtract each link's nearest exploded
      // ancestor's direction so nested links don't diagonally track a moving parent.
      const net = compensateAncestors(desired, parentOf)
      for (const [name, obj] of objs) {
        const d = net.get(name)
        if (!d) continue
        if (Math.hypot(d.x, d.y, d.z) < 1e-9 && parentOf.get(name) === null) continue // anchored base
        const q = new THREE.Quaternion()
        obj.parent?.getWorldQuaternion(q)
        const localDir = new THREE.Vector3(d.x, d.y, d.z).applyQuaternion(q.invert())
        entries.push({ obj, base: obj.position.clone(), dir: localDir })
      }
      return entries
    }
    const applyExplode = (f: number): void => {
      if (f > 0 && !explodeEntries) explodeEntries = buildExplode()
      if (!explodeEntries) return
      for (const e of explodeEntries) {
        e.obj.position.copy(e.base).addScaledVector(e.dir, f * explodeScale)
      }
      if (f === 0) explodeEntries = null // re-measure next time (pose may change)
    }
    const stopExplodeAnim = (): void => {
      if (explodeRaf) cancelAnimationFrame(explodeRaf)
      explodeRaf = 0
    }
    // One frame of the explode animation at progress t — shared by the LIVE
    // rAF animation and the DETERMINISTIC offline GIF renderer.
    type ExplodeCamCtx = { startPos: THREE.Vector3; startTarget: THREE.Vector3; startZoom: number; k: number }
    const stepExplodeFrame = (t: number, target: number, orbit: boolean, c: ExplodeCamCtx): void => {
      applyExplode(target * explodeProgress(t))
      // Speed-ramped orbit: ease the angle so the camera accelerates out of the
      // start and glides into the finish instead of turning at constant speed.
      // ease(0)=0 and ease(1)=1, so it still ends exactly where it began.
      const orbitT = easeInOutCubic(t)
      // Smooth fit: ease the zoom-out over the first 12% and back over the last
      // 12% — cubic-eased within each leg so the zoom ramps gently, no hard hit.
      const leg = 0.12
      const fitT = easeInOutCubic(t < leg ? t / leg : t > 1 - leg ? (1 - t) / leg : 1)
      const s = 1 + (c.k - 1) * fitT
      if (camera instanceof THREE.PerspectiveCamera) {
        const dir = c.startPos.clone().sub(c.startTarget)
        const base = orbit ? orbitPosition(orbitT, c.startPos, c.startTarget) : null
        if (base) {
          const bp = new THREE.Vector3(base.x, base.y, base.z).sub(c.startTarget).multiplyScalar(s).add(c.startTarget)
          camera.position.copy(bp)
        } else {
          // Read the length BEFORE normalize() — it mutates the vector, which
          // left length()=1 and teleported the camera ~1 unit from the target
          // (the robot vanished when orbit was unticked).
          const dist = dir.length()
          camera.position.copy(c.startTarget).addScaledVector(dir.normalize(), dist * s)
        }
      } else {
        if (orbit) {
          const p = orbitPosition(orbitT, c.startPos, c.startTarget)
          camera.position.set(p.x, p.y, p.z)
        }
        applyZoom(c.startZoom / s)
      }
      camera.lookAt(c.startTarget)
    }
    const explodeCamCtx = (target: number): ExplodeCamCtx => {
      const startPos = camera.position.clone()
      const startTarget = controls.target.clone()
      const r0 = robotRef.current ? new THREE.Box3().setFromObject(robotRef.current).getSize(new THREE.Vector3()) : null
      const baseR = r0 ? Math.max(r0.x, r0.y, r0.z, 0.1) * 0.5 : 1
      if (!explodeEntries) explodeEntries = buildExplode()
      const fullR = explodeFitRadius > 0 ? explodeFitRadius : baseR + explodeScale
      const k = Math.max(1, ((baseR + (fullR - baseR) * target) / baseR) * 1.12)
      return { startPos, startTarget, startZoom: camera.zoom, k }
    }
    // DETERMINISTIC GIF render (#499): step the animation math at perfectly
    // uniform intervals, render + capture each frame synchronously. Immune to
    // rAF beats / encode stalls, so playback is even — live sampling judders.
    const renderExplodeGif = async (target: number, orbit: boolean): Promise<Blob | null> => {
      stopExplodeAnim()
      anim = null
      const c = explodeCamCtx(target)
      const DELAY_MS = 30 // GIF's practical minimum — browsers clamp <20ms to 100ms
      const n = Math.round(5200 / DELAY_MS)
      const sink = createGifSink(DELAY_MS)
      for (let i = 0; i < n; i++) {
        stepExplodeFrame(i / (n - 1), target, orbit, c)
        renderer.render(scene, camera)
        sink.addCanvasFrame(renderer.domElement)
        // Keep the UI alive — yield between bursts of frames.
        if (i % 6 === 5) await new Promise((res) => window.setTimeout(res, 0))
      }
      applyExplode(0)
      camera.position.copy(c.startPos)
      if (!(camera instanceof THREE.PerspectiveCamera)) applyZoom(c.startZoom)
      camera.lookAt(c.startTarget)
      return sink.finish()
    }
    // Animate 0→f→0 (eased out-and-back). One smooth pre-fit zoom (scaled to the
    // fully-exploded radius) instead of per-frame re-fitting, so there's no
    // zoom jitter; the optional orbit is a full 2π turn ending at the start.
    const animateExplode = (target: number, orbit: boolean, durationMs = 4200, onDone?: () => void): void => {
      stopExplodeAnim()
      anim = null // cancel any in-flight flyTo — we own the camera now
      const ctx = explodeCamCtx(target)
      const { startPos, startTarget, startZoom } = ctx
      const t0 = performance.now()
      const step = (): void => {
        const t = Math.min(1, (performance.now() - t0) / durationMs)
        stepExplodeFrame(t, target, orbit, ctx)
        if (t < 1) {
          explodeRaf = requestAnimationFrame(step)
        } else {
          explodeRaf = 0
          applyExplode(0)
          camera.position.copy(startPos)
          if (!(camera instanceof THREE.PerspectiveCamera)) applyZoom(startZoom)
          camera.lookAt(startTarget)
          onDone?.()
        }
      }
      explodeRaf = requestAnimationFrame(step)
    }
    // Record the animation straight off the WebGL canvas. Prefers a real .mp4
    // (Chromium ≥126 muxes mp4 in MediaRecorder); falls back to .webm.
    const recordExplode = async (target: number, orbit: boolean): Promise<boolean> => {
      const canvas = renderer.domElement as HTMLCanvasElement & {
        captureStream?: (fps?: number) => MediaStream
      }
      const download = (blob: Blob, ext: string): void => {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `robot-explode.${ext}`
        a.click()
        window.setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
      }
      // PRIMARY: a proper progressive mp4 via WebCodecs + mp4-muxer (faststart
      // moov up front — QuickTime/Finder-friendly, unlike MediaRecorder's
      // fragmented mp4 which players report as "not a valid file").
      const mp4 = await recordCanvasMp4(canvas, (onDone) =>
        animateExplode(target, orbit, 5200, () => window.setTimeout(onDone, 150))
      )
      if (mp4 && videoBytesLookValid(new Uint8Array(await mp4.arrayBuffer()), 'video/mp4')) {
        download(mp4, 'mp4')
        return true
      }
      // FALLBACK: animated GIF — renders on ALL four platforms (macOS Quick
      // Time can't open webm; Electron can't encode H.264 for mp4).
      const gif = await renderExplodeGif(target, orbit)
      if (gif && gif.size > 2048) {
        download(gif, 'gif')
        return true
      }
      // LAST RESORT: MediaRecorder, but only
      // with a codec PROVEN to encode here — isTypeSupported alone lies, which
      // produced empty "not a valid file" downloads.
      const mime = await probeRecorderMime(canvas)
      if (!mime || !canvas.captureStream) return false
      return new Promise<boolean>((res) => {
        const stream = canvas.captureStream!(30)
        const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 })
        // Name the file from the recorder's ACTUAL negotiated type, not the ask.
        const actualMime = rec.mimeType || mime
        const chunks: Blob[] = []
        rec.ondataavailable = (e): void => {
          if (e.data.size) chunks.push(e.data)
        }
        rec.onstop = (): void => {
          stream.getTracks().forEach((tr) => tr.stop())
          const blob = new Blob(chunks, { type: actualMime })
          void blob.arrayBuffer().then((buf) => {
            // Final sanity check — never hand the user a broken file.
            if (!videoBytesLookValid(new Uint8Array(buf), actualMime)) {
              res(false)
              return
            }
            download(blob, extForMime(actualMime))
            res(true)
          })
        }
        rec.start()
        animateExplode(target, orbit, 5200, () => window.setTimeout(() => rec.stop(), 150))
      })
    }

    zoomApiRef.current = {
      in: () => applyZoom(camera.zoom * 1.2),
      out: () => applyZoom(camera.zoom / 1.2),
      fit: fitView,
      // Double-clicking the % readout: 100% ↔ fit (keyed on the live zoom).
      toggle: () => (Math.abs(camera.zoom - 1) < 0.005 ? fitView() : applyZoom(1)),
      // Home: fly to the default isometric framing at 100%.
      home: () => {
        if (robotRef.current) frameModel(robotRef.current, true)
      },
      focusLink,
      setExplode: applyExplode,
      animateExplode: (f, orbit, onDone) => animateExplode(f, orbit, undefined, onDone),
      recordExplode
    }
    // Every camera change (orbit / pan / wheel-zoom) updates the % readout AND records
    // the view, so an orbited view survives an editor-tab switch (#399) — not just the
    // discrete zoom/home/fit/cube actions.
    const onControlsChange = (): void => {
      syncZoomPct()
      recordCamera()
    }
    controls.addEventListener('change', onControlsChange)
    // A user grabbing the viewport cancels any in-flight camera animation (else
    // the tween and OrbitControls fight over the camera).
    const onControlsStart = (): void => {
      anim = null
    }
    controls.addEventListener('start', onControlsStart)

    // Frame the model isometrically + (re)lay a ground grid under it. Called once
    // up-front (primitives) and again when async meshes arrive and grow the box.
    const frameModel = (robot: URDFRobot, animate = false, attempt = 0): boolean => {
      // Flush world matrices BEFORE measuring — a dirty transform frames stale.
      robot.updateMatrixWorld(true)
      const box = new THREE.Box3().setFromObject(robot)
      if (!Number.isFinite(box.min.x) || box.isEmpty()) {
        // The geometry isn't laid out yet (can happen on the very first frame,
        // notably under Electron) — retry next frame instead of bailing and
        // leaving the camera at its default FRONT position (#…). Bounded so a
        // genuinely empty model doesn't loop; stops if the robot is swapped out.
        if (attempt < 8 && robotRef.current === robot) {
          requestAnimationFrame(() => frameModel(robot, animate, attempt + 1))
        }
        return false // couldn't frame yet (empty box) — caller must not treat this as done
      }
      const size = box.getSize(new THREE.Vector3())
      const centre = box.getCenter(new THREE.Vector3())
      const radius = Math.max(size.x, size.y, size.z, 0.1) * 0.5
      // Home = the top-LEFT-front corner (−X left, +Y up, +Z front) facing us.
      const isoDir = new THREE.Vector3(-1, 1, 1).normalize()
      // Ortho apparent size is set by halfView, so distance is arbitrary; perspective
      // must sit back far enough that the model fits the vertical fov.
      const dist =
        camera instanceof THREE.PerspectiveCamera
          ? (radius * 1.4) / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))
          : radius * 6
      zoomBase = dist
      const destPos = centre.clone().addScaledVector(isoDir, dist)
      layGrid(Math.max(size.x, size.z) * 3 + 0.4, box.min.y)
      if (animate) {
        flyTo(destPos, centre, 1, radius * 1.35, radius)
        return true
      }
      halfView = radius * 1.35 // a little padding around the model (ortho)
      camera.position.copy(destPos)
      controls.target.copy(centre)
      camera.zoom = 1
      controls.update()
      setClip(radius)
      resize()
      return true
    }

    // Frame a NEW robot isometrically, but PRESERVE the camera when the same file
    // is just re-parsed after a build edit (#315a must-fix — no view jump), or when the
    // view remounts after an editor-tab switch (#399, via the module cache). The grid
    // is refreshed to the new bounds either way. `frameKey` is defined above.
    const relayGrid = (robot: URDFRobot): void => {
      robot.updateMatrixWorld(true)
      const box = new THREE.Box3().setFromObject(robot)
      if (box.isEmpty()) return
      const size = box.getSize(new THREE.Vector3())
      layGrid(Math.max(size.x, size.z) * 3 + 0.4, box.min.y)
    }
    // The Build workspace opens at HOME (fit) rather than the preserved camera
    // (#615): frame the model on the FIRST frame of this mount, then record it so a
    // later async mesh-settle keeps the homed view (not a stale cached camera).
    let homedForMount = false
    const framePreservingCamera = (robot: URDFRobot): void => {
      if (homeOnMountRef.current && !homedForMount) {
        // Frame HOME — but only mark it done (and record the camera) if it actually
        // framed. The FIRST call fires before async meshes load, so the box is empty
        // and frameModel bails to FRONT; marking "homed" then would let finalize()
        // restore that front camera. Gating on success means finalize (after the
        // meshes settle + the box is real) re-frames home properly. (#…)
        if (frameModel(robot)) {
          homedForMount = true
          framedKeyRef.current = frameKey
          recordCamera()
        }
        return
      }
      const saved = cameraStateRef.current
      if (refitNextRef.current) {
        // A just-added object: reframe so it's actually in view (once).
        refitNextRef.current = false
        frameModel(robot)
        framedKeyRef.current = frameKey
        cameraStateRef.current = null
        return
      }
      // Restore the preserved view — either the in-run snapshot (re-parse/mesh-settle),
      // or, on a fresh mount after a tab switch, the module-cached view for this file.
      const restore = saved && framedKeyRef.current === frameKey ? saved : cameraCache.get(frameKey)
      if (restore) {
        halfView = restore.halfView
        camera.position.copy(restore.pos)
        controls.target.copy(restore.target)
        camera.zoom = restore.zoom
        camera.updateProjectionMatrix()
        controls.update()
        framedKeyRef.current = frameKey
        relayGrid(robot)
        resize()
      } else {
        frameModel(robot)
        framedKeyRef.current = frameKey
        // A genuinely new robot: drop any prior camera so the SECOND call this
        // run (finalize/mesh-settle) re-frames THIS model, not the old one.
        cameraStateRef.current = null
      }
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
      framePreservingCamera(robot)
      // A mesh that finished loading async isn't outlined yet — re-apply the
      // selection highlight now that its geometry exists.
      highlightApiRef.current?.apply(selectedLinkRef.current)
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
        framePreservingCamera(robot) // frame a new robot; keep the camera on an edit

        if (!poseUI) {
          // DOCKED MINI VIEWER (#409): the pose-tool seeding below is gated to the full
          // view, so seed the minimum the compact viewer needs to RECALL a saved pose —
          // a live robot handle + movable-joint meta at a neutral rest — then load the
          // saved poses for the dropdown. Preview-only: the compact view never writes
          // robot.yml (create/rename/delete stay in the full pose tool).
          const meta = extractJoints(robot)
          robotRef.current = robot
          const initial: Record<string, number> = {}
          for (const m of meta) {
            if (m.isMimic) continue
            const v = clamp(0, m.lower, m.upper)
            initial[m.name] = v
            robot.setJointValue(m.name, v)
          }
          setJointMeta(meta)
          setValues(initial)
          setPoses([]) // clear synchronously so a model switch can't flash the old list
          void (async () => {
            try {
              const def = await window.api.robot.load(currentFolder || undefined)
              if (disposed || !robotRef.current) return
              const ps = (def.robot ?? {}).poses
              setPoses(Array.isArray(ps) ? ps : [])
            } catch {
              /* no robot.yml — nothing to recall */
            }
          })()
        }

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
              setChosenBase(typeof model.baseLink === 'string' ? model.baseLink : null)
              // Limits are edited via the joint dialog now (URDF <limit>); ignore the
              // retired robot.yml `joints` OVERRIDE layer so a legacy override can't
              // silently clamp the sliders below a widened URDF limit (#312).
              const ov = {} as Record<string, { min?: number; max?: number }>
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
              jointRollRef.current = { ...(model.jointRoll ?? {}) } // remembered joint rolls
              jointNormalRef.current = { ...(model.jointNormal ?? {}) } // remembered mating normals
              setOverrides(ov)
              setPoses(Array.isArray(model.poses) ? model.poses : [])
              setValues(nv)
              // Motion timeline + mirror pairs (#314) — seed ONCE per folder, so a
              // content-only rerun (e.g. after an STL import) doesn't clobber
              // unsaved timeline edits still inside the save debounce.
              const folderKey = currentFolder || ''
              if (timelineLoadedFolder.current !== folderKey) {
                timelineLoadedFolder.current = folderKey
                const tl = model.timeline
                const loaded = tl && Array.isArray(tl.tracks) ? (tl as MotionTimeline) : EMPTY_TIMELINE
                timelineRef.current = loaded
                setTimeline(loaded)
                const movable = meta.filter((m) => !m.isMimic).map((m) => m.name)
                setMirrorPairs(
                  Array.isArray(model.mirror) && model.mirror.length
                    ? model.mirror
                    : autoMirrorPairs(movable)
                )
              }
              // Pose sequence (#415) — seed once per folder alongside the timeline.
              if (seqLoadedFolder.current !== folderKey) {
                seqLoadedFolder.current = folderKey
                const seq = Array.isArray(model.sequences) ? model.sequences[0] : undefined
                const loadedSeq = seq && Array.isArray(seq.steps) ? (seq as MotionSequence) : EMPTY_SEQUENCE
                sequenceRef.current = loadedSeq
                setSequence(loadedSeq)
                seqPlayheadRef.current = 0
                setSeqPlayhead(0)
                setSeqPlaying(false)
              }
            } catch {
              // No robot.yml (or unreadable) — keep the neutral pose.
            }
          })()

          // MEASURE TOOL (#312): click two points on the model → distance readout.
          const raycaster = new THREE.Raycaster()
          const ndc = new THREE.Vector2()
          const pts: THREE.Vector3[] = []
          const markerMat = new THREE.MeshBasicMaterial({ color: 0xc8a24a, depthTest: false })
          const lineMat = new THREE.LineDashedMaterial({ color: 0xc8a24a, depthTest: false, transparent: true })
          const markers: THREE.Mesh[] = []
          let line: THREE.Line | null = null
          let label: THREE.Sprite | null = null
          const disposeLabel = (): void => {
            if (!label) return
            scene.remove(label)
            const m = label.material as THREE.SpriteMaterial
            m.map?.dispose()
            m.dispose()
            label = null
          }
          // A floating pill showing the distance, centred on the dashed line.
          const showMeasureLabel = (text: string, at: THREE.Vector3): void => {
            disposeLabel()
            const c = document.createElement('canvas')
            c.width = 256
            c.height = 72
            const ctx = c.getContext('2d')!
            ctx.fillStyle = 'rgba(18, 19, 22, 0.86)'
            ctx.fillRect(8, 14, 240, 44)
            ctx.strokeStyle = '#c8a24a'
            ctx.lineWidth = 3
            ctx.strokeRect(8, 14, 240, 44)
            ctx.fillStyle = '#f0e4bf'
            ctx.font = 'bold 34px sans-serif'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText(text, 128, 38)
            const tex = new THREE.CanvasTexture(c)
            tex.anisotropy = 4
            label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }))
            const w = halfView * 0.95
            label.scale.set(w, (w * 72) / 256, 1)
            label.position.copy(at)
            label.renderOrder = 1000
            scene.add(label)
          }
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
            disposeLabel()
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
              lineMat.dashSize = halfView * 0.05
              lineMat.gapSize = halfView * 0.03
              line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat)
              line.computeLineDistances() // required for the dashes to render
              line.renderOrder = 998
              scene.add(line)
              const mm = pts[0].distanceTo(pts[1]) * 1000
              setMeasureDist(mm)
              const text = mm < 1000 ? `${mm.toFixed(1)} mm` : `${(mm / 1000).toFixed(3)} m`
              showMeasureLabel(text, pts[0].clone().add(pts[1]).multiplyScalar(0.5))
            } else {
              setMeasureDist(null)
              disposeLabel()
            }
          }
          // BLOCK BUILDER (#315a): push/pull a primitive face to resize (opposite
          // face stays put) + a selection outline. Active when the build dock is
          // open and NOT measuring — one guarded pointer path on this canvas.
          const buildRay = new THREE.Raycaster()
          const buildNdc = new THREE.Vector2()
          const camDir = new THREE.Vector3()
          // The URDF link an object belongs to (walk up to the marked URDFLink). Declared
          // HERE — before applyHighlight uses it below — so re-selecting on an effect
          // re-run (e.g. after adding a joint) can't hit a temporal-dead-zone crash.
          const ownerLinkName = (obj: THREE.Object3D | null): string | null => {
            let o = obj
            while (o && !(o as unknown as { isURDFLink?: boolean }).isURDFLink) o = o.parent
            return (o as unknown as { urdfName?: string } | null)?.urdfName ?? null
          }
          // Selection highlight: tint the one selected block LIGHT BLUE, keeping the
          // material's shading (so the sides still shade rather than going flat). Only
          // ever ONE block is highlighted — clearHighlight() restores the previous one
          // first — even when blocks are joined into a chain.
          const HL_BLUE = new THREE.Color(0x9db8dd)
          let highlight: {
            entries: { mesh: THREE.Mesh; origMat: THREE.Material | THREE.Material[]; tint: THREE.Material[] }[]
          } | null = null
          const clearHighlight = (): void => {
            if (!highlight) return
            for (const e of highlight.entries) {
              e.mesh.material = e.origMat
              e.tint.forEach((m) => m.dispose())
            }
            highlight = null
          }
          const applyHighlight = (link: string | null): void => {
            clearHighlight()
            const r = robotRef.current
            if (!link || !r || !r.links[link]) return
            const entries: {
              mesh: THREE.Mesh
              origMat: THREE.Material | THREE.Material[]
              tint: THREE.Material[]
            }[] = []
            r.links[link].traverse((o) => {
              const mesh = o as THREE.Mesh
              // A joined child link nests under its parent in the scene graph, so only
              // tint meshes this link actually OWNS — never the joined neighbours.
              if (!mesh.isMesh || ownerLinkName(mesh) !== link) return
              const origMat = mesh.material
              const mk = (m: THREE.Material): THREE.Material => {
                const c = m.clone() as THREE.MeshStandardMaterial
                // A real TINT (lerp the block's own colour 60% toward blue), not a flat
                // replace — so a link's custom colour still reads through the highlight.
                // That's what lets a live colour edit be visible while the part is still
                // selected (#405), and is truer to "keep the material's shading". A subtle
                // emissive blue glow keeps the selection legible even when the custom
                // colour is ALREADY near HL_BLUE (where the lerp alone barely moves it).
                if ('color' in c && c.color) c.color.lerp(HL_BLUE, 0.6)
                if ('emissive' in c && c.emissive) {
                  c.emissive = HL_BLUE.clone()
                  c.emissiveIntensity = 0.2
                }
                return c
              }
              const tint = Array.isArray(origMat) ? origMat.map(mk) : [mk(origMat)]
              mesh.material = Array.isArray(origMat) ? tint : tint[0]
              entries.push({ mesh, origMat, tint })
            })
            highlight = { entries }
          }
          highlightApiRef.current = { apply: applyHighlight }
          applyHighlight(selectedLinkRef.current) // survive re-parse

          const buildActive = (): boolean => buildOpenRef.current && !measureActiveRef.current
          const buildNdcFrom = (e: PointerEvent): void => {
            const rect = renderer.domElement.getBoundingClientRect()
            buildNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
            buildNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
          }
          const applyPreview = (
            kind: PrimitiveKind,
            m: THREE.Mesh,
            g: THREE.Object3D,
            dims: number[],
            origin: [number, number, number]
          ): void => {
            if (kind === 'box') m.scale.set(dims[0], dims[1], dims[2])
            else if (kind === 'cylinder') m.scale.set(dims[0], dims[1], dims[0])
            else m.scale.set(dims[0], dims[0], dims[0])
            g.position.set(origin[0], origin[1], origin[2])
          }
          const dimText = (kind: PrimitiveKind, face: FaceEdit, dims: number[]): string => {
            const v = (x: number): number => Math.round(x * 1000)
            if (kind === 'sphere') return `⌀ ${v(dims[0] * 2)} mm`
            if (kind === 'cylinder') return face.dim === 1 ? `length ${v(dims[1])} mm` : `⌀ ${v(dims[0] * 2)} mm`
            return `${v(dims[face.dim])} mm`
          }
          type Drag = {
            link: string
            kind: PrimitiveKind
            face: FaceEdit
            dims0: number[]
            origin0: [number, number, number]
            mesh: THREE.Mesh
            group: THREE.Object3D
            nWorld: THREE.Vector3
            plane: THREE.Plane
            anchor: THREE.Vector3
            preview: { dims: number[]; origin: [number, number, number] } | null
          }
          let drag: Drag | null = null
          let bDownX = 0
          let bDownY = 0

          // Snap-handle pool (Fusion-style dots on a hovered/target face) — small
          // TRANSLUCENT discs laid FLAT on the surface (oriented by the face normal) so
          // they read as painted onto the face rather than floating in front of it.
          // Shared geometry/materials; discs never intercept a raycast.
          const zAxis = new THREE.Vector3(0, 0, 1)
          const snapGroup = new THREE.Group()
          scene.add(snapGroup)
          const discGeo = new THREE.CircleGeometry(1, 28) // unit disc in XY, +Z normal
          // Role-distinct glyph geometries (#411), all unit-sized in the XY plane so
          // they orient to the face normal + scale by `r` like the disc: a square for a
          // corner, a diamond (square baked at 45°) for an edge, a ring for a hole.
          const squareGeo = new THREE.PlaneGeometry(1.6, 1.6)
          const diamondGeo = new THREE.PlaneGeometry(1.6, 1.6)
          diamondGeo.rotateZ(Math.PI / 4)
          const ringPts: THREE.Vector3[] = []
          for (let a = 0; a < 32; a++) {
            const t = (a / 32) * Math.PI * 2
            ringPts.push(new THREE.Vector3(Math.cos(t), Math.sin(t), 0))
          }
          const ringGeo = new THREE.BufferGeometry().setFromPoints(ringPts)
          const handleMat = new THREE.MeshBasicMaterial({
            color: 0xbfe0ff,
            transparent: true,
            opacity: 0.4,
            side: THREE.DoubleSide,
            depthTest: false,
            depthWrite: false
          })
          const handleMatOn = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.85,
            side: THREE.DoubleSide,
            depthTest: false,
            depthWrite: false
          })
          const ringMat = new THREE.LineBasicMaterial({
            color: 0xbfe0ff,
            transparent: true,
            opacity: 0.6,
            depthTest: false,
            depthWrite: false
          })
          const ringMatOn = new THREE.LineBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.95,
            depthTest: false,
            depthWrite: false
          })
          // Build the glyph for a snap role (#411). Meshes for filled glyphs, a line
          // loop for the hole ring; the caller positions/orients/scales it.
          const glyphFor = (role: string, active: boolean): THREE.Object3D => {
            const fill = active ? handleMatOn : handleMat
            switch (role) {
              case 'hole':
                return new THREE.LineLoop(ringGeo, active ? ringMatOn : ringMat)
              case 'corner':
                return new THREE.Mesh(squareGeo, fill)
              case 'edge':
                return new THREE.Mesh(diamondGeo, fill)
              default: // 'centre' → small dot, 'outline'/fallback → disc
                return new THREE.Mesh(discGeo, fill)
            }
          }
          const clearHandles = (): void => {
            snapGroup.clear()
          }
          const showHandles = (
            pts: THREE.Vector3[],
            roles: string[],
            activeIdx: number,
            normal?: THREE.Vector3
          ): void => {
            snapGroup.clear()
            const r = halfView * 0.025
            const q = normal
              ? new THREE.Quaternion().setFromUnitVectors(zAxis, normal.clone().normalize())
              : null
            pts.forEach((p, i) => {
              const role = roles[i] ?? 'point'
              const active = i === activeIdx
              const g = glyphFor(role, active)
              g.position.copy(p)
              if (q) g.quaternion.copy(q) // lie flat on the face
              else g.quaternion.copy(camera.quaternion) // billboard fallback
              // A centre 'dot' is smaller so it doesn't read like the 'outline' disc.
              const base = role === 'centre' ? r * 0.6 : r
              g.scale.setScalar(active ? base * 1.8 : base)
              g.renderOrder = 998
              g.raycast = () => {}
              snapGroup.add(g)
            })
          }
          const mmv = (m: number): number => Math.round(m * 1000)
          // Classify the hovered face + return its world snap handles.
          const hitToHandles = (
            hit: THREE.Intersection,
            link: string,
            geom: PrimitiveGeom
          ): { pts: THREE.Vector3[]; roles: string[]; face: FaceEdit } => {
            const linkObj = robotRef.current!.links[link]
            const mesh = hit.object as THREE.Mesh
            const nW = hit.face!.normal.clone().transformDirection(mesh.matrixWorld).normalize()
            const q = new THREE.Quaternion()
            linkObj.getWorldQuaternion(q)
            const nL = nW.clone().applyQuaternion(q.invert())
            const face = classifyFace([nL.x, nL.y, nL.z], geom.kind)
            const sp = faceSnapPoints(geom, face)
            const m = linkObj.matrixWorld
            return {
              pts: sp.map((s) => new THREE.Vector3(s.p[0], s.p[1], s.p[2]).applyMatrix4(m)),
              roles: sp.map((s) => s.role),
              face
            }
          }
          const nearestScreen = (pts: THREE.Vector3[], e: PointerEvent): { index: number; distPx: number } => {
            const rect = renderer.domElement.getBoundingClientRect()
            const px = e.clientX - rect.left
            const py = e.clientY - rect.top
            let index = -1
            let best = Infinity
            pts.forEach((p, i) => {
              const v = p.clone().project(camera)
              // Reject points behind the camera / outside the depth frustum: their
              // mirrored NDC would otherwise masquerade as a nearby on-screen snap.
              if (!(v.z >= -1 && v.z <= 1)) return
              const sx = (v.x * 0.5 + 0.5) * rect.width
              const sy = (-v.y * 0.5 + 0.5) * rect.height
              if (!Number.isFinite(sx) || !Number.isFinite(sy)) return
              const d = Math.hypot(sx - px, sy - py)
              if (d < best) {
                best = d
                index = i
              }
            })
            return { index, distPx: best }
          }
          // A HOLE centre is a joint's natural target but hard to hit dead-on (it sits
          // over empty space). Bias toward one within a generous radius so it STICKS even
          // when an edge midpoint is marginally closer — otherwise the target flicks off
          // the hole as you move to click it. Only role 'hole' is magnetised (NOT the
          // 'outline' = face centroid every mesh face has, which would swallow edge picks
          // on small faces). Falls back to the plain nearest.
          const nearestSnap = (
            pts: THREE.Vector3[],
            roles: string[],
            e: PointerEvent
          ): { index: number; distPx: number } => {
            const rect = renderer.domElement.getBoundingClientRect()
            const px = e.clientX - rect.left
            const py = e.clientY - rect.top
            let best = { index: -1, distPx: Infinity }
            let hole = { index: -1, distPx: Infinity }
            pts.forEach((p, i) => {
              const v = p.clone().project(camera)
              if (!(v.z >= -1 && v.z <= 1)) return
              const sx = (v.x * 0.5 + 0.5) * rect.width
              const sy = (-v.y * 0.5 + 0.5) * rect.height
              if (!Number.isFinite(sx) || !Number.isFinite(sy)) return
              const d = Math.hypot(sx - px, sy - py)
              if (d < best.distPx) best = { index: i, distPx: d }
              if (roles[i] === 'hole' && d < hole.distPx) hole = { index: i, distPx: d }
            })
            return hole.index >= 0 && hole.distPx <= SNAP_PX.hole ? hole : best
          }

          // ── Resize (push/pull tool) ──
          const startResize = (e: PointerEvent): void => {
            const editName = selectedLinkRef.current ?? editLinkRef.current
            if (!editName || !robotRef.current) return
            const linkObj = robotRef.current.links[editName]
            const geom = readPrimitive(contentRef.current, editName)
            if (!linkObj || !geom) return
            buildNdcFrom(e)
            buildRay.setFromCamera(buildNdc, camera)
            const hit = buildRay.intersectObject(linkObj, true).find((h) => h.face)
            if (!hit || !hit.face || ownerLinkName(hit.object) !== editName) return
            const mesh = hit.object as THREE.Mesh
            const group = mesh.parent
            if (!group) return
            const nWorld = hit.face.normal.clone().transformDirection(mesh.matrixWorld).normalize()
            const q = new THREE.Quaternion()
            linkObj.getWorldQuaternion(q)
            const nLink = nWorld.clone().applyQuaternion(q.invert())
            const face = classifyFace([nLink.x, nLink.y, nLink.z], geom.kind)
            camera.getWorldDirection(camDir)
            drag = {
              link: editName,
              kind: geom.kind,
              face,
              dims0: geom.dims,
              origin0: geom.origin,
              mesh,
              group,
              nWorld,
              plane: new THREE.Plane().setFromNormalAndCoplanarPoint(camDir, hit.point),
              anchor: hit.point.clone(),
              preview: null
            }
            controls.enabled = false
            ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
          }

          // ── Move tool ──
          type Move = {
            link: string
            jointObj: THREE.Object3D
            oldXyz: THREE.Vector3
            parentBasis: number[]
            grab: THREE.Vector3
            anchor: THREE.Vector3
            plane: THREE.Plane
            newXyz: THREE.Vector3
          }
          let move: Move | null = null
          const startMove = (e: PointerEvent): void => {
            const robot = robotRef.current
            if (!robot) return
            buildNdcFrom(e)
            buildRay.setFromCamera(buildNdc, camera)
            const hit = buildRay.intersectObject(robot, true).find((h) => h.face)
            if (!hit || !hit.face) return
            const link = ownerLinkName(hit.object)
            if (!link) return
            setSelectedLink(link)
            const joint = readJoint(contentRef.current, link) // null for the root
            const linkObj = robot.links[link]
            const jointObj = linkObj?.parent
            const geom = readPrimitive(contentRef.current, link) // null for mesh links
            const parentLink = jointObj?.parent
            // A mesh has no primitive geometry → no face snap points, but it can
            // still be moved (grab the hit point). Only the ROOT (no joint) is barred.
            if (!joint || !jointObj || !linkObj || !parentLink) return
            robot.updateMatrixWorld(true)
            const parentBasis = [...new THREE.Matrix3().setFromMatrix4(parentLink.matrixWorld).elements]
            let grab = hit.point.clone()
            if (geom) {
              const { pts } = hitToHandles(hit, link, geom)
              const near = nearestScreen(pts, e)
              if (near.index >= 0) grab = pts[near.index].clone()
            }
            camera.getWorldDirection(camDir)
            move = {
              link,
              jointObj,
              oldXyz: jointObj.position.clone(),
              parentBasis,
              grab,
              anchor: hit.point.clone(),
              plane: new THREE.Plane().setFromNormalAndCoplanarPoint(camDir, hit.point),
              newXyz: jointObj.position.clone()
            }
            controls.enabled = false
            ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
          }

          // ── Grab / IK tool (#410): grab a link + drag; the movable-joint chain from
          // the base to it re-poses (CCD) so the grabbed point follows the cursor. ──
          type Grab = {
            link: string // the grabbed (end-effector) link
            localOffset: THREE.Vector3 // grabbed point in that link's LOCAL frame
            plane: THREE.Plane // camera-facing drag plane
            joints: string[] // participating movable joints, NEAREST-to-effector first
          }
          let grab: Grab | null = null
          // The non-mimic revolute/continuous joints on the chain from `endLink` up to
          // the root, nearest-to-effector first — the joints IK is allowed to turn.
          const ikChainJoints = (endLink: string): string[] => {
            const byChild = new Map(readAllJoints(contentRef.current).map((j) => [j.child, j]))
            const out: string[] = []
            const seen = new Set<string>()
            let cur: string | undefined = endLink
            while (cur && !seen.has(cur)) {
              seen.add(cur)
              const j = byChild.get(cur) // the joint whose child is `cur` (its parent joint)
              if (!j) break // reached a root (no parent joint)
              const m = metaRef.current.find((x) => x.name === j.name)
              if (m && !m.isMimic && (m.type === 'revolute' || m.type === 'continuous')) out.push(j.name)
              cur = j.parent
            }
            return out
          }
          const startGrab = (e: PointerEvent): void => {
            const robot = robotRef.current
            if (!robot) return
            buildNdcFrom(e)
            buildRay.setFromCamera(buildNdc, camera)
            const hit = buildRay.intersectObject(robot, true).find((h) => h.face)
            if (!hit || !hit.face) return
            const link = ownerLinkName(hit.object)
            if (!link || !robot.links[link]) return
            const joints = ikChainJoints(link)
            if (!joints.length) return // the base, or no movable ancestor joint → no-op
            setSelectedLink(link)
            robot.updateMatrixWorld(true)
            camera.getWorldDirection(camDir)
            grab = {
              link,
              localOffset: robot.links[link].worldToLocal(hit.point.clone()),
              plane: new THREE.Plane().setFromNormalAndCoplanarPoint(camDir, hit.point),
              joints
            }
            controls.enabled = false
            ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
          }
          // Solve one drag frame: move the grabbed point toward the cursor's plane target.
          const dragGrab = (e: PointerEvent): void => {
            const robot = robotRef.current
            if (!grab || !robot) return
            buildNdcFrom(e)
            buildRay.setFromCamera(buildNdc, camera)
            const target = new THREE.Vector3()
            if (!buildRay.ray.intersectPlane(grab.plane, target)) return
            robot.updateMatrixWorld(true)
            const eff = robot.links[grab.link].localToWorld(grab.localOffset.clone())
            const p = new THREE.Vector3()
            const ax = new THREE.Vector3()
            const ikJoints: IkJoint[] = grab.joints.map((name) => {
              const j = robot.joints[name]
              j.getWorldPosition(p)
              ax.copy(j.axis).transformDirection(j.matrixWorld).normalize()
              const m = metaRef.current.find((x) => x.name === name)
              const lim = m
                ? effectiveLimit(m, overridesRef.current[name])
                : { lower: -Math.PI, upper: Math.PI }
              return {
                pivot: [p.x, p.y, p.z],
                axis: [ax.x, ax.y, ax.z],
                angle: j.angle,
                lower: lim.lower,
                upper: lim.upper
              }
            })
            const solved = solveCCD(ikJoints, [eff.x, eff.y, eff.z], [target.x, target.y, target.z], {
              iterations: 6
            })
            grab.joints.forEach((name, i) => robot.setJointValue(name, solved[i]))
            robot.updateMatrixWorld(true)
          }
          // Push the grabbed chain's final joint angles into React `values` so the pose
          // sliders reflect the new pose and it's savable via Save Pose. No URDF write.
          const finishGrab = (): void => {
            const robot = robotRef.current
            if (!grab) return
            const joints = grab.joints
            grab = null
            controls.enabled = true
            if (!robot) return
            setValues((v) => {
              const next = { ...v }
              for (const name of joints) {
                const a = robot.joints[name]?.angle
                if (typeof a === 'number') next[name] = a
              }
              return next
            })
          }

          // ── Join tool (#354): click a point on two blocks to connect them ──
          // Markers are a CIRCLE laid flat on the picked face + an X/Y/Z axis triad
          // (Z = the face normal) so the pick reads accurately in 3-D from any angle.
          // Committed pick markers: component 1 (parent) = GREEN, component 2 (child)
          // = BLUE — a filled translucent disc laid on the face + a bright ring, both
          // drawn on top of the geometry (depthTest off) so they're always visible.
          const jointMatParent = new THREE.LineBasicMaterial({ color: 0x34ad4f, depthTest: false })
          const jointMatChild = new THREE.LineBasicMaterial({ color: 0x4ea1ff, depthTest: false })
          const mkDisc = (color: number): THREE.MeshBasicMaterial =>
            new THREE.MeshBasicMaterial({
              color,
              transparent: true,
              opacity: 0.3,
              side: THREE.DoubleSide,
              depthTest: false,
              depthWrite: false
            })
          const jointDiscParent = mkDisc(0x34ad4f)
          const jointDiscChild = mkDisc(0x4ea1ff)
          const axisMatX = new THREE.LineBasicMaterial({ color: 0xff5566, depthTest: false })
          const axisMatY = new THREE.LineBasicMaterial({ color: 0x55dd66, depthTest: false })
          const axisMatZ = new THREE.LineBasicMaterial({ color: 0x5599ff, depthTest: false })
          const circlePts = (r: number): THREE.Vector3[] => {
            const a: THREE.Vector3[] = []
            for (let i = 0; i <= 40; i++) {
              const t = (i / 40) * Math.PI * 2
              a.push(new THREE.Vector3(Math.cos(t) * r, Math.sin(t) * r, 0))
            }
            return a
          }
          let parentMarker: THREE.Group | null = null
          let childMarker: THREE.Group | null = null
          const disposeMarker = (g: THREE.Group | null): void => {
            if (!g) return
            scene.remove(g)
            g.traverse((o) => {
              const l = o as THREE.Line
              // Dispose per-marker line geometries; never the shared disc geometry.
              if (l.geometry && l.geometry !== discGeo) l.geometry.dispose()
            })
          }
          // Fusion-style: fade ONLY the first-picked block (so it's obviously chosen
          // and can't be re-picked as the second). The block's material is usually
          // SHARED across links (e.g. everything uses "steel"), so editing it in place
          // would fade the whole robot — instead we swap in a transparent CLONE for
          // just this link's mesh and restore (+ dispose the clone) on un-dim.
          type DimMat = THREE.Material & { transparent: boolean; opacity: number }
          let dimmed: {
            mesh: THREE.Mesh
            orig: THREE.Material | THREE.Material[]
            clones: THREE.Material[]
          }[] = []
          const dimLink = (link: string | null): void => {
            for (const d of dimmed) {
              d.mesh.material = d.orig
              d.clones.forEach((c) => c.dispose())
            }
            dimmed = []
            const lo = link && robotRef.current?.links[link]
            if (!lo) return
            lo.traverse((o) => {
              const mesh = o as THREE.Mesh
              if (!mesh.isMesh || ownerLinkName(mesh) !== link) return
              const orig = mesh.material
              const mk = (m: THREE.Material): THREE.Material => {
                const c = m.clone() as DimMat
                c.transparent = true
                c.opacity = 0.28
                return c
              }
              const clones = Array.isArray(orig) ? orig.map(mk) : [mk(orig)]
              mesh.material = Array.isArray(orig) ? clones : clones[0]
              dimmed.push({ mesh, orig, clones })
            })
          }
          const clearJointMarkers = (): void => {
            disposeMarker(parentMarker)
            disposeMarker(childMarker)
            parentMarker = null
            childMarker = null
            dimLink(null) // un-fade the first block
            clearHoverMarker() // drop the on-surface hover target
            hoverSnaps = null
            lockedIndex = null // a fresh Join session must not inherit a stale snap-lock
          }
          jointPickApiRef.current = { clear: clearJointMarkers, dim: dimLink }
          const setJointMarker = (world: THREE.Vector3, normal: THREE.Vector3, isChild: boolean): void => {
            disposeMarker(isChild ? childMarker : parentMarker)
            const g = new THREE.Group()
            const r = halfView * 0.11
            const ax = halfView * 0.16
            // A filled translucent disc laid on the face + a bright ring on its rim.
            const disc = new THREE.Mesh(discGeo, isChild ? jointDiscChild : jointDiscParent)
            disc.scale.setScalar(r)
            disc.renderOrder = 998
            disc.raycast = () => {}
            const circle = new THREE.LineLoop(
              new THREE.BufferGeometry().setFromPoints(circlePts(r)),
              isChild ? jointMatChild : jointMatParent
            )
            const line = (dir: THREE.Vector3, mat: THREE.LineBasicMaterial): THREE.Line => {
              const l = new THREE.Line(
                new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), dir.clone().multiplyScalar(ax)]),
                mat
              )
              l.renderOrder = 999
              l.raycast = () => {}
              return l
            }
            circle.renderOrder = 999
            circle.raycast = () => {}
            g.add(
              disc,
              circle,
              line(new THREE.Vector3(1, 0, 0), axisMatX),
              line(new THREE.Vector3(0, 1, 0), axisMatY),
              line(new THREE.Vector3(0, 0, 1), axisMatZ)
            )
            g.position.copy(world)
            // Orient so the marker's +Z (the triad's blue axis + circle normal) points
            // along the picked face normal — the circle then lies flat on the face.
            g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().normalize())
            scene.add(g)
            if (isChild) childMarker = g
            else parentMarker = g
          }
          // Redraw markers for any picks that survived an effect rebuild mid-pick
          // (the state persists in jointPickStateRef; the old scene objects didn't).
          {
            const jp = jointPickStateRef.current
            robotRef.current?.updateMatrixWorld(true)
            const drawFrom = (p: JointPickPt | null, child: boolean): void => {
              const lo = p && robotRef.current?.links[p.link]
              if (!p || !lo) return
              const q = new THREE.Quaternion()
              lo.getWorldQuaternion(q)
              const wn = new THREE.Vector3(p.normal[0], p.normal[1], p.normal[2]).applyQuaternion(q)
              setJointMarker(lo.localToWorld(new THREE.Vector3(p.local[0], p.local[1], p.local[2])), wn, child)
            }
            drawFrom(jp?.parent ?? null, false)
            drawFrom(jp?.child ?? null, true)
          }
          // Detect hole / loop / edge snap centres on the face of a MESH the pointer
          // hit (an STL has no primitive face handles). Cached per mesh+plane — a
          // pass over the triangles is cheap but not per-hover-pixel cheap.
          const holeCache = new Map<string, { pts: THREE.Vector3[]; roles: string[] }>()
          const meshSnapCentres = (hit: THREE.Intersection): { pts: THREE.Vector3[]; roles: string[] } => {
            const mesh = hit.object as THREE.Mesh
            const geo = mesh.geometry as THREE.BufferGeometry
            const posAttr = geo.attributes.position
            if (!hit.face || !posAttr) return { pts: [], roles: [] }
            const nLocal = hit.face.normal.clone().normalize()
            const pLocal = mesh.worldToLocal(hit.point.clone())
            const key = `${mesh.uuid}:${Math.round(nLocal.x * 50)},${Math.round(nLocal.y * 50)},${Math.round(nLocal.z * 50)}:${Math.round(pLocal.dot(nLocal) * 2000)}`
            const cached = holeCache.get(key)
            if (cached) return cached
            const centres = detectSnapCentres(
              posAttr.array as ArrayLike<number>,
              geo.index ? (geo.index.array as ArrayLike<number>) : null,
              { point: [pLocal.x, pLocal.y, pLocal.z], normal: [nLocal.x, nLocal.y, nLocal.z] }
            )
            const result = {
              pts: centres.map((c) => mesh.localToWorld(new THREE.Vector3(c.p[0], c.p[1], c.p[2]))),
              roles: centres.map((c) => c.kind)
            }
            holeCache.set(key, result)
            return result
          }

          // The snap candidates on the surface under a hit: primitive face handles
          // or mesh hole/loop/edge centres, plus the (world) face normal shared by
          // all of them. Used by hover + pick + the SHIFT-lock.
          type Snaps = { link: string; pts: THREE.Vector3[]; roles: string[]; worldNormal: THREE.Vector3 }
          const computeSnaps = (hit: THREE.Intersection): Snaps | null => {
            const link = ownerLinkName(hit.object)
            if (!link || !robotRef.current?.links[link] || !hit.face) return null
            const mesh = hit.object as THREE.Mesh
            const worldNormal = hit.face.normal.clone().transformDirection(mesh.matrixWorld).normalize()
            const geom = readPrimitive(contentRef.current, link)
            const th = geom ? hitToHandles(hit, link, geom) : meshSnapCentres(hit)
            return { link, pts: th.pts, roles: th.roles, worldNormal }
          }
          // The last surface snaps — kept so SHIFT can LOCK them, letting the pick
          // land on a hole centre (empty space, no surface to raycast).
          let hoverSnaps: Snaps | null = null
          // Fusion-style SHIFT snap-lock: the index (into hoverSnaps) frozen while SHIFT
          // is held, so you can arm a snap (e.g. the centre of a holed face), then slide
          // the cursor OVER the hole and click it without the target following the cursor.
          let lockedIndex: number | null = null

          // While picking the CHILD the chosen parent is fixed AND faded — its
          // transparent geometry still hit-tests, so if it sits in front it would steal
          // the ray and you could never click the second block. Exclude the already-
          // picked block (parent during the child step, child during a parent re-pick)
          // so you always select the OTHER one. (A joined child link is a scene-graph
          // descendant, but ownerLinkName resolves each mesh to the link it belongs to.)
          const otherPickedLink = (): string | null => {
            const jr = jointPickRef.current
            return jr.step === 'child' ? jr.parentLink : jr.childLink
          }
          const jointRayHit = (): THREE.Intersection | undefined => {
            const robot = robotRef.current
            if (!robot) return undefined
            const ex = otherPickedLink()
            return buildRay
              .intersectObject(robot, true)
              .find((h) => h.face && ownerLinkName(h.object) !== ex)
          }

          // The hover TARGET drawn on the surface (where the next click will land): a
          // TRANSPARENT BLUE disc laid flat on the face + a blue ring + an X/Y/Z axis
          // triad (Z = face normal), plus a cross-hair over a hole / loop centre.
          const hoverMat = new THREE.LineBasicMaterial({ color: 0x4ea1ff, depthTest: false })
          const hoverDiscMat = new THREE.MeshBasicMaterial({
            color: 0x4ea1ff,
            transparent: true,
            opacity: 0.28,
            side: THREE.DoubleSide,
            depthTest: false,
            depthWrite: false
          })
          let hoverMarker: THREE.Group | null = null
          const clearHoverMarker = (): void => {
            if (!hoverMarker) return
            scene.remove(hoverMarker)
            hoverMarker.traverse((o) => {
              const m = o as THREE.Mesh
              // Dispose the per-marker line geometries; never the shared disc geometry.
              if (m.geometry && m.geometry !== discGeo) m.geometry.dispose()
            })
            hoverMarker = null
          }
          const seg = (a: THREE.Vector3, b: THREE.Vector3, mat: THREE.LineBasicMaterial): THREE.Line => {
            const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), mat)
            l.renderOrder = 1000
            l.raycast = () => {}
            return l
          }
          const setHoverMarker = (world: THREE.Vector3, normal: THREE.Vector3, role: string): void => {
            clearHoverMarker()
            const g = new THREE.Group()
            const r = halfView * 0.09
            const ax = halfView * 0.14
            const disc = new THREE.Mesh(discGeo, hoverDiscMat)
            disc.scale.setScalar(r)
            disc.renderOrder = 999
            disc.raycast = () => {}
            const circle = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(circlePts(r)), hoverMat)
            circle.renderOrder = 1000
            circle.raycast = () => {}
            g.add(
              disc,
              circle,
              seg(new THREE.Vector3(), new THREE.Vector3(ax, 0, 0), axisMatX),
              seg(new THREE.Vector3(), new THREE.Vector3(0, ax, 0), axisMatY),
              seg(new THREE.Vector3(), new THREE.Vector3(0, 0, ax), axisMatZ)
            )
            if (role === 'hole' || role === 'outline') {
              // Cross-hair through a hole / loop centre (in the face plane).
              const c = r * 1.5
              g.add(
                seg(new THREE.Vector3(-c, 0, 0), new THREE.Vector3(c, 0, 0), hoverMat),
                seg(new THREE.Vector3(0, -c, 0), new THREE.Vector3(0, c, 0), hoverMat)
              )
            }
            g.position.copy(world)
            g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().normalize())
            scene.add(g)
            hoverMarker = g
          }

          const pickJointPoint = (e: PointerEvent): void => {
            const robot = robotRef.current
            if (!robot) return
            const jr = jointPickRef.current
            let link: string | null = null
            let world: THREE.Vector3 | null = null
            let worldNormal: THREE.Vector3 | null = null
            let role = 'point'
            // WYSIWYG: a click lands on exactly the snap the hover cross-hair is
            // showing (its nearest snap on the last-hovered surface). This makes the
            // on-surface target — including a hole centre drawn over empty space —
            // directly clickable, with no pixel-threshold gap. Holding SHIFT commits the
            // LOCKED snap regardless of where the cursor now sits (e.g. over the hole).
            if (hoverSnaps && hoverSnaps.pts.length && robot.links[hoverSnaps.link]) {
              const locked =
                e.shiftKey && lockedIndex !== null && lockedIndex < hoverSnaps.pts.length
                  ? lockedIndex
                  : nearestSnap(hoverSnaps.pts, hoverSnaps.roles, e).index
              if (locked >= 0) {
                link = hoverSnaps.link
                world = hoverSnaps.pts[locked].clone()
                worldNormal = hoverSnaps.worldNormal.clone()
                role = hoverSnaps.roles[locked]
              }
            }
            if (!world) {
              // Fallback (no live hover target, e.g. a mesh face with no detectable
              // snaps): raycast the surface under the cursor and snap if close.
              buildNdcFrom(e)
              buildRay.setFromCamera(buildNdc, camera)
              const hit = jointRayHit() // never the already-picked block
              if (!hit) return
              link = ownerLinkName(hit.object)
              if (!link || !robot.links[link]) return
              const mesh = hit.object as THREE.Mesh
              worldNormal = hit.face!.normal.clone().transformDirection(mesh.matrixWorld).normalize()
              world = hit.point.clone()
              const geom = readPrimitive(contentRef.current, link)
              const th = geom ? hitToHandles(hit, link, geom) : meshSnapCentres(hit)
              const near = nearestSnap(th.pts, th.roles, e)
              if (near.index >= 0 && near.distPx < catchPx(th.roles[near.index], !geom)) {
                world = th.pts[near.index].clone()
                role = th.roles[near.index]
              }
            }
            if (!link || !world || !worldNormal) return
            // Reject a same-block pick (marker/state desync).
            if (jr.step === 'child' && jr.parentLink === link) return
            if (jr.step === 'parent' && jr.childLink === link) return
            const linkObj = robot.links[link]
            const local = linkObj.worldToLocal(world.clone())
            const lq = new THREE.Quaternion()
            linkObj.getWorldQuaternion(lq)
            const linkNormal = worldNormal.clone().applyQuaternion(lq.invert()) // face normal, link-local
            setJointMarker(world, worldNormal, jr.step === 'child')
            clearHoverMarker()
            setBuildDim(null) // the pick consumed the armed target — drop its "snap ✓" label (#411)
            // Drop the consumed snaps so the NEXT pick (e.g. the child after the
            // parent) can't reuse this surface's stale snap without a fresh hover —
            // absent a new hover it falls through to the raycast under the cursor.
            hoverSnaps = null
            lockedIndex = null
            onJointPickRef.current?.(
              link,
              [local.x, local.y, local.z],
              [linkNormal.x, linkNormal.y, linkNormal.z],
              role
            )
          }

          const onBuildDown = (e: PointerEvent): void => {
            bDownX = e.clientX
            bDownY = e.clientY
            if (jointPickRef.current.active) return // pick mode owns clicks (no move/resize)
            if (!buildActive() || !robotRef.current) return
            // The Grab/IK tool only POSES (live joint values), so it needs a loaded robot
            // but NOT a saved project file — unlike the geometry-editing tools below.
            if (buildToolRef.current === 'ik') {
              startGrab(e)
              return
            }
            if (!canEditRef.current) return
            if (buildToolRef.current === 'pushpull') startResize(e)
            else if (buildToolRef.current === 'move') startMove(e)
          }

          const onBuildMove = (e: PointerEvent): void => {
            if (grab) {
              dragGrab(e)
              return
            }
            if (drag) {
              buildNdcFrom(e)
              buildRay.setFromCamera(buildNdc, camera)
              const p = new THREE.Vector3()
              if (!buildRay.ray.intersectPlane(drag.plane, p)) return
              const delta = p.sub(drag.anchor).dot(drag.nWorld)
              const res = resizeFromDrag(drag.dims0, drag.origin0, drag.face, delta, {
                step: e.shiftKey ? 0.001 : 0.005
              })
              applyPreview(drag.kind, drag.mesh, drag.group, res.dims, res.origin)
              drag.preview = res
              const rect = mount.getBoundingClientRect()
              setBuildDim({ x: e.clientX - rect.left + 14, y: e.clientY - rect.top + 14, text: dimText(drag.kind, drag.face, res.dims) })
              return
            }
            if (!move || !robotRef.current) return
            buildNdcFrom(e)
            buildRay.setFromCamera(buildNdc, camera)
            const p = new THREE.Vector3()
            if (!buildRay.ray.intersectPlane(move.plane, p)) return
            const freeDelta = p.clone().sub(move.anchor)
            const movedGrab = move.grab.clone().add(freeDelta)
            // Snap the moved grab point to a handle on ANOTHER block under the cursor.
            let snapWorld: THREE.Vector3 | null = null
            let snapRole: string | null = null
            let handles: THREE.Vector3[] = []
            let handleRoles: string[] = []
            let handleNormal: THREE.Vector3 | undefined
            let activeIdx = -1
            const tHit = buildRay
              .intersectObject(robotRef.current, true)
              .filter((h) => h.face && ownerLinkName(h.object) !== move!.link)
              .find((h) => h.face)
            if (tHit) {
              handleNormal = tHit
                .face!.normal.clone()
                .transformDirection((tHit.object as THREE.Mesh).matrixWorld)
                .normalize()
              const tLink = ownerLinkName(tHit.object)!
              const tGeom = readPrimitive(contentRef.current, tLink)
              if (tGeom) {
                const th = hitToHandles(tHit, tLink, tGeom)
                handles = th.pts
                handleRoles = th.roles
                const near = nearestScreen(handles, e)
                const gp = movedGrab.clone().project(camera)
                const hp = near.index >= 0 ? handles[near.index].clone().project(camera) : gp
                const rect = renderer.domElement.getBoundingClientRect()
                const dpx = Math.hypot(((hp.x - gp.x) * rect.width) / 2, ((hp.y - gp.y) * rect.height) / 2)
                if (near.index >= 0 && dpx < SNAP_PX.move) {
                  snapWorld = handles[near.index]
                  snapRole = th.roles[near.index]
                  activeIdx = near.index
                }
              }
            }
            const worldDelta = snapWorld ? snapWorld.clone().sub(move.grab) : freeDelta
            const nx = movedJointOrigin(
              [move.oldXyz.x, move.oldXyz.y, move.oldXyz.z],
              [worldDelta.x, worldDelta.y, worldDelta.z] as Vec3,
              move.parentBasis,
              snapWorld ? {} : { step: e.shiftKey ? 0.001 : 0.005 }
            )
            move.newXyz.set(nx[0], nx[1], nx[2])
            move.jointObj.position.copy(move.newXyz)
            showHandles(handles, handleRoles, activeIdx, handleNormal)
            const rect = mount.getBoundingClientRect()
            setBuildDim({
              x: e.clientX - rect.left + 14,
              y: e.clientY - rect.top + 14,
              text: snapRole
                ? `snap ✓ ${snapRoleLabel(snapRole)}`
                : `${mmv(nx[0])} · ${mmv(nx[1])} · ${mmv(nx[2])} mm`
            })
          }

          const onBuildUp = (e: PointerEvent): void => {
            // Join tool: a near-stationary click picks a point (drags orbit). Skip
            // if measuring (that tool consumes the click via its own handler).
            if (jointPickRef.current.active) {
              if (!measureActiveRef.current && Math.hypot(e.clientX - bDownX, e.clientY - bDownY) <= 4) {
                pickJointPoint(e)
              }
              return
            }
            if (grab) {
              finishGrab() // write the posed joint angles into `values`; restore controls
              return
            }
            if (drag) {
              const d = drag
              drag = null
              controls.enabled = true
              setBuildDim(null)
              if (d.preview) {
                let next = setPrimitiveSize(contentRef.current, d.link, d.preview.dims)
                next = setVisualOrigin(next, d.link, d.preview.origin)
                commitUrdfRef.current?.(next)
              }
              return
            }
            if (move) {
              const mv = move
              move = null
              controls.enabled = true
              setBuildDim(null)
              clearHandles()
              if (!mv.newXyz.equals(mv.oldXyz)) {
                commitUrdfRef.current?.(
                  setJointOrigin(contentRef.current, mv.link, [mv.newXyz.x, mv.newXyz.y, mv.newXyz.z])
                )
              }
              return
            }
            // Select tool / plain click → pick the block under the cursor.
            if (!buildActive() || !robotRef.current) return
            if (Math.hypot(e.clientX - bDownX, e.clientY - bDownY) > 4) return
            buildNdcFrom(e)
            buildRay.setFromCamera(buildNdc, camera)
            const name = ownerLinkName(buildRay.intersectObject(robotRef.current, true)[0]?.object ?? null)
            if (name) setSelectedLink(name)
          }

          // Hover: reveal a face's snap points. The Move tool shows primitive face
          // handles; the Join picker shows all snaps + a TARGET marker on the surface
          // (circle + axis, cross-hair over holes), and holding SHIFT LOCKS the snaps
          // so you can slide onto a hole centre (empty space) and click it.
          const onBuildHover = (e: PointerEvent): void => {
            if (drag || move || grab) return
            const jointActive = jointPickRef.current.active
            const wantHandles = buildToolRef.current === 'move' || jointActive
            if (!buildActive() || !wantHandles || !robotRef.current) {
              clearHandles()
              clearHoverMarker()
              hoverSnaps = null
              lockedIndex = null
              setBuildDim(null)
              return
            }
            buildNdcFrom(e)
            buildRay.setFromCamera(buildNdc, camera)

            if (jointActive) {
              const shift = e.shiftKey
              // SHIFT snap-LOCK (Fusion-style): once a snap is armed, holding SHIFT
              // freezes THAT point — the surface + snaps aren't recomputed, so you can
              // slide the cursor over the hole (empty space) and click the locked centre.
              if (shift && lockedIndex !== null && hoverSnaps && lockedIndex < hoverSnaps.pts.length) {
                const role = hoverSnaps.roles[lockedIndex]
                showHandles(hoverSnaps.pts, hoverSnaps.roles, lockedIndex, hoverSnaps.worldNormal)
                setHoverMarker(hoverSnaps.pts[lockedIndex], hoverSnaps.worldNormal, role)
                const rect = mount.getBoundingClientRect()
                setBuildDim({
                  x: e.clientX - rect.left + 14,
                  y: e.clientY - rect.top + 14,
                  text: (
                    <>
                      <LockIcon size={11} /> locked {snapRoleLabel(role)}
                    </>
                  )
                })
                return
              }
              if (!shift) lockedIndex = null // released → the target follows the cursor again

              const hit = jointRayHit() // never the already-picked block
              if (hit) {
                const s = computeSnaps(hit)
                if (s) hoverSnaps = s
              } else if (hoverSnaps && hoverSnaps.pts.length) {
                // Over empty space (e.g. inside a hole). Keep the last surface's snaps
                // while one is still near the cursor so the target stays put — and stays
                // clickable — as you move onto it. SHIFT keeps them at any distance.
                const near = nearestScreen(hoverSnaps.pts, e)
                if (!shift && (near.index < 0 || near.distPx > SNAP_PX.keepAlive)) hoverSnaps = null
              } else {
                hoverSnaps = null
              }
              if (!hoverSnaps || !hoverSnaps.pts.length) {
                clearHandles()
                clearHoverMarker()
                setBuildDim(null)
                lockedIndex = null
                return
              }
              const near = nearestSnap(hoverSnaps.pts, hoverSnaps.roles, e)
              // Pressing SHIFT with a candidate armed locks it; from the next move the
              // branch above freezes it.
              if (shift && near.index >= 0) lockedIndex = near.index
              const armed =
                lockedIndex !== null && lockedIndex < hoverSnaps.pts.length ? lockedIndex : near.index
              showHandles(hoverSnaps.pts, hoverSnaps.roles, armed, hoverSnaps.worldNormal)
              if (armed >= 0) {
                const role = hoverSnaps.roles[armed]
                setHoverMarker(hoverSnaps.pts[armed], hoverSnaps.worldNormal, role)
                // Name the armed target BEFORE the click (WYSIWYG); SHIFT shows it's locked.
                const rect = mount.getBoundingClientRect()
                setBuildDim({
                  x: e.clientX - rect.left + 14,
                  y: e.clientY - rect.top + 14,
                  text:
                    lockedIndex !== null ? (
                      <>
                        <LockIcon size={11} /> locked {snapRoleLabel(role)}
                      </>
                    ) : (
                      `snap ✓ ${snapRoleLabel(role)}`
                    )
                })
              } else {
                clearHoverMarker()
                setBuildDim(null)
              }
              return
            }

            setBuildDim(null) // move-tool hover shows no snap-role label
            // Move tool: primitive face handles only.
            const hit = buildRay.intersectObject(robotRef.current, true).find((h) => h.face)
            const link = hit ? ownerLinkName(hit.object) : null
            const geom = link ? readPrimitive(contentRef.current, link) : null
            if (!hit || !link || !geom) {
              clearHandles()
              return
            }
            const th = hitToHandles(hit, link, geom)
            const near = nearestScreen(th.pts, e)
            const nW = hit.face!.normal
              .clone()
              .transformDirection((hit.object as THREE.Mesh).matrixWorld)
              .normalize()
            showHandles(th.pts, th.roles, near.distPx < SNAP_PX.move ? near.index : -1, nW)
          }

          // A cancelled/interrupted drag must never strand OrbitControls disabled
          // or leave a half-applied preview.
          const onBuildCancel = (): void => {
            controls.enabled = true
            setBuildDim(null)
            clearHandles()
            if (grab) finishGrab() // keep the live pose; sync it into `values` + restore controls
            if (drag) {
              applyPreview(drag.kind, drag.mesh, drag.group, drag.dims0, drag.origin0)
              drag = null
            }
            if (move) {
              move.jointObj.position.copy(move.oldXyz)
              move = null
            }
          }
          renderer.domElement.addEventListener('pointerdown', onDown)
          renderer.domElement.addEventListener('pointerup', onUp)
          renderer.domElement.addEventListener('pointerdown', onBuildDown)
          renderer.domElement.addEventListener('pointermove', onBuildMove)
          const onHoverLeave = (): void => {
            clearHandles()
            clearHoverMarker()
            setBuildDim(null) // don't strand an armed "snap ✓ …" label off-canvas (#411)
          }
          renderer.domElement.addEventListener('pointermove', onBuildHover)
          renderer.domElement.addEventListener('pointerup', onBuildUp)
          renderer.domElement.addEventListener('pointercancel', onBuildCancel)
          renderer.domElement.addEventListener('lostpointercapture', onBuildCancel)
          renderer.domElement.addEventListener('pointerleave', onHoverLeave)
          // Releasing SHIFT drops the snap-lock at once — keyup fires no pointermove, so
          // without this the frozen "🔒 locked" marker would linger (and a click with no
          // intervening move would commit the nearest snap, not the shown one) (#411).
          const onPickKeyUp = (ev: KeyboardEvent): void => {
            if (ev.key !== 'Shift' || lockedIndex === null) return
            lockedIndex = null
            clearHandles()
            clearHoverMarker()
            setBuildDim(null)
          }
          window.addEventListener('keyup', onPickKeyUp)
          teardownPose = () => {
            renderer.domElement.removeEventListener('pointerdown', onDown)
            renderer.domElement.removeEventListener('pointerup', onUp)
            renderer.domElement.removeEventListener('pointerdown', onBuildDown)
            renderer.domElement.removeEventListener('pointermove', onBuildMove)
            renderer.domElement.removeEventListener('pointermove', onBuildHover)
            renderer.domElement.removeEventListener('pointerup', onBuildUp)
            renderer.domElement.removeEventListener('pointercancel', onBuildCancel)
            renderer.domElement.removeEventListener('lostpointercapture', onBuildCancel)
            renderer.domElement.removeEventListener('pointerleave', onHoverLeave)
            window.removeEventListener('keyup', onPickKeyUp)
            // Remove everything that references the shared discGeo / materials FIRST,
            // then dispose those shared resources.
            clearMeasure()
            clearHighlight()
            clearJointMarkers() // disposes the pick + hover markers
            scene.remove(snapGroup)
            discGeo.dispose()
            squareGeo.dispose()
            diamondGeo.dispose()
            ringGeo.dispose()
            handleMat.dispose()
            handleMatOn.dispose()
            ringMat.dispose()
            ringMatOn.dispose()
            markerMat.dispose()
            lineMat.dispose()
            jointMatParent.dispose()
            jointMatChild.dispose()
            jointDiscParent.dispose()
            jointDiscChild.dispose()
            axisMatX.dispose()
            axisMatY.dispose()
            axisMatZ.dispose()
            hoverMat.dispose()
            hoverDiscMat.dispose()
            measureApiRef.current = null
            highlightApiRef.current = null
            jointPickApiRef.current = null
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
      stepAnim()
      controls.update()
      boneModeApi.update() // live skeleton overlay (#536) — follows every joint drive
      ikGizmoApi.update() // interactive IK goal gizmo (#540) — composes with Bone Mode
      const cs = comOverlayApi.update() // CoM + support polygon (#558)
      if (comModeRef.current) {
        // Push to the HUD only when the readout actually changes — no per-frame renders.
        const key = cs ? `${cs.state}:${cs.marginMm}:${Math.round(cs.massKg * 1000)}` : ''
        if (key !== comStatusRef.current) {
          comStatusRef.current = key
          setComStatus(cs)
        }
      }
      renderer.render(scene, camera)
      if (viewCube) {
        viewCube.sync(camera.quaternion)
        viewCube.render()
      }
      raf = requestAnimationFrame(tick)
    }
    tick()

    return () => {
      disposed = true
      // Snapshot the camera so the next rebuild (after a build edit) restores it
      // instead of re-framing (#315a). Cleared by a NEW file via framedKeyRef.
      cameraStateRef.current = {
        pos: camera.position.clone(),
        target: controls.target.clone(),
        zoom: camera.zoom,
        halfView
      }
      robotRef.current = null
      teardownPose()
      cancelAnimationFrame(raf)
      ro.disconnect()
      themeObserver.disconnect()
      controls.removeEventListener('change', onControlsChange)
      controls.removeEventListener('start', onControlsStart)
      stopExplodeAnim()
      zoomApiRef.current = null
      boneApiRef.current = null
      boneModeApi.dispose()
      comOverlayApi.dispose()
      ikApiRef.current = null
      ikGizmoApi.dispose()
      if (viewCube) {
        viewCube.dom.remove()
        viewCube.dispose()
      }
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
  }, [content, effectiveBase, isEmpty, poseUI, compact, currentFolder, activeFile?.id, projection])

  const showPanel = poseUI && !error && !isEmpty
  const showTimeline = poseUI && !error && !isEmpty && movableNames.length > 0

  return (
    <div className={`robotview${compact ? ' robotview--compact' : ''}${poseUI ? ' robotview--pose' : ''}`}>
      <div className="robotview__main">
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
        {!error && (meshNote || externalMeshRefs.length > 0 || (boneMode && dupJointNames.length > 0)) && (
          <div className="robotview__notes">
            {meshNote && (
              <div className="robotview__note" role="status">
                {meshNote}
              </div>
            )}
            {boneMode && dupJointNames.length > 0 && (
              <div className="robotview__note" role="alert">
                Bone Mode needs every joint to have its own name, but{' '}
                {dupJointNames.map((n) => `“${n}”`).join(', ')}{' '}
                {dupJointNames.length === 1 ? 'is' : 'are'} used more than once — rename the
                duplicate joint{dupJointNames.length === 1 ? '' : 's'} in the Build panel.
              </div>
            )}
            {externalMeshRefs.length > 0 && (
              <div className="robotview__note robotview__note--offer" role="status">
                <span>
                  {externalMeshRefs.length} mesh{externalMeshRefs.length === 1 ? '' : 'es'} live
                  outside this project and will go missing if it&apos;s moved.
                </span>
                <button
                  type="button"
                  className="robotview__note-action"
                  onClick={handleCopyExternalMeshes}
                  disabled={copyingMeshes}
                >
                  {copyingMeshes
                    ? 'Copying…'
                    : `Copy ${externalMeshRefs.length} mesh${externalMeshRefs.length === 1 ? '' : 'es'} into project`}
                </button>
              </div>
            )}
          </div>
        )}
        {!isEmpty && !error && compact && (
          <button
            type="button"
            className="robotview__minihome"
            onClick={() => zoomApiRef.current?.home()}
            title="Home — reset to the fitted default view"
            aria-label="Home view"
          >
            <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
              <path
                d="M2 7.5L8 2.5l6 5M3.5 6.6V13h9V6.6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}
        {!isEmpty && !error && compact && dockPoses.length > 0 && (
          // Saved-pose preview dropdown (#409). Controlled to "" so it resets to the
          // placeholder after a pick — re-selecting the same pose re-applies it.
          <select
            className="robotview__minipose"
            value=""
            onChange={(e) => {
              const p = dockPoses.find((x) => x.name === e.target.value)
              if (p) handleRecallPose(p)
            }}
            title="Preview a saved pose"
            aria-label="Preview a saved pose"
          >
            <option value="" disabled>
              Pose…
            </option>
            {dockPoses.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        {!isEmpty && !error && !compact && (
          <div className="robotview__navzone">
            <button
              type="button"
              className="robotview__home"
              onClick={() => zoomApiRef.current?.home()}
              title="Home — default view"
              aria-label="Home view"
            >
              <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                <path d="M2 7.5L8 2.5l6 5M3.5 6.6V13h9V6.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
              </svg>
            </button>
            <div
              className="robotview__viewcube"
              ref={cubeMountRef}
              title="Click a face / edge / corner to snap · drag to orbit"
            />
            <select
              className="robotview__proj"
              value={projection}
              onChange={(e) => {
                refitNextRef.current = true // re-frame with the new camera type
                setProjection(e.target.value as 'ortho' | 'persp')
              }}
              title="Camera projection"
              aria-label="Camera projection"
            >
              <option value="ortho">Orthographic</option>
              <option value="persp">Perspective</option>
            </select>
          </div>
        )}
        {!isEmpty && !error && !compact && (
          <div className="robotview__zoom" role="toolbar" aria-label="Zoom controls">
            <button
              type="button"
              className="robotview__zbtn"
              onClick={() => zoomApiRef.current?.out()}
              title="Zoom out"
              aria-label="Zoom out"
            >
              −
            </button>
            <button
              type="button"
              className="robotview__zbtn robotview__zbtn--pct"
              onDoubleClick={() => zoomApiRef.current?.toggle()}
              title="Double-click: 100% ↔ zoom to fit"
              aria-label={`Zoom ${zoomPct}% — double-click to toggle 100% / fit`}
            >
              {zoomPct}%
            </button>
            <button
              type="button"
              className="robotview__zbtn"
              onClick={() => zoomApiRef.current?.in()}
              title="Zoom in"
              aria-label="Zoom in"
            >
              +
            </button>
            <span className="robotview__zsep" aria-hidden="true" />
            <button
              type="button"
              className="robotview__zbtn"
              onClick={() => zoomApiRef.current?.fit()}
              title="Zoom to fit"
              aria-label="Zoom to fit"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <span className="robotview__zsep" aria-hidden="true" />
            {/* Exploded view (#499): separation slider + eased animation + video. */}
            <button
              type="button"
              className={`robotview__zbtn${explodeOpen ? ' is-active' : ''}`}
              onClick={() =>
                setExplodeOpen((v) => {
                  if (v) zoomApiRef.current?.setExplode(0) // closing re-assembles
                  return !v
                })
              }
              title="Exploded view"
              aria-label="Exploded view"
              aria-pressed={explodeOpen}
            >
              <ExplodeIcon />
            </button>
            {explodeOpen && (
              <div className="robotview__explode" role="group" aria-label="Exploded view controls">
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={explodeF}
                  disabled={explodeBusy}
                  onChange={(e) => {
                    const f = Number(e.target.value)
                    setExplodeF(f)
                    zoomApiRef.current?.setExplode(f)
                  }}
                  onPointerUp={() => zoomApiRef.current?.fit()}
                  aria-label="Explosion separation"
                  title="Separation"
                />
                <label className="robotview__explode-orbit" title="Orbit the camera during the animation">
                  <input
                    type="checkbox"
                    checked={explodeOrbit}
                    disabled={explodeBusy}
                    onChange={(e) => setExplodeOrbit(e.target.checked)}
                  />
                  orbit
                </label>
                <button
                  type="button"
                  className="robotview__zbtn"
                  disabled={explodeBusy}
                  onClick={() => {
                    setExplodeBusy(true)
                    zoomApiRef.current?.animateExplode(explodeF || 0.6, explodeOrbit, () => setExplodeBusy(false))
                  }}
                  title="Animate the explosion (eased, out and back)"
                  aria-label="Animate explosion"
                >
                  ▶
                </button>
                <button
                  type="button"
                  className="robotview__zbtn"
                  disabled={explodeBusy}
                  onClick={() => {
                    setExplodeBusy(true)
                    void zoomApiRef.current
                      ?.recordExplode(explodeF || 0.6, explodeOrbit)
                      .then((ok) => {
                        setExplodeBusy(false)
                        setSavingLabel(ok ? 'explosion video saved' : "couldn't record a video here")
                      })
                  }}
                  title="Save the explosion animation as a video (mp4/webm)"
                  aria-label="Save explosion video"
                >
                  <ClapperIcon />
                </button>
              </div>
            )}
            <span className="robotview__zsep" aria-hidden="true" />
            {/* Bone Mode (#536): ghost mesh + skeleton/compass overlay. */}
            <button
              type="button"
              className={`robotview__zbtn${boneMode ? ' is-active' : ''}`}
              onClick={() => setBoneMode((v) => !v)}
              title="Bone Mode — see the skeleton: bones, lengths and joint compasses"
              aria-label="Bone Mode"
              aria-pressed={boneMode}
            >
              <BoneIcon />
            </button>
            {/* CoM + support-polygon overlay (#558): balance point + stability. */}
            <button
              type="button"
              className={`robotview__zbtn${comMode ? ' is-active' : ''}`}
              onClick={() => setComMode((v) => !v)}
              title="Balance — centre of mass, ground projection and support polygon"
              aria-label="Centre of mass overlay"
              aria-pressed={comMode}
            >
              <BalanceIcon />
            </button>
            {/* Interactive IK goal gizmo (#540): drag a goal, the chain follows. */}
            <button
              type="button"
              className={`robotview__zbtn${ikGoal ? ' is-active' : ''}`}
              disabled={
                !jointMeta.some((m) => !m.isMimic && (m.type === 'revolute' || m.type === 'continuous'))
              }
              onClick={() => setIkGoal((v) => !v)}
              title="IK goal — pick a part, then drag its goal and the chain solves to reach it"
              aria-label="Interactive IK goal"
              aria-pressed={ikGoal}
            >
              <TargetIcon />
            </button>
            {ikGoal && (
              <button
                type="button"
                className="robotview__zbtn"
                disabled={!ikGoalChain(selectedLink)}
                onClick={() => void handleCaptureIkPose()}
                title="Capture Pose — save the current IK-solved position as a Motion Studio pose"
                aria-label="Capture IK pose"
              >
                <CameraIcon />
              </button>
            )}
          </div>
        )}
        {/* The build toolbar stays available even when the hierarchy panel is
            hidden (#…) — its tools (add primitive/joint, measure, undo/redo) act on
            the viewport, not the tree. */}
        {showPanel && (
          <RobotToolbar
            tool={buildTool}
            onSetTool={onSetTool}
            canEdit={canEdit}
            canPose={jointMeta.some(
              (m) => !m.isMimic && (m.type === 'revolute' || m.type === 'continuous')
            )}
            onAdd={handleAddPrimitive}
            measureActive={measureActive}
            onToggleMeasure={() => setMeasureActive((a) => !a)}
            canUndo={histCanUndo(histRef.current)}
            canRedo={histCanRedo(histRef.current)}
            onUndo={undoUrdf}
            onRedo={redoUrdf}
            onAddJoint={handleAddJoint}
          />
        )}
        {showPanel && (
          <RobotBuildPanel
            open={buildOpen}
            pinned={buildPinned}
            onSetOpen={setBuildOpen}
            onSetPinned={setBuildPinnedPersist}
            assembly={assembly}
            joints={joints}
            servos={bindings}
            bindableServos={servoList}
            jointOptions={movableNames}
            onBindServo={handleBindServo}
            poses={poses}
            selected={selectedLink}
            onSelect={(link) => {
              setSelectedLink(link)
              if (link) zoomApiRef.current?.focusLink(link) // hierarchy click zooms to fit
            }}
            active={dialogCtx}
            onEdit={handleOpenProps}
            onOpenJoint={handleOpenJoint}
            onRenameJoint={handleRenameJoint}
            onOpenServo={handleOpenServo}
            onNewServo={handleNewServo}
            onOpenPose={handleOpenPose}
            onNewPose={handleNewPose}
            rootLink={effectiveBaseLink}
            onMakeBase={handleMakeBase}
            onRename={handleRenameLink}
            onDelete={handleDeleteLink}
            onImportStl={() => void handleImportStl()}
            canImport={!!canImport}
            onExportUrdf={() => void handleExportUrdf()}
            canExport={canExport}
            importing={importing}
            canEdit={canEdit}
            onOpenRobot={() => void handleOpenRobotFile()}
            massSummary={massSummary}
          />
        )}
        {showPanel && dialogCtx && (
          <RobotPropertiesDialog
            key={`${dialogCtx.kind}:${
              dialogCtx.kind === 'link'
                ? dialogCtx.link
                : dialogCtx.kind === 'joint'
                  ? dialogCtx.joint
                  : dialogCtx.kind === 'servo'
                    ? dialogCtx.pin
                    : dialogCtx.kind === 'pose'
                      ? dialogCtx.name
                      : 'addjoint'
            }`}
            context={dialogCtx}
            geom={editGeom}
            joint={editJoint}
            jointNames={allJointNames}
            onSetSize={handleSetSize}
            massEditor={massEditor}
            contactsEditor={contactsEditor}
            linkColor={editLinkColor}
            colorable={editColorable}
            usedColors={usedLinkColors}
            onSetColor={handleSetColor}
            onSetJoint={handleSetJoint}
            onRenameJoint={handleRenameJoint}
            onSetJointOrigin={handleSetJointOrigin}
            onRollJoint={setJointRoll}
            jointRoll={editJoint ? jointRollRef.current[editJoint.name] ?? 0 : 0}
            parentOptions={parentOptions}
            currentParent={editJoint?.parent ?? null}
            isBase={editLink === effectiveBaseLink}
            onSetParent={handleReparent}
            onDeleteJoint={handleDeleteJoint}
            servo={dialogCtx.kind === 'servo' ? bindings.find((b) => b.pin === dialogCtx.pin) ?? null : null}
            movableJoints={movableNames}
            onSetServo={handleUpdateBinding}
            onDeleteServo={handleDeleteBinding}
            pose={dialogCtx.kind === 'pose' ? poses.find((p) => p.name === dialogCtx.name) ?? null : null}
            poseNames={poses.map((p) => p.name)}
            onRecallPose={handleRecallPose}
            onRenamePose={handleRenamePose}
            onDeletePose={handleDeletePose}
            onDuplicatePose={handleDuplicatePose}
            poseLive={poseLive}
            jointMeta={jointMeta}
            values={values}
            overrides={overrides}
            onJointChange={handleJointChange}
            onSavePose={handleSavePose}
            onResetPose={handleResetPose}
            jointPick={
              jointPick && {
                step: jointPick.step,
                parent: jointPick.parent && {
                  link: jointPick.parent.link,
                  role: jointPick.parent.role
                },
                child: jointPick.child && {
                  link: jointPick.child.link,
                  role: jointPick.child.role
                }
              }
            }
            onRepick={handleRepick}
            onSwapPicks={handleSwapPicks}
            onConnectPicked={handleConnectPicked}
            onPreview={handleMatePreview}
            onOk={handlePropsOk}
            onCancel={handlePropsCancel}
          />
        )}
        {buildDim && (
          <div className="robotbuild__dim" style={{ left: buildDim.x, top: buildDim.y }}>
            {buildDim.text}
          </div>
        )}
        {/* Floating status pills (formerly hosted in the retired pose sidebar): the
            save state, and the measure tool's live readout. */}
        {showPanel &&
          (savingLabel || (measureActive && measureDist != null) || (comMode && comStatus)) && (
            <div className="robotview__hud-status">
              {measureActive && measureDist != null && (
                <span className="robotview__hud-pill">
                  <RulerIcon size={13} /> {Math.round(measureDist)} mm
                </span>
              )}
              {comMode && comStatus && (
                <span className={`robotview__hud-pill robotview__hud-com robotview__hud-com--${comStatus.state}`}>
                  <BalanceIcon size={13} />{' '}
                  {comStatus.state === 'none'
                    ? `${Math.round(comStatus.massKg * 1000)} g · tag feet for stability`
                    : `${Math.round(comStatus.massKg * 1000)} g · ${comStatus.state} · ${comStatus.marginMm} mm`}
                </span>
              )}
              {savingLabel && <span className="robotview__hud-pill">{savingLabel}</span>}
            </div>
          )}
      </div>
      </div>
      {showTimeline && (
        <RobotMotionDock
          tabs={[
            {
              id: 'keyframes',
              label: 'Keyframes',
              badge: timeline.tracks.some((t) => t.keys.length > 0),
              content: (
                <RobotTimeline
                  timeline={timeline}
                  movableJoints={movableNames}
                  stabilityStrip={stabilityStrip}
                  playhead={playhead}
                  playing={playing}
                  selected={selectedKey}
                  poses={poses}
                  canExport={bindings.length > 0}
                  canMirror={mirrorPairs.length > 0}
                  onPlayPause={handlePlayPause}
                  onStop={() => seek(0)}
                  onToggleLoop={() =>
                    commitTimeline({ ...timelineRef.current, loop: !timelineRef.current.loop })
                  }
                  onScrub={seek}
                  onSetDuration={(d) =>
                    commitTimeline({ ...timelineRef.current, duration: Math.max(0.1, d) })
                  }
                  onSetEasing={(e: MotionEasing) => commitTimeline({ ...timelineRef.current, easing: e })}
                  onSetFps={(f) =>
                    commitTimeline({ ...timelineRef.current, fps: Math.max(1, Math.min(60, Math.round(f))) })
                  }
                  onCapture={handleCapture}
                  onImportPose={handleImportPose}
                  onMirror={handleMirror}
                  mirrorPairs={mirrorPairs}
                  onToggleInvert={handleToggleInvert}
                  onDuplicate={handleDuplicate}
                  onExport={handleExport}
                  onSelectKey={handleSelectKey}
                  onMoveKey={handleMoveKey}
                  onDeleteKey={handleDeleteKey}
                  onAddKey={handleAddKey}
                />
              )
            },
            {
              id: 'sequence',
              label: 'Sequence',
              badge: sequence.steps.length > 0,
              content: (
                <RobotSequencer
                  sequence={sequence}
                  poses={poses}
                  playing={seqPlaying}
                  playhead={seqPlayhead}
                  live={seqLive}
                  canLive={canSeqLive}
                  canExport={bindings.length > 0}
                  onPlayPause={handleSeqPlayPause}
                  onStop={() => seqSeek(0)}
                  onScrub={seqSeek}
                  onToggleLoop={() => commitSequence({ ...sequenceRef.current, loop: !sequenceRef.current.loop })}
                  onToggleLive={() => setSeqLive((v) => !v)}
                  onAddStep={handleAddStep}
                  onRemoveStep={handleRemoveStep}
                  onMoveStep={handleMoveStep}
                  onSetStepPose={(i, pose) => patchStep(i, { pose })}
                  onSetStepDuration={(i, seconds) => patchStep(i, { duration: Math.max(0, seconds) })}
                  onSetStepEasing={(i, easing) => patchStep(i, { easing })}
                  onExport={handleExport}
                />
              )
            },
            {
              id: 'controls',
              label: 'Controls',
              badge: controls.length > 0,
              content: (
                <RobotControls
                  controls={controls}
                  poses={poses}
                  values={controlVals}
                  live={controlsLive}
                  canLive={canSeqLive}
                  onToggleLive={() => setControlsLive((v) => !v)}
                  onChange={handleControlChange}
                  onCreate={handleCreateControl}
                  onRename={handleRenameControl}
                  onDelete={handleDeleteControl}
                />
              )
            }
          ]}
        />
      )}
    </div>
  )
}

export default RobotView
