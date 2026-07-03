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
  0x1e: ['HMC5883L magnetometer', 'LSM303 mag'],
  0x23: ['BH1750 light sensor'],
  0x27: ['PCF8574 I/O expander (LCD backpack)'],
  0x29: ['VL53L0X / VL53L1X ToF', 'TSL2591 light', 'BNO055 IMU (alt)'],
  0x38: ['AHT10 / AHT20 temp+humidity', 'FT6206 touch'],
  0x39: ['APDS-9960 gesture/colour', 'TSL2561 light'],
  0x3c: ['SSD1306 / SH1106 OLED'],
  0x3d: ['SSD1306 / SH1106 OLED (alt)'],
  0x40: ['PCA9685 PWM driver', 'INA219 current', 'HTU21D / Si7021 humidity'],
  0x48: ['ADS1115 / ADS1015 ADC', 'TMP102 temp', 'PCF8591'],
  0x49: ['ADS1115 ADC (alt)', 'TSL2561 light (alt)'],
  0x4a: ['ADS1115 ADC (alt)'],
  0x53: ['ADXL345 accelerometer (alt)'],
  0x57: ['MAX30102 pulse oximeter', 'AT24C32 EEPROM'],
  0x5a: ['MLX90614 IR thermometer', 'CCS811 air quality'],
  0x5b: ['CCS811 air quality (alt)'],
  0x60: ['MPL3115A2 pressure', 'ATECC608 crypto', 'SI1145 UV'],
  0x68: ['ICM-20948 / MPU-6050 / MPU-9250 IMU', 'DS1307 / DS3231 RTC'],
  0x69: ['ICM-20948 / MPU IMU (alt)'],
  0x70: ['TCA9548A I²C mux', 'HT16K33 LED matrix'],
  0x76: ['BME280 / BMP280 environmental'],
  0x77: ['BME280 / BMP280 environmental (alt)', 'BME680'],
  0x5c: ['AM2320 temp+humidity', 'LPS25 pressure']
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
