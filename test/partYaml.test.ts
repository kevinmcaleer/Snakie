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
        { name: 'SCL', type: 'io', gpio: 5, capabilities: ['i2c', 'digital'], number: 3, x: 0.6, y: 0.9 },
        { name: 'SDA', type: 'io', gpio: 4, capabilities: ['i2c', 'digital'], number: 4, castellated: true, x: 0.8, y: 0.9 }
      ]
    }
  ],
  mountingHoles: [{ x: 0.1, y: 0.5, diameter: 2 }],
  buttons: [{ label: 'XSHUT', x: 0.8, y: 0.5 }],
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
