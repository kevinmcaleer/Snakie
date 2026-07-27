import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PartBody, capabilityChips, capabilityChipsAt, connectorSize } from '../src/renderer/src/components/part-body'
import { blankPart } from '../src/renderer/src/components/part-editor.util'
import type { PartDefinition } from '../src/shared/part'

/**
 * Server-render the shared PartBody scene + the pin-anchored capability chips
 * (used by the breadboard hover) and assert the new elements draw with the right
 * signal/bus text.
 */
const box = { x: 0, y: 0, w: 100, h: 100 }
const render = (part: PartDefinition): string =>
  renderToStaticMarkup(createElement(PartBody, { part, box }))

describe('capabilityChipsAt (breadboard hover chips)', () => {
  it('renders signal + bus refined chips', () => {
    const html = renderToStaticMarkup(
      capabilityChipsAt(
        50,
        50,
        'right',
        ['pwm', 'adc', 'spi', 'i2c', 'uart'],
        { pwm: 'A', spi: 'SCK', i2c: 'SDA', uart: 'TX' },
        { spi: 1, i2c: 0, adc: 2, uart: 0 }
      ) ?? createElement('g')
    )
    expect(html).toContain('PWM A')
    expect(html).toContain('ADC2')
    expect(html).toContain('SPI1 SCK')
    expect(html).toContain('I2C0 SDA')
    expect(html).toContain('UART0 TX')
  })

  it('is null when the pin has no chip-worthy capabilities', () => {
    expect(capabilityChipsAt(0, 0, 'left', ['digital'])).toBeNull()
    expect(capabilityChipsAt(0, 0, 'left', undefined)).toBeNull()
  })
})

describe('PartBody onboard LEDs + connectors', () => {
  it('draws single / RGB / NeoPixel LEDs with their GPIO labels', () => {
    const part: PartDefinition = {
      ...blankPart(),
      onboardLeds: [
        { kind: 'single', gpio: 25, x: 0.3, y: 0.3 },
        { kind: 'rgb', rgb: { r: 18, g: 19, b: 20 }, x: 0.5, y: 0.5 },
        { kind: 'neopixel', gpio: 22, power: 23, x: 0.7, y: 0.7 }
      ]
    }
    const html = render(part)
    expect(html).toContain('LED · GP25')
    expect(html).toContain('RGB · GP18 GP19 GP20')
    expect(html).toContain('NeoPixel · GP22 · PWR GP23')
  })

  it('draws capability chips inside the body only when capsPins is set', () => {
    const part: PartDefinition = {
      ...blankPart(),
      headers: [
        {
          edge: 'left',
          pins: [
            { name: 'GP4', type: 'io', gpio: 4, capabilities: ['i2c'], signals: { i2c: 'SDA' }, buses: { i2c: 0 }, x: 0.1, y: 0.5 }
          ]
        }
      ]
    }
    // No caps prop → no chips.
    expect(renderToStaticMarkup(createElement(PartBody, { part, box }))).not.toContain('I2C0 SDA')
    // capsPins 'all' → the chip renders (box-relative, inside the body).
    const html = renderToStaticMarkup(createElement(PartBody, { part, box, boxedPins: true, capsPins: 'all' }))
    expect(html).toContain('I2C0 SDA')
    expect(html).toContain('pcv__caps-hover')
  })

  it('draws a QWIIC connector summarising its signal pins', () => {
    const part: PartDefinition = {
      ...blankPart(),
      connectors: [
        {
          kind: 'qwiic',
          x: 0.5,
          y: 0.9,
          pins: [
            { name: 'GND', type: 'gnd' },
            { name: 'SDA', type: 'io', gpio: 4, capabilities: ['i2c'], signals: { i2c: 'SDA' } }
          ]
        }
      ]
    }
    expect(render(part)).toContain('QWIIC · SDA GP4')
  })

  it('names a Grove port by its variant, like the silk on a Seeed board', () => {
    const part: PartDefinition = {
      ...blankPart(),
      connectors: [
        {
          kind: 'grove',
          variant: 'i2c',
          x: 0.5,
          y: 0.9,
          pins: [
            { name: 'SCL', type: 'io', gpio: 7, capabilities: ['i2c'], signals: { i2c: 'SCL' } },
            { name: 'SDA', type: 'io', gpio: 6, capabilities: ['i2c'], signals: { i2c: 'SDA' } },
            { name: 'VCC', type: 'pwr' },
            { name: 'GND', type: 'gnd' }
          ]
        }
      ]
    }
    expect(render(part)).toContain('GROVE I2C · SCL GP7 · SDA GP6')
  })

  it('names a 3-way DuPont block SERVO', () => {
    const part: PartDefinition = {
      ...blankPart(),
      connectors: [
        {
          kind: 'dupont',
          x: 0.5,
          y: 0.5,
          pins: [
            { name: 'SIG', type: 'io', gpio: 15, capabilities: ['pwm'] },
            { name: 'V+', type: 'pwr' },
            { name: 'GND', type: 'gnd' }
          ]
        }
      ]
    }
    expect(render(part)).toContain('SERVO · SIG GP15')
  })

  it('draws a Grove shell in its off-white housing colour, not the dark JST one', () => {
    const grove: PartDefinition = {
      ...blankPart(),
      connectors: [{ kind: 'grove', variant: 'i2c', x: 0.5, y: 0.5, pins: [{ name: 'SCL', type: 'io' }] }]
    }
    expect(render(grove)).toContain('#f1efe6')
  })
})

describe('connectorSize (mm-accurate connector scaling)', () => {
  const conn4 = { kind: 'qwiic' as const, x: 0.5, y: 0.5, pins: [{ name: 'A', type: 'io' as const }, { name: 'B', type: 'io' as const }, { name: 'C', type: 'io' as const }, { name: 'D', type: 'io' as const }] }

  it('falls back to the legacy fixed size when there are no mm dimensions (pxPerMm = 0)', () => {
    const s = connectorSize(conn4, 0)
    // Legacy: w = max(18, n*5+6) = 26, h = 11 for a 4-pin connector.
    expect(s).toEqual({ n: 4, w: 26, h: 11 })
  })

  it('scales the housing to the board when given px-per-mm (a QWIIC ≈ 4.5mm wide)', () => {
    const pxPerMm = 15 // e.g. the Tiny 2350 (18mm wide) drawn ~267px in the editor
    const s = connectorSize(conn4, pxPerMm)
    // QWIIC/JST-SH: (n-1)*1.0 + 2*0.75 = 4.5mm wide, 2.9mm deep → to px.
    expect(s.w).toBeCloseTo(4.5 * pxPerMm, 5)
    expect(s.h).toBeCloseTo(2.9 * pxPerMm, 5)
    // Much larger than the tiny legacy size — the reported "really small" bug.
    expect(s.w).toBeGreaterThan(connectorSize(conn4, 0).w * 2)
  })

  it('a 2.0mm-pitch JST is wider than a 1.0mm-pitch QWIIC with the same pin count', () => {
    const jst = { ...conn4, kind: 'jst' as const }
    expect(connectorSize(jst, 15).w).toBeGreaterThan(connectorSize(conn4, 15).w)
  })

  it('scales linearly with px-per-mm', () => {
    expect(connectorSize(conn4, 20).w).toBeCloseTo(connectorSize(conn4, 10).w * 2, 5)
  })

  it('draws a Grove socket at its real ~11.8 × 6.6 mm footprint', () => {
    const grove = { ...conn4, kind: 'grove' as const, variant: 'i2c' as const }
    const pxPerMm = 10
    const s = connectorSize(grove, pxPerMm)
    // (4-1)*2.0 + 2*2.9 = 11.8mm wide, 6.6mm deep.
    expect(s.w).toBeCloseTo(11.8 * pxPerMm, 5)
    expect(s.h).toBeCloseTo(6.6 * pxPerMm, 5)
    // A Grove shell dwarfs a QWIIC — that size difference is the visual tell.
    expect(s.w).toBeGreaterThan(connectorSize(conn4, pxPerMm).w * 2)
  })

  it('draws a 3-way DuPont header one 2.54 mm cell per pin', () => {
    const servo = {
      kind: 'dupont' as const,
      x: 0.5,
      y: 0.5,
      pins: [
        { name: 'SIG', type: 'io' as const },
        { name: 'V+', type: 'pwr' as const },
        { name: 'GND', type: 'gnd' as const }
      ]
    }
    const pxPerMm = 10
    const s = connectorSize(servo, pxPerMm)
    // (3-1)*2.54 + 2*1.27 = 7.62mm — exactly three 0.1" cells.
    expect(s.w).toBeCloseTo(7.62 * pxPerMm, 5)
    expect(s.h).toBeCloseTo(2.54 * pxPerMm, 5)
  })
})

describe('full-pinout props (the mini board’s pin-labels toggle)', () => {
  // The mini board is normally a USED-pin summary; showing the whole pinout is
  // `boxedPins` + `capsPins: 'all'`. Guard that combination actually produces a
  // readable pinout, since that is the entire point of the toggle.
  const MCU: PartDefinition = {
    ...blankPart(),
    headers: [
      {
        edge: 'left',
        pins: [
          { number: 5, name: 'D4', type: 'io', gpio: 6, capabilities: ['i2c'], signals: { i2c: 'SDA' }, buses: { i2c: 1 } },
          { number: 6, name: 'D5', type: 'io', gpio: 7, capabilities: ['i2c'], signals: { i2c: 'SCL' }, buses: { i2c: 1 } },
          { number: 7, name: '3V3', type: 'pwr' }
        ]
      }
    ]
  }
  const full = (): string =>
    renderToStaticMarkup(createElement(PartBody, { part: MCU, box, boxedPins: true, capsPins: 'all' as const }))

  it('shows every pin’s name, GP number and I²C bus/signal badge', () => {
    const html = full()
    expect(html).toContain('D4')
    expect(html).toContain('D5')
    expect(html).toContain('GP6')
    expect(html).toContain('GP7')
    // The badge that answers "am I on the right I2C pins?".
    expect(html).toContain('I2C1 SDA')
    expect(html).toContain('I2C1 SCL')
  })

  it('shows neither GP numbers nor badges without the toggle (the used-pin summary)', () => {
    const summary = renderToStaticMarkup(
      createElement(PartBody, { part: MCU, box, boxedPins: new Set<number>() })
    )
    expect(summary).not.toContain('GP6')
    expect(summary).not.toContain('I2C1 SDA')
  })

  it('keeps a used pin’s code variable in preference to its GP number', () => {
    // A pin the program uses keeps showing `i2c`/`sda` etc. — the toggle must not
    // replace the thing the mini board exists to show.
    const html = renderToStaticMarkup(
      createElement(PartBody, {
        part: MCU,
        box,
        boxedPins: true,
        capsPins: 'all' as const,
        pinVariables: new Map([[0, { variable: 'sda', color: '#0f0' }]])
      })
    )
    expect(html).toContain('sda')
    expect(html).toContain('GP7') // the other pins still fall back to GP<n>
  })
})

describe('capability chips sit on the pin line when rotated', () => {
  // Top/bottom pins draw their chips rotated ±90°. The strip is a rect centred on
  // its own y=0, so the transform's translate-x IS the strip's centre line and
  // must equal the pin's cx. It used to carry boxedPinLabel's ±3.5 baseline
  // compensation, which only makes sense for text hanging off a baseline — that
  // pushed the chips off centre (left on bottom pins, right on top ones).
  const box = { x: 0, y: 0, w: 200, h: 200 }
  const cx = 100
  const chips = (dir: 'top' | 'bottom' | 'left' | 'right'): string =>
    renderToStaticMarkup(
      capabilityChips(box, cx, 40, dir, 'D4', ['i2c'], { i2c: 'SDA' }, undefined, { i2c: 1 }) ??
        createElement('g')
    )

  it('centres the strip on the pin for a TOP pin', () => {
    expect(chips('top')).toContain(`translate(${cx},`)
  })

  it('centres the strip on the pin for a BOTTOM pin', () => {
    expect(chips('bottom')).toContain(`translate(${cx},`)
  })

  it('top and bottom land on the SAME line — no ±offset between them', () => {
    const tx = (html: string): string => /translate\((-?[\d.]+),/.exec(html)?.[1] ?? ''
    expect(tx(chips('top'))).toBe(tx(chips('bottom')))
    expect(tx(chips('top'))).toBe(String(cx))
  })

  it('still rotates the two in opposite directions (labels read outward)', () => {
    expect(chips('top')).toContain('rotate(-90)')
    expect(chips('bottom')).toContain('rotate(90)')
  })

  it('leaves left/right pins on their pin line too (unrotated, unchanged)', () => {
    // cy = 40 is the pin line for a horizontal pin; the strip centres on it.
    expect(chips('right')).toContain(', 40)')
    expect(chips('left')).toContain(', 40)')
  })
})

describe('pin labels stay upright on a 180°-rotated body', () => {
  const part: PartDefinition = {
    ...blankPart(),
    headers: [
      {
        edge: 'left',
        pins: [
          { number: 5, name: 'D4', type: 'io', gpio: 6, x: 0.05, y: 0.4 },
          { number: 6, name: 'D5', type: 'io', gpio: 7, x: 0.95, y: 0.4 }
        ]
      }
    ]
  }
  const at = (rotation: number): string =>
    renderToStaticMarkup(createElement(PartBody, { part, box, boxedPins: true, rotation }))

  it('flips each label about its own anchor at 180° so it reads the right way up', () => {
    // A plain counter-rotation would move the text to the far side of its anchor;
    // flipping about the anchor AND swapping start↔end keeps it in the same span.
    expect(at(180)).toContain('rotate(180')
  })

  it('leaves an unrotated body alone', () => {
    expect(at(0)).not.toContain('rotate(180')
  })

  it('leaves 90° and 270° alone — sideways labels read fine', () => {
    expect(at(90)).not.toContain('rotate(180')
    expect(at(270)).not.toContain('rotate(180')
  })
})

describe('board rear (#636) — PartBody draws one face at a time', () => {
  const twoSided: PartDefinition = {
    ...blankPart(),
    imageData: 'data:image/png;base64,FRONTIMG',
    rear: { imageData: 'data:image/png;base64,REARIMG' },
    headers: [
      {
        edge: 'left',
        pins: [
          { name: 'FRONTPIN', type: 'io', x: 0.1, y: 0.3 },
          { name: 'REARPIN', type: 'io', x: 0.1, y: 0.6, side: 'rear' }
        ]
      }
    ],
    labels: [
      { text: 'FRONTLABEL', x: 0.5, y: 0.2 },
      { text: 'REARLABEL', x: 0.5, y: 0.8, side: 'rear' }
    ],
    mountingHoles: [{ x: 0.2, y: 0.5, diameter: 2 }]
  }
  const draw = (side: 'front' | 'rear'): string =>
    renderToStaticMarkup(createElement(PartBody, { part: twoSided, box, side, boxedPins: true }))

  it('shows only the front’s items by default', () => {
    const html = draw('front')
    expect(html).toContain('FRONTLABEL')
    expect(html).not.toContain('REARLABEL')
  })

  it('shows only the rear’s items when flipped', () => {
    const html = draw('rear')
    expect(html).toContain('REARLABEL')
    expect(html).not.toContain('FRONTLABEL')
  })

  it('uses each face’s own photo, and never the front’s on the back', () => {
    expect(draw('front')).toContain('FRONTIMG')
    expect(draw('front')).not.toContain('REARIMG')
    expect(draw('rear')).toContain('REARIMG')
    expect(draw('rear')).not.toContain('FRONTIMG')
  })

  it('mirrors a mounting hole on the rear — it lands where it does in the hand', () => {
    // box is 100 wide, hole at x=0.2 → 20 on the front, 80 mirrored on the rear.
    expect(draw('front')).toContain('cx="20"')
    expect(draw('rear')).toContain('cx="80"')
  })
})

describe('through-board pads show on both faces (#636)', () => {
  // A castellated pad is ONE pad you can solder from either side — a XIAO's 14
  // castellations ARE its underside array. Duplicating them as rear pins would
  // invent 14 nets the board hasn't got.
  const xiaoish: PartDefinition = {
    ...blankPart(),
    dimensions: { width: 17.8, height: 21 },
    headers: [
      {
        edge: 'left',
        pins: [
          { name: 'D0', type: 'io', gpio: 26, shape: 'castellated', x: 0.126, y: 0.216 },
          { name: 'BATPLUS', type: 'pwr', shape: 'smd', x: 0.5, y: 0.1, side: 'rear' }
        ]
      }
    ]
  }
  const draw = (side: 'front' | 'rear'): string =>
    renderToStaticMarkup(createElement(PartBody, { part: xiaoish, box, side, boxedPins: true }))

  it('shows a castellated pad on the front AND the back', () => {
    expect(draw('front')).toContain('D0')
    expect(draw('rear')).toContain('D0')
  })

  it('mirrors it on the back — same pad, seen from the other side', () => {
    // box is 100 wide: x=0.126 → 12.6 on the front, 87.4 mirrored on the rear.
    expect(draw('front')).toContain('12.6')
    expect(draw('rear')).toContain('87.4')
  })

  it('keeps a rear-only SMD pad off the front', () => {
    expect(draw('front')).not.toContain('BATPLUS')
    expect(draw('rear')).toContain('BATPLUS')
  })
})
