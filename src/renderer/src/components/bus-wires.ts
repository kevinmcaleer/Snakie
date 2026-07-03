/**
 * SCHEMATIC BUS WIRES (#217) — classify a wiring-canvas connection as an I²C or
 * SPI BUS wire so the schematic view can draw short, named bus tags at both
 * ends (»I2C0«) instead of routing a long point-to-point noodle. Buses carry
 * many devices, so tying every SDA/SCL/SCK/… straight to the MCU is exactly
 * what makes real schematics chaotic — named stubs are the standard notation.
 * Pure + unit-tested.
 */
import type { PartPinCapability, PartPinSignals, PartPinBuses } from '../../../shared/part'

/** What the classifier needs to know about ONE wire endpoint. */
export interface BusEndInfo {
  /** Pin capabilities (part pins carry these; MCU pads usually don't). */
  caps?: PartPinCapability[]
  /** Per-capability bus ids authored on the pin. */
  buses?: PartPinBuses
  /** Signal designations (unused for classification today, kept for labels). */
  signals?: PartPinSignals
  /** The GPIO number (MCU pads) — used to derive the RP-family bus id. */
  gpio?: number
}

/** A classified bus wire: the peripheral kind + bus id (null = unknown). */
export interface BusWire {
  kind: 'i2c' | 'spi'
  bus: number | null
  label: string
}

/** RP-family I²C block for a GPIO: I2C0 ⇔ gpio%4 ∈ {0,1}, I2C1 ⇔ {2,3}. */
export function i2cBusForGpio(gpio: number | undefined): number | null {
  if (gpio === undefined || !Number.isInteger(gpio) || gpio < 0) return null
  return gpio % 4 <= 1 ? 0 : 1
}

/** RP-family SPI block for a GPIO: SPI0 ⇔ 0–7 & 16–23, SPI1 ⇔ 8–15 & 24–29. */
export function spiBusForGpio(gpio: number | undefined): number | null {
  if (gpio === undefined || !Number.isInteger(gpio) || gpio < 0) return null
  const m = gpio % 16
  return m <= 7 ? 0 : 1
}

/** The tag text for a classified bus (`I2C0`, `SPI1`, or bare `I2C`). */
export function busLabel(kind: 'i2c' | 'spi', bus: number | null): string {
  return `${kind.toUpperCase()}${bus ?? ''}`
}

/**
 * Classify one connection: it's a BUS wire when EITHER endpoint's pin declares
 * the i2c/spi capability (peripheral part pins carry capabilities; MCU pads
 * don't). The bus id prefers an authored `buses` id from either end, then the
 * RP-family gpio derivation from either end. Non-bus wires → null.
 */
export function classifyBusWire(a: BusEndInfo, b: BusEndInfo): BusWire | null {
  for (const kind of ['i2c', 'spi'] as const) {
    if (!a.caps?.includes(kind) && !b.caps?.includes(kind)) continue
    const authored = a.buses?.[kind] ?? b.buses?.[kind]
    const derived =
      kind === 'i2c'
        ? (i2cBusForGpio(a.gpio) ?? i2cBusForGpio(b.gpio))
        : (spiBusForGpio(a.gpio) ?? spiBusForGpio(b.gpio))
    const bus = authored ?? derived
    return { kind, bus, label: busLabel(kind, bus) }
  }
  return null
}
