import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  AssemblyItem,
  PrimitiveGeom,
  JointDef,
  JointFull,
  JointType,
  JointSpec
} from './robot-assembly'
import type { Vec3 } from './robot-build'
import { principalAxisName } from './robot-build'
import { toDisplay, toNative, unitLabel, normPin, type MovableType } from './robot-pose'
import { boundJoint, type BindableServo } from './servo-bind'
import { shouldAutoHide } from './pin-overlay'
import { HierarchyPanel } from './HierarchyPanel'
import { flattenHierarchy, jointKey, type HierarchyNode, type MassCoverage } from './hierarchy-tree'
import type { ServoJointBinding } from '../../../shared/robot'
import type { NamedPoseLike } from './robot-pose'
import type { PropsContext } from './RobotPropertiesDialog'
import { ContextMenu, type ContextMenuItem, type ContextMenuPosition } from './ContextMenu'
import { usePrompt } from './PromptModal'
import { FolderOpenIcon } from './ui-icons'
import { CollapsiblePanel } from './CollapsiblePanel'
import './RobotBuildPanel.css'

/**
 * ROBOT BUILD PANEL (#315a) — a floating, transparent, PINNABLE dock on the LEFT
 * of the pose tool (mirrors the breadboard's library dock). It holds the model
 * hierarchy (view-by-default; a pencil per row enters edit), buttons to add
 * box / cylinder / sphere blocks (each sticks to the selected part), the STL
 * import, and — while a primitive is being edited — a numeric size form. All the
 * 3-D interaction (select, push/pull faces) lives in RobotView.
 */
// The app-wide pushpin (canonical across WiringCanvas / BoardGraph): an outline
// when unpinned, filled when pinned. Kept identical so the builder dock matches.
const PinIcon = ({ pinned }: { pinned: boolean }): JSX.Element => (
  <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
    <path
      d="M9.5 1.5l5 5-2.2.6-2.5 2.5.4 3.1-1.8-.3-2.6-2.6L2 13.6 1.4 13l3.8-3.8L2.6 6.6l-.3-1.8 3.1.4L7.9 2.7z"
      fill={pinned ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
    />
  </svg>
)
// The row glyphs (anchor / mesh / cube / pencil / joint types) moved to
// `HierarchyPanel` with the tree itself (#718) — they belong to the rows, and
// both workspaces draw the same ones now.

export interface RobotBuildPanelProps {
  open: boolean
  pinned: boolean
  onSetOpen: (open: boolean) => void
  onSetPinned: (pinned: boolean) => void
  assembly: AssemblyItem[]
  /**
   * The SHARED hierarchy (#718) — the identical rows the Electronics workspace
   * renders. Replaces this panel's own kinematic chain: a part and its link are
   * one row here, and the board + placed parts that used to exist only in the
   * board browser now appear in Build too.
   */
  hierarchy: HierarchyNode[]
  /** How much of the robot is actually weighed (#719). */
  coverage: MassCoverage
  /** The model's joints, servo bindings and named poses — extra tree branches. */
  joints: JointFull[]
  servos: ServoJointBinding[]
  /** Breadboard servos (placed servo parts) that can be bound to a joint (#). */
  bindableServos: BindableServo[]
  /** Joint names a servo can drive (the bind picker's options). */
  jointOptions: string[]
  /** Bind a servo's GPIO to a joint (`''` unbinds). */
  onBindServo: (pin: string, joint: string) => void
  /** Remove a loose URDF link — the duplicate 3-D mesh a servo drop appended when the
   *  servo is already modelled as a joint (`meshLink` on the servo). */
  onRemoveMesh?: (link: string) => void
  poses: NamedPoseLike[]
  /** The SHARED selection key (#718) — survives a workspace switch. */
  selectedKey: string | null
  /** A hierarchy row was clicked: select it + zoom-fit it in THIS workspace. */
  onSelectNode: (node: HierarchyNode) => void
  /** The node whose context dialog is open (highlighted in the tree). */
  active: PropsContext | null
  onEdit: (link: string | null) => void
  onOpenJoint: (child: string, joint: string) => void
  /** Rename a joint (right-click a joint row) — cascades servo map + poses. */
  onRenameJoint: (oldName: string, newName: string) => void
  onOpenServo: (pin: string) => void
  /** Bind a servo to the next free pin + open its editor. */
  onNewServo: () => void
  onOpenPose: (name: string) => void
  /** Open the pose editor for a new pose (captures the current joint values). */
  onNewPose: () => void
  /** The current root link, and an action to re-root the model at a link. */
  rootLink: string | null
  onMakeBase: (link: string) => void
  onRename: (link: string, to: string) => void
  onDelete: (link: string) => void
  onImportStl: () => void
  canImport: boolean
  onExportUrdf: () => void
  canExport: boolean
  importing: boolean
  /** Editing needs a saved project file — disables add/edit with a hint. */
  canEdit: boolean
  /** Open a different robot `.urdf` via the native picker (works popped out). */
  onOpenRobot: () => void
}

/** metres → integer mm (display) and back. */
const mm = (m: number): number => Math.round(m * 1000)
const toM = (millis: number): number => millis / 1000

export function SizeForm({
  geom,
  onChange
}: {
  geom: PrimitiveGeom
  onChange: (dims: number[]) => void
}): JSX.Element {
  // Local mm state so typing doesn't rebuild the scene per keystroke; commit on
  // blur/Enter, clamped to a 1 mm minimum (a 0/blank field must never write a
  // degenerate size). Re-seeds when the geometry changes externally (a drag).
  const seed = geom.dims.map(mm)
  const [vals, setVals] = useState<number[]>(seed)
  const key = seed.join(',')
  useEffect(() => setVals(seed), [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const commit = (): void => onChange(vals.map((v) => Math.max(0.001, toM(v > 0 ? v : 1))))
  const field = (label: string, i: number): JSX.Element => (
    <label className="robotbuild__mm" key={label}>
      <span>{label}</span>
      <input
        type="number"
        min={1}
        step={5}
        value={Number.isFinite(vals[i]) ? vals[i] : ''}
        onChange={(e) => {
          const n = [...vals]
          n[i] = Number(e.target.value)
          setVals(n)
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
        }}
      />
    </label>
  )
  return (
    <div className="robotbuild__size">
      {geom.kind === 'box' && (
        <>
          {field('L', 0)}
          {field('W', 1)}
          {field('H', 2)}
        </>
      )}
      {geom.kind === 'cylinder' && (
        <>
          {field('⌀r', 0)}
          {field('len', 1)}
        </>
      )}
      {geom.kind === 'sphere' && field('r', 0)}
      <span className="robotbuild__mm-unit">mm</span>
    </div>
  )
}

// Kid-friendly names for the URDF joint types (jargon lives in the tooltip).
const JOINT_KINDS: Array<{ id: JointType; label: string; hint: string }> = [
  { id: 'fixed', label: 'Fixed', hint: 'Glued in place — no movement' },
  { id: 'revolute', label: 'Hinge', hint: 'Rotates about an axis, within limits (revolute)' },
  { id: 'continuous', label: 'Wheel', hint: 'Spins freely, no limits (continuous)' },
  { id: 'prismatic', label: 'Slider', hint: 'Slides along an axis, within limits (prismatic)' }
]
const AXES: Array<{ id: 'x' | 'y' | 'z'; vec: Vec3 }> = [
  { id: 'x', vec: [1, 0, 0] },
  { id: 'y', vec: [0, 1, 0] },
  { id: 'z', vec: [0, 0, 1] }
]

/** The joint editor (#315b): type, axis, limits and a mimic coupling. */
export function JointForm({
  joint,
  names,
  jointRoll,
  onChange,
  onSetOrigin,
  onRoll
}: {
  joint: JointDef
  names: string[]
  /** The joint's current absolute roll (deg) about its normal — seeds the Roll field. */
  jointRoll?: number
  onChange: (spec: JointSpec) => void
  /** Move the joint origin to `xyz` (metres), keeping its orientation (applied live). */
  onSetOrigin?: (xyz: [number, number, number]) => void
  /** Set the joint's ABSOLUTE roll about its own normal axis, in degrees (applied live). */
  onRoll?: (absDeg: number) => void
}): JSX.Element {
  // The current joint as a full spec, so each edit preserves the other fields.
  const spec = (): JointSpec => ({
    type: joint.type,
    axis: joint.axis ?? [0, 0, 1],
    lower: joint.limit?.lower,
    upper: joint.limit?.upper,
    mimic: joint.mimic
  })
  const movable = joint.type !== 'fixed'
  const bounded = joint.type === 'revolute' || joint.type === 'prismatic'
  const mt = (movable ? joint.type : 'revolute') as MovableType
  const activeAxis = principalAxisName(joint.axis)

  // Local limit fields (display units) so typing doesn't rebuild per keystroke.
  const disp = (n?: number): number => (n == null ? 0 : Math.round(toDisplay(mt, n) * 100) / 100)
  const lo = disp(joint.limit?.lower)
  const hi = disp(joint.limit?.upper)
  const [lim, setLim] = useState<[number, number]>([lo, hi])
  const limKey = `${joint.name}:${joint.type}:${lo}:${hi}`
  useEffect(() => setLim([lo, hi]), [limKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const commitLim = (): void =>
    onChange({ ...spec(), lower: toNative(mt, lim[0]), upper: toNative(mt, lim[1]) })

  // Origin offset (mm, local like the size fields) + an ABSOLUTE roll (deg) about the
  // joint's own normal axis. Both apply LIVE as the field changes (#354). Editable for
  // every joint type. The offset re-seeds from the model on an external change (a 3-D
  // drag) — but NOT while the field is focused, so live typing isn't clobbered by the
  // URDF's 0.1 mm rounding. The roll seeds from its remembered absolute value.
  const off0 = joint.xyz.map(mm) as [number, number, number]
  const [off, setOff] = useState<[number, number, number]>(off0)
  const offEditing = useRef(false)
  const offKey = `${joint.name}:${off0.join(',')}`
  useEffect(() => {
    if (!offEditing.current) setOff(off0)
  }, [offKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const toXyz = (v: number[]): [number, number, number] =>
    v.map((n) => toM(Number.isFinite(n) ? n : 0)) as [number, number, number]
  const pushOff = (n: [number, number, number]): void => {
    setOff(n)
    if (n.every((v) => Number.isFinite(v))) onSetOrigin?.(toXyz(n)) // live
  }
  const commitOff = (): void => onSetOrigin?.(toXyz(off))
  const [roll, setRoll] = useState(String(jointRoll ?? 0))
  const setRollLive = (v: string): void => {
    setRoll(v)
    const n = Number(v)
    if (v.trim() !== '' && Number.isFinite(n)) onRoll?.(n) // absolute, live
  }

  const others = names.filter((n) => n !== joint.name)
  const unit = unitLabel(mt)

  return (
    <div className="robotbuild__joint">
      <div className="robotbuild__jrow" role="group" aria-label="Joint type">
        {JOINT_KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            className={`robotbuild__chip${joint.type === k.id ? ' is-on' : ''}`}
            title={k.hint}
            onClick={() => onChange({ ...spec(), type: k.id })}
          >
            {k.label}
          </button>
        ))}
      </div>
      {onSetOrigin && (
        <div className="robotbuild__jrow">
          <span className="robotbuild__jlabel" title="Position of the joint, relative to its parent">
            Offset
          </span>
          {(['X', 'Y', 'Z'] as const).map((ax, i) => (
            <label className="robotbuild__mm" key={ax}>
              <span>{ax}</span>
              <input
                type="number"
                step={1}
                value={Number.isFinite(off[i]) ? off[i] : ''}
                onFocus={() => (offEditing.current = true)}
                onChange={(e) => {
                  const n = [...off] as [number, number, number]
                  n[i] = Number(e.target.value)
                  pushOff(n)
                }}
                onBlur={() => {
                  offEditing.current = false
                  commitOff()
                }}
                onKeyDown={(e) => e.key === 'Enter' && commitOff()}
              />
            </label>
          ))}
          <span className="robotbuild__mm-unit">mm</span>
        </div>
      )}
      {onRoll && (
        <div className="robotbuild__jrow">
          <span className="robotbuild__jlabel" title="Absolute roll about the joint's own normal axis">
            Roll
          </span>
          <label className="robotbuild__mm">
            <input type="number" step={15} value={roll} onChange={(e) => setRollLive(e.target.value)} />
          </label>
          <span className="robotbuild__mm-unit">°</span>
        </div>
      )}
      {movable && (
        <div className="robotbuild__jrow">
          <span className="robotbuild__jlabel">Axis</span>
          {AXES.map((a) => (
            <button
              key={a.id}
              type="button"
              className={`robotbuild__chip robotbuild__chip--axis${activeAxis === a.id ? ' is-on' : ''}`}
              title={`Move about the ${a.id.toUpperCase()} axis`}
              onClick={() => onChange({ ...spec(), axis: a.vec })}
            >
              {a.id.toUpperCase()}
            </button>
          ))}
          {activeAxis === 'custom' && <span className="robotbuild__jnote">custom</span>}
        </div>
      )}
      {bounded && (
        <div className="robotbuild__jrow">
          <span className="robotbuild__jlabel">Limits</span>
          <label className="robotbuild__mm">
            <span>min</span>
            <input
              type="number"
              value={Number.isFinite(lim[0]) ? lim[0] : ''}
              onChange={(e) => setLim([Number(e.target.value), lim[1]])}
              onBlur={commitLim}
              onKeyDown={(e) => e.key === 'Enter' && commitLim()}
            />
          </label>
          <label className="robotbuild__mm">
            <span>max</span>
            <input
              type="number"
              value={Number.isFinite(lim[1]) ? lim[1] : ''}
              onChange={(e) => setLim([lim[0], Number(e.target.value)])}
              onBlur={commitLim}
              onKeyDown={(e) => e.key === 'Enter' && commitLim()}
            />
          </label>
          <span className="robotbuild__mm-unit">{unit}</span>
        </div>
      )}
      {movable && (
        <div className="robotbuild__jrow">
          <span className="robotbuild__jlabel" title="This joint copies another (gear ratio)">
            Copies
          </span>
          <select
            className="robotbuild__jsel"
            value={joint.mimic?.joint ?? ''}
            onChange={(e) =>
              onChange({
                ...spec(),
                mimic: e.target.value
                  ? { joint: e.target.value, multiplier: joint.mimic?.multiplier ?? 1, offset: joint.mimic?.offset ?? 0 }
                  : null
              })
            }
          >
            <option value="">— none —</option>
            {others.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          {joint.mimic && (
            <MimicRatio
              key={`${joint.name}:${joint.mimic.joint}`}
              mult={joint.mimic.multiplier}
              offset={disp(joint.mimic.offset)}
              unit={unit}
              onChange={(mult, offsetDisp) =>
                onChange({
                  ...spec(),
                  mimic: { joint: joint.mimic!.joint, multiplier: mult, offset: toNative(mt, offsetDisp) }
                })
              }
            />
          )}
        </div>
      )}
    </div>
  )
}

/** The `× multiplier + offset` fields of a mimic coupling (local, commit on blur). */
function MimicRatio({
  mult,
  offset,
  unit,
  onChange
}: {
  mult: number
  offset: number
  unit: string
  onChange: (mult: number, offset: number) => void
}): JSX.Element {
  const [m, setM] = useState(mult)
  const [o, setO] = useState(offset)
  const commit = (): void => onChange(Number.isFinite(m) ? m : 1, Number.isFinite(o) ? o : 0)
  return (
    <span className="robotbuild__jratio">
      <span>×</span>
      <input
        type="number"
        step={0.1}
        value={Number.isFinite(m) ? m : ''}
        title="Gear ratio (negative to reverse)"
        onChange={(e) => setM(Number(e.target.value))}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
      <span>+</span>
      <input
        type="number"
        value={Number.isFinite(o) ? o : ''}
        title={`Offset (${unit})`}
        onChange={(e) => setO(Number(e.target.value))}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
      <span className="robotbuild__mm-unit">{unit}</span>
    </span>
  )
}

/** A collapsible branch of the hierarchy tree (disclosure ▸/▾ + label + count). */
function Section({
  id,
  label,
  count,
  collapsed,
  onToggle,
  children
}: {
  id: string
  label: string
  count: number
  collapsed: Record<string, boolean>
  onToggle: (id: string) => void
  children: React.ReactNode
}): JSX.Element {
  const isCollapsed = !!collapsed[id]
  // Soft Shell (#580): the CHAIN / URDF / Poses branches now use the shared
  // CollapsiblePanel primitive, so each owns its own header chevron + count badge
  // and matches every other collapsible panel in the app.
  return (
    <CollapsiblePanel
      title={label}
      open={!isCollapsed}
      onToggle={() => onToggle(id)}
      badge={count}
      className="robotbuild__section"
      bodyClassName="robotbuild__section-body"
    >
      <ul className="robotbuild__parts">{children}</ul>
    </CollapsiblePanel>
  )
}

export function RobotBuildPanel(props: RobotBuildPanelProps): JSX.Element {
  const {
    open,
    pinned,
    onSetOpen,
    onSetPinned,
    assembly,
    hierarchy,
    coverage,
    joints,
    servos,
    poses,
    selectedKey,
    onSelectNode,
    active,
    onEdit,
    onOpenJoint,
    onRenameJoint,
    onOpenServo,
    onNewServo,
    bindableServos,
    jointOptions,
    onBindServo,
    onRemoveMesh,
    onOpenPose,
    onNewPose,
    rootLink,
    onMakeBase,
    onRename,
    onDelete,
    onImportStl,
    canImport,
    onExportUrdf,
    canExport,
    importing,
    canEdit,
    onOpenRobot
  } = props
  const dockRef = useRef<HTMLElement | null>(null)
  const prompt = usePrompt()
  // Which tree branches are collapsed (all expanded by default).
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const toggle = (id: string): void => setCollapsed((c) => ({ ...c, [id]: !c[id] }))
  // Right-click menu (Fusion-style): rename / make base / delete a part.
  const [menu, setMenu] = useState<{ pos: ContextMenuPosition; link: string } | null>(null)
  const openMenu = (e: React.MouseEvent, link: string): void => {
    if (!canEdit) return
    e.preventDefault()
    e.stopPropagation()
    setMenu({ pos: { x: e.clientX, y: e.clientY }, link })
  }
  // Right-click a joint row → rename the joint.
  const [jmenu, setJmenu] = useState<{ pos: ContextMenuPosition; joint: string } | null>(null)
  const openJointMenu = (e: React.MouseEvent, joint: string): void => {
    if (!canEdit) return
    e.preventDefault()
    e.stopPropagation()
    setJmenu({ pos: { x: e.clientX, y: e.clientY }, joint })
  }
  const jointMenuItems = (joint: string): ContextMenuItem[] => [
    {
      key: 'rename',
      label: 'Rename joint…',
      onSelect: () => {
        void (async () => {
          const to = await prompt('Rename joint', joint)
          if (to && to.trim() && to.trim() !== joint) onRenameJoint(joint, to.trim())
        })()
      }
    }
  ]
  const menuItems = (link: string): ContextMenuItem[] => {
    const isBase = link === rootLink
    return [
      {
        key: 'rename',
        label: 'Rename…',
        onSelect: () => {
          void (async () => {
            const to = await prompt('Rename part', link)
            if (to && to.trim() && to.trim() !== link) onRename(link, to.trim())
          })()
        }
      },
      {
        key: 'base',
        label: isBase ? 'Base (already)' : 'Make base',
        disabled: isBase,
        onSelect: () => onMakeBase(link)
      },
      {
        key: 'delete',
        label: 'Delete',
        danger: true,
        disabled: isBase,
        onSelect: () => onDelete(link)
      }
    ]
  }

  // Which hierarchy row has its properties dialog open — the row highlight. The
  // dialog talks in links / joint names; the tree talks in row keys, so map once.
  const activeKey = useMemo(() => {
    if (active?.kind === 'joint') return jointKey(active.joint)
    const link = active?.kind === 'link' ? active.link : null
    if (!link) return null
    return flattenHierarchy(hierarchy).find((n) => n.link === link)?.key ?? null
  }, [active, hierarchy])
  const activeLink =
    active?.kind === 'link' ? active.link : active?.kind === 'joint' ? active.child : null
  // Servo bindings NOT backed by a breadboard servo part (manual / legacy), so they
  // aren't shown twice in the Servos section.
  const bindablePins = new Set(bindableServos.filter((s) => s.pin).map((s) => normPin(s.pin as string)))
  const orphanBindings = servos.filter((b) => !bindablePins.has(normPin(b.pin)))

  if (!open) {
    return (
      <button
        type="button"
        className="robotbuild__tab"
        title="Build — add + edit blocks"
        onClick={() => {
          onSetOpen(true)
          requestAnimationFrame(() => dockRef.current?.focus())
        }}
      >
        Build
      </button>
    )
  }

  return (
    <aside
      className={`robotbuild__dock${pinned ? '' : ' robotbuild__dock--overlay'}`}
      ref={dockRef}
      tabIndex={-1}
      aria-label="Build panel"
      onBlur={(e) => {
        // Don't auto-hide when focus moves to the tool toolbar (part of the
        // builder, but a separate DOM subtree over the stage).
        const rt = e.relatedTarget as Element | null
        if (rt && typeof rt.closest === 'function' && rt.closest('.robottool')) return
        if (shouldAutoHide(pinned, dockRef.current, e.relatedTarget)) onSetOpen(false)
      }}
    >
      <div className="robotbuild__head">
        <button
          type="button"
          className={`robotbuild__pin${pinned ? ' is-pinned' : ''}`}
          onClick={() => onSetPinned(!pinned)}
          title={pinned ? 'Unpin — hide when it loses focus' : 'Pin the panel open'}
          aria-label={pinned ? 'Unpin the build panel' : 'Pin the build panel open'}
        >
          <PinIcon pinned={pinned} />
        </button>
        <span className="robotbuild__title">Build</span>
        <button
          type="button"
          className="robotbuild__collapse"
          onClick={() => onSetOpen(false)}
          title="Hide"
          aria-label="Hide the build panel"
        >
          ‹
        </button>
      </div>

      {!canEdit && (
        <p className="robotbuild__hint">Save this robot to a folder to build.</p>
      )}

      <div className="robotbuild__tree">
        {/* The ONE hierarchy (#718) — the same component and the same rows the
            Electronics browser shows. Everything below (Servos, Poses) stays a
            Build-only branch. */}
        <HierarchyPanel
          nodes={hierarchy}
          workspace="build"
          selectedKey={selectedKey}
          onSelect={(node) => {
            onSelectNode(node)
            // A joint has no body to select — clicking it opens its editor,
            // exactly as the old chain's joint row did.
            if (node.kind === 'joint' && node.joint) onOpenJoint(node.joint.child, node.joint.name)
          }}
          open={!collapsed.chain}
          onToggleOpen={() => toggle('chain')}
          activeKey={activeKey}
          onEdit={(node) => {
            if (node.kind === 'joint' && node.joint) return onOpenJoint(node.joint.child, node.joint.name)
            if (node.link) onEdit(node.link === activeLink ? null : node.link)
          }}
          onContextMenu={(e, node) => {
            if (node.kind === 'joint' && node.joint) return openJointMenu(e, node.joint.name)
            if (node.link) openMenu(e, node.link)
          }}
          coverage={coverage}
          emptyHint="Add a block or import an STL to start building."
        />
        {rootLink === null && assembly.length > 1 && (
          <p className="robotbuild__hint">
            Several parts, no base yet — right-click a part ▸ <b>Make base</b> to start the chain.
          </p>
        )}

        {canEdit && (bindableServos.length > 0 || servos.length > 0 || joints.some((j) => j.type !== 'fixed')) && (
          <Section
            id="servos"
            label="Servos"
            count={bindableServos.length + orphanBindings.length}
            collapsed={collapsed}
            onToggle={toggle}
          >
            {/* Breadboard servos (#): the placed servo parts, each with a picker to
                bind its signal GPIO to a URDF joint — mirrors the Board View. */}
            {bindableServos.map((s) => {
              const cur = s.pin ? boundJoint(servos, s.pin) : null
              const on = active?.kind === 'servo' && !!s.pin && normPin(active.pin) === normPin(s.pin)
              return (
                <li className={`robotbuild__part${on ? ' is-sel' : ''}`} key={s.id}>
                  <div className="robotbuild__servo">
                    {s.pin && cur ? (
                      <button
                        type="button"
                        className="robotbuild__servo-name robotbuild__servo-name--link"
                        title={`${s.label} — click to calibrate GP${s.pin}`}
                        onClick={() => onOpenServo(s.pin as string)}
                      >
                        {s.label}
                      </button>
                    ) : (
                      <span className="robotbuild__servo-name" title={s.label}>
                        {s.label}
                      </span>
                    )}
                    {s.pin == null ? (
                      <span
                        className="robotbuild__servo-pin robotbuild__servo-pin--unwired"
                        title="Wire this servo's signal pin to a GPIO in the Board View"
                      >
                        unwired
                      </span>
                    ) : (
                      <>
                        <span className="robotbuild__servo-pin">GP{s.pin}</span>
                        <select
                          className="robotbuild__servo-joint"
                          value={cur ?? ''}
                          aria-label={`Joint driven by GP${s.pin}`}
                          onChange={(e) => onBindServo(s.pin as string, e.target.value)}
                        >
                          <option value="">→ (none)</option>
                          {jointOptions.map((j) => (
                            <option key={j} value={j}>
                              {j}
                            </option>
                          ))}
                        </select>
                      </>
                    )}
                  </div>
                  {/* "Already in my model" (#): the drop appended a loose 3-D copy of
                      this servo, but it's already a joint — remove the duplicate and
                      bind its pin to the existing joint (the picker above). */}
                  {s.meshLink && onRemoveMesh && (
                    <button
                      type="button"
                      className="robotbuild__servo-dupmesh"
                      title={`Already a joint in your model? Dropping this servo also added a loose 3-D copy ("${s.meshLink}"). Remove that copy — then bind GP${s.pin ?? '?'} to the joint above.`}
                      onClick={() => onRemoveMesh(s.meshLink as string)}
                    >
                      ⌦ remove duplicate 3-D copy
                    </button>
                  )}
                </li>
              )
            })}
            {/* Bindings NOT from a breadboard servo (manual / legacy) — open to calibrate. */}
            {orphanBindings.map((b) => {
              const on = active?.kind === 'servo' && normPin(active.pin) === normPin(b.pin)
              return (
                <li className="robotbuild__part" key={b.pin}>
                  <button
                    type="button"
                    className={`robotbuild__node${on ? ' is-on' : ''}`}
                    title={`Edit servo GP${normPin(b.pin)}`}
                    onClick={() => onOpenServo(b.pin)}
                  >
                    <span className="robotbuild__part-label">GP{normPin(b.pin)}</span>
                    <span className="robotbuild__part-geo">→ {b.joint || '—'}</span>
                  </button>
                </li>
              )
            })}
            <li className="robotbuild__part">
              <button
                type="button"
                className="robotbuild__node robotbuild__newpose"
                onClick={onNewServo}
                title="Bind a servo pin to a joint by hand"
              >
                ＋ Bind a servo by hand
              </button>
            </li>
          </Section>
        )}

        {canEdit && (
          <Section id="poses" label="Poses" count={poses.length} collapsed={collapsed} onToggle={toggle}>
            <li className="robotbuild__part">
              <button
                type="button"
                className="robotbuild__node robotbuild__newpose"
                onClick={onNewPose}
                title="Save the current joint positions as a new pose"
              >
                ＋ New pose
              </button>
            </li>
            {poses.map((p) => {
              const on = active?.kind === 'pose' && active.name === p.name
              return (
                <li className="robotbuild__part" key={p.name}>
                  <button
                    type="button"
                    className={`robotbuild__node${on ? ' is-on' : ''}`}
                    title={`Edit pose ${p.name}`}
                    onClick={() => onOpenPose(p.name)}
                  >
                    <span className="robotbuild__part-label">{p.name}</span>
                  </button>
                </li>
              )
            })}
          </Section>
        )}
      </div>

      {/* The mass summary (#555/#567), now honest about coverage (#719): the
          total is the sum of the WEIGHED parts, so it's a lower bound whenever
          the hierarchy's coverage line above says less than "all". Same numbers,
          one source — the old footer counted URDF links while the tree counted
          parts, and the two could disagree. */}
      {coverage.knownG > 0 && (
        <div
          className={`robotbuild__masstotal-bar${coverage.complete ? '' : ' is-partial'}`}
          title={
            coverage.complete
              ? 'Sum of every part’s mass — every part is weighed.'
              : `Only ${coverage.known} of ${coverage.total} parts are weighed, so this is a LOWER BOUND — the rest are left out, not guessed. Set a part's mass in its Properties.`
          }
        >
          <span>Total mass</span>
          <span className="robotbuild__masstotal-g">
            {Math.round(coverage.knownG)} g{coverage.complete ? '' : '+'}
          </span>
        </div>
      )}

      <div className="robotbuild__foot">
        <button
          type="button"
          className="robotbuild__open"
          onClick={onOpenRobot}
          title="Open a different robot (.urdf) — works when popped out full-screen"
        >
          <FolderOpenIcon size={13} /> Open…
        </button>
        <button
          type="button"
          className="robotbuild__stl"
          disabled={!canImport || importing}
          onClick={onImportStl}
          title={canImport ? 'Import an STL / DAE mesh' : 'Save the robot to a project folder to import meshes'}
        >
          {importing ? 'Importing…' : '+ STL / DAE'}
        </button>
        <button
          type="button"
          className="robotbuild__stl"
          disabled={!canExport}
          onClick={onExportUrdf}
          title={
            canExport
              ? 'Write a clean, tidy copy of this URDF into the project’s urdf/ folder'
              : 'Open the robot from a project folder to export it'
          }
        >
          ⬇ Export URDF
        </button>
      </div>
      {menu && (
        <ContextMenu position={menu.pos} items={menuItems(menu.link)} onClose={() => setMenu(null)} />
      )}
      {jmenu && (
        <ContextMenu position={jmenu.pos} items={jointMenuItems(jmenu.joint)} onClose={() => setJmenu(null)} />
      )}
    </aside>
  )
}

export default RobotBuildPanel
