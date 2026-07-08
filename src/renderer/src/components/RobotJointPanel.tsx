import { useState } from 'react'
import {
  type JointMeta,
  effectiveLimit,
  mimicValue,
  normPin,
  toDisplay,
  toNative,
  unitLabel
} from './robot-pose'
import type { AssemblyItem } from './robot-assembly'
import type { ServoJointBinding } from '../../../shared/robot'
import { baseName } from './robot-mesh'
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
  /** True while the measure tool (in the toolbar) is active — shows the readout. */
  measureActive: boolean
  /** Point-to-point distance in mm, or null when fewer than 2 points are set. */
  measureDistance: number | null
  /** Whether the current pose has been persisted (for a subtle saved hint). */
  savingLabel: string | null
  /** The model's links + the meshes they use (assembly list). */
  assembly: AssemblyItem[]
  onImportStl: () => void
  /** Import is only possible for a saved project robot (a file to edit). */
  canImport: boolean
  importing: boolean
  /** Servo → joint bindings (KRF servoJointMap) + editors (#313). */
  bindings: ServoJointBinding[]
  onAddBinding: (pin: string, joint: string) => void
  onUpdateBinding: (pin: string, patch: Partial<ServoJointBinding>) => void
  onDeleteBinding: (pin: string) => void
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
  measureDistance,
  savingLabel,
  assembly,
  onImportStl,
  canImport,
  importing,
  bindings,
  onAddBinding,
  onUpdateBinding,
  onDeleteBinding
}: RobotJointPanelProps): JSX.Element {
  const [poseName, setPoseName] = useState('')
  const [newPin, setNewPin] = useState('')
  const [newJoint, setNewJoint] = useState('')
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
          <span>Assembly</span>
          <button
            type="button"
            className="robotpanel__btn"
            disabled={!canImport || importing}
            onClick={onImportStl}
            title={
              canImport
                ? 'Import an STL / DAE mesh into this robot'
                : 'Open a saved project robot to import meshes'
            }
          >
            {importing ? 'Importing…' : '+ STL'}
          </button>
        </div>
        {assembly.length === 0 ? (
          <p className="robotpanel__empty">No links.</p>
        ) : (
          <ul className="robotpanel__assembly">
            {assembly.map((it) => (
              <li className="robotpanel__part" key={it.link}>
                <span className="robotpanel__part-name" title={it.link}>
                  {it.link}
                </span>
                <span
                  className={`robotpanel__part-geo${it.kind === 'mesh' ? ' is-mesh' : ''}`}
                  title={it.kind === 'mesh' ? it.mesh : it.kind}
                >
                  {it.kind === 'mesh' ? baseName(it.mesh ?? '') : it.kind}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="robotpanel__section">
        <div className="robotpanel__section-head">
          <span>Servos</span>
        </div>
        {movable.length === 0 ? (
          <p className="robotpanel__empty">No joints to bind.</p>
        ) : (
          <>
            {bindings.length > 0 && (
              <ul className="robotpanel__servos">
                {bindings.map((b) => (
                  <li className="robotpanel__servo" key={b.pin}>
                    <div className="robotpanel__servo-head">
                      <span className="robotpanel__servo-pin">GP{normPin(b.pin)}</span>
                      <span className="robotpanel__servo-arrow">→</span>
                      <select
                        className="robotpanel__servo-joint"
                        value={b.joint}
                        aria-label={`Joint for GP${normPin(b.pin)}`}
                        onChange={(e) => onUpdateBinding(b.pin, { joint: e.target.value })}
                      >
                        {movable.map((j) => (
                          <option key={j.name} value={j.name}>
                            {j.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="robotpanel__pose-del"
                        onClick={() => onDeleteBinding(b.pin)}
                        aria-label={`Unbind GP${normPin(b.pin)}`}
                      >
                        ×
                      </button>
                    </div>
                    <div className="robotpanel__servo-cal">
                      <span className="robotpanel__servo-lbl">servo</span>
                      <input
                        type="number"
                        aria-label={`GP${normPin(b.pin)} servo min`}
                        value={b.servoMin ?? 0}
                        onChange={(e) => onUpdateBinding(b.pin, { servoMin: Number(e.target.value) })}
                      />
                      <input
                        type="number"
                        aria-label={`GP${normPin(b.pin)} servo max`}
                        value={b.servoMax ?? 180}
                        onChange={(e) => onUpdateBinding(b.pin, { servoMax: Number(e.target.value) })}
                      />
                      <span className="robotpanel__servo-lbl">joint</span>
                      <input
                        type="number"
                        aria-label={`GP${normPin(b.pin)} joint min`}
                        value={b.jointMin}
                        onChange={(e) => onUpdateBinding(b.pin, { jointMin: Number(e.target.value) })}
                      />
                      <input
                        type="number"
                        aria-label={`GP${normPin(b.pin)} joint max`}
                        value={b.jointMax}
                        onChange={(e) => onUpdateBinding(b.pin, { jointMax: Number(e.target.value) })}
                      />
                      <label className="robotpanel__servo-inv" title="Reverse the mapping">
                        <input
                          type="checkbox"
                          checked={!!b.invert}
                          onChange={(e) => onUpdateBinding(b.pin, { invert: e.target.checked })}
                        />
                        inv
                      </label>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="robotpanel__servo-add">
              <input
                className="robotpanel__servo-newpin"
                placeholder="pin"
                aria-label="Servo pin"
                value={newPin}
                onChange={(e) => setNewPin(e.target.value)}
              />
              <select
                className="robotpanel__servo-newjoint"
                aria-label="Joint to bind"
                value={newJoint}
                onChange={(e) => setNewJoint(e.target.value)}
              >
                <option value="">joint…</option>
                {movable.map((j) => (
                  <option key={j.name} value={j.name}>
                    {j.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="robotpanel__btn"
                disabled={!normPin(newPin) || !newJoint}
                onClick={() => {
                  onAddBinding(normPin(newPin), newJoint)
                  setNewPin('')
                  setNewJoint('')
                }}
              >
                Bind
              </button>
            </div>
          </>
        )}
      </section>

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

      {measureActive && (
        <section className="robotpanel__section">
          <div className="robotpanel__section-head">
            <span>Measure</span>
          </div>
          <div className="robotpanel__measure-out">
            {measureDistance == null
              ? 'Click two points…'
              : measureDistance < 1000
                ? `${measureDistance.toFixed(1)} mm`
                : `${(measureDistance / 1000).toFixed(3)} m`}
          </div>
        </section>
      )}
    </aside>
  )
}

export default RobotJointPanel
