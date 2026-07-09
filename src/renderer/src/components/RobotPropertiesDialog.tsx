import { useRef, useState } from 'react'
import type { JointDef, JointFull, JointSpec, PrimitiveGeom } from './robot-assembly'
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
  onSetJoint: (link: string, spec: JointSpec) => void
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
  // addjoint
  /** All link names, for the Add Joint parent/child pickers. */
  links: string[]
  /** Every joint (to seed the offset from a child's current origin). */
  joints: JointFull[]
  /** Connect `child` under `parent` at joint origin `xyz` (metres). Returns
   *  whether anything changed (false = invalid pick, e.g. would form a loop). */
  onConnect: (parent: string, child: string, xyz: [number, number, number]) => boolean
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

  // Bodies with a local draft (servo/pose/addjoint) register a commit here; OK
  // runs it. A commit that returns `false` (an invalid Add-Joint pick) keeps the
  // dialog open instead of closing as if it succeeded.
  const commitRef = useRef<(() => void | boolean) | null>(null)

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

/** The pose body: rename (commit on OK) + a count; Recall / Delete live in the
 *  footer. */
function PoseBody({
  name,
  pose,
  poseNames,
  onRenamePose,
  commitRef
}: RobotPropertiesDialogProps & {
  name: string
  commitRef: React.MutableRefObject<(() => void | boolean) | null>
}): JSX.Element {
  const [draftName, setDraftName] = useState(name)
  const trimmed = draftName.trim()
  // A name that already belongs to a DIFFERENT pose would overwrite it.
  const clash = trimmed !== name && poseNames.includes(trimmed)
  // OK renames the pose if the name changed to something non-empty + non-clashing.
  commitRef.current = () => {
    if (trimmed && trimmed !== name && !clash) onRenamePose(name, trimmed)
  }
  const jointCount = pose ? Object.keys(pose.values).length : 0
  return (
    <>
      <section className="robotprops__section">
        <div className="robotprops__label">Name</div>
        <input
          className={`robotprops__text${clash ? ' is-invalid' : ''}`}
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
          }}
        />
      </section>
      {clash ? (
        <p className="robotprops__note robotprops__note--warn">
          A pose named “{trimmed}” already exists — pick another name.
        </p>
      ) : (
        <p className="robotprops__note">
          Captures {jointCount} joint{jointCount === 1 ? '' : 's'}. <strong>Recall</strong> applies
          it to the model.
        </p>
      )}
    </>
  )
}

/** The Add Joint body (#354): pick Component 1 (parent) + Component 2 (child) and
 *  an X/Y/Z offset (mm) for the joint origin; commit on **Add**. */
function AddJointBody({
  links,
  joints,
  onConnect,
  commitRef
}: RobotPropertiesDialogProps & {
  commitRef: React.MutableRefObject<(() => void | boolean) | null>
}): JSX.Element {
  const [parent, setParent] = useState(links[0] ?? '')
  const [child, setChild] = useState(links.find((l) => l !== (links[0] ?? '')) ?? '')
  // The child's current joint origin (metres → mm), so re-attaching without
  // touching the offset leaves the part where it is. Re-seeded as the child changes.
  const currentOrigin = (link: string): Record<'x' | 'y' | 'z', string> => {
    const j = joints.find((x) => x.child === link)
    const mm = (n: number): string => String(Math.round((n ?? 0) * 1000))
    return j ? { x: mm(j.xyz[0]), y: mm(j.xyz[1]), z: mm(j.xyz[2]) } : { x: '0', y: '0', z: '0' }
  }
  // Offsets in mm (raw strings so you can clear / type a leading "-").
  const [off, setOff] = useState<Record<'x' | 'y' | 'z', string>>(() => currentOrigin(child))
  const [err, setErr] = useState<string | null>(null)
  const same = !!parent && parent === child
  const alreadyJointed = joints.some((x) => x.child === child)

  commitRef.current = (): boolean => {
    if (!parent || !child) {
      setErr('Add another block to join to.')
      return false
    }
    if (same) {
      setErr('Pick two different blocks.')
      return false
    }
    const mm = (s: string): number => {
      const v = Number(s)
      return Number.isFinite(v) ? v / 1000 : 0 // mm → m
    }
    const ok = onConnect(parent, child, [mm(off.x), mm(off.y), mm(off.z)])
    if (!ok) {
      setErr('Can’t connect — that would form a loop (the parent hangs off the child).')
      return false
    }
    return true
  }
  const pickChild = (c: string): void => {
    setChild(c)
    setOff(currentOrigin(c)) // seed the offset from its current origin
    setErr(null)
  }
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
  const warn = err ?? (same ? 'Pick two different blocks.' : !child ? 'Add another block to join to.' : null)
  return (
    <>
      <section className="robotprops__section">
        <div className="robotprops__label">Component 1 (parent)</div>
        <select
          className="robotprops__sel"
          value={parent}
          onChange={(e) => {
            const p = e.target.value
            setParent(p)
            setErr(null)
            if (p === child) pickChild(links.find((l) => l !== p) ?? '') // keep child ≠ parent
          }}
        >
          {links.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </section>
      <section className="robotprops__section">
        <div className="robotprops__label">Component 2 (child)</div>
        <select className="robotprops__sel" value={child} onChange={(e) => pickChild(e.target.value)}>
          {links
            .filter((l) => l !== parent)
            .map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
        </select>
      </section>
      <section className="robotprops__section">
        <div className="robotprops__label">Offset (mm)</div>
        <div className="robotprops__row">
          {axis('x')}
          {axis('y')}
          {axis('z')}
        </div>
      </section>
      {warn ? (
        <p className="robotprops__note robotprops__note--warn">{warn}</p>
      ) : (
        <p className="robotprops__note">
          {alreadyJointed ? 'Re-attaches ' : 'Attaches '}
          <strong>{child}</strong> under <strong>{parent}</strong>
          {alreadyJointed ? ', keeping its joint type.' : ' as a fixed joint.'} Tune the type in the
          Joints branch.
        </p>
      )}
    </>
  )
}

export default RobotPropertiesDialog
