import type { PackageInfo } from './types'

/**
 * Curated "top packages" discovery list (issue #20).
 *
 * The first version ships a static, hand-picked set of popular MicroPython
 * libraries so the Packages tab is useful even when the network is unavailable
 * (CI, offline, restricted environments). Each entry uses the name that
 * MicroPython's `mip` understands — for micropython-lib packages that is the
 * short name (e.g. `urequests`); for PyPI-distributed libraries it is the
 * distribution name (e.g. `microdot`).
 *
 * This list is intentionally conservative and easy to extend. A future version
 * could augment/replace it with live PyPI download statistics, but that needs a
 * network round-trip and is therefore out of scope for the offline-safe
 * baseline.
 */
export const CURATED_PACKAGES: PackageInfo[] = [
  {
    name: 'urequests',
    description: 'Lightweight HTTP requests client (micropython-lib).',
    source: 'curated'
  },
  {
    name: 'umqtt.simple',
    description: 'Minimal MQTT client for IoT messaging (micropython-lib).',
    source: 'curated'
  },
  {
    name: 'umqtt.robust',
    description: 'MQTT client with automatic reconnection (micropython-lib).',
    source: 'curated'
  },
  {
    name: 'microdot',
    description: 'Tiny async web framework for microcontrollers.',
    source: 'curated'
  },
  {
    name: 'neopixel',
    description: 'Driver for WS2812 / NeoPixel addressable LEDs.',
    source: 'curated'
  },
  {
    name: 'ssd1306',
    description: 'Driver for SSD1306 OLED displays (I2C/SPI).',
    source: 'curated'
  },
  {
    name: 'bme280',
    description: 'Driver for Bosch BME280 temperature/humidity/pressure sensors.',
    source: 'curated'
  },
  {
    name: 'dht',
    description: 'Driver for DHT11 / DHT22 temperature & humidity sensors.',
    source: 'curated'
  },
  {
    name: 'logging',
    description: 'CPython-style logging facility (micropython-lib).',
    source: 'curated'
  },
  {
    name: 'aioble',
    description: 'Async Bluetooth Low Energy helper library (micropython-lib).',
    source: 'curated'
  },
  {
    name: 'datetime',
    description: 'Subset of CPython datetime for MicroPython (micropython-lib).',
    source: 'curated'
  },
  {
    name: 'base64',
    description: 'Base16/64 encodings (micropython-lib).',
    source: 'curated'
  }
]
