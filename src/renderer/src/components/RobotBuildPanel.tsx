import { useEffect, useRef, useState } from 'react'
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
import { baseName } from './robot-mesh'
import { shouldAutoHide } from './pin-overlay'
import type { ServoJointBinding } from '../../../shared/robot'
import type { NamedPoseLike } from './RobotJointPanel'
import type { PropsContext } from './RobotPropertiesDialog'
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

export interface RobotBuildPanelProps {
  open: boolean
  pinned: boolean
  onSetOpen: (open: boolean) => void
  onSetPinned: (pinned: boolean) => void
  assembly: AssemblyItem[]
  /** The model's joints, servo bindings and named poses — extra tree branches. */
  joints: JointFull[]
  servos: ServoJointBinding[]
  poses: NamedPoseLike[]
  selected: string | null
  onSelect: (link: string | null) => void
  /** The node whose context dialog is open (highlighted in the tree). */
  active: PropsContext | null
  onEdit: (link: string | null) => void
  onOpenJoint: (child: string, joint: string) => void
  onOpenServo: (pin: string) => void
  onOpenPose: (name: string) => void
  /** The current root link, and an action to re-root the model at a link. */
  rootLink: string | null
  onMakeBase: (link: string) => void
  onDelete: (link: string) => void
  onImportStl: () => void
  canImport: boolean
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
  onChange
}: {
  joint: JointDef
  names: string[]
  onChange: (spec: JointSpec) => void
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

/** A block / mesh row: base marker (☆/★), edit pencil, delete, and the name
 *  (click selects + zooms). Shared by the Blocks + Meshes branches. */
function BodyRow({
  it,
  isSel,
  isEdit,
  isRoot,
  loose = false,
  onSelect,
  onEdit,
  onMakeBase,
  onDelete
}: {
  it: AssemblyItem
  isSel: boolean
  isEdit: boolean
  isRoot: boolean
  loose?: boolean
  onSelect: (link: string) => void
  onEdit: (link: string | null) => void
  onMakeBase: (link: string) => void
  onDelete: (link: string) => void
}): JSX.Element {
  return (
    <li className={`robotbuild__part${isSel ? ' is-sel' : ''}${loose ? ' is-loose' : ''}`}>
      <div className="robotbuild__part-row">
        {/* Action icons sit to the LEFT of the name so they never overlap long
            titles (the name button flexes to fill the rest). */}
        {isRoot ? (
          <span className="robotbuild__rowbase is-base" title="This is the base — every block hangs off it">
            ★
          </span>
        ) : (
          <button
            type="button"
            className="robotbuild__rowbase"
            onClick={() => onMakeBase(it.link)}
            title="Make this the base"
            aria-label={`Make ${it.link} the base`}
          >
            ☆
          </button>
        )}
        <button
          type="button"
          className={`robotbuild__edit${isEdit ? ' is-on' : ''}`}
          onClick={() => onEdit(isEdit ? null : it.link)}
          title={isEdit ? 'Close properties' : 'Edit properties'}
          aria-label={`Edit ${it.link}`}
        >
          {PENCIL}
        </button>
        <button
          type="button"
          className="robotbuild__del"
          disabled={isRoot}
          onClick={() => onDelete(it.link)}
          title={
            isRoot
              ? 'The base can’t be deleted — make another block the base first'
              : `Delete ${it.link}`
          }
          aria-label={`Delete ${it.link}`}
        >
          ✕
        </button>
        <button
          type="button"
          className="robotbuild__part-name"
          title={it.link}
          onClick={() => onSelect(it.link)}
        >
          <span className="robotbuild__part-label">{it.link}</span>
          <span className={`robotbuild__part-geo${it.kind === 'mesh' ? ' is-mesh' : ''}`}>
            {it.kind === 'mesh' ? baseName(it.mesh ?? '') : it.kind}
          </span>
        </button>
        {loose && (
          <span className="robotbuild__loosebadge" title="Not connected — join it into the robot">
            not connected
          </span>
        )}
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
    onOpenServo,
    onOpenPose,
    rootLink,
    onMakeBase,
    onDelete,
    onImportStl,
    canImport,
    importing,
    canEdit,
    onOpenRobot
  } = props
  const dockRef = useRef<HTMLElement | null>(null)
  // Which tree branches are collapsed (all expanded by default).
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const toggle = (id: string): void => setCollapsed((c) => ({ ...c, [id]: !c[id] }))

  // A part is LOOSE (not connected yet) when it has no parent joint AND it isn't the
  // chosen base — i.e. an imported part still waiting to be joined into the chain.
  const jointChildren = new Set(joints.map((j) => j.child))
  const isLoose = (it: AssemblyItem): boolean => !jointChildren.has(it.link) && it.link !== rootLink
  const looseParts = assembly.filter(isLoose)
  const blocks = assembly.filter((it) => it.kind !== 'mesh' && !isLoose(it))
  const meshes = assembly.filter((it) => it.kind === 'mesh' && !isLoose(it))
  // No base picked yet but parts exist → prompt the user to choose one.
  const needsBase = rootLink === null && assembly.length > 0
  const editLink = active?.kind === 'link' ? active.link : null

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
        {needsBase && (
          <p className="robotbuild__basehint">
            ⭐ Pick a <strong>base</strong> part (tap its ☆) — it&rsquo;s the anchor the
            rest of the robot hangs off.
          </p>
        )}
        {looseParts.length > 0 && (
          <Section
            id="loose"
            label="Not connected yet"
            count={looseParts.length}
            collapsed={collapsed}
            onToggle={toggle}
          >
            <li className="robotbuild__loosehint">
              Join each of these to your robot with the Add Joint tool — or tap ☆ to make
              one the base.
            </li>
            {looseParts.map((it) => (
              <BodyRow
                key={it.link}
                it={it}
                isSel={it.link === selected}
                isEdit={it.link === editLink}
                isRoot={false}
                loose
                onSelect={onSelect}
                onEdit={onEdit}
                onMakeBase={onMakeBase}
                onDelete={onDelete}
              />
            ))}
          </Section>
        )}
        <Section id="blocks" label="Blocks" count={blocks.length} collapsed={collapsed} onToggle={toggle}>
          {blocks.map((it) => (
            <BodyRow
              key={it.link}
              it={it}
              isSel={it.link === selected}
              isEdit={it.link === editLink}
              isRoot={it.link === rootLink}
              onSelect={onSelect}
              onEdit={onEdit}
              onMakeBase={onMakeBase}
              onDelete={onDelete}
            />
          ))}
          {blocks.length === 0 && <li className="robotbuild__empty">No blocks yet — add one above.</li>}
        </Section>

        <Section id="meshes" label="Meshes" count={meshes.length} collapsed={collapsed} onToggle={toggle}>
          {meshes.map((it) => (
            <BodyRow
              key={it.link}
              it={it}
              isSel={it.link === selected}
              isEdit={it.link === editLink}
              isRoot={it.link === rootLink}
              onSelect={onSelect}
              onEdit={onEdit}
              onMakeBase={onMakeBase}
              onDelete={onDelete}
            />
          ))}
          {meshes.length === 0 && <li className="robotbuild__empty">No imported meshes.</li>}
        </Section>

        <Section id="joints" label="Joints" count={joints.length} collapsed={collapsed} onToggle={toggle}>
          {joints.map((j) => {
            const on = active?.kind === 'joint' && active.joint === j.name
            return (
              <li className="robotbuild__part" key={j.name}>
                <button
                  type="button"
                  className={`robotbuild__node${on ? ' is-on' : ''}`}
                  title={`Edit joint ${j.name}`}
                  onClick={() => onOpenJoint(j.child, j.name)}
                >
                  <span className="robotbuild__part-label">{j.name}</span>
                  <span className="robotbuild__part-geo">{jointTypeLabel(j.type)}</span>
                </button>
              </li>
            )
          })}
          {joints.length === 0 && <li className="robotbuild__empty">No joints.</li>}
        </Section>

        <Section id="servos" label="Servos" count={servos.length} collapsed={collapsed} onToggle={toggle}>
          {servos.map((b) => {
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
          {servos.length === 0 && <li className="robotbuild__empty">No servos mapped.</li>}
        </Section>

        <Section id="poses" label="Poses" count={poses.length} collapsed={collapsed} onToggle={toggle}>
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
          {poses.length === 0 && <li className="robotbuild__empty">No saved poses.</li>}
        </Section>
      </div>

      <div className="robotbuild__foot">
        <button
          type="button"
          className="robotbuild__open"
          onClick={onOpenRobot}
          title="Open a different robot (.urdf) — works when popped out full-screen"
        >
          📂 Open…
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
      </div>
    </aside>
  )
}

export default RobotBuildPanel
