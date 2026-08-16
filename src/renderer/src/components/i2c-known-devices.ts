/**
 * KNOWN I²C DEVICES (#214) — a curated 7-bit-address → device-name table so the
 * I²C-detect instrument can say what a found address probably is, and match it
 * back to installed library parts (via {@link PartDefinition.i2cAddresses}).
 * Pure + DOM-free (unit-tested).
 */
import type { PartDefinition } from '../../../shared/part'

/** Well-known devices per 7-bit address (the usual breakout suspects). */
export const KNOWN_I2C_DEVICES: Record<number, string[]> = {
  0x0c: ['AK09916 magnetometer'],
  0x1d: ['ADXL345 accelerometer', 'LSM303 accel'],
  0x1e: ['HMC5883L magnetometer', 'LSM303 mag', 'Modulino Buzzer'],
  0x23: ['BH1750 light sensor'],
  0x27: ['PCF8574 I/O expander (LCD backpack)'],
  0x29: ['VL53L0X / VL53L1X ToF', 'TSL2591 light', 'BNO055 IMU (alt)', 'Modulino Distance'],
  0x38: ['AHT10 / AHT20 temp+humidity', 'FT6206 touch', 'Modulino Vibro'],
  0x39: ['APDS-9960 gesture/colour', 'TSL2561 light', 'Modulino LED Matrix'],
  0x3c: ['SSD1306 / SH1106 OLED'],
  0x3d: ['SSD1306 / SH1106 OLED (alt)'],
  0x40: ['PCA9685 PWM driver', 'INA219 current', 'HTU21D / Si7021 humidity'],
  0x48: ['ADS1115 / ADS1015 ADC', 'TMP102 temp', 'PCF8591'],
  0x49: ['ADS1115 ADC (alt)', 'TSL2561 light (alt)'],
  0x4a: ['ADS1115 ADC (alt)'],
  0x53: ['ADXL345 accelerometer (alt)', 'Modulino Light'],
  0x57: ['MAX30102 pulse oximeter', 'AT24C32 EEPROM'],
  0x5a: ['MLX90614 IR thermometer', 'CCS811 air quality'],
  0x5b: ['CCS811 air quality (alt)'],
  0x60: ['MPL3115A2 pressure', 'ATECC608 crypto', 'SI1145 UV'],
  0x68: ['ICM-20948 / MPU-6050 / MPU-9250 IMU', 'DS1307 / DS3231 RTC'],
  0x69: ['ICM-20948 / MPU IMU (alt)'],
  0x70: ['TCA9548A I²C mux', 'HT16K33 LED matrix'],
  0x76: ['BME280 / BMP280 environmental'],
  0x77: ['BME280 / BMP280 environmental (alt)', 'BME680'],
  0x5c: ['AM2320 temp+humidity', 'LPS25 pressure'],
  // Arduino Modulinos (#721). MIND THE SHIFT: a Modulino with an onboard MCU
  // publishes an EIGHT-bit address (the library's `default_addresses`), and the
  // firmware answers on that >> 1 — so Buttons ships as 0x7C and a scan reports
  // 0x3E. The four with no MCU (Distance, Thermo, Light, Movement) are the raw
  // sensor and use their own 7-bit address unshifted, so they sit beside the
  // bare chip above. Getting this wrong makes detect silently fail to name any
  // MCU module. Cross-check: the store quotes 0x39 for LED Matrix = 0x72 >> 1.
  // UNVERIFIED: the library declares Latch Relay as 0x04 with no `has_mcu`
  // override, which shifts to 0x02 — inside the I²C reserved range 0x00–0x07.
  // Either the module ignores the reservation or its 0x04 is already 7-bit.
  // Left as the derivation until someone can scan one; there is no Latch Relay
  // part yet, so nothing depends on it.
  0x02: ['Modulino Latch Relay (unconfirmed)'],
  0x24: ['Modulino Motors'],
  0x2c: ['Modulino Joystick'],
  0x36: ['Modulino Pixels'],
  0x3a: ['Modulino Knob'],
  0x3b: ['Modulino Knob (alt)'],
  0x3e: ['Modulino Buttons'],
  0x44: ['Modulino Thermo (HS3003)'],
  0x6a: ['Modulino Movement (LSM6DSOX)'],
  0x6b: ['Modulino Movement (LSM6DSOX, alt)']
}

/** Human names for a found address — `[]` when we don't recognise it. */
export function knownDevicesFor(addr: number): string[] {
  return KNOWN_I2C_DEVICES[addr] ?? []
}

/** One matched library part for an address (the Add offer). */
export interface AddressPartMatch {
  libraryId: string
  part: PartDefinition
}

/** Installed library parts declaring `i2cAddresses` that include `addr`. */
export function partsForAddress(
  addr: number,
  libraries: { id: string; parts: PartDefinition[] }[]
): AddressPartMatch[] {
  const out: AddressPartMatch[] = []
  for (const lib of libraries) {
    for (const part of lib.parts) {
      if (part.i2cAddresses?.includes(addr)) out.push({ libraryId: lib.id, part })
    }
  }
  return out
}

/** Format a 7-bit address the way the grid does (`0x68`). */
export function hexAddr(addr: number): string {
  return `0x${addr.toString(16).toUpperCase().padStart(2, '0')}`
}

/** The highest valid 7-bit I²C address. */
export const I2C_MAX_ADDRESS = 0x7f

/**
 * Parse an address a part author typed, or `null` if it isn't a valid 7-bit one.
 *
 * Hex needs a marker — `0x76`, `76h` or `$76`. **Bare digits are decimal**, which
 * is the one genuinely ambiguous case: I²C addresses are conventionally written
 * in hex, so someone typing `76` may well mean `0x76` and get `0x4C`. Rather than
 * guess (a wrong guess here silently mislabels the part), the caller shows the
 * canonical parse back to the author as they type — see the Addresses section's
 * live preview, which also names the device at that address.
 */
export function parseI2cAddress(input: string): number | null {
  const s = String(input ?? '').trim()
  if (!s) return null
  const hex = /^(?:0x([0-9a-f]+)|([0-9a-f]+)h|\$([0-9a-f]+))$/i.exec(s)
  let n: number
  if (hex) n = parseInt(hex[1] ?? hex[2] ?? hex[3], 16)
  else if (/^\d+$/.test(s)) n = Number(s)
  else return null
  if (!Number.isInteger(n) || n < 0 || n > I2C_MAX_ADDRESS) return null
  return n
}

/**
 * Addresses the I²C spec reserves (`0x00`–`0x07` and `0x78`–`0x7F`).
 *
 * A part claiming one is *probably* a typo, but not certainly — so this drives a
 * warning, never a block. Real hardware does occasionally sit here.
 */
export function isReservedI2cAddress(addr: number): boolean {
  return addr <= 0x07 || addr >= 0x78
}

/**
 * Whether the part has anything that speaks I²C — an `i2c`-capable pin, a QWIIC
 * connector, or a Grove port strapped to the I²C variant.
 *
 * Used to tailor the Addresses section's hint, NOT to hide it: a part can be
 * mid-authoring (addresses first, pins later), and a control the author can't
 * find is worse than one they don't need.
 */
export function hasI2cInterface(part: PartDefinition): boolean {
  for (const h of part.headers ?? []) {
    for (const p of h.pins) if (p.capabilities?.includes('i2c')) return true
  }
  for (const c of part.connectors ?? []) {
    if (c.kind === 'qwiic') return true
    if (c.kind === 'grove' && c.variant === 'i2c') return true
    for (const p of c.pins ?? []) if (p.capabilities?.includes('i2c')) return true
  }
  return false
}

/**
 * Other parts already claiming `addr`, so the author can be told before they ship
 * two parts the scanner can't tell apart.
 *
 * `exceptId` drops the part being edited (it should not clash with itself). Note
 * this only sees the parts passed in — in the Part Editor that is the part's own
 * library, not every installed one, so it catches the realistic case (building a
 * parts pack) rather than every possible one.
 */
export function partsClaimingAddress(
  addr: number,
  parts: PartDefinition[],
  exceptId?: string
): PartDefinition[] {
  return parts.filter((p) => p.id !== exceptId && p.i2cAddresses?.includes(addr))
}
