/**
 * POWER INDICATOR LEDs (#698) — is this part actually being supplied?
 * =============================================================================
 *
 * A breakout's PWR LED is the first thing you look at on a real bench: it says
 * the board has power, before anything else can be true. Snakie drew it the same
 * whether the part was wired to a battery or sitting unconnected, so the one piece
 * of feedback hardware gives for free was missing.
 *
 * The DC solver (#603/#604) already knows every node's voltage, so the answer is
 * there — this module is just the reading of it, kept pure so it can be tested
 * without a canvas.
 *
 * **Three states, not two.** `unknown` is load-bearing: with no solvable circuit
 * (no source, no electrical models) there is nothing to read, and drawing the LED
 * dark would assert "this part is unpowered" on the strength of knowing nothing.
 * Only a real solve may turn an LED off.
 */
import type { PartElectrical } from './part'

/**
 * Supply threshold when the part doesn't say what it needs, in volts.
 *
 * An indicator LED and its series resistor won't visibly light much below this —
 * a red LED's forward drop is ~1.8 V and green/blue are higher — so it is the
 * honest floor for "there is a supply here" absent better information.
 */
export const POWER_LED_MIN_V = 2

/** Lit, dark, or nothing known well enough to say. */
export type PowerLedState = 'lit' | 'dark' | 'unknown'

/** Is this LED a supply indicator (as opposed to something a GPIO drives)? */
export function isPowerLed(led: { kind: string }): boolean {
  return led.kind === 'power'
}

/**
 * Does a part's power LED light, given the supply its pins are actually sitting on?
 *
 * `operatingV` (#687) is the right threshold when it exists: it is precisely the
 * range the part is designed to run at, so at or above its minimum the part is
 * properly supplied. Below it the LED goes dark, which lines up with the ERC's
 * under-voltage warning rather than contradicting it — a browned-out part looks
 * browned out.
 *
 * OVER-voltage still lights. The part is receiving power (and being damaged by it);
 * saying so is the ERC's job, and a dark LED would read as "not connected".
 */
export function powerLedState(supplyV: number | undefined, electrical?: PartElectrical): PowerLedState {
  if (supplyV === undefined || !Number.isFinite(supplyV)) return 'unknown'
  const min = electrical?.operatingV?.[0]
  const threshold = min !== undefined && min > 0 ? min : POWER_LED_MIN_V
  return supplyV >= threshold ? 'lit' : 'dark'
}

/** One pin of a placed part, as much of it as this module needs. */
export interface SuppliedPin {
  /** `vcc` / `gnd` / `signal` — the netlist's classification of the pin. */
  net: string
  /** The wiring endpoint this pin resolves to, for the solved-voltage lookup. */
  endpoint: string
}

/**
 * The supply a placed part is sitting on: its power pins' voltage, measured
 * against its OWN ground pin.
 *
 * Not against 0 V — the part is a two-terminal thing as far as its indicator is
 * concerned, and a design with a shifted ground reference (a high-side shunt, a
 * split supply) would otherwise read a voltage the part never sees. A part with no
 * solved ground falls back to 0 V, which is the usual case and the usual answer.
 *
 * The highest power pin wins: a board fed 5 V that also exposes a 3V3 output is
 * powered, and its indicator sits on the input rail.
 *
 * Returns `undefined` when no power pin resolves to a solved node at all — the
 * caller decides whether that means "unwired, so 0 V" (a solve ran and this part
 * simply isn't in it) or "nothing to say".
 */
export function partSupplyVoltage(
  pins: readonly SuppliedPin[],
  byEndpoint: ReadonlyMap<string, number>
): number | undefined {
  let vcc: number | undefined
  let gnd: number | undefined
  for (const p of pins) {
    const v = byEndpoint.get(p.endpoint)
    if (v === undefined) continue
    if (p.net === 'vcc') vcc = vcc === undefined ? v : Math.max(vcc, v)
    else if (p.net === 'gnd') gnd = gnd === undefined ? v : Math.min(gnd, v)
  }
  if (vcc === undefined) return undefined
  return vcc - (gnd ?? 0)
}
