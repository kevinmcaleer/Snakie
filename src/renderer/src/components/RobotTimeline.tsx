import { useRef } from 'react'
import type { MirrorPair, MotionEasing, MotionTimeline } from '../../../shared/robot'
import type { NamedPoseLike } from './robot-pose'
import './RobotTimeline.css'

export interface RobotTimelineProps {
  timeline: MotionTimeline
  /** Movable (non-mimic) joint names — the track rows. */
  movableJoints: string[]
  playhead: number // seconds
  playing: boolean
  /** The selected keyframe, if any. */
  selected: { joint: string; t: number } | null
  poses: NamedPoseLike[]
  /** True when at least one joint has a servo binding (export is possible). */
  canExport: boolean
  /** True when a left↔right mirror pairing exists. */
  canMirror: boolean
  onPlayPause: () => void
  onStop: () => void
  onToggleLoop: () => void
  onScrub: (t: number) => void
  onSetDuration: (d: number) => void
  onSetEasing: (e: MotionEasing) => void
  onSetFps: (f: number) => void
  onCapture: () => void
  onImportPose: (pose: NamedPoseLike) => void
  onMirror: (halfCycle: boolean) => void
  /** Left↔right mirror pairs + a per-pair invert toggle (#332). */
  mirrorPairs: MirrorPair[]
  onToggleInvert: (index: number) => void
  /** Duplicate the selected keyframe (or the whole pose at the playhead). */
  onDuplicate: () => void
  onExport: () => void
  onSelectKey: (joint: string, t: number) => void
  onMoveKey: (joint: string, fromT: number, toT: number) => void
  onDeleteKey: (joint: string, t: number) => void
  onAddKey: (joint: string, t: number) => void
}

function fmt(t: number): string {
  return `${t.toFixed(2)}s`
}

export function RobotTimeline(props: RobotTimelineProps): JSX.Element {
  const {
    timeline,
    movableJoints,
    playhead,
    playing,
    selected,
    poses,
    canExport,
    canMirror,
    onPlayPause,
    onStop,
    onToggleLoop,
    onScrub,
    onSetDuration,
    onSetEasing,
    onSetFps,
    onCapture,
    onImportPose,
    onMirror,
    mirrorPairs,
    onToggleInvert,
    onDuplicate,
    onExport,
    onSelectKey,
    onMoveKey,
    onDeleteKey,
    onAddKey
  } = props
  const duration = timeline.duration
  const trackByJoint = new Map(timeline.tracks.map((t) => [t.joint, t]))
  const hasKeys = timeline.tracks.some((t) => t.keys.length > 0)
  const dragRef = useRef<{ joint: string; fromT: number; el: HTMLElement } | null>(null)

  // Pointer x within a track element → time in seconds (clamped).
  const timeAt = (el: HTMLElement, clientX: number): number => {
    const r = el.getBoundingClientRect()
    const u = r.width > 0 ? (clientX - r.left) / r.width : 0
    return Math.max(0, Math.min(1, u)) * duration
  }

  const onKeyPointerDown = (e: React.PointerEvent, joint: string, t: number): void => {
    e.stopPropagation()
    const track = (e.currentTarget as HTMLElement).parentElement as HTMLElement
    dragRef.current = { joint, fromT: t, el: track }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    onSelectKey(joint, t)
  }
  const onKeyPointerMove = (e: React.PointerEvent): void => {
    const d = dragRef.current
    if (!d) return
    const to = timeAt(d.el, e.clientX)
    if (Math.abs(to - d.fromT) > 1e-4) {
      onMoveKey(d.joint, d.fromT, to)
      d.fromT = to
    }
  }
  const onKeyPointerUp = (): void => {
    dragRef.current = null
  }

  return (
    <div className="robottimeline" aria-label="Motion timeline">
      <div className="robottimeline__bar">
        <button
          type="button"
          className={`robottimeline__btn${playing ? ' is-on' : ''}`}
          onClick={onPlayPause}
          title={playing ? 'Pause' : 'Play'}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <button type="button" className="robottimeline__btn" onClick={onStop} title="Stop / rewind">
          ■
        </button>
        <label className="robottimeline__loop" title="Loop playback + export">
          <input type="checkbox" checked={timeline.loop} onChange={onToggleLoop} />
          loop
        </label>
        <input
          className="robottimeline__scrub"
          type="range"
          aria-label="Scrub"
          min={0}
          max={duration}
          step={0.01}
          value={Math.min(playhead, duration)}
          onChange={(e) => onScrub(Number(e.target.value))}
        />
        <span className="robottimeline__time">{fmt(playhead)}</span>
        <label className="robottimeline__field" title="Clip duration (seconds)">
          <span>dur</span>
          <input
            type="number"
            min={0.1}
            step={0.1}
            value={duration}
            onChange={(e) => onSetDuration(Number(e.target.value))}
          />
        </label>
        <select
          className="robottimeline__easing"
          aria-label="Easing"
          value={timeline.easing}
          onChange={(e) => onSetEasing(e.target.value as MotionEasing)}
        >
          <option value="easeInOut">ease-in-out</option>
          <option value="linear">linear</option>
        </select>
        <label className="robottimeline__field" title="Frames per second (preview + export)">
          <span>fps</span>
          <input
            type="number"
            min={1}
            max={60}
            step={1}
            value={timeline.fps ?? 20}
            onChange={(e) => onSetFps(Number(e.target.value))}
          />
        </label>
      </div>

      <div className="robottimeline__bar robottimeline__bar--actions">
        <button type="button" className="robottimeline__btn" onClick={onCapture} title="Add a keyframe for every joint at the playhead, from the current pose">
          ＋ Keyframe
        </button>
        <select
          className="robottimeline__pose"
          aria-label="Import a pose as a keyframe"
          value=""
          onChange={(e) => {
            const p = poses.find((x) => x.name === e.target.value)
            if (p) onImportPose(p)
            e.currentTarget.selectedIndex = 0
          }}
        >
          <option value="">＋ pose…</option>
          {poses.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="robottimeline__btn"
          disabled={!canMirror}
          onClick={() => onMirror(false)}
          title="Copy keyframes onto the opposite (left↔right) joints"
        >
          Mirror
        </button>
        <button
          type="button"
          className="robottimeline__btn"
          disabled={!canMirror}
          onClick={() => onMirror(true)}
          title="Mirror to the opposite joints, offset half a cycle (a walk)"
        >
          Mirror ½
        </button>
        {mirrorPairs.length > 0 && (
          <span className="robottimeline__mirpairs">
            {mirrorPairs.map((p, i) => (
              <label
                key={`${p.a} ${p.b}`}
                className="robottimeline__mirpair"
                title={`Mirror ${p.a} ↔ ${p.b}. Tick "inv" if the partner joint faces the opposite way (reflect the value about its neutral).`}
              >
                <input type="checkbox" checked={!!p.invert} onChange={() => onToggleInvert(i)} />
                <span>
                  {p.a}↔{p.b}
                </span>
              </label>
            ))}
          </span>
        )}
        <button
          type="button"
          className="robottimeline__btn"
          disabled={!hasKeys}
          onClick={onDuplicate}
          title={selected ? 'Duplicate the selected keyframe' : 'Duplicate the whole pose at the playhead'}
        >
          ⧉ Duplicate
        </button>
        {selected && (
          <button
            type="button"
            className="robottimeline__btn robottimeline__btn--del"
            onClick={() => onDeleteKey(selected.joint, selected.t)}
            title="Delete the selected keyframe"
          >
            ✕ key
          </button>
        )}
        <span className="robottimeline__spacer" />
        <button
          type="button"
          className="robottimeline__btn robottimeline__btn--export"
          disabled={!canExport}
          onClick={onExport}
          title={canExport ? 'Export runnable MicroPython' : 'Bind a servo to a joint first'}
        >
          Export .py
        </button>
      </div>

      <div className="robottimeline__tracks">
        <div
          className="robottimeline__playhead"
          style={{ left: `${(Math.min(playhead, duration) / duration) * 100}%` }}
          aria-hidden="true"
        />
        {movableJoints.map((joint) => {
          const track = trackByJoint.get(joint)
          return (
            <div className="robottimeline__row" key={joint}>
              <span className="robottimeline__row-name" title={joint}>
                {joint}
              </span>
              <div
                className="robottimeline__track"
                onPointerMove={onKeyPointerMove}
                onPointerUp={onKeyPointerUp}
                onDoubleClick={(e) => onAddKey(joint, timeAt(e.currentTarget as HTMLElement, e.clientX))}
              >
                {(track?.keys ?? []).map((k) => {
                  const isSel = selected?.joint === joint && Math.abs(selected.t - k.t) < 1e-4
                  return (
                    <button
                      type="button"
                      key={k.t}
                      className={`robottimeline__key${isSel ? ' is-sel' : ''}`}
                      style={{ left: `${(k.t / duration) * 100}%` }}
                      title={`${joint} @ ${fmt(k.t)} = ${k.value.toFixed(1)}`}
                      aria-label={`${joint} keyframe at ${fmt(k.t)}`}
                      onPointerDown={(e) => onKeyPointerDown(e, joint, k.t)}
                    />
                  )
                })}
              </div>
            </div>
          )
        })}
        {movableJoints.length === 0 && (
          <p className="robottimeline__empty">No movable joints to animate.</p>
        )}
      </div>
    </div>
  )
}

export default RobotTimeline
