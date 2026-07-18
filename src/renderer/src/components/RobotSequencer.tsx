import type { JSX } from 'react'
import type { MotionEasing, MotionSequence, NamedPose } from '../../../shared/robot'
import { sequenceDuration, sequenceSegments } from '../../../shared/robot-timeline'
import './RobotSequencer.css'

/**
 * POSE-STEP SEQUENCER (#415, epic #403) — authors a walk cycle as an ordered list
 * of saved poses, each with its own duration + easing, instead of a grid of
 * per-joint keyframes. A transport bar (play/pause, stop, scrubber over the total
 * duration, loop, Live, export) mirrors {@link RobotTimeline}; the body is the
 * reorderable step list. Playback + persistence + the managed `SNAKIE_SEQUENCES`
 * export live in {@link RobotView}; this is the presentational surface.
 */

export interface RobotSequencerProps {
  sequence: MotionSequence
  /** Saved poses to pick steps from (only those that apply to this robot). */
  poses: NamedPose[]
  playing: boolean
  /** Current play time (seconds). */
  playhead: number
  /** Streaming to a connected board. */
  live: boolean
  /** A board is connected AND at least one servo is bound (else Live is disabled). */
  canLive: boolean
  /** A servo is bound (else Export has nothing to drive). */
  canExport: boolean
  onPlayPause: () => void
  onStop: () => void
  onScrub: (t: number) => void
  onToggleLoop: () => void
  onToggleLive: () => void
  onAddStep: (pose: string) => void
  onRemoveStep: (index: number) => void
  onMoveStep: (index: number, dir: -1 | 1) => void
  onSetStepPose: (index: number, pose: string) => void
  onSetStepDuration: (index: number, seconds: number) => void
  onSetStepEasing: (index: number, easing: MotionEasing) => void
  onExport: () => void
}

const fmt = (s: number): string => `${s.toFixed(2)}s`

export function RobotSequencer({
  sequence,
  poses,
  playing,
  playhead,
  live,
  canLive,
  canExport,
  onPlayPause,
  onStop,
  onScrub,
  onToggleLoop,
  onToggleLive,
  onAddStep,
  onRemoveStep,
  onMoveStep,
  onSetStepPose,
  onSetStepDuration,
  onSetStepEasing,
  onExport
}: RobotSequencerProps): JSX.Element {
  const steps = sequence.steps
  const total = sequenceDuration(sequence)
  const segs = sequenceSegments(sequence)
  const poseNames = poses.map((p) => p.name)
  const hasPoses = poseNames.length > 0

  // Cumulative end-time of each segment, so a step row can show when it lands.
  let acc = 0
  const segEnd = segs.map((d) => (acc += d))

  return (
    <div className="robotseq" aria-label="Pose sequence">
      <div className="robotseq__bar">
        <button
          type="button"
          className={`robotseq__btn${playing ? ' is-on' : ''}`}
          onClick={onPlayPause}
          disabled={steps.length < 1}
          title={playing ? 'Pause' : 'Play the sequence'}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <button type="button" className="robotseq__btn" onClick={onStop} title="Stop / rewind">
          ■
        </button>
        <label className="robotseq__loop" title="Loop the sequence (last step eases back to the first)">
          <input type="checkbox" checked={sequence.loop} onChange={onToggleLoop} />
          Loop
        </label>
        <input
          className="robotseq__scrub"
          type="range"
          min={0}
          max={Math.max(0.001, total)}
          step={0.01}
          value={Math.min(playhead, total)}
          onChange={(e) => onScrub(Number(e.target.value))}
          disabled={total <= 0}
          aria-label="Scrub the sequence"
        />
        <span className="robotseq__time">
          {fmt(Math.min(playhead, total))} / {fmt(total)}
        </span>
        <label
          className={`robotseq__live${live ? ' is-on' : ''}`}
          title={
            canLive
              ? 'Stream each frame to the connected board (SNKCMD servo)'
              : 'Connect a board and bind a servo to stream live'
          }
        >
          <input type="checkbox" checked={live} onChange={onToggleLive} disabled={!canLive} />
          <span className="robotseq__live-dot" aria-hidden="true" />
          Live
        </label>
        <span className="robotseq__spacer" />
        <button
          type="button"
          className="robotseq__btn"
          onClick={onExport}
          disabled={!canExport}
          title={canExport ? 'Export motion.py (with the sequence)' : 'Bind a servo first'}
        >
          Export
        </button>
      </div>

      <div className="robotseq__steps">
        {!hasPoses ? (
          <p className="robotseq__empty">Save a pose first — steps reference your saved poses.</p>
        ) : steps.length === 0 ? (
          <p className="robotseq__empty">No steps yet. Add a pose below to start the sequence.</p>
        ) : (
          <ol className="robotseq__list">
            {steps.map((step, i) => {
              const known = poseNames.includes(step.pose)
              return (
                <li className="robotseq__step" key={i}>
                  <span className="robotseq__num">{i + 1}</span>
                  <select
                    className={`robotseq__pose${known ? '' : ' is-missing'}`}
                    value={known ? step.pose : ''}
                    onChange={(e) => onSetStepPose(i, e.target.value)}
                    title={known ? step.pose : `“${step.pose}” — no such pose`}
                  >
                    {!known && (
                      <option value="" disabled>
                        {step.pose} (missing)
                      </option>
                    )}
                    {poseNames.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                  <label className="robotseq__dur" title="Seconds to the next pose">
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      value={step.duration}
                      onChange={(e) => onSetStepDuration(i, Number(e.target.value))}
                    />
                    s
                  </label>
                  <select
                    className="robotseq__easing"
                    value={step.easing ?? 'easeInOut'}
                    onChange={(e) => onSetStepEasing(i, e.target.value as MotionEasing)}
                    title="Interpolation into the next pose"
                  >
                    <option value="easeInOut">smooth</option>
                    <option value="linear">linear</option>
                  </select>
                  <span className="robotseq__at" title="Reaches the next pose at">
                    {fmt(segEnd[i] ?? total)}
                  </span>
                  <span className="robotseq__ops">
                    <button
                      type="button"
                      className="robotseq__op"
                      onClick={() => onMoveStep(i, -1)}
                      disabled={i === 0}
                      title="Move up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="robotseq__op"
                      onClick={() => onMoveStep(i, 1)}
                      disabled={i === steps.length - 1}
                      title="Move down"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="robotseq__op robotseq__op--del"
                      onClick={() => onRemoveStep(i)}
                      title="Remove step"
                    >
                      ✕
                    </button>
                  </span>
                </li>
              )
            })}
          </ol>
        )}
      </div>

      {hasPoses && (
        <div className="robotseq__add">
          <span className="robotseq__add-label">Add step:</span>
          {poses.map((p) => (
            <button
              key={p.name}
              type="button"
              className="robotseq__add-pose"
              onClick={() => onAddStep(p.name)}
              title={`Append “${p.name}” as a step`}
            >
              + {p.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default RobotSequencer
