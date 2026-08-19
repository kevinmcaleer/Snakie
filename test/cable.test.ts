import { describe, it, expect } from 'vitest'
import {
  cablePlugGeometry,
  cableRole,
  conductorColour,
  connectorFit,
  connectorKindName,
  housingPlugAngle,
  pairContacts
} from '../src/renderer/src/components/cable'
import type { PartConnector, PartPin } from '../src/shared/part'

const pin = (name: string, type: PartPin['type'], extra: Partial<PartPin> = {}): PartPin => ({
  name,
  type,
  ...extra
})

const groveI2c = (): PartConnector => ({
  kind: 'grove',
  variant: 'i2c',
  x: 0.5,
  y: 0.5,
  pins: [
    pin('SCL', 'io', { capabilities: ['i2c'], signals: { i2c: 'SCL' } }),
    pin('SDA', 'io', { capabilities: ['i2c'], signals: { i2c: 'SDA' } }),
    pin('VCC', 'pwr'),
    pin('GND', 'gnd')
  ]
})

const groveUart = (): PartConnector => ({
  kind: 'grove',
  variant: 'uart',
  x: 0.5,
  y: 0.5,
  pins: [
    pin('RX', 'io', { capabilities: ['uart'], signals: { uart: 'RX' } }),
    pin('TX', 'io', { capabilities: ['uart'], signals: { uart: 'TX' } }),
    pin('VCC', 'pwr'),
    pin('GND', 'gnd')
  ]
})

const groveDigital = (): PartConnector => ({
  kind: 'grove',
  variant: 'digital',
  x: 0.5,
  y: 0.5,
  pins: [pin('SIG', 'io'), pin('NC', 'other'), pin('VCC', 'pwr'), pin('GND', 'gnd')]
})

const qwiic = (): PartConnector => ({
  kind: 'qwiic',
  x: 0.5,
  y: 0.5,
  pins: [
    pin('GND', 'gnd'),
    pin('3V3', 'pwr'),
    pin('SDA', 'io', { capabilities: ['i2c'], signals: { i2c: 'SDA' } }),
    pin('SCL', 'io', { capabilities: ['i2c'], signals: { i2c: 'SCL' } })
  ]
})

const servo = (): PartConnector => ({
  kind: 'dupont',
  x: 0.5,
  y: 0.5,
  pins: [pin('SIG', 'io', { capabilities: ['pwm'] }), pin('V+', 'pwr'), pin('GND', 'gnd')]
})

describe('cableRole', () => {
  it('reads the designated signal in preference to the pin name', () => {
    expect(cableRole(pin('D4', 'io', { signals: { i2c: 'SDA' } }))).toBe('sda')
    expect(cableRole(pin('D5', 'io', { signals: { i2c: 'SCL' } }))).toBe('scl')
    expect(cableRole(pin('SDA', 'io'))).toBe('sda')
  })

  it('classifies power and ground by type, whatever they are called', () => {
    expect(cableRole(pin('VCC', 'pwr'))).toBe('pwr')
    expect(cableRole(pin('5V', 'pwr'))).toBe('pwr')
    expect(cableRole(pin('GND', 'gnd'))).toBe('gnd')
  })

  it('treats an NC contact as carrying nothing (so no wire is invented for it)', () => {
    expect(cableRole(pin('NC', 'other'))).toBeNull()
    expect(cableRole(pin('', 'io'))).toBeNull()
  })

  it('falls back to a generic signal for an unnamed io contact', () => {
    expect(cableRole(pin('SIG', 'io'))).toBe('sig')
  })
})

describe('conductorColour', () => {
  it('gives the real ribbon colours in contact order', () => {
    // Grove: yellow, white, red, black.
    expect(conductorColour('grove', 0)).toBe('#e8c33a')
    expect(conductorColour('grove', 3)).toBe('#23262b')
    // QWIIC: black(GND), red(3V3), blue(SDA), yellow(SCL).
    expect(conductorColour('qwiic', 0)).toBe('#23262b')
    expect(conductorColour('qwiic', 2)).toBe('#2f6fb3')
    // Servo lead: orange(SIG), red(V+), brown(GND).
    expect(conductorColour('dupont', 0)).toBe('#e08a2e')
    expect(conductorColour('dupont', 2)).toBe('#7a5230')
  })

  it('has no standard colours for a plain JST, or beyond the lead width', () => {
    expect(conductorColour('jst', 0)).toBeUndefined()
    expect(conductorColour('dupont', 3)).toBeUndefined()
  })
})

describe('pairContacts', () => {
  it('joins two identical sockets contact-for-contact', () => {
    expect(pairContacts(groveI2c(), groveI2c())).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3]
    ])
  })

  it('keeps a Grove UART lead straight-through (the crossover is not the cable)', () => {
    const pairs = pairContacts(groveUart(), groveUart())
    // Contact 1 (RX) to contact 1, NOT RX->TX.
    expect(pairs).toContainEqual([0, 0])
    expect(pairs).toContainEqual([1, 1])
  })

  it('skips an NC contact rather than inventing a wire for it', () => {
    const pairs = pairContacts(groveDigital(), groveDigital())
    expect(pairs).toEqual([
      [0, 0],
      [2, 2],
      [3, 3]
    ])
  })

  it('matches a cross-family adapter lead by role, not position', () => {
    // Grove is SCL/SDA/VCC/GND; QWIIC is GND/3V3/SDA/SCL — opposite orders.
    const pairs = pairContacts(groveI2c(), qwiic())
    expect(pairs).toContainEqual([0, 3]) // SCL -> SCL
    expect(pairs).toContainEqual([1, 2]) // SDA -> SDA
    expect(pairs).toContainEqual([2, 1]) // VCC -> 3V3
    expect(pairs).toContainEqual([3, 0]) // GND -> GND
  })

  it('lands a servo lead the right way round regardless of drag direction', () => {
    // Orientation is a property of contact order, not of which end you grabbed —
    // so both directions map Signal->Signal, V+->V+, GND->GND.
    expect(pairContacts(servo(), servo())).toEqual([
      [0, 0],
      [1, 1],
      [2, 2]
    ])
  })
})

describe('connectorFit', () => {
  it('accepts two matching Grove I²C ports', () => {
    const fit = connectorFit(groveI2c(), groveI2c())
    expect(fit.ok).toBe(true)
    expect(fit.pairs).toHaveLength(4)
  })

  it('accepts a Grove-to-QWIIC adapter lead', () => {
    expect(connectorFit(groveI2c(), qwiic()).ok).toBe(true)
  })

  it('refuses an I²C module in a UART port, naming both', () => {
    const fit = connectorFit(groveI2c(), groveUart())
    expect(fit.ok).toBe(false)
    expect(fit.reason).toMatch(/UART/)
    expect(fit.reason).toMatch(/I2C/i)
    expect(fit.pairs).toEqual([])
  })

  it('refuses a servo lead in a Grove socket', () => {
    const fit = connectorFit(servo(), groveI2c())
    expect(fit.ok).toBe(false)
    expect(fit.reason).toMatch(/servo header/)
    expect(fit.reason).toMatch(/Grove/)
    // ...and says the same thing whichever end was grabbed first.
    expect(connectorFit(groveI2c(), servo()).reason).toBe(fit.reason)
  })

  it('refuses a lead that would only join power and ground', () => {
    const powerOnly: PartConnector = {
      kind: 'jst',
      x: 0.5,
      y: 0.5,
      pins: [pin('VCC', 'pwr'), pin('GND', 'gnd')]
    }
    const fit = connectorFit(powerOnly, powerOnly)
    expect(fit.ok).toBe(false)
    expect(fit.reason).toMatch(/no signal/)
  })

  it('refuses a 3-way lead on a 4-way header', () => {
    const four: PartConnector = {
      kind: 'dupont',
      x: 0.5,
      y: 0.5,
      pins: [pin('SIG', 'io'), pin('V+', 'pwr'), pin('GND', 'gnd'), pin('AUX', 'io')]
    }
    const fit = connectorFit(servo(), four)
    expect(fit.ok).toBe(false)
    expect(fit.reason).toMatch(/3-way/)
  })
})

describe('connectorKindName', () => {
  it('names a port the way its silk does', () => {
    expect(connectorKindName(groveI2c())).toBe('Grove I2C')
    expect(connectorKindName(groveUart())).toBe('Grove UART')
    expect(connectorKindName(qwiic())).toBe('QWIIC')
    expect(connectorKindName(servo())).toBe('servo header')
  })
})

describe('the lead leaves through the mouth, not off an end', () => {
  const c = (over: Partial<PartConnector>): PartConnector =>
    ({ kind: 'qwiic', x: 0.5, y: 0.5, pins: [], ...over }) as PartConnector

  it('a row of contacts near the BOTTOM edge takes its lead downward', () => {
    // The reported case: a QWIIC socket along a board's bottom edge should take
    // its cable out of the board, not sideways out of the shell's end.
    expect(housingPlugAngle(c({ y: 0.9 }))).toBe(90)
  })

  it('a row near the TOP edge takes its lead upward', () => {
    // …and its mate enters that board from the top, rather than the left.
    expect(housingPlugAngle(c({ y: 0.1 }))).toBe(-90)
  })

  it('a COLUMN of contacts takes its lead out the nearer side', () => {
    expect(housingPlugAngle(c({ rotation: 90, x: 0.1 }))).toBe(180)
    expect(housingPlugAngle(c({ rotation: 90, x: 0.9 }))).toBe(0)
  })

  it('always points AWAY from the middle of the part', () => {
    // Whichever axis the contacts run along, the mouth faces the outside — that
    // is the whole rule, and it is what keeps a lead off the board's face.
    for (const rotation of [0, 180]) {
      expect(housingPlugAngle(c({ rotation, y: 0.2 }))).toBeLessThan(0) // upper half → up
      expect(housingPlugAngle(c({ rotation, y: 0.8 }))).toBeGreaterThan(0) // lower → down
    }
  })
})

describe('the plug a seated lead is drawn as (#772)', () => {
  // A real 4-way Grove socket: 11.8 mm along its contacts, 6.6 mm across them,
  // drawn here at 6.55 px/mm (a 58 mm carrier filling the canvas cap).
  const SPAN = 11.8 * 6.55
  const DEPTH = 6.6 * 6.55

  it('centres the shell on the socket, not beside it', () => {
    // The frame's origin IS the socket centre, so a shell that is not centred on
    // the origin is a shell that does not sit on its port. The plug used to be
    // pinned to the mean of the contact anchors, which sit at the housing's front
    // edge — half a housing-depth adrift.
    const { shell } = cablePlugGeometry(SPAN, DEPTH)
    expect(shell.x + shell.w / 2).toBeCloseTo(0, 10)
    expect(shell.y + shell.h / 2).toBeCloseTo(0, 10)
  })

  it('covers the socket footprint exactly — depth along the lead, span across it', () => {
    // +x is the way the lead leaves, and a lead leaves through the mouth: so the
    // housing's DEPTH runs along that axis and its contact span across it. Getting
    // this the other way round draws the shell broadside to its own cable.
    const { shell } = cablePlugGeometry(SPAN, DEPTH)
    expect(shell.w).toBeCloseTo(DEPTH, 10)
    expect(shell.h).toBeCloseTo(SPAN, 10)
  })

  it('never grows outside the socket across the contacts', () => {
    // What made this visible on hardware: on a 20 mm Grove module the plug covered
    // a third of the board. Nothing the plug draws may be wider than the port.
    const { shell, boot } = cablePlugGeometry(SPAN, DEPTH)
    for (const r of [shell, boot]) {
      expect(r.y).toBeGreaterThanOrEqual(-SPAN / 2)
      expect(r.y + r.h).toBeLessThanOrEqual(SPAN / 2)
    }
  })

  it('keeps the strain relief a stub — proportioned to the DEPTH, not the span', () => {
    // The boot's length used to come from the contact span, so on a Grove (11.8 mm
    // across, 6.6 mm deep) it stood further proud of the shell than the shell was
    // thick. A plug is a little longer than its socket, never half as long again.
    const { shell, boot } = cablePlugGeometry(SPAN, DEPTH)
    const proud = boot.x + boot.w - (shell.x + shell.w)
    expect(proud).toBeGreaterThan(0) // it IS a boot: it stands out of the shell
    expect(proud).toBeLessThan(DEPTH / 2)
    expect(boot.x).toBeGreaterThan(0) // …on the side the lead leaves from
  })

  it('is linear in the drawn scale — no absolute pixels to trip over', () => {
    // The bug class this closes: a plug measured in one unit against a socket
    // measured in another looks right at one board size and wrong at every other.
    // Doubling the socket must double every number the plug is drawn from.
    const once = cablePlugGeometry(SPAN, DEPTH)
    const twice = cablePlugGeometry(SPAN * 2, DEPTH * 2)
    for (const key of ['shell', 'boot'] as const) {
      for (const f of ['x', 'y', 'w', 'h', 'rx'] as const) {
        expect(twice[key][f], `${key}.${f}`).toBeCloseTo(once[key][f] * 2, 10)
      }
    }
  })

  it('degrades to nothing rather than NaN for a socket with no size', () => {
    const { shell, boot } = cablePlugGeometry(0, 0)
    for (const v of [shell.w, shell.h, shell.rx, boot.w, boot.h, boot.rx]) {
      expect(Number.isFinite(v)).toBe(true)
      expect(v).toBe(0)
    }
  })
})
