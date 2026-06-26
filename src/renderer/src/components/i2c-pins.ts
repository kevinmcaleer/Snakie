/**
 * I²C PIN OPTIONS (#165) — valid bus / SDA / SCL combinations for a board.
 * =======================================================================
 *
 * On the RP2040 / RP2350 (the whole Pico family) the I²C function is fixed by the
 * GPIO number: GP0/GP1 = I2C0 SDA/SCL, GP2/GP3 = I2C1 SDA/SCL, repeating every 4
 * GPIOs, and SCL is always SDA+1. So from the GPIOs a board exposes we can derive
 * exactly the valid (bus, sda, scl) triples and reject anything else — driving the
 * i2c-detect instrument's dropdowns so the user can't pick an invalid combo.
 *
 * Pure + DOM-free (unit-tested like the other helpers).
 */

export interface I2cOption {
  bus: number
  sda: number
  scl: number
}

/** Every valid (bus, sda, scl) triple for an RP-family board exposing `gpios`. */
export function i2cOptions(gpios: number[]): I2cOption[] {
  const set = new Set(gpios)
  const out: I2cOption[] = []
  for (const sda of [...gpios].sort((a, b) => a - b)) {
    const scl = sda + 1
    if (!set.has(scl)) continue // SCL must be the adjacent exposed pin
    if (sda % 4 === 0) out.push({ bus: 0, sda, scl })
    else if (sda % 4 === 2) out.push({ bus: 1, sda, scl })
  }
  return out
}

/** Distinct buses that have at least one valid option, ascending. */
export function i2cBuses(opts: I2cOption[]): number[] {
  return [...new Set(opts.map((o) => o.bus))].sort((a, b) => a - b)
}

/** Valid SDA pins for a bus, ascending. */
export function sdaOptions(opts: I2cOption[], bus: number): number[] {
  return opts.filter((o) => o.bus === bus).map((o) => o.sda)
}

/** Valid SCL pins for a bus + SDA (one, on the RP chips), ascending. */
export function sclOptions(opts: I2cOption[], bus: number, sda: number): number[] {
  return opts.filter((o) => o.bus === bus && o.sda === sda).map((o) => o.scl)
}

/** Whether a (bus, sda, scl) triple is one of the valid options. */
export function isValidI2c(opts: I2cOption[], bus: number, sda: number, scl: number): boolean {
  return opts.some((o) => o.bus === bus && o.sda === sda && o.scl === scl)
}
