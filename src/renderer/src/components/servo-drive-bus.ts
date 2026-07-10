/**
 * SERVO-DRIVE BUS (#) — a tiny in-renderer channel that lets a dock instrument
 * drive the live 3-D model directly, without a running program.
 * =============================================================================
 *
 * The Pose / Servo instruments WRITE hardware control (`SNKCMD servos …`), but
 * that only moves anything once a program on the board polls the control channel.
 * With no program running, moving a slider or clicking a pose does nothing
 * visible. This bus closes that gap: an instrument also `emitServoDrive({pin: deg})`,
 * and the Robot View subscribes (`onServoDrive`) and applies each pin→joint the
 * same way it applies live `SNK SERVO` telemetry — so the model moves immediately,
 * board-free, alongside the hardware send.
 *
 * It's a module-singleton listener set (no DOM events), so it's dependency-free
 * and unit-testable. It only reaches within ONE renderer window: a docked
 * instrument and the Robot View share it; a popped-out instrument window (a
 * separate realm) falls back to the hardware send. Keys are NUMERIC pins (e.g.
 * "16"), values whole servo degrees (0–180) — the shape `buildServosPayload` and
 * `servoToJointNative` both take.
 */

/** A batch of servo commands: numeric-pin → servo angle (degrees). */
export type ServoDriveMap = Record<string, number>

type Listener = (byPin: ServoDriveMap) => void

const listeners = new Set<Listener>()

/** Push a servo-drive batch to every subscriber (Robot View). No-op when empty. */
export function emitServoDrive(byPin: ServoDriveMap): void {
  if (!byPin || Object.keys(byPin).length === 0) return
  // Copy so a subscriber can't mutate the caller's object mid-iteration.
  const snapshot = { ...byPin }
  for (const l of [...listeners]) l(snapshot)
}

/** Subscribe to servo-drive batches. Returns an unsubscribe. */
export function onServoDrive(cb: Listener): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}
