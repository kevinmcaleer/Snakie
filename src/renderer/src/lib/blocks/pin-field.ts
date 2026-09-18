import * as Blockly from 'blockly/core'
// `RegistrableField` is the registry's own contract type and is not on the
// `blockly/core` barrel, so it comes from the module that declares it.
import type { RegistrableField } from 'blockly/core/field_registry'
import { isPinName, pinOptionsFor } from './board-pins'

/**
 * THE PIN FIELD (#1012, epic #1007).
 * =============================================================================
 *
 * A dropdown of the pins the selected board actually has, filtered to the ones
 * that can do this block's job — ADC-capable for an analogue read, PWM-capable
 * for brightness and servos.
 *
 * A custom field rather than a plain `field_dropdown` because the options are
 * not known when the block is DEFINED. The board can change while the app is
 * open (plug in a different one, switch it in the Board View), and a JSON
 * dropdown's options are a fixed array baked in at definition time. Blockly's
 * dropdown does accept a FUNCTION, but a JSON block definition cannot hold one —
 * so the function lives here, in a field type the JSON can name.
 *
 * IT NEVER REJECTS A VALUE. `FieldDropdown` normally refuses anything outside
 * its current options, and that rule is exactly wrong here: a file written for a
 * board with a GP22 opens on a board without one, and refusing the value would
 * silently reset the block to a different pin — quietly rewiring somebody's
 * robot. The value is kept, the dropdown shows it, and the pin-conflict pass
 * (`pin-conflicts.ts`) is what flags anything the current board can't do.
 */
export class FieldPin extends Blockly.FieldDropdown {
  /** The capability this field filters on, e.g. `adc`. Undefined ⇒ all pins. */
  private readonly capability?: string

  constructor(capability?: string, value?: string) {
    super(() => pinOptionsFor(capability))
    this.capability = capability
    if (value !== undefined) this.setValue(value)
  }

  /**
   * Blockly's JSON hook: `{ type: 'field_snakie_pin', capability: 'adc' }`.
   *
   * The signature widens `FieldDropdown.fromJson`'s config (which insists on a
   * static `options` array this field does not have and must not take), so it
   * takes Blockly's own config type and reads the two extra keys off it.
   */
  static override fromJson(options: Blockly.FieldDropdownFromJsonConfig): FieldPin {
    const { capability, pin } = options as unknown as {
      capability?: string
      pin?: string | number
    }
    return new FieldPin(capability, pin === undefined ? undefined : String(pin))
  }

  /**
   * Accept any pin, including one this board does not have.
   *
   * See the note above: refusing would rewire a saved program to whatever pin
   * happened to be first in the list.
   */
  protected override doClassValidation_(value?: string): string | null {
    return value === undefined || value === null ? null : String(value)
  }

  /**
   * What the dropdown shows for the current value.
   *
   * Looks the label up in the LIVE options so a pin reads as `GP15` rather than
   * `15`, and falls back for a value the options do not hold — which is the case
   * that must still render something legible.
   *
   * THE FALLBACK HAS TO ASK WHICH KIND OF VALUE IT IS HOLDING. `GP` is a GPIO
   * prefix, and since #1097 this field can hold a learner's own NAME for a pin
   * as well as a number. Prefixing one gave `GPled` — a label naming no pin on
   * any board, sitting on the block a child had just named themselves. A name
   * falls back to itself; only a number gets the prefix it belongs to.
   */
  override getText(): string {
    const value = this.getValue()
    if (value === null) return ''
    const match = pinOptionsFor(this.capability).find(([, v]) => v === value)
    if (match) return match[0]
    return isPinName(value) ? value : `GP${value}`
  }
}

/**
 * Redraw every pin dropdown in a workspace, because the OPTIONS changed.
 *
 * A field's text comes out of {@link FieldPin.getText}, which reads the live
 * option list — but Blockly computes it while it renders the block and has no
 * reason to compute it again. So the option list and what is on screen come
 * apart whenever the options arrive AFTER the blocks:
 *
 *   - opening a file. The canvas loads the workspace, and only then does
 *     `applyPinWarnings` read the `name pin` blocks it now has and push the
 *     names. Every block was drawn before that, against an empty name list —
 *     which is exactly how `led` came out as `GPled` and stayed there.
 *   - swapping the board, which renames pins (`GP0` is `D1` on some) and can
 *     take one away entirely.
 *
 * Called from the two places that change the options, and only when they really
 * did change: this walks the whole workspace, and the drag path runs it on every
 * debounce.
 */
export function refreshPinFields(workspace: Blockly.Workspace): void {
  for (const block of workspace.getAllBlocks(false)) {
    for (const input of block.inputList) {
      for (const field of input.fieldRow) {
        // A headless workspace has nothing to draw, and `forceRerender` on an
        // unrendered block is Blockly's own no-op — but the test workspaces are
        // headless, so this is load-bearing rather than defensive.
        if (field instanceof FieldPin) field.forceRerender()
      }
    }
  }
}

/**
 * Register the field type so JSON block definitions can name it.
 *
 * Idempotent: Blockly throws on a duplicate registration, and this module is
 * imported by every palette that has a pin on it.
 */
export function installPinField(): void {
  if (Blockly.registry.hasItem(Blockly.registry.Type.FIELD, FIELD_PIN_TYPE)) return
  // The cast is the price of the widened `fromJson` above: Blockly's
  // `RegistrableField` wants the exact base signature, and a field whose options
  // are a live function cannot have it.
  Blockly.fieldRegistry.register(FIELD_PIN_TYPE, FieldPin as unknown as RegistrableField)
}

/** The name JSON definitions use. */
export const FIELD_PIN_TYPE = 'field_snakie_pin'
