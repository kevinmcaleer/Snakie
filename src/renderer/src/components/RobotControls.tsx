import { useState, type JSX } from 'react'
import type { NamedPose, PuppetControl } from '../../../shared/robot'
import './RobotControls.css'

/**
 * PUPPET CONTROLS (#416, epic #403) — a Controls panel of named sliders, each
 * blending 2+ saved poses (Bottango-style). Dragging a slider interpolates
 * between the ordered poses and drives the live model + a connected board in real
 * time (the drive lives in {@link RobotView}). A **+ Control** creator names a
 * control and picks its ordered poses; controls can be renamed / deleted. Own
 * `robotctl__` BEM prefix; reads on dark + skeuomorph light.
 */

export interface RobotControlsProps {
  controls: PuppetControl[]
  /** Saved poses to build a control from. */
  poses: NamedPose[]
  /** Current slider position per control id (0..1). */
  values: Record<string, number>
  /** Whether a board is streaming (shows a Live hint on the panel). */
  live: boolean
  onChange: (id: string, t: number) => void
  onCreate: (name: string, poses: string[]) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
}

export function RobotControls({
  controls,
  poses,
  values,
  live,
  onChange,
  onCreate,
  onRename,
  onDelete
}: RobotControlsProps): JSX.Element {
  const [creating, setCreating] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [draftPoses, setDraftPoses] = useState<string[]>([])
  const poseNames = poses.map((p) => p.name)

  const reset = (): void => {
    setCreating(false)
    setDraftName('')
    setDraftPoses([])
  }
  const create = (): void => {
    const name = draftName.trim()
    if (!name || draftPoses.length < 2) return
    onCreate(name, draftPoses)
    reset()
  }

  return (
    <div className="robotctl" aria-label="Puppet controls">
      <div className="robotctl__bar">
        <span className="robotctl__title">Controls</span>
        {live && (
          <span className="robotctl__live" title="Streaming to the connected board">
            <span className="robotctl__live-dot" aria-hidden="true" />
            Live
          </span>
        )}
        <span className="robotctl__spacer" />
        <button
          type="button"
          className="robotctl__btn"
          onClick={() => (creating ? reset() : setCreating(true))}
          disabled={poseNames.length < 2}
          title={poseNames.length < 2 ? 'Save at least two poses first' : 'Create a control from your poses'}
        >
          {creating ? 'Cancel' : '+ Control'}
        </button>
      </div>

      {creating && (
        <div className="robotctl__create">
          <input
            className="robotctl__name"
            placeholder="control name (e.g. look, walk)"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
            autoFocus
          />
          <div className="robotctl__pick">
            <span className="robotctl__pick-label">Poses in order:</span>
            {draftPoses.length === 0 ? (
              <span className="robotctl__pick-hint">click poses below (≥2)</span>
            ) : (
              draftPoses.map((p, i) => (
                <span className="robotctl__chip" key={`${p}-${i}`}>
                  {i + 1}. {p}
                  <button
                    type="button"
                    className="robotctl__chip-x"
                    onClick={() => setDraftPoses((d) => d.filter((_, j) => j !== i))}
                    title="Remove"
                  >
                    ✕
                  </button>
                </span>
              ))
            )}
          </div>
          <div className="robotctl__pool">
            {poseNames.map((n) => (
              <button
                key={n}
                type="button"
                className="robotctl__pool-pose"
                onClick={() => setDraftPoses((d) => [...d, n])}
                title={`Append “${n}”`}
              >
                + {n}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="robotctl__btn robotctl__btn--ok"
            onClick={create}
            disabled={!draftName.trim() || draftPoses.length < 2}
          >
            Create control
          </button>
        </div>
      )}

      <div className="robotctl__list">
        {controls.length === 0 && !creating && (
          <p className="robotctl__empty">No controls yet — blend 2+ poses into a live slider.</p>
        )}
        {controls.map((c) => {
          const valid = c.poses.filter((p) => poseNames.includes(p))
          const usable = valid.length >= 2
          const t = values[c.id] ?? 0
          return (
            <div className={`robotctl__ctl${usable ? '' : ' is-disabled'}`} key={c.id}>
              <div className="robotctl__ctl-head">
                <input
                  className="robotctl__ctl-name"
                  value={c.name}
                  onChange={(e) => onRename(c.id, e.target.value)}
                  aria-label={`Rename ${c.name}`}
                />
                <span className="robotctl__ctl-poses" title={c.poses.join(' → ')}>
                  {c.poses.join(' → ')}
                </span>
                <button
                  type="button"
                  className="robotctl__ctl-del"
                  onClick={() => onDelete(c.id)}
                  title="Delete control"
                >
                  ✕
                </button>
              </div>
              <div className="robotctl__slider-wrap">
                <input
                  className="robotctl__slider"
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={t}
                  disabled={!usable}
                  onChange={(e) => onChange(c.id, Number(e.target.value))}
                  aria-label={c.name}
                />
                <div className="robotctl__ticks" aria-hidden="true">
                  {c.poses.map((p, i) => (
                    <span
                      className="robotctl__tick"
                      key={i}
                      style={{ left: `${c.poses.length > 1 ? (i / (c.poses.length - 1)) * 100 : 0}%` }}
                      title={p}
                    />
                  ))}
                </div>
              </div>
              {!usable && <span className="robotctl__ctl-warn">needs ≥2 saved poses</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default RobotControls
