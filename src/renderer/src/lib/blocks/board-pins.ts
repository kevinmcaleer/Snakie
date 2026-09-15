/**
 * THE PINS THIS BOARD ACTUALLY HAS (#1012, epic #1007).
 * =============================================================================
 *
 * A hardware block asks for a pin. The wrong answer is a number field: a child
 * types 27 for an analogue reading, nothing happens, and there is no way to find
 * out that GP27 on their board has no ADC. The right answer is a dropdown of
 * THIS board's pins that can do THAT job — which means the block needs to know
 * what board is selected, and which of its pins are ADC-capable, PWM-capable,
 * or just digital.
 *
 * That knowledge already exists: part definitions carry `capabilities` per pin
 * (`digital`, `pwm`, `adc`, `i2c`, `spi`), the board index resolves the selected
 * board to a part, and `board-pin-check.ts` already projects one into
 * `BoardPinInfo`. This module is the small piece in the middle — a cache the
 * canvas fills and the block fields read.
 *
 * WHY A MODULE-LEVEL CACHE rather than a React context. A Blockly field's option
 * list is produced by a callback Blockly invokes when the menu opens, deep
 * inside its own event handling, with no component anywhere near it. A plain
 * module the canvas keeps up to date is the only shape that fits, and the cost
 * is that it is global — which is correct here, because so is the selected
 * board.
 *
 * Pure apart from the cache, so the filtering and the fallback are unit-tested.
 */

import { pyString } from './py'

/** One pin a block may target. */
export interface BlockPin {
  /** The GPIO number — what the generated code passes to `Pin(...)`. */
  gpio: number
  /** The silk label the dropdown shows, e.g. `GP15`. */
  label: string
  /** What this pin can do: `digital`, `pwm`, `adc`, `i2c`, `spi`. */
  capabilities: readonly string[]
}

/**
 * The Pico's pins, used when no board has been resolved yet.
 *
 * NOT a guess about the user's hardware — a floor, so the dropdowns are never
 * empty. An empty dropdown is a block a learner cannot configure at all, which
 * is worse than one offering the pins of the most common board in the room
 * while the real one loads. The Pico is Snakie's default board
 * (`DEFAULT_BOARD_ID`), and on the whole RP2040/RP2350 family these are right.
 */
export const FALLBACK_PINS: readonly BlockPin[] = Object.freeze(
  Array.from({ length: 29 }, (_, gpio) => ({
    gpio,
    label: `GP${gpio}`,
    // ADC lives on GP26-28 on the RP2 family; every GPIO can do PWM.
    capabilities: gpio >= 26 ? ['digital', 'pwm', 'adc'] : ['digital', 'pwm']
  }))
)

let current: readonly BlockPin[] = FALLBACK_PINS
let onboardLed: string | null = null

/**
 * Tell the blocks which board is on screen.
 *
 * Called by the canvas whenever the board selection changes. An empty list
 * resets to {@link FALLBACK_PINS} rather than leaving the dropdowns empty.
 */
export function setBoardPins(pins: readonly BlockPin[], onboardLedToken?: string | null): void {
  current = pins.length > 0 ? pins : FALLBACK_PINS
  onboardLed = onboardLedToken ?? null
}

/** The pins currently offered. */
export function boardPins(): readonly BlockPin[] {
  return current
}

/**
 * The onboard LED's pin token, as the generated code should write it.
 *
 * A string like `"LED"` on a Pico W (where the LED hangs off the wireless chip
 * and has no GPIO number at all) or a number like `25` on a plain Pico. Absent
 * when the board doesn't declare one — the block then says so rather than
 * generating a pin that isn't there.
 */
export function onboardLedToken(): string | null {
  return onboardLed
}

/**
 * The dropdown options for a role: `[label, value]` pairs, GPIO as the value.
 *
 * `capability` filters — `adc` for the analogue blocks, `pwm` for brightness and
 * servos. A board whose part declares no capabilities at all (an older or
 * hand-authored one) offers everything rather than nothing: a missing
 * declaration means we don't know, and "we don't know" must not read as "this
 * pin can't".
 */
export function pinOptionsFor(capability?: string): [string, string][] {
  const pins = current.filter((p) => !capability || capable(p, capability))
  const usable = pins.length > 0 ? pins : current
  return usable.map((p) => [p.label, String(p.gpio)])
}

/** Does `pin` claim `capability` — or claim nothing at all, which is not a no? */
function capable(pin: BlockPin, capability: string): boolean {
  return pin.capabilities.length === 0 || pin.capabilities.includes(capability)
}

/** The label for a GPIO, for a warning message. Falls back to `GP<n>`. */
export function pinLabel(gpio: string | number): string {
  const n = Number(gpio)
  return current.find((p) => p.gpio === n)?.label ?? `GP${gpio}`
}

/**
 * The onboard-LED token as the generated code should write it.
 *
 * A board declares its onboard LED as a bare token: `25` on a plain Pico, `LED`
 * on a Pico W (where it hangs off the wireless chip and has no GPIO at all).
 * Python needs the first as a number and the second as a string, and getting it
 * the wrong way round gives `Pin("25")` — which some ports accept and some do
 * not — or `Pin(LED)`, a `NameError`.
 */
export function ledPinToken(ledLabel: string | null | undefined): string | null {
  const raw = (ledLabel ?? '').trim()
  if (!raw) return null
  if (/^[0-9]+$/.test(raw)) return raw
  // `GP25` is a label for a numbered pin, so the number is what Python wants.
  const gp = /^GP([0-9]+)$/i.exec(raw)
  return gp ? gp[1] : pyString(raw)
}
