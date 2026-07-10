import { useEffect, useRef, useState } from 'react'
import type { JointDef, JointType, JointSpec, PrimitiveGeom } from './robot-assembly'
import type { ServoJointBinding } from '../../../shared/robot'
import {
  normPin,
  effectiveLimit,
  mimicValue,
  toDisplay,
  toNative,
  unitLabel,
  type NamedPoseLike,
  type JointMeta
} from './robot-pose'
import { SizeForm, JointForm } from './RobotBuildPanel'
import { SwatchPicker } from './SwatchPicker'
import './RobotPropertiesDialog.css'

/**
 * The thing the Properties dialog is editing (#353). A block/mesh shows its size
 * + joint; a joint shows just the joint form; a servo shows its binding editor;
 * a pose shows recall / rename / delete. Clicking any hierarchy node opens the
 * matching context here (Fusion-style), on the right.
 */
export type PropsContext =
  | { kind: 'link'; link: string }
  | { kind: 'joint'; child: string; joint: string }
  | { kind: 'servo'; pin: string }
  | { kind: 'pose'; name: string }
  | { kind: 'addjoint' }

/** A short human title for the dialog header, per context. */
function contextTitle(ctx: PropsContext): string {
  switch (ctx.kind) {
    case 'link':
      return ctx.link
    case 'joint':
      return ctx.joint
    case 'servo':
      return `Servo — GP${normPin(ctx.pin)}`
    case 'pose':
      return `Pose — ${ctx.name}`
    case 'addjoint':
      return 'Add Joint'
  }
}

export interface RobotPropertiesDialogProps {
  context: PropsContext
  // link / joint
  geom: PrimitiveGeom | null
  joint: JointDef | null
  jointNames: string[]
  onSetSize: (link: string, dims: number[]) => void
  /** The edited link's colour (#rrggbb), or undefined for the default. */
  linkColor?: string
  /** Whether this link can be recoloured (a primitive, or an STL mesh — not DAE). */
  colorable: boolean
  /** Colours already used on the robot's links, for the quick-pick swatches. */
  usedColors: string[]
  /** Set a link's colour (#rrggbb) — recolours only that link, live + persisted. */
  onSetColor: (link: string, hex: string) => void
  onSetJoint: (link: string, spec: JointSpec) => void
  /** Rename the open joint — cascades the servo map + poses (#). */
  onRenameJoint: (oldName: string, newName: string) => void
  /** Reposition the joint origin (offset, mm→m) and set its ABSOLUTE roll about its
   *  own normal axis (deg) — both applied live as the field changes. */
  onSetJointOrigin: (child: string, xyz: [number, number, number]) => void
  onRollJoint: (child: string, absDeg: number) => void
  /** The open joint's current absolute roll (deg), for seeding the Roll field. */
  jointRoll?: number
  /** Valid parents for the open part (every link except itself + its descendants). */
  parentOptions: string[]
  /** The part's current parent link (null for the base / a loose root). */
  currentParent: string | null
  /** True when the open part is the base (no parent — the picker is hidden). */
  isBase: boolean
  /** Re-home the part under a new parent — keeps it where it is, only moves it in the chain. */
  onSetParent: (child: string, parent: string) => void
  /** Remove the joint whose child is this link (the block re-attaches to the base). */
  onDeleteJoint: (child: string) => void
  // servo
  servo: ServoJointBinding | null
  movableJoints: string[]
  onSetServo: (pin: string, patch: Partial<ServoJointBinding>) => void
  onDeleteServo: (pin: string) => void
  // pose
  pose: NamedPoseLike | null
  /** All pose names (to reject renaming onto an existing pose). */
  poseNames: string[]
  onRecallPose: (pose: NamedPoseLike) => void
  onRenamePose: (oldName: string, newName: string) => void
  onDeletePose: (name: string) => void
  /** Duplicate a pose under a unique "<name> copy" name (#414). */
  onDuplicatePose: (name: string) => void
  /** True while a running program's servo telemetry is driving a mapped joint —
   *  the pose editor shows a "Live ●" hint that a Capture reads that posture (#414). */
  poseLive?: boolean
  /** The movable joints + live values, so the pose editor can pose the robot with
   *  sliders (the retired pose sidebar's controls moved here — #312). */
  jointMeta: JointMeta[]
  values: Record<string, number>
  overrides: Record<string, { min?: number; max?: number }>
  onJointChange: (name: string, native: number) => void
  /** Capture the live posture as a pose. `include` (when given) writes only those
   *  joints — a PARTIAL pose that leaves the rest untouched on recall (#414). */
  onSavePose: (name: string, include?: string[]) => void
  onResetPose: () => void
  // addjoint (#354 — pick two points in 3-D)
  /** The Add Joint pick state (which block/point is Component 1 / 2), driven by
   *  clicks in the 3-D view. */
  jointPick: JointPickView | null
  /** Arm the picker for a component again (the next 3-D click re-picks it). */
  onRepick: (step: 'parent' | 'child') => void
  /** Swap which pick is the parent vs the child (flip the hierarchy). */
  onSwapPicks: () => void
  /** Create the joint from the two picks + chosen type + offset (mm) + a roll angle
   *  (degrees) about the joint normal. Returns false (keeps the dialog open) if the
   *  picks are incomplete / would loop. */
  onConnectPicked: (
    type: JointType,
    offsetMm: [number, number, number],
    rotation?: { minDeg: number; maxDeg: number; defaultDeg: number },
    angleDeg?: number
  ) => boolean
  /** Live-preview the mate (same params) as soon as both points are picked / when they
   *  change, so the user sees the result before Add. Reverted on Cancel. */
  onPreview: (
    type: JointType,
    offsetMm: [number, number, number],
    rotation: { minDeg: number; maxDeg: number; defaultDeg: number } | undefined,
    angleDeg: number
  ) => void
  // footer
  onOk: () => void
  onCancel: () => void
}

/** A component picked in 3-D for the Join tool: its link + the snap role. */
export interface JointPickView {
  step: 'parent' | 'child'
  parent: { link: string; role: string } | null
  child: { link: string; role: string } | null
}

/**
 * PROPERTIES DIALOG (#352 / #353, Fusion-style) — a floating, draggable dialog on
 * the RIGHT holding the properties of the hierarchy node being edited. For a
 * block/mesh/joint, edits apply live to the 3-D preview and the footer commits
 * (**OK**) or reverts (**Cancel**) via a URDF snapshot RobotView takes on open.
 * Servo + pose edits are held locally and only committed on **OK** (a `commitRef`
 * the body registers), so **Cancel** simply discards them.
 *
 * Mounted with a per-node `key` so switching nodes gives fresh local state.
 */
export function RobotPropertiesDialog(props: RobotPropertiesDialogProps): JSX.Element {
  const { context, onOk, onCancel } = props

  // Bodies with a local draft (servo/pose/addjoint) register a commit here; OK
  // runs it. A commit that returns `false` (an invalid Add-Joint pick) keeps the
  // dialog open instead of closing as if it succeeded.
  const commitRef = useRef<(() => void | boolean) | null>(null)

  // Drag the dialog by its title bar. `pos` null = the default docked spot (CSS).
  // `left`/`top` are relative to the dialog's positioned ancestor (the 3-D stage),
  // NOT the viewport — so we convert the (viewport) pointer coords by the ancestor's
  // offset; otherwise the dialog jumps by that offset on the first move.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const drag = useRef<{ dx: number; dy: number; ox: number; oy: number } | null>(null)
  const onHeadDown = (e: React.PointerEvent): void => {
    const aside = e.currentTarget.parentElement as HTMLElement
    const rect = aside.getBoundingClientRect()
    const parent = (aside.offsetParent as HTMLElement | null)?.getBoundingClientRect()
    drag.current = {
      dx: e.clientX - rect.left, // cursor offset within the dialog
      dy: e.clientY - rect.top,
      ox: parent?.left ?? 0, // the ancestor's viewport offset
      oy: parent?.top ?? 0
    }
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  }
  const onHeadMove = (e: React.PointerEvent): void => {
    if (!drag.current) return
    const d = drag.current
    setPos({ x: e.clientX - d.dx - d.ox, y: e.clientY - d.dy - d.oy })
  }
  const onHeadUp = (e: React.PointerEvent): void => {
    drag.current = null
    ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
  }

  const style = pos ? { left: `${pos.x}px`, top: `${pos.y}px`, right: 'auto' } : undefined
  const title = contextTitle(context)
  const handleOk = (): void => {
    if (commitRef.current?.() === false) return // invalid — keep the dialog open
    onOk()
  }

  return (
    <aside className="robotprops" style={style} role="dialog" aria-label={`Properties — ${title}`}>
      <div
        className="robotprops__head"
        onPointerDown={onHeadDown}
        onPointerMove={onHeadMove}
        onPointerUp={onHeadUp}
      >
        <span className="robotprops__grip" aria-hidden="true">
          ⠿
        </span>
        <span className="robotprops__title" title={title}>
          {title}
        </span>
      </div>
      <div className="robotprops__body">
        {(context.kind === 'link' || context.kind === 'joint') && (
          <LinkBody {...props} context={context} />
        )}
        {context.kind === 'servo' && (
          <ServoBody {...props} pin={context.pin} commitRef={commitRef} />
        )}
        {context.kind === 'pose' && (
          <PoseBody {...props} name={context.name} commitRef={commitRef} />
        )}
        {context.kind === 'addjoint' && <AddJointBody {...props} commitRef={commitRef} />}
      </div>
      <div className="robotprops__foot">
        {context.kind === 'joint' && (
          <button
            type="button"
            className="robotprops__btn robotprops__btn--danger"
            title="Remove this joint — the part is freed and kept where it is"
            onClick={() => {
              props.onDeleteJoint(context.child)
              onOk()
            }}
          >
            Delete
          </button>
        )}
        {context.kind === 'servo' && (
          <button
            type="button"
            className="robotprops__btn robotprops__btn--danger"
            onClick={() => {
              props.onDeleteServo(context.pin)
              onOk()
            }}
          >
            Delete
          </button>
        )}
        {context.kind === 'pose' && props.pose && (
          <>
            <button
              type="button"
              className="robotprops__btn"
              onClick={() => props.pose && props.onRecallPose(props.pose)}
            >
              Recall
            </button>
            <button
              type="button"
              className="robotprops__btn"
              onClick={() => props.onDuplicatePose(context.name)}
              title="Copy this pose under a new name"
            >
              Duplicate
            </button>
            <button
              type="button"
              className="robotprops__btn robotprops__btn--danger"
              onClick={() => {
                props.onDeletePose(context.name)
                onOk()
              }}
            >
              Delete
            </button>
          </>
        )}
        <span className="robotprops__foot-spacer" />
        <button type="button" className="robotprops__btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="robotprops__btn robotprops__btn--ok" onClick={handleOk}>
          {context.kind === 'addjoint' ? 'Add' : 'OK'}
        </button>
      </div>
    </aside>
  )
}

/** The block / mesh / joint body: size (primitives) + the joint form. Edits are
 *  applied live (URDF); RobotView reverts via snapshot on Cancel. */
function LinkBody({
  context,
  geom,
  joint,
  jointNames,
  onSetSize,
  onSetJoint,
  onRenameJoint,
  onSetJointOrigin,
  onRollJoint,
  jointRoll,
  parentOptions,
  currentParent,
  isBase,
  onSetParent,
  linkColor,
  colorable,
  usedColors,
  onSetColor
}: RobotPropertiesDialogProps & { context: PropsContext }): JSX.Element {
  // `link` = the block being edited, or the joint's child link (which carries it).
  const link = context.kind === 'joint' ? context.child : context.kind === 'link' ? context.link : ''
  return (
    <>
      {context.kind === 'link' && (
        <>
          {geom && (
            <section className="robotprops__section">
              <div className="robotprops__label">Size (mm)</div>
              <SizeForm geom={geom} onChange={(d) => onSetSize(link, d)} />
            </section>
          )}
          {colorable ? (
            // Primitives + STL meshes recolour via the inline URDF <material>. (DAE/
            // Collada meshes carry their own materials, so they fall through to the note.)
            <section className="robotprops__section">
              <div className="robotprops__label">Colour</div>
              <SwatchPicker
                value={linkColor}
                fallback="#9ea6b0"
                used={usedColors}
                onChange={(c) => onSetColor(link, c)}
                ariaLabel={`Colour of ${link}`}
              />
              {!geom && (
                <p className="robotprops__note">Recolours the mesh — grab a face in 3-D to move it.</p>
              )}
            </section>
          ) : (
            !geom && (
              <p className="robotprops__note">This is a mesh — grab a face in 3-D to move it.</p>
            )
          )}
        </>
      )}
      {!isBase && parentOptions.length > 0 && (
        <section className="robotprops__section">
          <div className="robotprops__label" title="Which part this connects to in the chain">
            Attaches to
          </div>
          <select
            className="robotprops__sel"
            value={currentParent ?? ''}
            onChange={(e) => e.target.value && onSetParent(link, e.target.value)}
          >
            {currentParent === null && (
              <option value="" disabled>
                — choose a parent —
              </option>
            )}
            {parentOptions.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <p className="robotprops__note">
            {currentParent === null
              ? 'This part isn’t in the chain yet — pick where it connects.'
              : 'Changing the parent keeps this part where it is — it only moves it in the chain.'}
          </p>
        </section>
      )}
      {joint ? (
        <section className="robotprops__section">
          <div className="robotprops__label">Joint</div>
          <input
            key={joint.name}
            className="robotprops__text robotprops__jname"
            defaultValue={joint.name}
            placeholder="joint name"
            aria-label="Joint name"
            title="The joint name — matches the Servos list and the pose editor"
            onBlur={(e) => {
              const v = e.target.value.trim()
              if (v && v !== joint.name) onRenameJoint(joint.name, v)
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          />
          <JointForm
            joint={joint}
            names={jointNames}
            jointRoll={jointRoll}
            onChange={(spec) => onSetJoint(link, spec)}
            onSetOrigin={(xyz) => onSetJointOrigin(link, xyz)}
            onRoll={(absDeg) => onRollJoint(link, absDeg)}
          />
        </section>
      ) : isBase ? (
        <p className="robotprops__note">This is the base — everything hangs off it.</p>
      ) : null}
    </>
  )
}

/** The servo binding body: joint mapping + servo/joint ranges + invert. Held in
 *  local draft state, committed on OK via `commitRef` (so Cancel discards). */
function ServoBody({
  pin,
  servo,
  movableJoints,
  onSetServo,
  commitRef
}: RobotPropertiesDialogProps & {
  pin: string
  commitRef: React.MutableRefObject<(() => void | boolean) | null>
}): JSX.Element {
  const [joint, setJoint] = useState(servo?.joint ?? movableJoints[0] ?? '')
  const [invert, setInvert] = useState(!!servo?.invert)
  // Numeric ranges are held as RAW STRINGS so a user can clear a field or type a
  // leading "-" (a negative joint range) without it snapping to 0 mid-keystroke;
  // they're coerced back to numbers on commit.
  const [fields, setFields] = useState<Record<'servoMin' | 'servoMax' | 'jointMin' | 'jointMax', string>>({
    servoMin: String(servo?.servoMin ?? 0),
    servoMax: String(servo?.servoMax ?? 180),
    jointMin: String(servo?.jointMin ?? 0),
    jointMax: String(servo?.jointMax ?? 0)
  })
  // OK commits the whole draft as a patch (empty / partial fields fall back to 0).
  commitRef.current = () => {
    const n = (s: string): number => {
      const v = Number(s)
      return Number.isFinite(v) ? v : 0
    }
    onSetServo(pin, {
      joint,
      servoMin: n(fields.servoMin),
      servoMax: n(fields.servoMax),
      jointMin: n(fields.jointMin),
      jointMax: n(fields.jointMax),
      invert
    })
  }
  // Include the current joint even if it's no longer movable, so it's not dropped.
  const options = !joint || movableJoints.includes(joint) ? movableJoints : [joint, ...movableJoints]

  const num = (label: string, key: keyof typeof fields): JSX.Element => (
    <label className="robotprops__mm">
      <span>{label}</span>
      <input
        type="number"
        value={fields[key]}
        onChange={(e) => setFields((f) => ({ ...f, [key]: e.target.value }))}
      />
    </label>
  )

  return (
    <>
      <section className="robotprops__section">
        <div className="robotprops__label">Drives joint</div>
        <select className="robotprops__sel" value={joint} onChange={(e) => setJoint(e.target.value)}>
          {options.length === 0 && <option value="">— no movable joints —</option>}
          {options.map((j) => (
            <option key={j} value={j}>
              {j}
            </option>
          ))}
        </select>
      </section>
      <section className="robotprops__section">
        <div className="robotprops__label">Servo (°)</div>
        <div className="robotprops__row">
          {num('min', 'servoMin')}
          {num('max', 'servoMax')}
        </div>
      </section>
      <section className="robotprops__section">
        <div className="robotprops__label">Joint range</div>
        <div className="robotprops__row">
          {num('min', 'jointMin')}
          {num('max', 'jointMax')}
        </div>
      </section>
      <label className="robotprops__check">
        <input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} />
        <span>Invert (servo min → joint max)</span>
      </label>
    </>
  )
}

const fmtDeg = (v: number): string => (Math.abs(v) < 10 ? v.toFixed(1) : Math.round(v).toString())

/** A directly-editable joint value (display units), paired with the pose slider so the
 *  user can type an exact angle/offset. Applies LIVE as it changes; re-seeds from the
 *  slider's value when it moves — but not while the field is focused, so typing isn't
 *  clobbered by rounding. Clamped to the joint's limits on commit. */
function PoseNum({
  value,
  min,
  max,
  step,
  onCommit
}: {
  value: number
  min: number
  max: number
  step: number
  onCommit: (v: number) => void
}): JSX.Element {
  const [v, setV] = useState(fmtDeg(value))
  const editing = useRef(false)
  useEffect(() => {
    if (!editing.current) setV(fmtDeg(value))
  }, [value])
  const clamp = (n: number): number => Math.min(Math.max(n, min), max)
  return (
    <input
      className="robotprops__poj-num"
      type="number"
      min={min}
      max={max}
      step={step}
      value={v}
      onFocus={() => (editing.current = true)}
      onChange={(e) => {
        setV(e.target.value)
        const n = Number(e.target.value)
        if (e.target.value.trim() !== '' && Number.isFinite(n)) onCommit(clamp(n))
      }}
      onBlur={() => {
        editing.current = false
        const n = Number(v)
        onCommit(Number.isFinite(n) ? clamp(n) : value)
      }}
    />
  )
}

/** The pose editor (#312 — the retired pose sidebar's controls moved here): a name,
 *  a live joint SLIDER per movable joint (drag to pose the robot), and Save / Reset.
 *  Recall / Delete + the OK rename live in the footer. Opening an existing pose recalls
 *  it first, so the sliders start on its saved values. */
function PoseBody({
  name,
  pose,
  poseNames,
  poseLive,
  onRenamePose,
  jointMeta,
  values,
  overrides,
  onJointChange,
  onSavePose,
  onResetPose,
  commitRef
}: RobotPropertiesDialogProps & {
  name: string
  commitRef: React.MutableRefObject<(() => void | boolean) | null>
}): JSX.Element {
  const [draftName, setDraftName] = useState(name)
  const trimmed = draftName.trim()
  // A name that already belongs to a DIFFERENT pose would overwrite it.
  const clash = trimmed !== name && poseNames.includes(trimmed)
  const movable = jointMeta.filter((j) => !j.isMimic)
  const mimics = jointMeta.filter((j) => j.isMimic)

  // Which joints this capture INCLUDES (#414). Default: all movable joints on;
  // when editing an existing PARTIAL pose, start from the joints it actually
  // stored so re-capturing keeps its shape.
  const [included, setIncluded] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    const saved = pose?.values
    for (const j of movable) init[j.name] = saved ? Object.prototype.hasOwnProperty.call(saved, j.name) : true
    return init
  })
  const includedNames = movable.filter((j) => included[j.name] !== false).map((j) => j.name)
  const allIncluded = includedNames.length === movable.length
  const partial = includedNames.length > 0 && !allIncluded

  // Save the current joint values as this pose. For an EXISTING pose the values are
  // saved under its ORIGINAL name (so a name-field edit never duplicates it); the
  // rename is a separate op via OK. For a NEW pose, Save creates it under the name.
  // Only the INCLUDED joints are written (a partial pose); when all are on we pass
  // no filter so the stored shape stays "full".
  const saveValues = (): void => {
    if (name || trimmed) onSavePose(name || trimmed, allIncluded ? undefined : includedNames)
  }
  // Footer OK: save a NEW pose (else it'd discard silently), or rename an EXISTING
  // pose whose name was changed. (Editing an existing pose's values is the Save button.)
  // Mirror the Capture button's guard — never persist an empty (0-joint) pose.
  commitRef.current = () => {
    if (!name && trimmed && includedNames.length > 0)
      onSavePose(trimmed, allIncluded ? undefined : includedNames)
    else if (name && trimmed && trimmed !== name && !clash) onRenamePose(name, trimmed)
  }
  return (
    <>
      <section className="robotprops__section">
        <div className="robotprops__label">Name</div>
        <input
          className={`robotprops__text${clash ? ' is-invalid' : ''}`}
          placeholder="name this pose"
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
          }}
        />
      </section>
      {clash && (
        <p className="robotprops__note robotprops__note--warn">
          A pose named “{trimmed}” already exists — Save overwrites it.
        </p>
      )}
      <section className="robotprops__section">
        <div className="robotprops__poserow">
          <span className="robotprops__label">Joints — drag to pose</span>
          {poseLive && (
            <span className="robotprops__live" title="A running program's servos are driving these joints — Capture reads the live posture">
              <span className="robotprops__live-dot" aria-hidden="true" />
              Live
            </span>
          )}
          <span className="robotprops__foot-spacer" />
          {movable.length > 1 && (
            <button
              type="button"
              className="robotprops__chip"
              onClick={() => {
                const next = !allIncluded
                setIncluded(Object.fromEntries(movable.map((j) => [j.name, next])))
              }}
              title={allIncluded ? 'Exclude all joints (then pick which to capture)' : 'Include every joint'}
            >
              {allIncluded ? 'None' : 'All'}
            </button>
          )}
          <button
            type="button"
            className="robotprops__chip"
            onClick={onResetPose}
            title="Reset all joints to the default pose"
          >
            Reset
          </button>
        </div>
        {partial && (
          <p className="robotprops__note">
            Partial pose — only the {includedNames.length} ticked joint
            {includedNames.length > 1 ? 's' : ''} will be captured; the rest stay where they are on recall.
          </p>
        )}
        {movable.length === 0 ? (
          <p className="robotprops__note">This robot has no movable joints.</p>
        ) : (
          <div className="robotprops__poses-joints">
            {movable.map((j) => {
              const lim = effectiveLimit(j, overrides[j.name])
              const dLower = toDisplay(j.type, lim.lower)
              const dUpper = toDisplay(j.type, lim.upper)
              const dVal = toDisplay(j.type, values[j.name] ?? 0)
              const step = j.type === 'prismatic' ? 0.5 : 1
              const inc = included[j.name] !== false
              return (
                <div className={`robotprops__poj${inc ? '' : ' robotprops__poj--excluded'}`} key={j.name}>
                  <div className="robotprops__poj-head">
                    <label className="robotprops__poj-inc" title={inc ? 'Included in this pose' : 'Excluded — left untouched on recall'}>
                      <input
                        type="checkbox"
                        checked={inc}
                        onChange={(e) => setIncluded((prev) => ({ ...prev, [j.name]: e.target.checked }))}
                        aria-label={`Include ${j.name}`}
                      />
                    </label>
                    <span className="robotprops__poj-name" title={j.name}>
                      {j.name}
                    </span>
                    <span className="robotprops__poj-valwrap">
                      <PoseNum
                        value={dVal}
                        min={dLower}
                        max={dUpper}
                        step={step}
                        onCommit={(v) => onJointChange(j.name, toNative(j.type, v))}
                      />
                      <span className="robotprops__poj-unit">{unitLabel(j.type)}</span>
                    </span>
                  </div>
                  <input
                    className="robotprops__poj-slider"
                    type="range"
                    aria-label={j.name}
                    min={dLower}
                    max={dUpper}
                    step={step}
                    value={Math.min(Math.max(dVal, dLower), dUpper)}
                    onChange={(e) => onJointChange(j.name, toNative(j.type, Number(e.target.value)))}
                  />
                </div>
              )
            })}
            {mimics.map((j) => {
              const dVal = toDisplay(j.type, mimicValue(j, values[j.master ?? ''] ?? 0))
              return (
                <div className="robotprops__poj robotprops__poj--mimic" key={j.name}>
                  <div className="robotprops__poj-head">
                    <span className="robotprops__poj-name" title={j.name}>
                      {j.name}
                    </span>
                    <span className="robotprops__poj-val">
                      {fmtDeg(dVal)}
                      {unitLabel(j.type)}
                    </span>
                  </div>
                  <span className="robotprops__poj-mimic">follows {j.master}</span>
                </div>
              )
            })}
          </div>
        )}
        <button
          type="button"
          className="robotprops__btn robotprops__btn--ok robotprops__savepose"
          disabled={!(name || trimmed) || includedNames.length === 0}
          onClick={saveValues}
          title={
            includedNames.length === 0
              ? 'Tick at least one joint to capture'
              : name
                ? `Capture the current posture into “${name}” (rename via OK)`
                : trimmed
                  ? 'Capture the current posture as this pose'
                  : 'Name the pose first'
          }
        >
          {name ? 'Capture Pose' : 'Capture new pose'}
        </button>
      </section>
    </>
  )
}

// Kid-friendly joint kinds offered by the Join tool (a subset of the URDF set).
const ADDJOINT_KINDS: Array<{ id: JointType; label: string; hint: string }> = [
  { id: 'fixed', label: 'Static', hint: 'Glued in place — no movement' },
  { id: 'revolute', label: 'Rotation', hint: 'Rotates about an axis, within limits (revolute)' },
  { id: 'prismatic', label: 'Linear', hint: 'Slides along an axis (prismatic)' }
]

/**
 * The Add Joint body (#354): pick a point on TWO blocks in the 3-D view (Component
 * 1 = parent, Component 2 = child), choose the joint type + an X/Y/Z offset, then
 * **Add**. The picks come from clicks in the 3-D stage (snapping to face
 * corners/edges/centres); this body just reflects them + collects type/offset.
 */
function AddJointBody({
  jointPick,
  onRepick,
  onSwapPicks,
  onConnectPicked,
  onPreview,
  commitRef
}: RobotPropertiesDialogProps & {
  commitRef: React.MutableRefObject<(() => void | boolean) | null>
}): JSX.Element {
  const [type, setType] = useState<JointType>('fixed')
  const [off, setOff] = useState<Record<'x' | 'y' | 'z', string>>({ x: '0', y: '0', z: '0' })
  // Roll of the child ABOUT the joint normal (degrees) — for every joint type.
  const [angle, setAngle] = useState('0')
  // Rotation (revolute) limits + default angle, in DEGREES (raw strings).
  const [rot, setRot] = useState<{ min: string; max: string; def: string }>({
    min: '-90',
    max: '90',
    def: '0'
  })
  const [err, setErr] = useState<string | null>(null)
  const parent = jointPick?.parent ?? null
  const child = jointPick?.child ?? null
  const step = jointPick?.step ?? 'parent'

  commitRef.current = (): boolean => {
    if (!parent || !child) {
      setErr('Pick a point on both blocks first.')
      return false
    }
    const mm = (s: string): number => {
      const v = Number(s)
      return Number.isFinite(v) ? v / 1000 : 0 // mm → m
    }
    const rotation =
      type === 'revolute'
        ? { minDeg: Number(rot.min) || 0, maxDeg: Number(rot.max) || 0, defaultDeg: Number(rot.def) || 0 }
        : undefined
    const ok = onConnectPicked(type, [mm(off.x), mm(off.y), mm(off.z)], rotation, Number(angle) || 0)
    if (!ok) {
      setErr('Can’t connect — that would form a loop (the parent hangs off the child).')
      return false
    }
    return true
  }
  // Live preview: mate the child as soon as both points are picked, and re-mate whenever
  // the type / offset / roll change — so the result is visible before Add. (onPreview is
  // stable enough; excluded from deps so a preview commit doesn't re-trigger itself.)
  useEffect(() => {
    if (!parent || !child) return
    const mm = (s: string): number => {
      const v = Number(s)
      return Number.isFinite(v) ? v / 1000 : 0
    }
    const rotation =
      type === 'revolute'
        ? { minDeg: Number(rot.min) || 0, maxDeg: Number(rot.max) || 0, defaultDeg: Number(rot.def) || 0 }
        : undefined
    onPreview(type, [mm(off.x), mm(off.y), mm(off.z)], rotation, Number(angle) || 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parent, child, type, off.x, off.y, off.z, angle, rot.min, rot.max, rot.def])
  const axis = (k: 'x' | 'y' | 'z'): JSX.Element => (
    <label className="robotprops__mm">
      <span>{k.toUpperCase()}</span>
      <input
        type="number"
        value={off[k]}
        onChange={(e) => setOff((o) => ({ ...o, [k]: e.target.value }))}
      />
    </label>
  )
  const slot = (which: 'parent' | 'child', pick: { link: string; role: string } | null): JSX.Element => {
    const arming = step === which && !pick
    return (
      <button
        type="button"
        className={`robotprops__pick${arming ? ' is-arming' : ''}`}
        onClick={() => {
          onRepick(which)
          setErr(null)
        }}
        title="Click, then pick a point on the block in the 3-D view"
      >
        {pick ? (
          <>
            <span className="robotprops__pick-link">{pick.link}</span>
            <span className="robotprops__pick-role">{pick.role}</span>
          </>
        ) : (
          <span className="robotprops__pick-hint">
            {arming ? '● Click a point in 3-D…' : 'Click to pick'}
          </span>
        )}
      </button>
    )
  }

  return (
    <>
      <section className="robotprops__section">
        <div className="robotprops__label">Component 1 · parent (stays put)</div>
        {slot('parent', parent)}
      </section>
      <div className="robotprops__swaprow">
        <button
          type="button"
          className="robotprops__swap"
          onClick={() => {
            onSwapPicks()
            setErr(null)
          }}
          disabled={!parent || !child}
          title="Swap parent ↔ child — flip which part stays put and which attaches"
        >
          ⇅ swap
        </button>
      </div>
      <section className="robotprops__section">
        <div className="robotprops__label">Component 2 · child (attaches onto Component 1)</div>
        {slot('child', child)}
      </section>
      <section className="robotprops__section">
        <div className="robotprops__label">Joint type</div>
        <div className="robotprops__row">
          {ADDJOINT_KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              className={`robotprops__chip${type === k.id ? ' is-on' : ''}`}
              title={k.hint}
              onClick={() => setType(k.id)}
            >
              {k.label}
            </button>
          ))}
        </div>
      </section>
      {type === 'revolute' && (
        <section className="robotprops__section">
          <div className="robotprops__label">Rotation limits (°)</div>
          <div className="robotprops__row">
            <label className="robotprops__mm">
              <span>min</span>
              <input
                type="number"
                value={rot.min}
                onChange={(e) => setRot((r) => ({ ...r, min: e.target.value }))}
              />
            </label>
            <label className="robotprops__mm">
              <span>max</span>
              <input
                type="number"
                value={rot.max}
                onChange={(e) => setRot((r) => ({ ...r, max: e.target.value }))}
              />
            </label>
            <label className="robotprops__mm">
              <span>default</span>
              <input
                type="number"
                value={rot.def}
                onChange={(e) => setRot((r) => ({ ...r, def: e.target.value }))}
              />
            </label>
          </div>
        </section>
      )}
      <section className="robotprops__section">
        <div className="robotprops__label">Offset (mm)</div>
        <div className="robotprops__row">
          {axis('x')}
          {axis('y')}
          {axis('z')}
        </div>
        <div className="robotprops__row">
          <label className="robotprops__mm" title="Rotate the child about the joint's normal axis">
            <span>roll °</span>
            <input type="number" value={angle} onChange={(e) => setAngle(e.target.value)} />
          </label>
        </div>
      </section>
      {err ? (
        <p className="robotprops__note robotprops__note--warn">{err}</p>
      ) : (
        <p className="robotprops__note">
          {!parent || !child
            ? 'Pick a point on the PARENT first, then the CHILD (snaps to corners / edges / hole centres). Hold Shift to LOCK the highlighted snap, then move over the hole and click it.'
            : type === 'revolute'
              ? 'The parent (1) stays put; the child (2) attaches onto it — use ⇅ swap to flip. After Add, pose the joint to preview the swing.'
              : 'The child (2) moves so its point meets the parent (1) — use ⇅ swap if you picked them the wrong way round.'}
        </p>
      )}
    </>
  )
}

export default RobotPropertiesDialog
