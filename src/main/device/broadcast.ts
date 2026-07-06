import type { WebContents } from 'electron'

/**
 * The slice of `WebContents` the device-event broadcaster needs. Kept minimal so
 * it's trivially fakeable in a plain unit test (no Electron runtime dependency —
 * this module only uses the TYPE, which is erased at build).
 */
export type BroadcastTarget = Pick<WebContents, 'isDestroyed' | 'send'>

/**
 * Send `payload` on `channel` to every live target window (#226).
 *
 * Skips `undefined`/`null` and destroyed targets, and swallows a `send()` that
 * throws — a secondary window (instrument / console / Board View) can be torn
 * down BETWEEN the `isDestroyed()` check and the `send()`, which used to throw
 * "Object has been destroyed" and kill the whole broadcast loop, so later
 * windows (and the next event) stopped receiving device data/status. Guarding
 * every send keeps the broadcast robust when a window closes mid-stream.
 */
export function broadcastToTargets(
  targets: Array<BroadcastTarget | undefined | null>,
  channel: string,
  payload: unknown
): void {
  for (const wc of targets) {
    if (!wc || wc.isDestroyed()) continue
    try {
      wc.send(channel, payload)
    } catch {
      // Torn down between the isDestroyed() check and the send — ignore so one
      // dead window can't stop the broadcast reaching the others.
    }
  }
}
