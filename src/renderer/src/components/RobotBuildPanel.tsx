import { useEffect, useRef, useState } from 'react'
import type { AssemblyItem, PrimitiveGeom, JointDef, JointType, JointSpec } from './robot-assembly'
import type { PrimitiveKind, Vec3 } from './robot-build'
import { principalAxisName } from './robot-build'
import { toDisplay, toNative, unitLabel, type MovableType } from './robot-pose'
import { baseName } from './robot-mesh'
import { shouldAutoHide } from './pin-overlay'
import './RobotBuildPanel.css'

/**
 * ROBOT BUILD PANEL (#315a) — a floating, transparent, PINNABLE dock on the LEFT
 * of the pose tool (mirrors the breadboard's library dock). It holds the model
 * hierarchy (view-by-default; a pencil per row enters edit), buttons to add
 * box / cylinder / sphere blocks (each sticks to the selected part), the STL
 * import, and — while a primitive is being edited — a numeric size form. All the
 * 3-D interaction (select, push/pull faces) lives in RobotView.
 */
const STAR = (
  <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
    <path
      d="M8 1.6l1.9 3.9 4.3.6-3.1 3 .8 4.3L8 11.9 4.1 13.4l.8-4.3-3.1-3 4.3-.6z"
      fill="currentColor"
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
  selected: string | null
  onSelect: (link: string | null) => void
  editLink: string | null
  onEdit: (link: string | null) => void
  /** Geometry of the link being edited (for the size form), or null. */
  editGeom: PrimitiveGeom | null
  onAdd: (kind: PrimitiveKind) => void
  onSetSize: (link: string, dims: number[]) => void
  /** The parent joint of the link being edited (null for the root), + a setter. */
  editJoint: JointDef | null
  jointNames: string[]
  onSetJoint: (link: string, spec: JointSpec) => void
  /** The current root link, and an action to re-root the model at a link. */
  rootLink: string | null
  onMakeBase: (link: string) => void
  onDelete: (link: string) => void
  onImportStl: () => void
  canImport: boolean
  importing: boolean
  /** Editing needs a saved project file — disables add/edit with a hint. */
  canEdit: boolean
}

/** metres → integer mm (display) and back. */
const mm = (m: number): number => Math.round(m * 1000)
const toM = (millis: number): number => millis / 1000

function SizeForm({
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
function JointForm({
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

export function RobotBuildPanel(props: RobotBuildPanelProps): JSX.Element {
  const {
    open,
    pinned,
    onSetOpen,
    onSetPinned,
    assembly,
    selected,
    onSelect,
    editLink,
    onEdit,
    editGeom,
    onAdd,
    onSetSize,
    editJoint,
    jointNames,
    onSetJoint,
    rootLink,
    onMakeBase,
    onDelete,
    onImportStl,
    canImport,
    importing,
    canEdit
  } = props
  const dockRef = useRef<HTMLElement | null>(null)

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
          {STAR}
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

      <div className="robotbuild__add" role="group" aria-label="Add a block">
        {(['box', 'cylinder', 'sphere'] as const).map((k) => (
          <button
            key={k}
            type="button"
            disabled={!canEdit}
            onClick={() => onAdd(k)}
            title={canEdit ? `Add a ${k}` : 'Save the robot to a project folder first'}
          >
            {k === 'box' ? '▦ Box' : k === 'cylinder' ? '⬭ Tube' : '● Ball'}
          </button>
        ))}
      </div>
      <p className="robotbuild__hint">
        {canEdit ? 'A new block sticks to the part you picked.' : 'Save this robot to a folder to build.'}
      </p>

      <ul className="robotbuild__parts">
        {assembly.map((it) => {
          const isSel = it.link === selected
          const isEdit = it.link === editLink
          return (
            <li
              className={`robotbuild__part${isSel ? ' is-sel' : ''}`}
              key={it.link}
            >
              <div className="robotbuild__part-row">
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
                <button
                  type="button"
                  className={`robotbuild__edit${isEdit ? ' is-on' : ''}`}
                  onClick={() => onEdit(isEdit ? null : it.link)}
                  title={isEdit ? 'Done editing' : 'Edit this block'}
                  aria-label={`Edit ${it.link}`}
                >
                  {PENCIL}
                </button>
              </div>
              {isEdit &&
                (() => {
                  const isRoot = it.link === rootLink
                  return (
                    <div className="robotbuild__editrow">
                      <div className="robotbuild__editmain">
                        {editGeom ? (
                          <SizeForm geom={editGeom} onChange={(d) => onSetSize(it.link, d)} />
                        ) : (
                          <span className="robotbuild__editnote">Grab a face in 3D to resize, or…</span>
                        )}
                        {editJoint && (
                          <JointForm
                            joint={editJoint}
                            names={jointNames}
                            onChange={(spec) => onSetJoint(it.link, spec)}
                          />
                        )}
                        {isRoot ? (
                          <span className="robotbuild__basebadge" title="Every other block hangs off the base">
                            ★ This is the base
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="robotbuild__makebase"
                            onClick={() => onMakeBase(it.link)}
                            title="Make this the base — the whole model re-hangs off this block"
                          >
                            ★ Make base
                          </button>
                        )}
                      </div>
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
                      >
                        ✕
                      </button>
                    </div>
                  )
                })()}
            </li>
          )
        })}
        {assembly.length === 0 && <li className="robotbuild__empty">No blocks yet — add one above.</li>}
      </ul>

      <div className="robotbuild__foot">
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
