import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { reporter } from '../lib/report-error'
import { InstrumentWindow, type FloatProps } from './InstrumentWindow'
import { type InstrumentDef } from './instruments-registry'
import { useWorkspaceOptional } from '../store/workspace'
import { buildServosPayload } from '../../../shared/control'
import { poseServoAngles } from './servo-bind'
import { normPin } from './robot-pose'
import type { NamedPose, ServoJointBinding } from '../../../shared/robot'
import './PoseInstrument.css'

/**
 * POSE INSTRUMENT (#) — a live test bench for a rig's servos.
 * =============================================================================
 *
 * Reads the project's `robot.yml` (its servo↔joint map + saved poses) and gives
 * two quick ways to drive the real hardware while a program runs:
 *
 *  • **Pose buttons** — one per saved pose; a press snaps every bound servo to
 *    the angle that reaches that pose (via each binding's calibration,
 *    {@link poseServoAngles}).
 *  • **Per-servo sliders** — one per bound GPIO; drag to nudge that servo live.
 *
 * Both WRITE a single `SNKCMD servos "<pin>:<deg> …"` control line via
 * `window.api.device.sendControl('servos', …)` — the multi-servo payload built by
 * {@link buildServosPayload}, matching the on-device `servos_command` receiver.
 * The instrument reloads its map/poses on `robot:onChanged`, so binding a servo
 * or saving a pose in either editor shows up here without reopening. It reads the
 * same shared spine (`servoJointMap`) the 3-D view uses, so a slider here also
 * moves the on-screen model (the board echoes `SNK SERVO`).
 */

export interface PoseInstrumentProps {
  def: InstrumentDef
  onClose?: () => void
  docked?: boolean
  onToggleDock?: () => void
  float?: FloatProps
}

/** The multi-servo control target (`SNKCMD servos …`). */
const SERVOS_TARGET = 'servos'
/** Neutral servo angle for a freshly-loaded slider. */
const NEUTRAL_DEG = 90

function clampDeg(n: number): number {
  return !Number.isFinite(n) ? NEUTRAL_DEG : n < 0 ? 0 : n > 180 ? 180 : Math.round(n)
}

export function PoseInstrument({
  def,
  onClose,
  docked = true,
  onToggleDock,
  float
}: PoseInstrumentProps): JSX.Element {
  // The workspace is absent in a detached OS window (no provider); read it safely
  // and fall back to the default project folder.
  const ws = useWorkspaceOptional()
  const folder = ws?.currentFolder ?? undefined

  const [bindings, setBindings] = useState<ServoJointBinding[]>([])
  const [poses, setPoses] = useState<NamedPose[]>([])
  // Commanded angle per NUMERIC pin (optimistic) — keys match buildServosPayload.
  const [angles, setAngles] = useState<Record<string, number>>({})
  const lastSent = useRef(0)

  // Load the rig's servo map + poses, and follow live edits from the other views.
  useEffect(() => {
    let live = true
    const load = (): void => {
      window.api.robot
        .load(folder)
        .then((d) => {
          if (!live) return
          const bs = d.robot?.servoJointMap ?? []
          setBindings(bs)
          setPoses(d.robot?.poses ?? [])
          // Seed a neutral angle for any newly-bound pin; keep known ones.
          setAngles((prev) => {
            const next: Record<string, number> = {}
            for (const b of bs) {
              const pin = normPin(b.pin)
              next[pin] = prev[pin] ?? NEUTRAL_DEG
            }
            return next
          })
        })
        .catch(reporter('poses load'))
    }
    load()
    const off = window.api.robot.onChanged(load)
    return () => {
      live = false
      off()
    }
  }, [folder])

  /** Fire a servos payload; throttle rapid streams (slider drags) like the servo panel. */
  const send = useCallback((byPin: Record<string, number>, throttle = false): void => {
    if (throttle) {
      const now = Date.now()
      if (now - lastSent.current < 40) return
      lastSent.current = now
    }
    const payload = buildServosPayload(byPin)
    if (payload) void window.api.device.sendControl(SERVOS_TARGET, payload).catch(reporter('poses send'))
  }, [])

  /** Jump every bound servo to a saved pose. */
  const recall = useCallback(
    (pose: NamedPose): void => {
      const byPin = poseServoAngles(bindings, pose.values)
      if (Object.keys(byPin).length === 0) return
      setAngles((a) => ({ ...a, ...byPin }))
      send(byPin)
    },
    [bindings, send]
  )

  /** Nudge one servo live. */
  const setServo = useCallback(
    (pin: string, deg: number, throttle = false): void => {
      const d = clampDeg(deg)
      setAngles((a) => ({ ...a, [pin]: d }))
      send({ [pin]: d }, throttle)
    },
    [send]
  )

  const hasServos = bindings.length > 0
  const source = hasServos
    ? `${bindings.length} servo${bindings.length === 1 ? '' : 's'}`
    : 'no servos'

  return (
    <InstrumentWindow
      name={def.name.toUpperCase()}
      helpId={`inst-${def.id}`}
      source={source}
      docked={docked}
      onClose={onClose}
      onToggleDock={onToggleDock}
      {...float}
    >
      <div
        className="posebench"
        style={{ '--accent': def.accent, '--accent-border': def.border } as CSSProperties}
      >
        {!hasServos ? (
          <p className="posebench__empty">
            No servos bound yet. Bind a servo to a joint in the Board or Robot View — then its
            slider (and your saved poses) appear here to test live.
          </p>
        ) : (
          <>
            {poses.length > 0 && (
              <div className="posebench__poses">
                <span className="posebench__label">Poses</span>
                <div className="posebench__pose-btns">
                  {poses.map((p) => (
                    <button
                      key={p.name}
                      type="button"
                      className="posebench__pose"
                      onClick={() => recall(p)}
                      title={`Send every servo to “${p.name}”`}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="posebench__servos">
              <span className="posebench__label">Servos</span>
              {bindings.map((b) => {
                const pin = normPin(b.pin)
                const val = angles[pin] ?? NEUTRAL_DEG
                return (
                  <div className="posebench__servo" key={pin}>
                    <span className="posebench__servo-name" title={`GP${pin} · ${b.joint}`}>
                      <span className="posebench__servo-pin">GP{pin}</span>
                      <span className="posebench__servo-joint">{b.joint}</span>
                    </span>
                    <input
                      className="posebench__slider"
                      type="range"
                      min={0}
                      max={180}
                      step={1}
                      value={val}
                      aria-label={`GP${pin} (${b.joint}) angle`}
                      onChange={(e) => setServo(pin, Number(e.currentTarget.value), true)}
                      // A final un-throttled send so the last position always lands.
                      onPointerUp={() => setServo(pin, val)}
                    />
                    <span className="posebench__servo-val">{val}°</span>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </InstrumentWindow>
  )
}

export default PoseInstrument
