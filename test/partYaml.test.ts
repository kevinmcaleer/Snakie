import { describe, it, expect } from 'vitest'
import {
  libraryFromYaml,
  libraryToYaml,
  partFromYaml,
  partToYaml
} from '../src/shared/part-yaml'
import { blankPart, normalisePart } from '../src/renderer/src/components/part-editor.util'
import type { PartDefinition } from '../src/shared/part'

const RICH: PartDefinition = normalisePart({
  id: 'vl53l0x',
  name: 'VL53L0X ToF',
  description: 'Time-of-flight distance sensor',
  manufacturer: 'STMicroelectronics',
  family: 'Sensor',
  tags: ['i2c', 'distance', 'tof'],
  package: 'SMD',
  pinSpacing: 2.54,
  voltage: '2.8–5V',
  partNumber: 'VL53L0X',
  properties: { range: '2m', interface: 'I²C' },
  version: '1.2.3',
  pcbColor: '#101820',
  aspect: 1.3,
  dimensions: { width: 25, height: 11 },
  polygon: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 }
  ],
  shape: { kind: 'polygon' },
  headers: [
    {
      edge: 'bottom',
      pins: [
        { name: 'VIN', type: 'pwr', number: 1, x: 0.2, y: 0.9 },
        { name: 'GND', type: 'gnd', number: 2, x: 0.4, y: 0.9 },
        { name: 'SCL', type: 'io', gpio: 5, capabilities: ['i2c', 'digital'], number: 3, x: 0.6, y: 0.9, shape: 'header' },
        { name: 'SDA', type: 'io', gpio: 4, capabilities: ['i2c', 'digital'], number: 4, castellated: true, x: 0.8, y: 0.9, shape: 'round' }
      ]
    }
  ],
  mountingHoles: [{ x: 0.1, y: 0.5, diameter: 2 }],
  buttons: [{ label: 'XSHUT', x: 0.8, y: 0.5 }],
  shapes: [
    { kind: 'circle', x: 0.5, y: 0.5, r: 0.1, fill: '#101010', stroke: '#202020', strokeWidth: 2, label: 'U1' },
    {
      kind: 'polygon',
      x: 0.2,
      y: 0.2,
      fill: '#111111',
      stroke: '#222222',
      strokeWidth: 1,
      points: [
        { x: 0.2, y: 0.1 },
        { x: 0.3, y: 0.2 },
        { x: 0.1, y: 0.2 }
      ]
    }
  ],
  labels: [{ text: 'ToF', x: 0.5, y: 0.3, fontSize: 14 }],
  ledLabel: 'LED',
  image: 'image.png',
  imageLayer: { x: 0.1, y: 0.1, w: 0.8, h: 0.8, opacity: 0.9 },
  schematic: { aspect: 1, pins: [{ pin: 'SDA', side: 'left', order: 0 }] }
})

describe('partToYaml / partFromYaml round-trip', () => {
  it('round-trips a rich part unchanged through the canonical shape', () => {
    const yaml = partToYaml(RICH)
    const back = partFromYaml(yaml)
    expect(normalisePart(back)).toEqual(RICH)
  })

  it('round-trips the blank starter part', () => {
    const start = normalisePart(blankPart())
    expect(normalisePart(partFromYaml(partToYaml(start)))).toEqual(start)
  })

  it('never serialises the runtime imageData blob', () => {
    const withBlob = { ...RICH, imageData: 'data:image/png;base64,AAAA' }
    const yaml = partToYaml(withBlob)
    expect(yaml).not.toContain('imageData')
    expect(yaml).not.toContain('base64')
    // The relative filename IS kept.
    expect(yaml).toContain('image: image.png')
  })

  it('tolerates a sparse hand-edited file', () => {
    const part = partFromYaml('id: thing\nheaders:\n  - edge: left\n    pins:\n      - name: A0\n        type: io\n')
    expect(part.id).toBe('thing')
    expect(part.name).toBe('thing')
    expect(part.headers[0].pins[0].name).toBe('A0')
  })

  it('coerces malformed features + schematic (tolerant parse, no crash)', () => {
    const part = partFromYaml(
      [
        'id: x',
        'headers:',
        '  - edge: left',
        '    pins: [{ name: A, type: io }]',
        'features:',
        '  - { label: MCU, kind: banana, x: 0.3, y: 0.3, w: 0.2, h: 0.2 }', // bad kind → chip
        '  - { label: NoCoords }', // missing x/y/w/h → dropped
        '  - null', // null entry → dropped
        'schematic:',
        '  pins:',
        '    - { pin: A, side: weird, order: 0 }', // bad side → left',
        '    - null', // dropped
        ''
      ].join('\n')
    )
    expect(part.features).toHaveLength(1)
    expect(part.features?.[0].kind).toBe('chip')
    expect(part.schematic?.pins).toHaveLength(1)
    expect(part.schematic?.pins[0].side).toBe('left')
  })

  it('round-trips a non-finite imageLayer rotation (dropped both sides)', () => {
    const p = normalisePart({
      id: 'x',
      name: 'X',
      headers: [{ edge: 'left', pins: [{ name: 'A', type: 'pwr' }] }],
      imageLayer: { x: 0, y: 0, w: 1, h: 1, rotation: NaN }
    })
    expect(p.imageLayer?.rotation).toBeUndefined() // finite-guarded out
    expect(normalisePart(partFromYaml(partToYaml(p)))).toEqual(p)
  })

  it('drops non-io fields like gpio/capabilities on power pins', () => {
    const part = partFromYaml(
      'id: x\nheaders:\n  - edge: left\n    pins:\n      - name: VCC\n        type: pwr\n        gpio: 5\n        capabilities: [adc]\n'
    )
    const pin = part.headers[0].pins[0]
    expect(pin.gpio).toBeUndefined()
    expect(pin.capabilities).toBeUndefined()
  })
})

describe('library.yml round-trip', () => {
  it('round-trips a library manifest', () => {
    const lib = {
      id: 'pimoroni',
      name: 'Pimoroni Parts',
      description: 'Boards & breakouts',
      author: 'Pimoroni',
      homepage: 'https://pimoroni.com',
      version: '2.0.0'
    }
    expect(libraryFromYaml(libraryToYaml(lib))).toEqual(lib)
  })
})

describe('library link (#166) round-trips', () => {
  it('keeps module / url / docs through normalise + YAML', () => {
    const part = normalisePart({
      id: 'tof',
      name: 'ToF',
      headers: [{ edge: 'left', pins: [{ name: 'SDA', type: 'io' }] }],
      library: { module: 'vl53l0x', url: 'github:org/vl53l0x', docs: 'https://example.com/readme' }
    })
    expect(part.library).toEqual({ module: 'vl53l0x', url: 'github:org/vl53l0x', docs: 'https://example.com/readme' })
    const back = partFromYaml(partToYaml(part))
    expect(back.library).toEqual(part.library)
  })

  it('drops a fully-empty library object', () => {
    const part = normalisePart({
      id: 'x',
      name: 'X',
      headers: [{ edge: 'left', pins: [{ name: 'A', type: 'io' }] }],
      library: { module: '   ', url: '', docs: undefined }
    })
    expect(part.library).toBeUndefined()
  })
})

describe('drivers (#184) round-trip', () => {
  it('keeps source / target / label through normalise + YAML', () => {
    const part = normalisePart({
      id: 'tof',
      name: 'ToF',
      headers: [{ edge: 'left', pins: [{ name: 'SDA', type: 'io' }] }],
      drivers: [
        { source: 'vl53l0x.py', target: 'lib/vl53l0x.py', label: 'VL53L0X driver' },
        { source: 'github:org/repo', target: 'lib' }
      ]
    })
    expect(part.drivers).toEqual([
      { source: 'vl53l0x.py', target: 'lib/vl53l0x.py', label: 'VL53L0X driver' },
      { source: 'github:org/repo', target: 'lib' }
    ])
    const back = partFromYaml(partToYaml(part))
    expect(back.drivers).toEqual(part.drivers)
    expect(normalisePart(back)).toEqual(part)
  })

  it('drops driver entries missing source or target', () => {
    const part = normalisePart({
      id: 'x',
      name: 'X',
      headers: [{ edge: 'left', pins: [{ name: 'A', type: 'io' }] }],
      drivers: [
        { source: '  ', target: 'lib/x.py' },
        { source: 'x.py', target: '' },
        { source: 'ok.py', target: 'lib/ok.py' }
      ]
    })
    expect(part.drivers).toEqual([{ source: 'ok.py', target: 'lib/ok.py' }])
  })

  it('drops the drivers key entirely when none are valid', () => {
    const part = normalisePart({
      id: 'x',
      name: 'X',
      headers: [{ edge: 'left', pins: [{ name: 'A', type: 'io' }] }],
      drivers: [{ source: '', target: '' }]
    })
    expect(part.drivers).toBeUndefined()
    expect(partToYaml(part)).not.toContain('drivers')
  })
})

describe('pin rotation + uart capability round-trip', () => {
  it('snaps rotation to 90° and keeps the uart capability through normalise + YAML', () => {
    const part = normalisePart({
      id: 'p',
      name: 'P',
      headers: [
        {
          edge: 'top',
          pins: [{ name: 'TX', type: 'io', gpio: 0, capabilities: ['uart', 'pwm'], shape: 'castellated', rotation: 95 }]
        }
      ]
    })
    const pin = part.headers[0].pins[0]
    expect(pin.rotation).toBe(90) // 95 snapped to the nearest 90°
    expect(pin.capabilities).toContain('uart')
    const back = partFromYaml(partToYaml(part)).headers[0].pins[0]
    expect(back.rotation).toBe(90)
    expect(back.capabilities).toContain('uart')
  })

  it('persists rotation on a NON-castellated pin (rotation applies to every pin)', () => {
    const part = normalisePart({
      id: 'p',
      name: 'P',
      headers: [
        { edge: 'left', pins: [{ name: 'A', type: 'io', gpio: 0, shape: 'round', rotation: 270 }] }
      ]
    })
    expect(part.headers[0].pins[0].rotation).toBe(270)
    const back = partFromYaml(partToYaml(part)).headers[0].pins[0]
    expect(back.rotation).toBe(270) // survives the YAML round-trip for a round pad too
  })

  it('keeps rotation 0 (a deliberately un-rotated pin is not dropped)', () => {
    const part = normalisePart({
      id: 'p',
      name: 'P',
      headers: [{ edge: 'left', pins: [{ name: 'A', type: 'io', gpio: 0, rotation: 0 }] }]
    })
    expect(part.headers[0].pins[0].rotation).toBe(0)
    expect(partFromYaml(partToYaml(part)).headers[0].pins[0].rotation).toBe(0)
  })
})

describe('pin label offset (manual placement) round-trip', () => {
  it('keeps a non-zero labelOffset and drops a zero one', () => {
    const part = normalisePart({
      id: 'p',
      name: 'P',
      headers: [
        {
          edge: 'left',
          pins: [
            { name: 'SDA', type: 'io', gpio: 4, labelOffset: { x: 0.2, y: -0.1 } },
            { name: 'SCL', type: 'io', gpio: 5, labelOffset: { x: 0, y: 0 } }
          ]
        }
      ]
    })
    const pins = partFromYaml(partToYaml(part)).headers[0].pins
    expect(pins[0].labelOffset).toEqual({ x: 0.2, y: -0.1 })
    expect(pins[1].labelOffset).toBeUndefined()
  })
})

describe('onboard LEDs round-trip', () => {
  it('keeps single + RGB onboard LEDs through normalise + YAML', () => {
    const part = normalisePart({
      id: 'p',
      name: 'P',
      headers: [{ edge: 'left', pins: [{ name: 'GP0', type: 'io', gpio: 0 }] }],
      onboardLeds: [
        { kind: 'single', label: 'LED', gpio: 25, color: '#39d353', x: 0.5, y: 0.2 },
        { kind: 'rgb', rgb: { r: 18, g: 19, b: 20 }, x: 0.5, y: 0.6 }
      ]
    })
    const back = partFromYaml(partToYaml(part)).onboardLeds
    expect(back).toEqual([
      { kind: 'single', label: 'LED', gpio: 25, color: '#39d353', x: 0.5, y: 0.2 },
      { kind: 'rgb', rgb: { r: 18, g: 19, b: 20 }, x: 0.5, y: 0.6 }
    ])
  })

  it('round-trips a NeoPixel with a data + optional power GPIO', () => {
    const part = normalisePart({
      id: 'p',
      name: 'P',
      headers: [{ edge: 'left', pins: [{ name: 'GP0', type: 'io', gpio: 0 }] }],
      onboardLeds: [
        { kind: 'neopixel', label: 'NeoPixel', gpio: 22, power: 23, x: 0.5, y: 0.5 },
        { kind: 'neopixel', gpio: 16, x: 0.3, y: 0.3 } // no power pin (common case)
      ]
    })
    const back = partFromYaml(partToYaml(part)).onboardLeds
    expect(back).toEqual([
      { kind: 'neopixel', label: 'NeoPixel', gpio: 22, power: 23, x: 0.5, y: 0.5 },
      { kind: 'neopixel', gpio: 16, x: 0.3, y: 0.3 }
    ])
  })

  it('drops onboard LEDs missing a position', () => {
    const yaml =
      'id: p\nheaders:\n  - edge: left\n    pins:\n      - name: GP0\n        type: io\n        gpio: 0\n' +
      'onboardLeds:\n  - { kind: single, gpio: 25 }\n  - { kind: rgb, x: 0.4, y: 0.4, rgb: { r: 1, g: 2, b: 3 } }\n'
    const leds = partFromYaml(yaml).onboardLeds
    expect(leds).toEqual([{ kind: 'rgb', rgb: { r: 1, g: 2, b: 3 }, x: 0.4, y: 0.4 }])
  })
})

describe('connectors round-trip', () => {
  it('keeps a QWIIC connector with full pins (SDA/SCL GP## + i2c bus)', () => {
    const part = normalisePart({
      id: 'p',
      name: 'P',
      headers: [{ edge: 'left', pins: [{ name: 'GP0', type: 'io', gpio: 0 }] }],
      connectors: [
        {
          kind: 'qwiic',
          label: 'QWIIC',
          x: 0.5,
          y: 0.9,
          pins: [
            { name: 'GND', type: 'gnd' },
            { name: '3V3', type: 'pwr' },
            { name: 'SDA', type: 'io', gpio: 4, capabilities: ['i2c'], signals: { i2c: 'SDA' }, buses: { i2c: 0 } },
            { name: 'SCL', type: 'io', gpio: 5, capabilities: ['i2c'], signals: { i2c: 'SCL' }, buses: { i2c: 0 } }
          ]
        }
      ]
    })
    const back = partFromYaml(partToYaml(part)).connectors
    expect(back).toEqual(part.connectors)
    expect(back?.[0].pins[2]).toMatchObject({ name: 'SDA', gpio: 4, signals: { i2c: 'SDA' }, buses: { i2c: 0 } })
  })

  it('drops connectors missing a position', () => {
    const yaml =
      'id: p\nheaders:\n  - edge: left\n    pins:\n      - name: GP0\n        type: io\n        gpio: 0\n' +
      'connectors:\n  - { kind: qwiic, pins: [] }\n  - { kind: jst, x: 0.2, y: 0.2, pins: [{ name: A, type: io, gpio: 1 }] }\n'
    const conns = partFromYaml(yaml).connectors
    expect(conns).toEqual([{ kind: 'jst', x: 0.2, y: 0.2, pins: [{ name: 'A', type: 'io', gpio: 1 }] }])
  })
})

describe('pin signal designations round-trip', () => {
  it('keeps per-capability signals (SDA/SCL, SPI CSn, UART TX, PWM A) through YAML', () => {
    const part = normalisePart({
      id: 'p',
      name: 'P',
      headers: [
        {
          edge: 'left',
          pins: [
            { name: 'GP4', type: 'io', gpio: 4, capabilities: ['i2c', 'pwm'], signals: { i2c: 'SDA', pwm: 'A' } },
            { name: 'GP1', type: 'io', gpio: 1, capabilities: ['spi', 'uart'], signals: { spi: 'CSn', uart: 'TX' } }
          ]
        }
      ]
    })
    const back = partFromYaml(partToYaml(part)).headers[0].pins
    expect(back[0].signals).toEqual({ i2c: 'SDA', pwm: 'A' })
    expect(back[1].signals).toEqual({ spi: 'CSn', uart: 'TX' })
  })

  it('keeps per-capability bus / channel numbers (I2C0, SPI1, UART0, ADC2)', () => {
    const part = normalisePart({
      id: 'p',
      name: 'P',
      headers: [
        {
          edge: 'left',
          pins: [
            { name: 'GP26', type: 'io', gpio: 26, capabilities: ['i2c', 'adc'], signals: { i2c: 'SDA' }, buses: { i2c: 0, adc: 2 } },
            { name: 'GP15', type: 'io', gpio: 15, capabilities: ['spi', 'uart'], buses: { spi: 1, uart: 0 } }
          ]
        }
      ]
    })
    const back = partFromYaml(partToYaml(part)).headers[0].pins
    expect(back[0].buses).toEqual({ i2c: 0, adc: 2 })
    expect(back[0].signals).toEqual({ i2c: 'SDA' })
    expect(back[1].buses).toEqual({ spi: 1, uart: 0 })
  })

  it('coerces case + drops signals on non-io pins and empty maps', () => {
    // Case-insensitive read (spi CSn is mixed-case canonical); junk dropped.
    const yaml =
      'id: p\nheaders:\n  - edge: left\n    pins:\n' +
      '      - name: GP2\n        type: io\n        gpio: 2\n        capabilities: [i2c, spi]\n' +
      '        signals: { i2c: sda, spi: csn, bogus: x }\n' +
      '      - name: VCC\n        type: pwr\n        signals: { i2c: SDA }\n'
    const pins = partFromYaml(yaml).headers[0].pins
    expect(pins[0].signals).toEqual({ i2c: 'SDA', spi: 'CSn' })
    expect(pins[1].signals).toBeUndefined() // non-io pins carry no signals
  })
})

describe('component z-order + layer visibility round-trip', () => {
  it('round-trips component z and persisted layer visibility', () => {
    const part = normalisePart({
      id: 'p',
      name: 'P',
      headers: [{ edge: 'left', pins: [{ name: 'A', type: 'io', gpio: 0 }] }],
      shapes: [{ kind: 'rect', x: 0.1, y: 0.1, w: 0.2, h: 0.2, z: 3 }],
      labels: [{ text: 'U1', x: 0.5, y: 0.5, z: 1 }],
      layerVisibility: { pcb: false, image: false, pins: true }
    })
    expect(part.shapes?.[0].z).toBe(3)
    expect(part.labels?.[0].z).toBe(1)
    expect(part.layerVisibility).toEqual({ pcb: false, image: false, pins: true })
    expect(normalisePart(partFromYaml(partToYaml(part)))).toEqual(part)
  })
})

describe('component rotation round-trip', () => {
  it('snaps shape + label rotation to 90° and survives YAML', () => {
    const part = normalisePart({
      id: 'p',
      name: 'P',
      headers: [{ edge: 'left', pins: [{ name: 'A', type: 'io', gpio: 0 }] }],
      shapes: [{ kind: 'rect', x: 0.1, y: 0.1, w: 0.2, h: 0.2, rotation: 95 }],
      labels: [{ text: 'U1', x: 0.5, y: 0.5, rotation: 265 }]
    })
    expect(part.shapes?.[0].rotation).toBe(90) // 95 snapped to nearest 90°
    expect(part.labels?.[0].rotation).toBe(270) // 265 snapped to nearest 90°
    const back = partFromYaml(partToYaml(part))
    expect(back.shapes?.[0].rotation).toBe(90)
    expect(back.labels?.[0].rotation).toBe(270)
    expect(normalisePart(back)).toEqual(part)
  })

  it('round-trips a rect corner radius, including an explicit 0 (sharp)', () => {
    const part = normalisePart({
      id: 'p',
      name: 'P',
      headers: [{ edge: 'left', pins: [{ name: 'A', type: 'io', gpio: 0 }] }],
      shapes: [
        { kind: 'rect', x: 0.1, y: 0.1, w: 0.2, h: 0.2, cornerRadius: 12 },
        { kind: 'rect', x: 0.4, y: 0.1, w: 0.2, h: 0.2, cornerRadius: 0 }
      ]
    })
    expect(part.shapes?.[0].cornerRadius).toBe(12)
    expect(part.shapes?.[1].cornerRadius).toBe(0) // explicit sharp corners survive
    const back = partFromYaml(partToYaml(part))
    expect(back.shapes?.[0].cornerRadius).toBe(12)
    expect(back.shapes?.[1].cornerRadius).toBe(0)
    expect(normalisePart(back)).toEqual(part)
  })

  it('round-trips shape-label + free-label text styling', () => {
    const part = normalisePart({
      id: 'p',
      name: 'P',
      headers: [{ edge: 'left', pins: [{ name: 'A', type: 'io', gpio: 0 }] }],
      shapes: [
        {
          kind: 'rect',
          x: 0.1,
          y: 0.1,
          w: 0.3,
          h: 0.2,
          label: 'Motor A',
          labelFontSize: 14,
          labelBold: true,
          labelUnderline: true,
          labelAlign: 'left',
          labelWrap: true,
          labelColor: '#ff8800'
        }
      ],
      labels: [{ text: 'Title', x: 0.5, y: 0.5, italic: true, align: 'right', color: '#00aaff' }]
    })
    const s = part.shapes?.[0]
    expect(s).toMatchObject({ labelFontSize: 14, labelBold: true, labelUnderline: true, labelAlign: 'left', labelWrap: true, labelColor: '#ff8800' })
    expect(s?.labelItalic).toBeUndefined() // unset flags stay absent
    expect(part.labels?.[0]).toMatchObject({ italic: true, align: 'right', color: '#00aaff' })
    expect(part.labels?.[0].bold).toBeUndefined()
    expect(normalisePart(partFromYaml(partToYaml(part)))).toEqual(part)
  })

  it('drops a 0° (and full-turn 360°) rotation rather than persisting it', () => {
    const part = normalisePart({
      id: 'p',
      name: 'P',
      headers: [{ edge: 'left', pins: [{ name: 'A', type: 'io', gpio: 0 }] }],
      shapes: [{ kind: 'rect', x: 0.1, y: 0.1, w: 0.2, h: 0.2, rotation: 360 }],
      labels: [{ text: 'U1', x: 0.5, y: 0.5, rotation: 0 }]
    })
    expect(part.shapes?.[0].rotation).toBeUndefined()
    expect(part.labels?.[0].rotation).toBeUndefined()
    const back = partFromYaml(partToYaml(part))
    expect(back.shapes?.[0].rotation).toBeUndefined()
    expect(back.labels?.[0].rotation).toBeUndefined()
  })
})
