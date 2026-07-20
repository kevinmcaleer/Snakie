import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AssemblyItem,
  ChainNode,
  PrimitiveGeom,
  JointDef,
  JointFull,
  JointType,
  JointSpec
} from './robot-assembly'
import { buildChainTree } from './robot-assembly'
import type { Vec3 } from './robot-build'
import { principalAxisName } from './robot-build'
import { toDisplay, toNative, unitLabel, normPin, type MovableType } from './robot-pose'
import { boundJoint, type BindableServo } from './servo-bind'
import { shouldAutoHide } from './pin-overlay'
import { sourceLabel, type MassBreakdown, type MassSort } from './robot-mass'
import type { ServoJointBinding } from '../../../shared/robot'
import type { NamedPoseLike } from './robot-pose'
import type { PropsContext } from './RobotPropertiesDialog'
import { ContextMenu, type ContextMenuItem, type ContextMenuPosition } from './ContextMenu'
import { usePrompt } from './PromptModal'
import { FolderOpenIcon } from './ui-icons'
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
const PENCIL = (
  <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
    <path d="M11.5 1.5l3 3L5 14l-3.5.5L2 11z" fill="none" stroke="currentColor" strokeWidth="1.4" />
  </svg>
)
// An anchor marks the base link (Fusion-style) — the part everything hangs off.
const ANCHOR = (
  <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
    <circle cx="8" cy="3" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.3" />
    <path
      d="M8 4.8V14M4 8H2.4c0 3 2.4 4.8 5.6 4.8S13.6 11 13.6 8H12M4.8 10.2L8 13l3.2-2.8"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)
// Row type glyphs (#): tell a MESH-backed link apart from a primitive/block at a
// glance — a little triangle-mesh vs a cube, sat between the elbow and the pencil.
const MESH_ICON = (
  <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
    <path
      d="M8 2.2l5.6 9.6H2.4z M8 2.2v9.6 M4.9 8.6h6.2"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
    />
  </svg>
)
const CUBE_ICON = (
  <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
    <path
      d="M8 2.3l5.4 3.1v5.2L8 13.7 2.6 10.6V5.4z M2.6 5.4L8 8.5l5.4-3.1 M8 8.5v5.2"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
    />
  </svg>
)

export interface RobotBuildPanelProps {
  open: boolean
  pinned: boolean
  onSetOpen: (open: boolean) => void
  onSetPinned: (pinned: boolean) => void
  assembly: AssemblyItem[]
  /** The model's joints, servo bindings and named poses — extra tree branches. */
  joints: JointFull[]
  servos: ServoJointBinding[]
  /** Breadboard servos (placed servo parts) that can be bound to a joint (#). */
  bindableServos: BindableServo[]
  /** Joint names a servo can drive (the bind picker's options). */
  jointOptions: string[]
  /** Bind a servo's GPIO to a joint (`''` unbinds). */
  onBindServo: (pin: string, joint: string) => void
  poses: NamedPoseLike[]
  selected: string | null
  onSelect: (link: string | null) => void
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
  /** Per-link mass breakdown + total (#555 part 2), or null when nothing has a mass. */
  massSummary?: MassBreakdown | null
  /** Current breakdown sort, and a setter (the table's "by mass / by name" toggle). */
  massSort: MassSort
  onSetMassSort: (sort: MassSort) => void
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

/** Kid-friendly label for a joint type (matches the joint editor's chips). */
function jointTypeLabel(type: JointType): string {
  return JOINT_KINDS.find((k) => k.id === type)?.label ?? type
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
  return (
    <div className="robotbuild__section">
      <button
        type="button"
        className="robotbuild__branch"
        aria-expanded={!isCollapsed}
        onClick={() => onToggle(id)}
      >
        <span className="robotbuild__caret">{isCollapsed ? '▸' : '▾'}</span>
        <span className="robotbuild__branch-label">{label}</span>
        <span className="robotbuild__branch-count">{count}</span>
      </button>
      {!isCollapsed && <ul className="robotbuild__parts">{children}</ul>}
    </div>
  )
}

/** Grams for the table, whole numbers once past ~10 g, else one decimal. */
const fmtRowGrams = (g: number): string =>
  g >= 10 ? Math.round(g).toString() : (Math.round(g * 10) / 10).toString()

/**
 * The Mass summary (#555 part 2): a total-mass readout + a per-link table you
 * can sort by mass (what dominates) or name. Collapsible like the other tree
 * sections; clicking a row opens that link's inspector. Rows with no mass show
 * a dash so it's obvious what's still un-weighed.
 */
function MassSummary({
  summary,
  sort,
  onSetSort,
  collapsed,
  onToggle,
  onSelect
}: {
  summary: MassBreakdown
  sort: MassSort
  onSetSort: (s: MassSort) => void
  collapsed: Record<string, boolean>
  onToggle: (id: string) => void
  onSelect: (link: string) => void
}): JSX.Element {
  const isCollapsed = !!collapsed.mass
  return (
    <div className="robotbuild__section">
      <button
        type="button"
        className="robotbuild__branch"
        aria-expanded={!isCollapsed}
        onClick={() => onToggle('mass')}
      >
        <span className="robotbuild__caret">{isCollapsed ? '▸' : '▾'}</span>
        <span className="robotbuild__branch-label">Mass</span>
        <span className="robotbuild__branch-count robotbuild__masstotal">
          {Math.round(summary.totalG)} g
        </span>
      </button>
      {!isCollapsed && (
        <div className="robotbuild__masstable">
          <div className="robotbuild__masssort" role="group" aria-label="Sort mass table">
            <button
              type="button"
              className={sort === 'mass' ? 'is-on' : ''}
              onClick={() => onSetSort('mass')}
            >
              by mass
            </button>
            <button
              type="button"
              className={sort === 'name' ? 'is-on' : ''}
              onClick={() => onSetSort('name')}
            >
              by name
            </button>
          </div>
          {summary.rows.map((r) => (
            <button
              key={r.link}
              type="button"
              className="robotbuild__massrow"
              onClick={() => onSelect(r.link)}
              title={`Edit ${r.link}'s mass`}
            >
              <span className="robotbuild__massrow-link">{r.link}</span>
              <span className="robotbuild__massrow-g">
                {r.grams > 0 ? `${fmtRowGrams(r.grams)} g` : '—'}
              </span>
              <span className={`robotbuild__massrow-src robotbuild__massrow-src--${r.source}`}>
                {r.grams > 0 ? sourceLabel(r.source) : 'not set'}
              </span>
            </button>
          ))}
          {summary.unsetCount > 0 && (
            <p className="robotbuild__masshint">
              {summary.unsetCount} link{summary.unsetCount === 1 ? '' : 's'} with no mass — the total
              is a lower bound.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

const INDENT = 14 // px of indent per depth level in the chain tree

// A distinct glyph per joint type (#): a lock (fixed), a rotation arrow (hinge /
// revolute), a spoked wheel (continuous) and a slider track (prismatic).
const JOINT_ICONS: Record<JointType, JSX.Element> = {
  fixed: (
    <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
      <path d="M5 7V5.2a3 3 0 0 1 6 0V7" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <rect x="3.6" y="7" width="8.8" height="6" rx="1.1" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  ),
  revolute: (
    <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
      <path d="M12.6 8a4.6 4.6 0 1 1-1.5-3.4" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M12.7 3.2v2.4h-2.4" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  ),
  continuous: (
    <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
      <circle cx="8" cy="8" r="5.2" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="8" cy="8" r="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 2.8v2M8 11.2v2M2.8 8h2M11.2 8h2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  ),
  prismatic: (
    <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
      <path d="M3 8h10M4.6 5.8v4.4M11.4 5.8v4.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <rect x="6.5" y="5.9" width="3" height="4.2" rx="0.9" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

/** One JOINT row of the Chain tree (#): the connecting joint sits directly above its
 *  child link at the same indent — a type icon, the (editable) joint NAME, and its
 *  type badge. Click opens the joint dialog; right-click renames. */
function JointRow({
  node,
  isActive,
  onOpen,
  onContextMenu
}: {
  node: ChainNode
  isActive: boolean
  onOpen: (child: string, joint: string) => void
  onContextMenu: (e: React.MouseEvent, joint: string) => void
}): JSX.Element | null {
  if (!node.joint) return null
  const j = node.joint
  return (
    <li className="robotbuild__joint-row" style={{ paddingLeft: node.depth * INDENT }}>
      <span className="robotbuild__joint-elbow" aria-hidden="true">
        ├
      </span>
      <span className="robotbuild__joint-icon" aria-hidden="true">
        {JOINT_ICONS[j.type] ?? JOINT_ICONS.fixed}
      </span>
      <button
        type="button"
        className={`robotbuild__joint-name${isActive ? ' is-on' : ''}`}
        title={`Joint “${j.name}” · ${jointTypeLabel(j.type)} · ${j.parent} → ${node.link} — click to edit, right-click to rename`}
        onClick={() => onOpen(node.link, j.name)}
        onContextMenu={(e) => onContextMenu(e, j.name)}
      >
        {j.name}
      </button>
      <span className="robotbuild__joint-badge">{jointTypeLabel(j.type)}</span>
    </li>
  )
}

/** One row of the kinematic Chain tree (#354): the part name (indented by depth), the
 *  joint type that connects it to its parent, and a "loose" flag for unconnected parts. */
function ChainRow({
  node,
  isSel,
  isEdit,
  onSelect,
  onEdit,
  onContextMenu
}: {
  node: ChainNode
  isSel: boolean
  isEdit: boolean
  onSelect: (link: string) => void
  onEdit: (link: string | null) => void
  onContextMenu: (e: React.MouseEvent, link: string) => void
}): JSX.Element {
  const geo = node.kind === 'mesh' ? node.mesh?.match(/\.(\w+)$/)?.[1]?.toLowerCase() ?? 'mesh' : node.kind
  return (
    <li
      className={`robotbuild__part${isSel ? ' is-sel' : ''}${node.loose ? ' robotbuild__chain--loose' : ''}`}
      style={{ paddingLeft: node.depth * INDENT }}
      onContextMenu={(e) => onContextMenu(e, node.link)}
    >
      <div className="robotbuild__part-row">
        {node.depth > 0 && (
          <span className="robotbuild__chain-elbow" aria-hidden="true">
            └
          </span>
        )}
        <span
          className={`robotbuild__rowbase${node.isBase ? ' is-base' : ''}`}
          title={node.isBase ? 'This is the base — everything hangs off it' : undefined}
          aria-hidden={node.isBase ? undefined : true}
        >
          {node.isBase ? ANCHOR : null}
        </span>
        <span
          className="robotbuild__typeicon"
          title={node.kind === 'mesh' ? 'Mesh part' : 'Primitive block'}
          aria-hidden="true"
        >
          {node.kind === 'mesh' ? MESH_ICON : CUBE_ICON}
        </span>
        <button
          type="button"
          className={`robotbuild__edit${isEdit ? ' is-on' : ''}`}
          onClick={() => onEdit(isEdit ? null : node.link)}
          title={isEdit ? 'Close properties' : 'Edit properties'}
          aria-label={`Edit ${node.link}`}
        >
          {PENCIL}
        </button>
        <button
          type="button"
          className="robotbuild__part-name"
          title={`${node.link} — right-click for rename / base / delete / attach`}
          onClick={() => onSelect(node.link)}
          onContextMenu={(e) => onContextMenu(e, node.link)}
        >
          <span className="robotbuild__part-label">{node.link}</span>
          <span className={`robotbuild__part-geo${node.kind === 'mesh' ? ' is-mesh' : ''}`}>{geo}</span>
        </button>
        {node.loose ? (
          <span className="robotbuild__loose-tag" title="Not connected to the base — open it and pick a parent">
            ⚠ loose
          </span>
        ) : null}
      </div>
    </li>
  )
}

export function RobotBuildPanel(props: RobotBuildPanelProps): JSX.Element {
  const {
    open,
    pinned,
    onSetOpen,
    onSetPinned,
    assembly,
    joints,
    servos,
    poses,
    selected,
    onSelect,
    active,
    onEdit,
    onOpenJoint,
    onRenameJoint,
    onOpenServo,
    onNewServo,
    bindableServos,
    jointOptions,
    onBindServo,
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
    onOpenRobot,
    massSummary,
    massSort,
    onSetMassSort
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

  // The kinematic chain, flattened for an indented list: base's subtree first, then any
  // loose (unconnected) parts. This replaces the flat Blocks/Meshes/Joints lists so the
  // parent→child structure is always visible.
  const tree = useMemo(() => buildChainTree(assembly, joints, rootLink), [assembly, joints, rootLink])
  const activeLink =
    active?.kind === 'link' ? active.link : active?.kind === 'joint' ? active.child : null
  const activeJoint = active?.kind === 'joint' ? active.joint : null
  const looseStart = tree.findIndex((n) => n.loose)
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
        {tree.length > 0 && (
          <Section id="chain" label="Chain" count={tree.length} collapsed={collapsed} onToggle={toggle}>
            {tree.map((node, i) => (
              <Fragment key={node.link}>
                {i === looseStart && looseStart > 0 && (
                  <li className="robotbuild__loose-head" aria-hidden="true">
                    Not connected
                  </li>
                )}
                {/* The connecting joint sits directly above its child link (#). */}
                <JointRow
                  node={node}
                  isActive={!!node.joint && activeJoint === node.joint.name}
                  onOpen={onOpenJoint}
                  onContextMenu={openJointMenu}
                />
                <ChainRow
                  node={node}
                  isSel={node.link === selected}
                  isEdit={node.link === activeLink}
                  onSelect={onSelect}
                  onEdit={onEdit}
                  onContextMenu={openMenu}
                />
              </Fragment>
            ))}
          </Section>
        )}
        {massSummary && massSummary.rows.length > 0 && (
          <MassSummary
            summary={massSummary}
            sort={massSort}
            onSetSort={onSetMassSort}
            collapsed={collapsed}
            onToggle={toggle}
            onSelect={onEdit}
          />
        )}
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
        {assembly.length === 0 && (
          <p className="robotbuild__hint">Add a block or import an STL to start building.</p>
        )}
      </div>

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
