import { useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from 'react'
import type { MotionEasing, MotionSequence, NamedPose } from '../../../shared/robot'
import { blockAt, blockTimes, MIN_GAP } from '../../../shared/robot-pose-timeline'
import './RobotPoseTimeline.css'

/**
 * POSE TIMELINE (Animate) — the one timeline: a row of pose blocks, with a gap
 * between each pair that says how long the move takes and how it eases.
 *
 * It replaces the Sequence step table (and is where a keyframe clip goes when it
 * is turned into blocks). Reading left to right is reading time: a wider gap is
 * a slower move. Drag a gap's handle to retime it, press its label to type a
 * time, press its curve to switch between a smooth and a steady move.
 *
 * Presentational: playback, persistence and the export live in RobotView.
 */
export interface RobotPoseTimelineProps {
  sequence: MotionSequence
  poses: NamedPose[]
  /** Pose name → thumbnail data URL (shared with the pose shelf). */
  thumbs: Record<string, string>
  playing: boolean
  /** Current play time (seconds). */
  playhead: number
  /** The selected block, or null. */
  selected: number | null
  live: boolean
  canLive: boolean
  canExport: boolean
  /** The robot has left/right joint pairs (so a walk cycle can be mirrored). */
  canMirror: boolean
  /** Ghosts of the neighbouring poses are shown in the 3-D view. */
  onion: boolean
  /** A joint-track clip exists that could be turned into blocks. */
  hasKeyframes: boolean
  onPlayPause: () => void
  onStop: () => void
  onSeek: (t: number) => void
  onSelect: (index: number) => void
  onToggleLoop: () => void
  onToggleLive: () => void
  onToggleOnion: () => void
  /** Add the pose the robot is in now as a block (saving it first if needed). */
  onAddCurrent: () => void
  onRemove: (index: number) => void
  onMove: (from: number, to: number) => void
  onSetGap: (index: number, seconds: number) => void
  onSetGapEasing: (index: number, easing: MotionEasing) => void
  onWalkCycle: () => void
  onConvertKeyframes: () => void
  onExport: () => void
}

/** Screen pixels per second of motion. */
const PX_PER_S = 140
const GAP_MIN_PX = 56
const GAP_MAX_PX = 420
const gapWidth = (seconds: number): number => Math.max(GAP_MIN_PX, Math.min(GAP_MAX_PX, seconds * PX_PER_S))
const fmt = (s: number): string => `${s.toFixed(2)}s`
const fmtGap = (s: number): string => `${Number(s.toFixed(2))}s`

export function RobotPoseTimeline({
  sequence,
  poses,
  thumbs,
  playing,
  playhead,
  selected,
  live,
  canLive,
  canExport,
  canMirror,
  onion,
  hasKeyframes,
  onPlayPause,
  onStop,
  onSeek,
  onSelect,
  onToggleLoop,
  onToggleLive,
  onToggleOnion,
  onAddCurrent,
  onRemove,
  onMove,
  onSetGap,
  onSetGapEasing,
  onWalkCycle,
  onConvertKeyframes,
  onExport
}: RobotPoseTimelineProps): JSX.Element {
  const steps = sequence.steps
  const n = steps.length
  const { starts, total } = blockTimes(sequence)
  const known = new Set(poses.map((p) => p.name))
  const t = Math.max(0, Math.min(playhead, total))
  const current = blockAt(sequence, t)
  const [editingGap, setEditingGap] = useState<number | null>(null)
  const [gapDraft, setGapDraft] = useState('')
  const [dragOver, setDragOver] = useState<number | null>(null)
  const dragFrom = useRef<number | null>(null)
  // A gap being stretched: where the pointer started and the gap it started at.
  const stretch = useRef<{ index: number; x: number; seconds: number } | null>(null)

  // A gap exists after every block on a loop; a one-shot has none after the last.
  const hasGap = (i: number): boolean => sequence.loop || i < n - 1

  const beginStretch = (i: number, e: ReactPointerEvent<HTMLSpanElement>): void => {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    stretch.current = { index: i, x: e.clientX, seconds: steps[i].duration }
  }
  const moveStretch = (e: ReactPointerEvent<HTMLSpanElement>): void => {
    const s = stretch.current
    if (!s) return
    // Snap to 0.05 s so a drag lands on tidy times.
    const raw = s.seconds + (e.clientX - s.x) / PX_PER_S
    onSetGap(s.index, Math.max(MIN_GAP, Math.round(raw * 20) / 20))
  }
  const endStretch = (): void => {
    stretch.current = null
  }

  const commitGap = (i: number): void => {
    const v = Number(gapDraft)
    if (Number.isFinite(v) && v > 0) onSetGap(i, v)
    setEditingGap(null)
  }

  const sel = selected != null && selected >= 0 && selected < n ? selected : null

  return (
    <div className="posetl" aria-label="Timeline">
      <div className="posetl__bar">
        <button
          type="button"
          className={`posetl__icon${playing ? ' is-on' : ''}`}
          onClick={onPlayPause}
          title={playing ? 'Pause (Space)' : 'Play (Space)'}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <button type="button" className="posetl__icon" onClick={onStop} title="Back to the start" aria-label="Back to the start">
          ■
        </button>
        <span className="posetl__time" aria-label="Time">
          {fmt(t)} / {fmt(total)}
        </span>
        <button
          type="button"
          className={`posetl__btn${sequence.loop ? ' is-on' : ''}`}
          aria-pressed={sequence.loop}
          onClick={onToggleLoop}
          title="Loop — after the last pose, move back to the first and go round again"
        >
          Loop
        </button>
        <span className="posetl__sep" aria-hidden="true" />
        <button
          type="button"
          className="posetl__btn posetl__btn--primary"
          onClick={onAddCurrent}
          title="Add pose — put the pose the robot is in now on the timeline (K)"
        >
          + Add pose <kbd>K</kbd>
        </button>
        {sel != null && (
          <span className="posetl__group" role="group" aria-label={`Block ${sel + 1}`}>
            <button
              type="button"
              className="posetl__icon"
              onClick={() => onMove(sel, sel - 1)}
              disabled={sel === 0}
              title="Move this pose earlier"
              aria-label="Move pose earlier"
            >
              ←
            </button>
            <button
              type="button"
              className="posetl__icon"
              onClick={() => onMove(sel, sel + 1)}
              disabled={sel === n - 1}
              title="Move this pose later"
              aria-label="Move pose later"
            >
              →
            </button>
            <button
              type="button"
              className="posetl__icon posetl__icon--danger"
              onClick={() => onRemove(sel)}
              title="Take this pose off the timeline (Delete). The saved pose stays on the shelf."
              aria-label="Remove pose from timeline"
            >
              ✕
            </button>
          </span>
        )}
        <span className="posetl__spacer" />
        <button
          type="button"
          className="posetl__btn"
          onClick={onWalkCycle}
          title={
            canMirror
              ? 'Make walk cycle — follow these poses with their mirror image, so a step with one leg becomes a full stride'
              : 'Make walk cycle needs left and right joints (for example hip_left and hip_right)'
          }
        >
          Make walk cycle
        </button>
        <button
          type="button"
          className={`posetl__btn${onion ? ' is-on' : ''}`}
          aria-pressed={onion}
          onClick={onToggleOnion}
          title="Onion skin — show faint copies of the pose before and after the one you are on"
        >
          Onion skin
        </button>
        <button
          type="button"
          className={`posetl__btn${live ? ' is-on' : ''}`}
          aria-pressed={live}
          onClick={onToggleLive}
          title={
            canLive
              ? 'Live — the real robot follows along as this plays'
              : 'Live needs a connected board and a servo bound to a joint'
          }
        >
          <span className="posetl__dot" aria-hidden="true" />
          Live
        </button>
        <button
          type="button"
          className="posetl__btn"
          onClick={onExport}
          title={canExport ? 'Export this motion as MicroPython (motion.py)' : 'Bind a servo to a joint first'}
        >
          Export
        </button>
      </div>

      {n === 0 ? (
        <div className="posetl__empty">
          <p>
            Pose the robot, then press <strong>Add pose</strong>. Each pose becomes a block here, and the robot moves from
            one block to the next.
          </p>
          {hasKeyframes && (
            <button type="button" className="posetl__btn" onClick={onConvertKeyframes}>
              Turn my keyframes into pose blocks
            </button>
          )}
        </div>
      ) : (
        <ol className="posetl__strip">
          {steps.map((step, i) => {
            const missing = !known.has(step.pose)
            const dur = Math.max(0, step.duration || 0)
            // How far the playhead is through the gap after this block (0..1).
            const through =
              current === i && hasGap(i) && dur > 0 ? Math.max(0, Math.min(1, (t - starts[i]) / dur)) : current > i ? 1 : 0
            return (
              <li className="posetl__cell" key={i}>
                <button
                  type="button"
                  draggable
                  className={
                    'posetl__block' +
                    (sel === i ? ' is-selected' : '') +
                    (current === i ? ' is-current' : '') +
                    (missing ? ' is-missing' : '') +
                    (dragOver === i ? ' is-drop' : '')
                  }
                  onClick={() => onSelect(i)}
                  onDragStart={(e) => {
                    dragFrom.current = i
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/plain', String(i))
                  }}
                  onDragOver={(e) => {
                    if (dragFrom.current == null) return
                    e.preventDefault()
                    setDragOver(i)
                  }}
                  onDragLeave={() => setDragOver((d) => (d === i ? null : d))}
                  onDrop={(e) => {
                    e.preventDefault()
                    const from = dragFrom.current
                    dragFrom.current = null
                    setDragOver(null)
                    if (from != null && from !== i) onMove(from, i)
                  }}
                  onDragEnd={() => {
                    dragFrom.current = null
                    setDragOver(null)
                  }}
                  title={
                    missing
                      ? `“${step.pose}” is no longer a saved pose`
                      : `${step.pose} — reached at ${fmt(starts[i])}. Press to go to it; drag to reorder.`
                  }
                  aria-label={`Pose ${i + 1}: ${step.pose}`}
                  aria-pressed={sel === i}
                >
                  {thumbs[step.pose] ? (
                    <img className="posetl__thumb" src={thumbs[step.pose]} alt="" draggable={false} />
                  ) : (
                    <span className="posetl__thumb posetl__thumb--blank" aria-hidden="true">
                      {missing ? '?' : ''}
                    </span>
                  )}
                  <span className="posetl__name">{step.pose}</span>
                  <span className="posetl__at">{fmt(starts[i])}</span>
                </button>

                {hasGap(i) && (
                  <div
                    className={`posetl__gap${i === n - 1 ? ' posetl__gap--loop' : ''}`}
                    style={{ width: gapWidth(dur) }}
                    onClick={(e) => {
                      // Press anywhere in a gap to scrub to that moment.
                      if ((e.target as HTMLElement).closest('button, input, .posetl__handle')) return
                      const r = e.currentTarget.getBoundingClientRect()
                      onSeek(starts[i] + dur * Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)))
                    }}
                  >
                    <span className="posetl__rail" aria-hidden="true">
                      <span className="posetl__fill" style={{ width: `${through * 100}%` }} />
                    </span>
                    <span className="posetl__gapctl">
                      {editingGap === i ? (
                        <input
                          className="posetl__gapinput"
                          type="number"
                          min={MIN_GAP}
                          step={0.05}
                          autoFocus
                          value={gapDraft}
                          aria-label={`Seconds from pose ${i + 1} to the next`}
                          onChange={(e) => setGapDraft(e.target.value)}
                          onBlur={() => commitGap(i)}
                          onKeyDown={(e) => {
                            e.stopPropagation()
                            if (e.key === 'Enter') commitGap(i)
                            if (e.key === 'Escape') setEditingGap(null)
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          className="posetl__gaptime"
                          onClick={() => {
                            setGapDraft(String(dur))
                            setEditingGap(i)
                          }}
                          title="How long this move takes. Press to type a time, or drag the handle."
                        >
                          {fmtGap(dur)}
                        </button>
                      )}
                      <button
                        type="button"
                        className="posetl__ease"
                        onClick={() =>
                          onSetGapEasing(i, (step.easing ?? 'easeInOut') === 'easeInOut' ? 'linear' : 'easeInOut')
                        }
                        title={
                          (step.easing ?? 'easeInOut') === 'easeInOut'
                            ? 'Smooth — starts and stops gently. Press for a steady move.'
                            : 'Steady — the same speed all the way. Press for a smooth move.'
                        }
                        aria-label={`Move ${i + 1} is ${(step.easing ?? 'easeInOut') === 'easeInOut' ? 'smooth' : 'steady'}`}
                      >
                        <svg viewBox="0 0 20 12" width="20" height="12" aria-hidden="true">
                          {(step.easing ?? 'easeInOut') === 'easeInOut' ? (
                            <path d="M1 11 C8 11 12 1 19 1" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                          ) : (
                            <path d="M1 11 L19 1" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                          )}
                        </svg>
                      </button>
                    </span>
                    {i === n - 1 && <span className="posetl__loopmark">back to start</span>}
                    <span
                      className="posetl__handle"
                      role="slider"
                      tabIndex={0}
                      aria-label={`Length of move ${i + 1}`}
                      aria-valuemin={MIN_GAP}
                      aria-valuemax={10}
                      aria-valuenow={dur}
                      aria-valuetext={fmtGap(dur)}
                      title="Drag to make this move slower or faster"
                      onPointerDown={(e) => beginStretch(i, e)}
                      onPointerMove={moveStretch}
                      onPointerUp={endStretch}
                      onPointerCancel={endStretch}
                      onKeyDown={(e) => {
                        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
                        e.preventDefault()
                        e.stopPropagation()
                        onSetGap(i, dur + (e.key === 'ArrowRight' ? 0.05 : -0.05))
                      }}
                    />
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

export default RobotPoseTimeline
