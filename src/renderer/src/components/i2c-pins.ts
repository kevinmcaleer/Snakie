/**
 * I²C PIN OPTIONS (#165 / #701) — valid bus / SDA / SCL combinations for a board.
 * =============================================================================
 *
 * Two sources, because neither is enough alone.
 *
 * **What the board DECLARES.** A part names its I²C pins outright — the XIAO
 * ESP32-S3's `D4`/`D5` carry `signals.i2c` — and that is authoritative, because
 * which GPIOs can be I²C is a property of the CHIP.
 *
 * **The RP2040/RP2350 rule**, as a fallback for boards that declare nothing: on
 * the Pico family the I²C function is fixed by GPIO number — GP0/GP1 = I2C0
 * SDA/SCL, GP2/GP3 = I2C1, repeating every 4, SCL always SDA+1.
 *
 * Applying that rule to EVERY board was the bug (#701). An ESP32 routes I²C
 * through a GPIO matrix, so almost any pin can serve. On a XIAO ESP32-S3 the Grove
 * port is GPIO5/GPIO6 — and `5 % 4 === 1` satisfies neither branch, so the correct
 * pair could never be offered at all. The dropdown showed 4 & 5, the nearest
 * RP2040-legal pair, and a scan on it finds nothing.
 *
 * The two are UNIONED rather than one replacing the other: a Pico user may legally
 * wire I²C to pins the part never mentions, so the derived options must survive.
 *
 * Pure + DOM-free (unit-tested like the other helpers).
 */

export interface I2cOption {
  bus: number
  sda: number
  scl: number
}

/** A board pad, as much of one as this module needs. */
export interface I2cPad {
  gpio?: number
  /** The I²C role the board declares for this pad, if any. */
  i2c?: 'SDA' | 'SCL'
  /** Which I²C peripheral that role belongs to; absent ⇒ bus 0. */
  i2cBus?: number
}

/** The (bus, sda, scl) triples a board DECLARES, by pairing its named pins. */
export function declaredI2cOptions(pads: I2cPad[]): I2cOption[] {
  const byBus = new Map<number, { sda: number[]; scl: number[] }>()
  for (const p of pads) {
    if (typeof p.gpio !== 'number' || (p.i2c !== 'SDA' && p.i2c !== 'SCL')) continue
    const bus = p.i2cBus ?? 0
    const entry = byBus.get(bus) ?? { sda: [], scl: [] }
    entry[p.i2c === 'SDA' ? 'sda' : 'scl'].push(p.gpio)
    byBus.set(bus, entry)
  }
  const out: I2cOption[] = []
  for (const [bus, { sda, scl }] of byBus) {
    for (const s of sda.sort((a, b) => a - b)) {
      for (const c of scl.sort((a, b) => a - b)) out.push({ bus, sda: s, scl: c })
    }
  }
  return out
}

/** The triples implied by the RP2040/RP2350 pin multiplexing rule. */
export function derivedI2cOptions(gpios: number[]): I2cOption[] {
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

/**
 * Every valid (bus, sda, scl) triple for a board.
 *
 * `pads` may be plain GPIO numbers (the old call shape) or pads carrying their
 * declared I²C roles. Declared pairs come FIRST, so the dropdown opens on the
 * board's real I²C port rather than on whatever the arithmetic happened to
 * produce.
 */
export function i2cOptions(pads: readonly (number | I2cPad)[]): I2cOption[] {
  const list: I2cPad[] = pads.map((p) => (typeof p === 'number' ? { gpio: p } : p))
  const gpios = list.map((p) => p.gpio).filter((g): g is number => typeof g === 'number')
  const declared = declaredI2cOptions(list)
  const seen = new Set(declared.map((o) => `${o.bus}:${o.sda}:${o.scl}`))
  const out = [...declared]
  for (const o of derivedI2cOptions(gpios)) {
    const k = `${o.bus}:${o.sda}:${o.scl}`
    if (!seen.has(k)) {
      seen.add(k)
      out.push(o)
    }
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
