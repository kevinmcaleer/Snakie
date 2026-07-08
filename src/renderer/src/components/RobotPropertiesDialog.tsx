import { useRef, useState } from 'react'
import type { JointDef, JointSpec, PrimitiveGeom } from './robot-assembly'
import type { ServoJointBinding } from '../../../shared/robot'
import type { NamedPoseLike } from './RobotJointPanel'
import { normPin } from './robot-pose'
import { SizeForm, JointForm } from './RobotBuildPanel'
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
  }
}

export interface RobotPropertiesDialogProps {
  context: PropsContext
  // link / joint
  geom: PrimitiveGeom | null
  joint: JointDef | null
  jointNames: string[]
  onSetSize: (link: string, dims: number[]) => void
  onSetJoint: (link: string, spec: JointSpec) => void
  // servo
  servo: ServoJointBinding | null
  movableJoints: string[]
  onSetServo: (pin: string, patch: Partial<ServoJointBinding>) => void
  onDeleteServo: (pin: string) => void
  // pose
  pose: NamedPoseLike | null
  onRecallPose: (pose: NamedPoseLike) => void
  onRenamePose: (oldName: string, newName: string) => void
  onDeletePose: (name: string) => void
  // footer
  onOk: () => void
  onCancel: () => void
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

  // Bodies with a local draft (servo/pose) register a commit here; OK runs it.
  const commitRef = useRef<(() => void) | null>(null)

  // Drag the dialog by its title bar. `pos` null = the default docked spot (CSS).
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const drag = useRef<{ dx: number; dy: number } | null>(null)
  const onHeadDown = (e: React.PointerEvent): void => {
    const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
    drag.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top }
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  }
  const onHeadMove = (e: React.PointerEvent): void => {
    if (!drag.current) return
    setPos({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy })
  }
  const onHeadUp = (e: React.PointerEvent): void => {
    drag.current = null
    ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
  }

  const style = pos ? { left: `${pos.x}px`, top: `${pos.y}px`, right: 'auto' } : undefined
  const title = contextTitle(context)
  const handleOk = (): void => {
    commitRef.current?.()
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
      </div>
      <div className="robotprops__foot">
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
        {context.kind === 'pose' && (
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
          OK
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
  onSetJoint
}: RobotPropertiesDialogProps & { context: PropsContext }): JSX.Element {
  // `link` = the block being edited, or the joint's child link (which carries it).
  const link = context.kind === 'joint' ? context.child : context.kind === 'link' ? context.link : ''
  return (
    <>
      {context.kind === 'link' &&
        (geom ? (
          <section className="robotprops__section">
            <div className="robotprops__label">Size (mm)</div>
            <SizeForm geom={geom} onChange={(d) => onSetSize(link, d)} />
          </section>
        ) : (
          <p className="robotprops__note">This is a mesh — grab a face in 3-D to move it.</p>
        ))}
      {joint ? (
        <section className="robotprops__section">
          <div className="robotprops__label">Joint</div>
          <JointForm joint={joint} names={jointNames} onChange={(spec) => onSetJoint(link, spec)} />
        </section>
      ) : (
        <p className="robotprops__note">This is the base — nothing to join to.</p>
      )}
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
  commitRef: React.MutableRefObject<(() => void) | null>
}): JSX.Element {
  const [draft, setDraft] = useState<ServoJointBinding>(() => ({
    pin,
    joint: servo?.joint ?? movableJoints[0] ?? '',
    servoMin: servo?.servoMin ?? 0,
    servoMax: servo?.servoMax ?? 180,
    jointMin: servo?.jointMin ?? 0,
    jointMax: servo?.jointMax ?? 0,
    invert: servo?.invert ?? false
  }))
  // OK commits the whole draft as a patch.
  commitRef.current = () => onSetServo(pin, draft)
  const set = (patch: Partial<ServoJointBinding>): void => setDraft((d) => ({ ...d, ...patch }))
  // Include the current joint even if it's no longer movable, so it's not dropped.
  const options =
    !draft.joint || movableJoints.includes(draft.joint) ? movableJoints : [draft.joint, ...movableJoints]

  const num = (
    label: string,
    key: 'servoMin' | 'servoMax' | 'jointMin' | 'jointMax'
  ): JSX.Element => (
    <label className="robotprops__mm">
      <span>{label}</span>
      <input
        type="number"
        value={Number.isFinite(draft[key] as number) ? (draft[key] as number) : 0}
        onChange={(e) => set({ [key]: Number(e.target.value) })}
      />
    </label>
  )

  return (
    <>
      <section className="robotprops__section">
        <div className="robotprops__label">Drives joint</div>
        <select
          className="robotprops__sel"
          value={draft.joint}
          onChange={(e) => set({ joint: e.target.value })}
        >
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
        <input
          type="checkbox"
          checked={!!draft.invert}
          onChange={(e) => set({ invert: e.target.checked })}
        />
        <span>Invert (servo min → joint max)</span>
      </label>
    </>
  )
}

/** The pose body: rename (commit on OK) + a count; Recall / Delete live in the
 *  footer. */
function PoseBody({
  name,
  pose,
  onRenamePose,
  commitRef
}: RobotPropertiesDialogProps & {
  name: string
  commitRef: React.MutableRefObject<(() => void) | null>
}): JSX.Element {
  const [draftName, setDraftName] = useState(name)
  // OK renames the pose if the name changed to something non-empty.
  commitRef.current = () => {
    const next = draftName.trim()
    if (next && next !== name) onRenamePose(name, next)
  }
  const jointCount = pose ? Object.keys(pose.values).length : 0
  return (
    <>
      <section className="robotprops__section">
        <div className="robotprops__label">Name</div>
        <input
          className="robotprops__text"
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
          }}
        />
      </section>
      <p className="robotprops__note">
        Captures {jointCount} joint{jointCount === 1 ? '' : 's'}. <strong>Recall</strong> applies it
        to the model.
      </p>
    </>
  )
}

export default RobotPropertiesDialog
