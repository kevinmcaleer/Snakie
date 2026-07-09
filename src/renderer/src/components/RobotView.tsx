import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js'
import URDFLoader from 'urdf-loader'
import type { URDFRobot } from 'urdf-loader'
import { useWorkspace } from '../store/workspace'
import { useWorkspaceLayout } from '../store/layout'
import { baseName, dirname, meshKind } from './robot-mesh'
import { RobotJointPanel, type NamedPoseLike } from './RobotJointPanel'
import {
  type JointMeta,
  clamp,
  effectiveLimit,
  extractJoints,
  servoToJointNative,
  toDisplay,
  toNative
} from './robot-pose'
import {
  addMeshLink,
  addPrimitive,
  connectJoint,
  jointNames,
  parseAssembly,
  readAllJoints,
  readJoint,
  readPrimitive,
  readVisualOrigin,
  removeJoint,
  removeLink,
  rootLink,
  setJoint,
  setJointOrigin,
  orientJoint,
  setPrimitiveSize,
  setVisualOrigin,
  type JointDef,
  type JointSpec,
  type JointType,
  type PrimitiveGeom
} from './robot-assembly'
import { reRoot } from './robot-reroot'
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
import {
  autoMirrorPairs,
  deleteKey,
  dropPose,
  duplicateKey,
  duplicatePose,
  generateMicroPython,
  mirrorTracks,
  moveKey,
  sampleTimeline,
  upsertKey
} from '../../../shared/robot-timeline'
import { useTelemetryStream } from './instrument-telemetry-subscribe'
import type {
  MirrorPair,
  MotionEasing,
  MotionTimeline,
  RobotDefinition,
  RobotModel,
  ServoJointBinding
} from '../../../shared/robot'
import './RobotView.css'

/** An empty motion clip (2 s, ease-in-out, looping). */
const EMPTY_TIMELINE: MotionTimeline = { duration: 2, easing: 'easeInOut', loop: true, fps: 20, tracks: [] }

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
  } | null>(null)
  const [zoomPct, setZoomPct] = useState(100)
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
  // The model's joints, for the hierarchy's Joints branch (#353).
  const joints = useMemo(() => readAllJoints(content), [content])
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

  // ── Block builder (#315a) ──────────────────────────────────────────────────
  // The build menu defaults to PINNED OPEN (first run / no stored preference).
  const [buildPinned, setBuildPinned] = useState(() =>
    loadPin(window.localStorage, PIN_KEYS.builder, true)
  )
  const [buildOpen, setBuildOpen] = useState(() =>
    loadPin(window.localStorage, PIN_KEYS.builder, true)
  )
  const [selectedLink, setSelectedLink] = useState<string | null>(null)
  // The hierarchy node whose context dialog (#353) is open — a block/mesh, a
  // joint, a servo binding or a pose. `editLink` (the block whose URDF is being
  // edited + highlighted in 3-D) is DERIVED from it (link + joint contexts).
  const [dialogCtx, setDialogCtx] = useState<PropsContext | null>(null)
  const editLink =
    dialogCtx?.kind === 'link' ? dialogCtx.link : dialogCtx?.kind === 'joint' ? dialogCtx.child : null
  const [buildDim, setBuildDim] = useState<{ x: number; y: number; text: string } | null>(null)
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
  const rootName = useMemo(() => rootLink(content) ?? null, [content])

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
  const handleSetJoint = (link: string, spec: JointSpec): void => {
    commitUrdf(setJoint(content, link, spec))
  }
  const handleDeleteLink = (link: string): void => {
    // Deleting the root would cascade-remove the whole tree → an empty, unusable
    // URDF. The UI disables it; guard here too. Re-root onto a keeper first.
    if (link === rootLink(content)) return
    commitUrdf(removeLink(content, link))
    setSelectedLink(null)
    setDialogCtx(null)
  }
  const handleMakeBase = (link: string): void => {
    commitUrdf(reRoot(content, link))
  }
  // Properties dialog (#352 / #353): clicking a node opens its context here. For a
  // block/mesh/joint we snapshot the URDF so Cancel can revert the live edits; OK
  // keeps them. Servo/pose contexts hold their own drafts (committed on OK).
  const editSnapshotRef = useRef<string | null>(null)
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
    openContext({ kind: 'pose', name }, null)
  }
  // Add Joint (#354): the toolbar opens the dialog + ARMS picking. The user clicks
  // a point on each block in 3-D (onJointPick), picks a type + offset, then Add.
  const handleAddJoint = (): void => {
    setMeasureActive(false) // picking + measuring both own clicks — don't double-fire
    jointPickApiRef.current?.clear()
    setJointPick({ step: 'parent', parent: null, child: null })
    openContext({ kind: 'addjoint' }, null)
    if (!buildOpen) setBuildOpen(true)
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
    setJointPick((jp) =>
      jp
        ? which === 'parent'
          ? { ...jp, step: 'parent', parent: null }
          : { ...jp, step: 'child', child: null }
        : jp
    )
  }
  // Add: place the child so its picked point meets the parent's picked point
  // (origin = parentLocal − childLocal + offset), re-parent it, and set the type.
  const handleConnectPicked = (
    type: JointType,
    offsetMm: [number, number, number],
    rotation?: { minDeg: number; maxDeg: number; defaultDeg: number }
  ): boolean => {
    const jp = jointPick
    if (!jp?.parent || !jp?.child) return false
    const base = contentRef.current
    // Intelligent parent/child (#354): if the chosen order would loop but the
    // reverse wouldn't, orientJoint swaps them so the user needn't get it "right".
    const o = orientJoint(base, jp.parent.link, jp.child.link)
    const [parent, child] = o.parent === jp.parent.link ? [jp.parent, jp.child] : [jp.child, jp.parent]
    // Orient the joint from the two picked FACE NORMALS: rotate the child so its
    // face mates flush against the parent's and the picked points coincide.
    const { xyz, rpy } = jointFromPicks(
      parent.local,
      parent.normal,
      child.local,
      child.normal,
      offsetMm
    )
    let next = connectJoint(base, { parent: parent.link, child: child.link, xyz })
    if (next === base) return false // cycle / invalid — keep the dialog open
    const rad = (d: number): number => (d * Math.PI) / 180
    // A Rotation joint carries its min/max limits (native rad); else just the type.
    next =
      rotation && type === 'revolute'
        ? setJoint(next, child.link, { type, lower: rad(rotation.minDeg), upper: rad(rotation.maxDeg) })
        : setJoint(next, child.link, { type })
    next = setJointOrigin(next, child.link, xyz, rpy) // xyz + the mating rotation
    commitUrdf(next)
    setSelectedLink(child.link)
    // Rotation default angle: persist it to the robot.yml defaultPose (keyed by the
    // joint's actual name, in display degrees) so the joint loads at that angle —
    // and it seeds the pose slider for interactive preview of the swing.
    if (rotation && type === 'revolute' && rotation.defaultDeg) {
      const jn = readJoint(next, child.link)?.name
      if (jn) {
        const dd = rotation.defaultDeg
        void persist((m) => {
          m.defaultPose = { ...(m.defaultPose ?? {}), [jn]: dd }
        })
      }
    }
    return true
  }
  // Delete a joint (#354): strip it so the child becomes a free-standing root, and
  // keep the whole sub-assembly EXACTLY where it is. Because a root has no frame
  // transform, moving the child frame to the origin is compensated two ways: the
  // child's own visual origin is baked with its full world transform, and each of
  // the child's DIRECT-child joints is pre-multiplied by that same transform (so
  // descendants — which hang off those joints — don't teleport). Handles rotation
  // (full rel matrix → rpy), meshes (readVisualOrigin), and dangling mimics.
  const handleDeleteJoint = (child: string): void => {
    const before = content
    const root = rootLink(before)
    if (!root || child === root) {
      setDialogCtx(null)
      return
    }
    const stripped = removeJoint(before, child)
    if (stripped === before) {
      setDialogCtx(null) // no such joint
      return
    }
    // The child's full transform relative to the base (which loads at the origin).
    const robot = robotRef.current
    let relM = new THREE.Matrix4()
    if (robot?.links[child] && robot.links[root]) {
      robot.updateMatrixWorld(true)
      relM = new THREE.Matrix4()
        .copy(robot.links[root].matrixWorld)
        .invert()
        .multiply(robot.links[child].matrixWorld)
    }
    const toMat = (xyz: readonly number[], rpy: readonly number[]): THREE.Matrix4 =>
      new THREE.Matrix4()
        .makeRotationFromEuler(new THREE.Euler(rpy[0], rpy[1], rpy[2], 'ZYX'))
        .setPosition(xyz[0], xyz[1], xyz[2])
    const fromMat = (m: THREE.Matrix4): { xyz: [number, number, number]; rpy: [number, number, number] } => {
      const p = new THREE.Vector3()
      const q = new THREE.Quaternion()
      m.decompose(p, q, new THREE.Vector3())
      const e = new THREE.Euler().setFromQuaternion(q, 'ZYX') // URDF rpy convention
      return { xyz: [p.x, p.y, p.z], rpy: [e.x, e.y, e.z] }
    }
    // Bake the child's own visual so it stays put.
    const ov = readVisualOrigin(before, child) ?? { xyz: [0, 0, 0], rpy: [0, 0, 0] }
    const nv = fromMat(relM.clone().multiply(toMat(ov.xyz, ov.rpy)))
    let next = setVisualOrigin(stripped, child, nv.xyz, nv.rpy)
    // Re-base the child's direct-child joints so the subtree keeps its world pose.
    for (const j of readAllJoints(before)) {
      if (j.parent !== child) continue
      const nj = fromMat(relM.clone().multiply(toMat(j.xyz, j.rpy)))
      next = setJointOrigin(next, j.child, nj.xyz, nj.rpy)
    }
    commitUrdf(next)
    setDialogCtx(null)
    setSelectedLink(child)
  }
  const handlePropsOk = (): void => {
    editSnapshotRef.current = null
    setDialogCtx(null)
    setJointPick(null)
    jointPickApiRef.current?.clear()
  }
  const handlePropsCancel = (): void => {
    const snap = editSnapshotRef.current
    editSnapshotRef.current = null
    if (snap != null && snap !== contentRef.current) commitUrdf(snap) // discard edits
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
      } catch {
        if (live) setBindings([])
      }
    })()
    return () => {
      live = false
    }
  }, [currentFolder])

  // A running program's servo writes drive the mapped joints in real time. This
  // works headless: the simulator runs the Python and `inst.servo_on(pin).angle`
  // emits `SNK SERVO <pin> <deg>` — no board required.
  useTelemetryStream((r) => {
    if (r.kind !== 'servo') return
    const res = servoToJointNative(bindingsRef.current, metaRef.current, r.pin, r.angle)
    if (!res || !robotRef.current) return
    robotRef.current.setJointValue(res.joint, res.native)
    setValues((v) => (v[res.joint] === res.native ? v : { ...v, [res.joint]: res.native }))
  })

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

  // Apply a sampled timeline frame to the robot IMPERATIVELY (mimics auto-follow).
  // `commitState` also pushes the sliders (only on scrub/stop — never per frame).
  const applyTimelineAt = (t: number, commitState = false): void => {
    const r = robotRef.current
    if (!r) return
    const sampled = sampleTimeline(timelineRef.current, t)
    const patch: Record<string, number> = {}
    for (const m of metaRef.current) {
      if (m.isMimic) continue
      const disp = sampled[m.name]
      if (typeof disp !== 'number') continue
      const lim = effectiveLimit(m, overridesRef.current[m.name])
      const native = clamp(toNative(m.type, disp), lim.lower, lim.upper)
      r.setJointValue(m.name, native)
      patch[m.name] = native
    }
    if (commitState) setValues((v) => ({ ...v, ...patch }))
  }

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

  // Update the timeline + schedule a debounced persist (drags/edits coalesce).
  // The deferred save SNAPSHOTS the target folder and loads a FRESH def for it,
  // writing only the timeline — so a folder switch within the 400 ms window can
  // never write this timeline into a different project's robot.yml (data loss).
  const commitTimeline = (next: MotionTimeline): void => {
    timelineRef.current = next
    setTimeline(next)
    const folder = currentFolder || undefined
    pendingTimelineSave.current = async (): Promise<void> => {
      pendingTimelineSave.current = null
      try {
        const def = await window.api.robot.load(folder)
        def.robot = { ...(def.robot ?? {}), timeline: next }
        await window.api.robot.save(folder, def)
      } catch {
        // best-effort — a keyframe save failing is non-fatal
      }
    }
    if (timelineSaveTimer.current) clearTimeout(timelineSaveTimer.current)
    timelineSaveTimer.current = setTimeout(() => {
      void pendingTimelineSave.current?.()
    }, 400)
  }

  // Flush a pending timeline save on unmount so the last edit isn't lost (and the
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
      // Starting: rewind a FINISHED one-shot clip so it replays from the top.
      const tl = timelineRef.current
      if (!tl.loop && playheadRef.current >= tl.duration) {
        playheadRef.current = 0
        setPlayhead(0)
      }
      return true
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

  const handleExport = (): void => {
    const ex = generateMicroPython(timelineRef.current, bindingsRef.current, {
      robotName: info?.name,
      fps: timelineRef.current.fps
    })
    openBuffer('motion.py', ex.code)
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
      // Add the mesh to the URDF (a new link + fixed joint at the origin) so it
      // renders now. Select it + reframe so the user can see + place it.
      const linkBase = res.name?.replace(/\.(stl|dae)$/i, '') ?? 'part'
      const next = addMeshLink(content, { meshRel: res.rel, linkBase, scale })
      refitNextRef.current = true
      // Route through the choke point so the import is ONE undoable step and the
      // history stays in sync (commitUrdf updates the buffer + schedules the save).
      commitUrdf(next.urdf)
      setSelectedLink(next.link)
      setDialogCtx({ kind: 'link', link: next.link })
      if (!buildOpen) setBuildOpen(true)
      setSavingLabel(scale !== 1 ? `added ${next.link} (scaled mm→m)` : `added ${next.link}`)
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
    // Snapshot the camera as the PRESERVED state so a later re-parse / async
    // mesh-settle restores THIS view instead of re-framing the whole model. Called
    // by manual camera actions (zoom, fit, home, focus-a-link, cube snap/orbit) so
    // a click made while meshes are still loading isn't clobbered on settle.
    const recordCamera = (): void => {
      cameraStateRef.current = {
        pos: camera.position.clone(),
        target: controls.target.clone(),
        zoom: camera.zoom,
        halfView
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
      focusLink
    }
    const onControlsChange = (): void => syncZoomPct()
    controls.addEventListener('change', onControlsChange)
    // A user grabbing the viewport cancels any in-flight camera animation (else
    // the tween and OrbitControls fight over the camera).
    const onControlsStart = (): void => {
      anim = null
    }
    controls.addEventListener('start', onControlsStart)

    // Frame the model isometrically + (re)lay a ground grid under it. Called once
    // up-front (primitives) and again when async meshes arrive and grow the box.
    const frameModel = (robot: URDFRobot, animate = false): void => {
      // Flush world matrices BEFORE measuring — a dirty transform frames stale.
      robot.updateMatrixWorld(true)
      const box = new THREE.Box3().setFromObject(robot)
      if (!Number.isFinite(box.min.x) || box.isEmpty()) return
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
        return
      }
      halfView = radius * 1.35 // a little padding around the model (ortho)
      camera.position.copy(destPos)
      controls.target.copy(centre)
      camera.zoom = 1
      controls.update()
      setClip(radius)
      resize()
    }

    // Frame a NEW robot isometrically, but PRESERVE the camera when the same file
    // is just re-parsed after a build edit (#315a must-fix — no view jump). The
    // grid is refreshed to the new bounds either way.
    const frameKey = activeFile?.id ?? ''
    const relayGrid = (robot: URDFRobot): void => {
      robot.updateMatrixWorld(true)
      const box = new THREE.Box3().setFromObject(robot)
      if (box.isEmpty()) return
      const size = box.getSize(new THREE.Vector3())
      layGrid(Math.max(size.x, size.z) * 3 + 0.4, box.min.y)
    }
    const framePreservingCamera = (robot: URDFRobot): void => {
      const saved = cameraStateRef.current
      if (refitNextRef.current) {
        // A just-added object: reframe so it's actually in view (once).
        refitNextRef.current = false
        frameModel(robot)
        framedKeyRef.current = frameKey
        cameraStateRef.current = null
        return
      }
      if (saved && framedKeyRef.current === frameKey) {
        halfView = saved.halfView
        camera.position.copy(saved.pos)
        controls.target.copy(saved.target)
        camera.zoom = saved.zoom
        camera.updateProjectionMatrix()
        controls.update()
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
                if ('color' in c && c.color) c.color = HL_BLUE.clone()
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
          const clearHandles = (): void => {
            snapGroup.clear()
          }
          const showHandles = (pts: THREE.Vector3[], activeIdx: number, normal?: THREE.Vector3): void => {
            snapGroup.clear()
            const r = halfView * 0.025
            const q = normal
              ? new THREE.Quaternion().setFromUnitVectors(zAxis, normal.clone().normalize())
              : null
            pts.forEach((p, i) => {
              const s = new THREE.Mesh(discGeo, i === activeIdx ? handleMatOn : handleMat)
              s.position.copy(p)
              if (q) s.quaternion.copy(q) // lie flat on the face
              else s.quaternion.copy(camera.quaternion) // billboard fallback
              s.scale.setScalar(i === activeIdx ? r * 1.8 : r)
              s.renderOrder = 998
              s.raycast = () => {}
              snapGroup.add(s)
            })
          }
          const mmv = (m: number): number => Math.round(m * 1000)
          const ownerLinkName = (obj: THREE.Object3D | null): string | null => {
            let o = obj
            while (o && !(o as unknown as { isURDFLink?: boolean }).isURDFLink) o = o.parent
            return (o as unknown as { urdfName?: string } | null)?.urdfName ?? null
          }
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
            // directly clickable, with no pixel-threshold gap and no need to hold
            // SHIFT to reach it.
            if (hoverSnaps && hoverSnaps.pts.length && robot.links[hoverSnaps.link]) {
              const near = nearestScreen(hoverSnaps.pts, e)
              if (near.index >= 0) {
                link = hoverSnaps.link
                world = hoverSnaps.pts[near.index].clone()
                worldNormal = hoverSnaps.worldNormal.clone()
                role = hoverSnaps.roles[near.index]
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
              const near = nearestScreen(th.pts, e)
              if (near.index >= 0 && near.distPx < (geom ? 24 : 28)) {
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
            // Drop the consumed snaps so the NEXT pick (e.g. the child after the
            // parent) can't reuse this surface's stale snap without a fresh hover —
            // absent a new hover it falls through to the raycast under the cursor.
            hoverSnaps = null
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
            if (!buildActive() || !canEditRef.current || !robotRef.current) return
            if (buildToolRef.current === 'pushpull') startResize(e)
            else if (buildToolRef.current === 'move') startMove(e)
          }

          const onBuildMove = (e: PointerEvent): void => {
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
                const near = nearestScreen(handles, e)
                const gp = movedGrab.clone().project(camera)
                const hp = near.index >= 0 ? handles[near.index].clone().project(camera) : gp
                const rect = renderer.domElement.getBoundingClientRect()
                const dpx = Math.hypot(((hp.x - gp.x) * rect.width) / 2, ((hp.y - gp.y) * rect.height) / 2)
                if (near.index >= 0 && dpx < 16) {
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
            showHandles(handles, activeIdx, handleNormal)
            const rect = mount.getBoundingClientRect()
            setBuildDim({
              x: e.clientX - rect.left + 14,
              y: e.clientY - rect.top + 14,
              text: snapRole ? `snap ✓ ${snapRole}` : `${mmv(nx[0])} · ${mmv(nx[1])} · ${mmv(nx[2])} mm`
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
            if (drag || move) return
            const jointActive = jointPickRef.current.active
            const wantHandles = buildToolRef.current === 'move' || jointActive
            if (!buildActive() || !wantHandles || !robotRef.current) {
              clearHandles()
              clearHoverMarker()
              hoverSnaps = null
              return
            }
            buildNdcFrom(e)
            buildRay.setFromCamera(buildNdc, camera)

            if (jointActive) {
              const hit = jointRayHit() // never the already-picked block
              if (hit) {
                const s = computeSnaps(hit)
                if (s) hoverSnaps = s
              } else if (hoverSnaps && hoverSnaps.pts.length) {
                // Over empty space (e.g. inside a hole). Keep the last surface's
                // snaps while one is still near the cursor so the hole cross-hair
                // stays put — and stays clickable — as you move onto it. SHIFT
                // force-locks them regardless of distance (large holes).
                const near = nearestScreen(hoverSnaps.pts, e)
                if (!e.shiftKey && (near.index < 0 || near.distPx > 90)) hoverSnaps = null
              } else {
                hoverSnaps = null
              }
              if (!hoverSnaps || !hoverSnaps.pts.length) {
                clearHandles()
                clearHoverMarker()
                return
              }
              const near = nearestScreen(hoverSnaps.pts, e)
              showHandles(hoverSnaps.pts, near.index, hoverSnaps.worldNormal)
              if (near.index >= 0) {
                setHoverMarker(hoverSnaps.pts[near.index], hoverSnaps.worldNormal, hoverSnaps.roles[near.index])
              } else clearHoverMarker()
              return
            }

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
            showHandles(th.pts, near.distPx < 16 ? near.index : -1, nW)
          }

          // A cancelled/interrupted drag must never strand OrbitControls disabled
          // or leave a half-applied preview.
          const onBuildCancel = (): void => {
            controls.enabled = true
            setBuildDim(null)
            clearHandles()
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
          }
          renderer.domElement.addEventListener('pointermove', onBuildHover)
          renderer.domElement.addEventListener('pointerup', onBuildUp)
          renderer.domElement.addEventListener('pointercancel', onBuildCancel)
          renderer.domElement.addEventListener('lostpointercapture', onBuildCancel)
          renderer.domElement.addEventListener('pointerleave', onHoverLeave)
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
            // Remove everything that references the shared discGeo / materials FIRST,
            // then dispose those shared resources.
            clearMeasure()
            clearHighlight()
            clearJointMarkers() // disposes the pick + hover markers
            scene.remove(snapGroup)
            discGeo.dispose()
            handleMat.dispose()
            handleMatOn.dispose()
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
      zoomApiRef.current = null
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
  }, [content, effectiveBase, isEmpty, poseUI, currentFolder, activeFile?.id, projection])

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
        {!error && meshNote && (
          <div className="robotview__note" role="status">
            {meshNote}
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
          </div>
        )}
        {showPanel && buildOpen && (
          <RobotToolbar
            tool={buildTool}
            onSetTool={onSetTool}
            canEdit={canEdit}
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
            poses={poses}
            selected={selectedLink}
            onSelect={(link) => {
              setSelectedLink(link)
              if (link) zoomApiRef.current?.focusLink(link) // hierarchy click zooms to fit
            }}
            active={dialogCtx}
            onEdit={handleOpenProps}
            onOpenJoint={handleOpenJoint}
            onOpenServo={handleOpenServo}
            onOpenPose={handleOpenPose}
            rootLink={rootName}
            onMakeBase={handleMakeBase}
            onDelete={handleDeleteLink}
            onImportStl={() => void handleImportStl()}
            canImport={!!canImport}
            importing={importing}
            canEdit={canEdit}
            onOpenRobot={() => void handleOpenRobotFile()}
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
            onSetJoint={handleSetJoint}
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
            onConnectPicked={handleConnectPicked}
            onOk={handlePropsOk}
            onCancel={handlePropsCancel}
          />
        )}
        {buildDim && (
          <div className="robotbuild__dim" style={{ left: buildDim.x, top: buildDim.y }}>
            {buildDim.text}
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
          measureDistance={measureDist}
          savingLabel={savingLabel}
          assembly={assembly}
          onImportStl={() => void handleImportStl()}
          canImport={!!canImport}
          importing={importing}
          bindings={bindings}
          onAddBinding={handleAddBinding}
          onUpdateBinding={handleUpdateBinding}
          onDeleteBinding={handleDeleteBinding}
        />
      )}
      </div>
      {showTimeline && (
        <RobotTimeline
          timeline={timeline}
          movableJoints={movableNames}
          playhead={playhead}
          playing={playing}
          selected={selectedKey}
          poses={poses}
          canExport={bindings.length > 0}
          canMirror={mirrorPairs.length > 0}
          onPlayPause={handlePlayPause}
          onStop={() => seek(0)}
          onToggleLoop={() => commitTimeline({ ...timelineRef.current, loop: !timelineRef.current.loop })}
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
      )}
    </div>
  )
}

export default RobotView
