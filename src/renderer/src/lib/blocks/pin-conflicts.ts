import type * as Blockly from 'blockly/core'
import { boardPins, pinLabel } from './board-pins'
import { blockDefinition } from './registry'

/**
 * TWO BLOCKS, ONE PIN (#1012, epic #1007).
 * =============================================================================
 *
 * A learner drags a servo block onto GP15 and a buzzer block onto GP15. Both
 * generate correct Python; both objects grab the same PWM slice; the servo
 * twitches and nobody can see why. The canvas is the only place that can see the
 * whole program at once, so the canvas is where this is caught.
 *
 * A WARNING, NOT AN ERROR — deliberately, and the issue says so. Sharing a pin
 * is sometimes exactly right: two blocks reading the same button, an LED and a
 * PWM on the same leg while you experiment. A hard error would be the app
 * telling a child their circuit is wrong when it is the app that cannot tell.
 * A warning badge says "look at this", which is all we actually know.
 *
 * ALSO CAUGHT: a pin that isn't on this board, and a pin that can't do the job.
 * Both come from the same place — a file written for different hardware, or a
 * board swapped underneath a program — and both are the same kind of "look at
 * this", for the same reason.
 *
 * Pure: it takes claims and returns messages, so every rule is a unit test
 * rather than something you find out by wiring up two servos.
 */

/** One block's claim on a pin. */
export interface PinClaim {
  /** The block making the claim. */
  blockId: string
  /** The GPIO, as the field holds it. */
  pin: string
  /** What the block is doing with it, for the message: `servo`, `buzzer`, … */
  role: string
  /** The capability the block needs, if it needs a particular one. */
  needs?: string
}

/**
 * Warnings by block id. A block with nothing wrong is absent, so a caller can
 * clear a block's warning by looking it up and finding nothing.
 */
export function pinConflicts(claims: readonly PinClaim[]): Map<string, string> {
  const out = new Map<string, string>()
  const byPin = new Map<string, PinClaim[]>()
  for (const claim of claims) {
    byPin.set(claim.pin, [...(byPin.get(claim.pin) ?? []), claim])
  }

  const pins = boardPins()
  for (const claim of claims) {
    const messages: string[] = []

    const sharing = (byPin.get(claim.pin) ?? []).filter((c) => c.blockId !== claim.blockId)
    if (sharing.length > 0) {
      // Named, not counted: "also used by the buzzer" tells a learner where to
      // look, and "used by 1 other block" does not.
      const others = [...new Set(sharing.map((c) => c.role))].sort()
      messages.push(`${pinLabel(claim.pin)} is also used by the ${others.join(' and ')}.`)
    }

    const known = pins.find((p) => String(p.gpio) === claim.pin)
    if (!known) {
      messages.push(`This board has no ${pinLabel(claim.pin)}.`)
    } else if (
      claim.needs &&
      known.capabilities.length > 0 &&
      !known.capabilities.includes(claim.needs)
    ) {
      // The failure this exists for: an analogue read on a pin with no ADC does
      // nothing at all, and nothing at all is the hardest thing to debug.
      messages.push(`${known.label} can't do ${claim.needs} on this board.`)
    }

    if (messages.length > 0) out.set(claim.blockId, messages.join('\n'))
  }
  return out
}

/**
 * The pin claims a workspace is making, from the blocks that declare one.
 *
 * Reads the registry rather than sniffing field names: a block called `PIN` that
 * isn't a pin, or a pin field called something else, would both be wrong, and
 * only the block's own definition knows which it is.
 */
export function collectPinClaims(workspace: Blockly.Workspace): PinClaim[] {
  const claims: PinClaim[] = []
  for (const block of workspace.getAllBlocks(false)) {
    const spec = blockDefinition(block.type)?.pin
    if (!spec) continue
    const pin = block.getFieldValue(spec.field)
    if (pin === null || pin === undefined) continue
    claims.push({ blockId: block.id, pin: String(pin), role: spec.role, needs: spec.needs })
  }
  return claims
}

/**
 * Put the warnings on the blocks, and take away the ones that no longer apply.
 *
 * Clearing matters as much as setting: a learner who moves a servo off the
 * buzzer's pin should watch the badge go, and a warning that outlives its cause
 * teaches them to ignore warnings.
 */
export function applyPinWarnings(workspace: Blockly.Workspace): void {
  const warnings = pinConflicts(collectPinClaims(workspace))
  for (const block of workspace.getAllBlocks(false)) {
    if (!blockDefinition(block.type)?.pin) continue
    block.setWarningText(warnings.get(block.id) ?? null)
  }
}
