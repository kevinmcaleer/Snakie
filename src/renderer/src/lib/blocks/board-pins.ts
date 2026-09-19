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
 *
 * Returns whether the pins really changed, for the same reason
 * {@link setPinAliases} does: a board swap RENAMES pins — `GP0` is `D1` on some
 * — and a dropdown already on screen is still showing what the old board called
 * it until something redraws it.
 */
export function setBoardPins(
  pins: readonly BlockPin[],
  onboardLedToken?: string | null
): boolean {
  const next = pins.length > 0 ? pins : FALLBACK_PINS
  const changed =
    next.map((p) => `${p.gpio}:${p.label}`).join('|') !==
    current.map((p) => `${p.gpio}:${p.label}`).join('|')
  current = next
  onboardLed = onboardLedToken ?? null
  return changed
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
 * NAMED PINS.
 * ---------------------------------------------------------------------------
 *
 * `GP15` is what the board calls the hole. `motor_left_speed` is what the
 * LEARNER calls it, and on a robot with six of them it is the only one of the
 * two anybody can keep straight. A `name pin` block declares one; every pin
 * dropdown then offers it by name, and the generated Python assigns it once and
 * refers to it everywhere after:
 *
 *     motor_left_speed = Pin(15, Pin.OUT)
 *     pwm_motor_left_speed = PWM(motor_left_speed)
 *
 * WHY THE ASSIGNMENT RATHER THAN SUBSTITUTING 15 EVERYWHERE. Rewiring a robot
 * then means editing one line instead of hunting six, which is the entire point
 * of naming a thing — and it is what `parse-pins.ts` already reads: its
 * `buildPinVarMap` resolves a `name = Pin(...)` line and puts the identifier
 * back through it wherever it is used, so the Board View lights the right badge.
 *
 * THE NAME IS THE PIN OBJECT, not its number. The direction is chosen on the
 * `name pin` block, once, and every block that uses the name uses that object
 * rather than building a second one around the number.
 *
 * THE NAME IS THE FIELD'S VALUE. A pin field normally holds a GPIO number as a
 * string; for a named pin it holds the name. {@link FieldPin} already accepts
 * any value and already falls back for one it cannot find in its options — both
 * written for the "file saved on another board" case, and both exactly what
 * this needs. So nothing about the field changes; only what the options are.
 */

/** A pin the learner has given a name. */
export interface PinAlias {
  /** The identifier as typed, e.g. `motor_left_speed`. Also the field's value. */
  name: string
  /** The GPIO it stands for. */
  gpio: number
  /**
   * How the `name pin` block configured it — the block's `DIRECTION` field.
   *
   * `OUT`, `IN`, `PULL_UP` or `PULL_DOWN`; the last two are inputs with their
   * resistor. It is what goes in the constructor, and it is what
   * `pin-conflicts.ts` checks a block's own direction against.
   */
  direction: PinDirection
}

/** The four ways a named pin can be configured. */
export type PinDirection = 'OUT' | 'IN' | 'PULL_UP' | 'PULL_DOWN'

/** Is this direction an input? The three that are not `OUT`. */
export function isInputDirection(direction: PinDirection): boolean {
  return direction !== 'OUT'
}

/**
 * The constructor a named pin is built with: `Pin(4, Pin.OUT)`.
 *
 * A PIN OBJECT, not the bare number it used to be. `motor_left = 4` made every
 * block that used it wrap the number again — `Pin(motor_left, Pin.OUT)` in one
 * place, `PWM(Pin(motor_left))` in another — so the name stood for a pin NUMBER
 * and the thing it named was built fresh each time, configured by whichever
 * block got there. Naming it once, as the object, is what a person writing this
 * by hand would do, and it puts the direction where the learner chose it.
 */
export function pinConstructor(gpio: number, direction: PinDirection): string {
  if (direction === 'OUT') return `Pin(${gpio}, Pin.OUT)`
  if (direction === 'IN') return `Pin(${gpio}, Pin.IN)`
  return `Pin(${gpio}, Pin.IN, Pin.${direction})`
}

/**
 * The block type that declares one.
 *
 * Here rather than in the hardware palette because this module is what reads
 * them off a workspace, and the palette already imports this module — naming it
 * the other way round would be a cycle.
 */
export const PIN_ALIAS_BLOCK = 'snakie_name_pin'

/**
 * The block that names a PWM.
 *
 * Beside {@link PIN_ALIAS_BLOCK} and for the same reason: this module is what
 * reads a declaration back, so the two block names live where the reading is.
 */
export const PWM_ALIAS_BLOCK = 'snakie_name_pwm'

let aliases: readonly PinAlias[] = []

/**
 * Tell the pin dropdowns which names this program declares.
 *
 * The canvas pushes, exactly as it does for the board's pins and for the same
 * reason: a Blockly field's option list is built inside Blockly's own event
 * handling, with no React near it. UI ONLY — code generation reads the
 * workspace through {@link pinAliasesIn} instead, so a generated program never
 * depends on which module-level cache happened to be warm.
 *
 * RETURNS WHETHER THE SET REALLY CHANGED, because a field that has already been
 * drawn is showing the labels these names imply and will not work them out
 * again — see `refreshPinFields` in `pin-field.ts`, which the caller runs on a
 * true. This runs on every workspace change, including every frame of a drag,
 * and redrawing every dropdown in the program that often would be a waste.
 */
export function setPinAliases(next: readonly PinAlias[]): boolean {
  const changed = key(next) !== key(aliases)
  aliases = [...next]
  return changed
}

/** A comparable form of an alias list, for "did this actually change?". */
function key(list: readonly PinAlias[]): string {
  return list.map((a) => `${a.name}:${a.gpio}:${a.direction}`).join('|')
}

/** The names currently offered by the dropdowns. */
export function pinAliases(): readonly PinAlias[] {
  return aliases
}

/**
 * The names a WORKSPACE declares, read off its `name pin` blocks.
 *
 * The source of truth for everything that must be correct rather than merely
 * current: code generation, the pin-conflict pass, and the canvas's own push
 * into {@link setPinAliases}. A blank name is not a declaration, and the FIRST
 * block to claim a name keeps it — two blocks naming the same thing two
 * different pins is a mistake the conflict pass reports, not one this silently
 * resolves by picking the last one it happened to walk past.
 */
export function pinAliasesIn(workspace: {
  getBlocksByType: (type: string, ordered: boolean) => { getFieldValue: (n: string) => unknown }[]
}): PinAlias[] {
  const out: PinAlias[] = []
  const seen = new Set<string>()
  for (const block of workspace.getBlocksByType(PIN_ALIAS_BLOCK, true)) {
    const name = String(block.getFieldValue('NAME') ?? '').trim()
    const gpio = Number(block.getFieldValue('PIN'))
    if (!name || seen.has(name) || !Number.isFinite(gpio)) continue
    seen.add(name)
    // `OUT` for a block saved before the field existed, which is also the
    // commonest thing to name a pin for.
    const raw = String(block.getFieldValue('DIRECTION') ?? 'OUT')
    const direction = (['OUT', 'IN', 'PULL_UP', 'PULL_DOWN'] as const).find((d) => d === raw)
    out.push({ name, gpio, direction: direction ?? 'OUT' })
  }
  return out
}

/**
 * The PWM names a WORKSPACE declares, read off its `name pwm` blocks.
 *
 * The same source-of-truth role {@link pinAliasesIn} has, and kept separate
 * from it on purpose: a name here stands for a `PWM(...)`, not for a `Pin(...)`,
 * so anything that would build a pin from it — `namedPin`, the pin dropdowns,
 * the conflict pass — must NOT see it. What both lists share is that the
 * generator may not rename either of them (`boundName`).
 */
export function pwmAliasesIn(workspace: {
  getBlocksByType: (type: string, ordered: boolean) => { getFieldValue: (n: string) => unknown }[]
}): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const block of workspace.getBlocksByType(PWM_ALIAS_BLOCK, true)) {
    const name = String(block.getFieldValue('NAME') ?? '').trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

/**
 * The GPIO a pin-field value stands for, or `null` when it names nothing.
 *
 * A plain number passes straight through, so every caller can hand its field
 * value here without first asking which kind it is holding. `null` means a name
 * nothing declares — a `name pin` block the learner deleted out from under a
 * block still set to it — which is a warning, not a crash: see
 * `pin-conflicts.ts`.
 */
export function resolvePinGpio(value: string, declared: readonly PinAlias[] = aliases): number | null {
  const trimmed = value.trim()
  if (/^\d+$/.test(trimmed)) return Number(trimmed)
  return declared.find((a) => a.name === trimmed)?.gpio ?? null
}

/** Is this field value a NAME rather than a GPIO number? */
export function isPinName(value: string): boolean {
  return !/^\d+$/.test(value.trim())
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
  // NAMED PINS FIRST, and filtered by the same rule: a name standing for GP15
  // has GP15's capabilities, so it belongs in the PWM menu and not in the ADC
  // one. Listed above the numbers because a learner who has bothered to name a
  // pin is reaching for the name — and the GPIO stays in the label, so the
  // menu never hides which hole it actually is.
  const named: [string, string][] = pinAliases()
    .filter((a) => {
      const pin = current.find((p) => p.gpio === a.gpio)
      // A name for a pin this board hasn't got still shows: dropping it would
      // silently rewrite a robot built for another board. `pin-conflicts.ts`
      // is what says so.
      return !pin || !capability || capable(pin, capability)
    })
    .map((a) => [`${a.name} (${pinLabel(a.gpio)})`, a.name])
  return [...named, ...usable.map((p): [string, string] => [p.label, String(p.gpio)])]
}

/** Does `pin` claim `capability` — or claim nothing at all, which is not a no? */
function capable(pin: BlockPin, capability: string): boolean {
  return pin.capabilities.length === 0 || pin.capabilities.includes(capability)
}

/**
 * The label for a pin-field value, for a warning message.
 *
 * A GPIO reads as the board's silk label; a NAME reads as itself plus the pin
 * it stands for (`motor_left_speed (GP15)`), because a warning about a named
 * pin has to say both — the name is what the learner sees on the block, and the
 * GPIO is what is actually clashing. Falls back to `GP<n>`.
 */
export function pinLabel(gpio: string | number, declared: readonly PinAlias[] = aliases): string {
  const raw = String(gpio)
  if (isPinName(raw)) {
    const match = declared.find((a) => a.name === raw.trim())
    return match ? `${match.name} (${pinLabel(match.gpio, [])})` : raw
  }
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

/**
 * What CircuitPython calls the pin MicroPython calls `15` (#1040).
 *
 * `board.GP15` and `machine.Pin(15)` are the same physical hole with two
 * different names, and this is the join. The name comes from the BOARD's own
 * silk label, which is exactly what CircuitPython's `board` module is built
 * from — `GP15` on an RP2040, `IO15` on an ESP32-S3, `D13` on a Feather — so
 * reading it off the profile is not a convention we are imposing, it is the one
 * already written on the plastic.
 *
 * A pin the profile does not know falls back to `GP<n>`, which is right for the
 * RP2040 family this defaults to and visibly wrong anywhere else — better than
 * silently generating a pin that is not the one the learner picked.
 */
export function circuitPythonPin(
  gpio: string | number,
  declared: readonly PinAlias[] = aliases
): string {
  // A NAMED PIN RESOLVES TO THE HOLE (#1082). CircuitPython addresses pins by
  // attribute — `board.GP15` — not by a number a variable could hold, so the
  // name cannot survive into the generated line the way it does on the
  // MicroPython side. It resolves here rather than further up so every
  // CircuitPython emitter gets it from one place.
  const n = resolvePinGpio(String(gpio), declared) ?? Number(gpio)
  const pin = boardPins().find((p) => p.gpio === n)
  return `board.${pin?.label ?? `GP${n}`}`
}
