import type { JSX } from 'react'
import {
  effectiveLimit,
  toDisplay,
  toNative,
  unitLabel,
  type JointMeta
} from './robot-pose'
import { friendlyJointName, groupJoints } from './robot-animate'
import './RobotJointsPanel.css'

/**
 * JOINTS PANEL (Animate mode) — exact values for every joint, beside the stage.
 *
 * Posing is done by dragging the robot; this is for the times a number matters
 * ("knee at exactly 45°"). Joints are grouped by side of the robot rather than
 * listed flat, so the slider for the left knee is under "Left side", next to the
 * left hip. The joint the pointer is on in the 3-D view is highlighted here, and
 * pointing at a row here puts the ring on that joint there.
 */
export interface RobotJointsPanelProps {
  jointMeta: JointMeta[]
  /** Live joint values, NATIVE units (rad / m). */
  values: Record<string, number>
  overrides: Record<string, { min?: number; max?: number }>
  /** The joint the 3-D ring is on (highlighted row). */
  activeJoint: string | null
  /** Joints whose value is being driven by Mirror from their partner. */
  mirrored: Set<string>
  onChange: (name: string, native: number) => void
  /** A slider drag / edit is starting, and has finished (undo checkpoints). */
  onBegin: () => void
  onCommit: () => void
  onHoverJoint: (name: string | null) => void
  onClose: () => void
}

export function RobotJointsPanel({
  jointMeta,
  values,
  overrides,
  activeJoint,
  mirrored,
  onChange,
  onBegin,
  onCommit,
  onHoverJoint,
  onClose
}: RobotJointsPanelProps): JSX.Element {
  const movable = jointMeta.filter((m) => !m.isMimic)
  const byName = new Map(movable.map((m) => [m.name, m]))
  const groups = groupJoints(movable.map((m) => m.name))

  return (
    <aside className="robotjoints" aria-label="Joints">
      <div className="robotjoints__head">
        <span className="robotjoints__title">Joints</span>
        <button type="button" className="robotjoints__close" onClick={onClose} title="Hide the Joints panel" aria-label="Hide the Joints panel">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="robotjoints__body">
        {groups.map((g) => (
          <section className="robotjoints__group" key={g.side} aria-label={g.label}>
            <h3 className="robotjoints__group-title">{g.label}</h3>
            {g.joints.map((name) => {
              const m = byName.get(name)
              if (!m) return null
              const lim = effectiveLimit(m, overrides[name])
              const lo = toDisplay(m.type, lim.lower)
              const hi = toDisplay(m.type, lim.upper)
              const cur = toDisplay(m.type, values[name] ?? 0)
              const unit = unitLabel(m.type)
              const id = `robotjoints-${name}`
              const set = (display: number): void => {
                if (!Number.isFinite(display)) return
                onChange(name, toNative(m.type, Math.min(hi, Math.max(lo, display))))
              }
              return (
                <div
                  className={`robotjoints__row${activeJoint === name ? ' is-active' : ''}`}
                  key={name}
                  onPointerEnter={() => onHoverJoint(name)}
                >
                  <div className="robotjoints__row-head">
                    <label className="robotjoints__name" htmlFor={id} title={name}>
                      {friendlyJointName(name)}
                    </label>
                    {mirrored.has(name) && (
                      <span className="robotjoints__tag" title="Mirror is on: this joint follows its partner">
                        mirrored
                      </span>
                    )}
                    <span className="robotjoints__num">
                      <input
                        type="number"
                        aria-label={`${friendlyJointName(name)} value`}
                        min={Math.round(lo)}
                        max={Math.round(hi)}
                        step={1}
                        value={Number(cur.toFixed(1))}
                        onFocus={onBegin}
                        onChange={(e) => set(Number(e.target.value))}
                        onBlur={onCommit}
                      />
                      {unit}
                    </span>
                  </div>
                  <input
                    id={id}
                    className="robotjoints__slider"
                    type="range"
                    min={lo}
                    max={hi}
                    step={(hi - lo) / 400 || 0.1}
                    value={cur}
                    onPointerDown={onBegin}
                    onKeyDown={onBegin}
                    onChange={(e) => set(Number(e.target.value))}
                    onPointerUp={onCommit}
                    onKeyUp={onCommit}
                    onBlur={onCommit}
                  />
                </div>
              )
            })}
          </section>
        ))}
        {movable.length === 0 && <p className="robotjoints__empty">This robot has no joints that move yet.</p>}
      </div>
    </aside>
  )
}

export default RobotJointsPanel
