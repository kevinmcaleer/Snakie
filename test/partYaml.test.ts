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
  headers: [
    {
      edge: 'bottom',
      pins: [
        { name: 'VIN', type: 'pwr', number: 1 },
        { name: 'GND', type: 'gnd', number: 2 },
        { name: 'SCL', type: 'io', gpio: 5, capabilities: ['i2c', 'digital'], number: 3 },
        { name: 'SDA', type: 'io', gpio: 4, capabilities: ['i2c', 'digital'], number: 4, castellated: true }
      ]
    }
  ],
  mountingHoles: [{ x: 0.1, y: 0.5, diameter: 2 }],
  buttons: [{ label: 'XSHUT', x: 0.8, y: 0.5 }],
  ledLabel: 'LED',
  image: 'image.png',
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
