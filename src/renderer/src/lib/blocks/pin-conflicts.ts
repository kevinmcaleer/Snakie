import type * as Blockly from 'blockly/core'
import {
  boardPins,
  isInputDirection,
  pinAliasesIn,
  pinLabel,
  resolvePinGpio,
  setPinAliases,
  type PinDirection
} from './board-pins'
import { syncHardwareVariables } from './hardware-names'
import { refreshPinFields } from './pin-field'
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
  /** The pin as the field holds it: a GPIO, or the learner's NAME for one. */
  pin: string
  /** What the block is doing with it, for the message: `servo`, `buzzer`, … */
  role: string
  /** The capability the block needs, if it needs a particular one. */
  needs?: string
  /**
   * The GPIO {@link pin} stands for; `null` when it names one nothing declares.
   *
   * Resolved by {@link collectPinClaims}, which has the workspace and therefore
   * the `name pin` blocks. Omitted entirely by a caller holding plain numbers —
   * then it is read off {@link pin} itself, so nothing that was true before
   * named pins existed has to change.
   *
   * IT IS WHAT THE COMPARISONS USE, all of them. Two blocks on GP15 clash
   * whether they got there as `15`, as `motor_left`, or as one of each: what
   * clashes is the hole, and a learner who names the same pin twice has made
   * exactly the mistake this pass is for.
   */
  gpio?: number | null
  /** Which way this block drives it, when the block's definition says. */
  direction?: 'in' | 'out'
  /**
   * How the pin was configured where it was NAMED, when it was.
   *
   * Absent for a plain GPIO, which every block configures for itself. Present
   * for a named one, where the object is built once and a block that drives it
   * the other way does nothing at all — `.value(1)` on an input pin neither
   * errors nor lights anything, which is the silent wrong answer this whole
   * pass exists to catch.
   */
  declaredAs?: PinDirection
}

/**
 * The GPIO a claim is really about.
 *
 * `gpio` when the collector resolved one, and otherwise read off the field value
 * — which covers every caller written before names existed, all of whom hold
 * plain numbers.
 */
function gpioOf(claim: PinClaim): number | null {
  return claim.gpio !== undefined ? claim.gpio : resolvePinGpio(claim.pin, [])
}

/**
 * Warnings by block id. A block with nothing wrong is absent, so a caller can
 * clear a block's warning by looking it up and finding nothing.
 */
export function pinConflicts(claims: readonly PinClaim[]): Map<string, string> {
  const out = new Map<string, string>()
  const byPin = new Map<string, PinClaim[]>()
  // Grouped by the HOLE, not by what the field says. An undeclared name has no
  // hole to group by, so it groups under itself — two blocks set to the same
  // undeclared name are still one mistake, and neither is a clash with a real
  // pin we cannot prove they meant.
  const key = (claim: PinClaim): string => {
    const gpio = gpioOf(claim)
    return gpio === null ? `name:${claim.pin.trim()}` : String(gpio)
  }
  for (const claim of claims) {
    byPin.set(key(claim), [...(byPin.get(key(claim)) ?? []), claim])
  }

  const pins = boardPins()
  for (const claim of claims) {
    const messages: string[] = []

    const sharing = (byPin.get(key(claim)) ?? []).filter((c) => c.blockId !== claim.blockId)
    if (sharing.length > 0) {
      // Named, not counted: "also used by the buzzer" tells a learner where to
      // look, and "used by 1 other block" does not.
      const others = [...new Set(sharing.map((c) => c.role))].sort()
      messages.push(`${pinLabel(claim.pin)} is also used by the ${others.join(' and ')}.`)
    }

    if (claim.declaredAs && claim.direction) {
      const declaredIn = isInputDirection(claim.declaredAs)
      if (declaredIn !== (claim.direction === 'in')) {
        const was = declaredIn ? 'an input' : 'an output'
        const wants = claim.direction === 'in' ? 'reads' : 'drives'
        messages.push(
          `${claim.pin.trim()} is named as ${was}, and this block ${wants} it. Change the “name pin” block, or pick another pin.`
        )
      }
    }

    const gpio = gpioOf(claim)
    if (gpio === null) {
      // A `name pin` block deleted out from under a block still set to its name.
      // The generated line would raise `NameError`, so this says so before it is
      // ever run — and says what to do about it.
      messages.push(
        `Nothing names ${claim.pin.trim()}. Add a “name pin” block for it, or pick a pin.`
      )
    }
    const known = gpio === null ? undefined : pins.find((p) => p.gpio === gpio)
    if (gpio !== null && !known) {
      messages.push(`This board has no ${pinLabel(claim.pin)}.`)
    } else if (
      known &&
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
  // Read once for the whole workspace rather than per claim: the names are a
  // property of the program, and a block cannot change them by being looked at.
  const declared = pinAliasesIn(workspace)
  for (const block of workspace.getAllBlocks(false)) {
    const spec = blockDefinition(block.type)?.pin
    if (!spec) continue
    const pin = block.getFieldValue(spec.field)
    if (pin === null || pin === undefined) continue
    const named = declared.find((a) => a.name === String(pin).trim())
    claims.push({
      blockId: block.id,
      pin: String(pin),
      role: spec.role,
      needs: spec.needs,
      direction: spec.direction,
      gpio: resolvePinGpio(String(pin), declared),
      ...(named ? { declaredAs: named.direction } : {})
    })
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
  // The pin dropdowns offer the names this program declares. Pushed from here
  // because this already runs on every workspace change and already holds the
  // workspace — so the menu and the warnings can never be looking at different
  // sets of names.
  //
  // AND THE FIELDS ALREADY ON SCREEN HAVE TO BE TOLD. A dropdown works out its
  // label while Blockly draws the block and has no reason to do it again, so on
  // the path that matters most — opening a file, where every block is drawn
  // before this line has read a single `name pin` off it — each pin field was
  // rendered against an empty name list. That is how a learner's `led` came out
  // as `GPled` and stayed there while the menu behind it was right all along.
  if (setPinAliases(pinAliasesIn(workspace))) refreshPinFields(workspace)
  // AND THE SOCKETS OFFER THEM TOO. A pin dropdown is a field and reads the
  // list above; `set power of ( )` and `set pin ( ) to [high]` take their
  // hardware in a SOCKET, where the menu is a variable dropdown — so a name the
  // program declares has to exist as a variable or it cannot be pointed at at
  // all. Here for the same reason the push above is: this already runs on every
  // change and on the load, so what a declaration means can never be two
  // different answers in two different menus.
  syncHardwareVariables(workspace)
  const warnings = pinConflicts(collectPinClaims(workspace))
  for (const block of workspace.getAllBlocks(false)) {
    if (!blockDefinition(block.type)?.pin) continue
    block.setWarningText(warnings.get(block.id) ?? null)
  }
}
