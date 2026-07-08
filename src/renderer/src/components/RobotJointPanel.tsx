import { useState } from 'react'
import {
  type JointMeta,
  effectiveLimit,
  mimicValue,
  toDisplay,
  toNative,
  unitLabel
} from './robot-pose'
import './RobotJointPanel.css'

/** A saved pose (name + joint→display-value map). Mirrors KRF `NamedPose`. */
export interface NamedPoseLike {
  name: string
  values: Record<string, number>
}

export interface RobotJointPanelProps {
  joints: JointMeta[]
  /** Live NATIVE values for the movable (non-mimic) joints. */
  values: Record<string, number>
  /** In-app limit overrides (display units — deg/mm), by joint name. */
  overrides: Record<string, { min?: number; max?: number }>
  onJointChange: (name: string, native: number) => void
  onLimitChange: (name: string, next: { min: number; max: number }) => void
  poses: NamedPoseLike[]
  onSavePose: (name: string) => void
  onRecallPose: (pose: NamedPoseLike) => void
  onDeletePose: (name: string) => void
  onResetPose: () => void
  measureActive: boolean
  onToggleMeasure: () => void
  /** Point-to-point distance in mm, or null when fewer than 2 points are set. */
  measureDistance: number | null
  /** Whether the current pose has been persisted (for a subtle saved hint). */
  savingLabel: string | null
}

/** Round a display value for compact display. */
function fmt(v: number): string {
  return Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)
}

export function RobotJointPanel({
  joints,
  values,
  overrides,
  onJointChange,
  onLimitChange,
  poses,
  onSavePose,
  onRecallPose,
  onDeletePose,
  onResetPose,
  measureActive,
  onToggleMeasure,
  measureDistance,
  savingLabel
}: RobotJointPanelProps): JSX.Element {
  const [poseName, setPoseName] = useState('')
  const movable = joints.filter((j) => !j.isMimic)
  const mimics = joints.filter((j) => j.isMimic)

  const saveDisabled = poseName.trim().length === 0

  return (
    <aside className="robotpanel" aria-label="Pose controls">
      <header className="robotpanel__head">
        <span className="robotpanel__title">Pose</span>
        <button
          type="button"
          className="robotpanel__btn"
          onClick={onResetPose}
          title="Reset all joints to the default pose"
        >
          Reset
        </button>
      </header>

      {joints.length === 0 && (
        <p className="robotpanel__empty">This robot has no movable joints.</p>
      )}

      <div className="robotpanel__joints">
        {movable.map((j) => {
          const lim = effectiveLimit(j, overrides[j.name])
          const dLower = toDisplay(j.type, lim.lower)
          const dUpper = toDisplay(j.type, lim.upper)
          const dVal = toDisplay(j.type, values[j.name] ?? 0)
          const step = j.type === 'prismatic' ? 0.5 : 1
          return (
            <div className="robotpanel__joint" key={j.name}>
              <div className="robotpanel__joint-head">
                <span className="robotpanel__joint-name" title={j.name}>
                  {j.name}
                </span>
                <span className="robotpanel__joint-val">
                  {fmt(dVal)}
                  {unitLabel(j.type)}
                </span>
              </div>
              <div className="robotpanel__slider-row">
                <input
                  className="robotpanel__limit"
                  type="number"
                  aria-label={`${j.name} minimum`}
                  value={Number(dLower.toFixed(1))}
                  step={step}
                  onChange={(e) =>
                    onLimitChange(j.name, { min: Number(e.target.value), max: dUpper })
                  }
                />
                <input
                  className="robotpanel__slider"
                  type="range"
                  aria-label={j.name}
                  min={dLower}
                  max={dUpper}
                  step={step}
                  value={Math.min(Math.max(dVal, dLower), dUpper)}
                  onChange={(e) => onJointChange(j.name, toNative(j.type, Number(e.target.value)))}
                />
                <input
                  className="robotpanel__limit"
                  type="number"
                  aria-label={`${j.name} maximum`}
                  value={Number(dUpper.toFixed(1))}
                  step={step}
                  onChange={(e) =>
                    onLimitChange(j.name, { min: dLower, max: Number(e.target.value) })
                  }
                />
              </div>
            </div>
          )
        })}

        {mimics.map((j) => {
          const masterNative = values[j.master ?? ''] ?? 0
          const dVal = toDisplay(j.type, mimicValue(j, masterNative))
          return (
            <div className="robotpanel__joint robotpanel__joint--mimic" key={j.name}>
              <div className="robotpanel__joint-head">
                <span className="robotpanel__joint-name" title={j.name}>
                  {j.name}
                </span>
                <span className="robotpanel__joint-val">
                  {fmt(dVal)}
                  {unitLabel(j.type)}
                </span>
              </div>
              <span className="robotpanel__mimic-hint">follows {j.master}</span>
            </div>
          )
        })}
      </div>

      <section className="robotpanel__section">
        <div className="robotpanel__section-head">
          <span>Poses</span>
          {savingLabel && <span className="robotpanel__saved">{savingLabel}</span>}
        </div>
        <div className="robotpanel__pose-add">
          <input
            className="robotpanel__pose-name"
            placeholder="name this pose"
            value={poseName}
            onChange={(e) => setPoseName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !saveDisabled) {
                onSavePose(poseName.trim())
                setPoseName('')
              }
            }}
          />
          <button
            type="button"
            className="robotpanel__btn"
            disabled={saveDisabled}
            onClick={() => {
              onSavePose(poseName.trim())
              setPoseName('')
            }}
          >
            Save
          </button>
        </div>
        {poses.length > 0 && (
          <ul className="robotpanel__poses">
            {poses.map((p) => (
              <li className="robotpanel__pose" key={p.name}>
                <button
                  type="button"
                  className="robotpanel__pose-recall"
                  onClick={() => onRecallPose(p)}
                  title={`Recall ${p.name}`}
                >
                  {p.name}
                </button>
                <button
                  type="button"
                  className="robotpanel__pose-del"
                  onClick={() => onDeletePose(p.name)}
                  aria-label={`Delete ${p.name}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="robotpanel__section">
        <div className="robotpanel__section-head">
          <span>Measure</span>
        </div>
        <button
          type="button"
          className={`robotpanel__btn robotpanel__measure${measureActive ? ' is-on' : ''}`}
          onClick={onToggleMeasure}
        >
          {measureActive ? 'Measuring — click 2 points' : 'Measure distance'}
        </button>
        {measureDistance != null && (
          <div className="robotpanel__measure-out">
            {measureDistance < 1000
              ? `${measureDistance.toFixed(1)} mm`
              : `${(measureDistance / 1000).toFixed(3)} m`}
          </div>
        )}
      </section>
    </aside>
  )
}

export default RobotJointPanel
