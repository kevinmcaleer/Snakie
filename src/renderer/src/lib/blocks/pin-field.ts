import * as Blockly from 'blockly/core'
// `RegistrableField` is the registry's own contract type and is not on the
// `blockly/core` barrel, so it comes from the module that declares it.
import type { RegistrableField } from 'blockly/core/field_registry'
import { pinOptionsFor } from './board-pins'

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
   * `15`, and falls back to the raw value for a pin this board doesn't have —
   * which is the case that must still render something legible.
   */
  override getText(): string {
    const value = this.getValue()
    if (value === null) return ''
    const match = pinOptionsFor(this.capability).find(([, v]) => v === value)
    return match ? match[0] : `GP${value}`
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
