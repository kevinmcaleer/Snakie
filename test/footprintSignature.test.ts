import { describe, it, expect } from 'vitest'
import type { PartDefinition, PartPin } from '../src/shared/part'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  pinSignature,
  partSignature,
  mountSignature,
  signaturesMatch,
  type SigPin
} from '../src/shared/footprint-signature'
import { partFromYaml, partToYaml } from '../src/shared/part-yaml'

const pins = (...ps: SigPin[]): SigPin[] => ps

describe('pinSignature — structural duck-typing (#166)', () => {
  it('is translation + scale invariant (a board and its shrunk imprint match)', () => {
    const board = pins(
      { type: 'pwr', x: 0.1, y: 0.1 },
      { type: 'gnd', x: 0.1, y: 0.5 },
      { type: 'io', x: 0.1, y: 0.9 }
    )
    // Same layout imprinted into a carrier: translated to (0.6,0.2) and half the size.
    const imprint = board.map((p) => ({ type: p.type, x: 0.6 + p.x * 0.5, y: 0.2 + p.y * 0.5 }))
    expect(pinSignature(board)).toBe(pinSignature(imprint))
    expect(signaturesMatch(pinSignature(board), pinSignature(imprint))).toBe(true)
  })

  it('ignores pin ORDER (sorted canonical form)', () => {
    const a = pins({ type: 'pwr', x: 0.1, y: 0.1 }, { type: 'io', x: 0.9, y: 0.9 })
    const b = pins({ type: 'io', x: 0.9, y: 0.9 }, { type: 'pwr', x: 0.1, y: 0.1 })
    expect(pinSignature(a)).toBe(pinSignature(b))
  })

  it('distinguishes different TYPES at the same position', () => {
    const a = pins({ type: 'io', x: 0.1, y: 0.1 }, { type: 'gnd', x: 0.9, y: 0.9 })
    const b = pins({ type: 'pwr', x: 0.1, y: 0.1 }, { type: 'gnd', x: 0.9, y: 0.9 })
    expect(signaturesMatch(pinSignature(a), pinSignature(b))).toBe(false)
  })

  it('distinguishes different LAYOUTS (a moved pin) and different pin counts', () => {
    const a = pins({ type: 'io', x: 0.1, y: 0.1 }, { type: 'io', x: 0.1, y: 0.9 })
    const moved = pins({ type: 'io', x: 0.1, y: 0.1 }, { type: 'io', x: 0.9, y: 0.9 })
    const fewer = pins({ type: 'io', x: 0.1, y: 0.1 })
    expect(signaturesMatch(pinSignature(a), pinSignature(moved))).toBe(false)
    expect(signaturesMatch(pinSignature(a), pinSignature(fewer))).toBe(false)
  })

  it('an empty cluster never matches (not even another empty one)', () => {
    expect(pinSignature([])).toBe('')
    expect(signaturesMatch('', '')).toBe(false)
  })
})

const pin = (p: Partial<PartPin> & { name: string; type: PartPin['type'] }): PartPin => p as PartPin

describe('partSignature / mountSignature over a PartDefinition', () => {
  it('a board and a carrier that imprinted it share a signature', () => {
    const board: PartDefinition = {
      parts: [],
      connections: [],
      headers: [
        {
          pins: [
            pin({ name: '3V3', type: 'pwr', x: 0.2, y: 0.2 }),
            pin({ name: 'GND', type: 'gnd', x: 0.2, y: 0.5 }),
            pin({ name: 'D0', type: 'io', x: 0.2, y: 0.8, gpio: 26 })
          ]
        }
      ]
    } as unknown as PartDefinition
    // The carrier holds the same pins imprinted from mount "m1" (shrunk + moved),
    // plus its own unrelated pin that must NOT count toward the mount's signature.
    const carrier: PartDefinition = {
      parts: [],
      connections: [],
      headers: [
        {
          pins: [
            pin({ name: 'own', type: 'io', x: 0.05, y: 0.05 }),
            pin({ name: '3V3', type: 'pwr', x: 0.6, y: 0.3, derived: 'm1' }),
            pin({ name: 'GND', type: 'gnd', x: 0.6, y: 0.45, derived: 'm1' }),
            pin({ name: 'D0', type: 'io', x: 0.6, y: 0.6, derived: 'm1' })
          ]
        }
      ]
    } as unknown as PartDefinition
    expect(mountSignature(carrier, 'm1')).toBe(partSignature(board))
    expect(signaturesMatch(mountSignature(carrier, 'm1'), partSignature(board))).toBe(true)
  })
})

describe('real bundled boards (#166)', () => {
  const load = (id: string): PartDefinition =>
    partFromYaml(readFileSync(join(__dirname, `../examples/parts/snakie-standard/${id}/parts.yml`), 'utf-8'))

  it('the XIAO RP2040 and RP2350 duck-type (same footprint despite different authored positions)', () => {
    const a = partSignature(load('seeed-xiao-rp2350'))
    const b = partSignature(load('seeed-xiao-rp2040'))
    expect(a).not.toBe('')
    expect(signaturesMatch(a, b)).toBe(true)
  })

  it('a XIAO does NOT duck-type with an unrelated board', () => {
    expect(signaturesMatch(partSignature(load('seeed-xiao-rp2350')), partSignature(load('esp32-devkit')))).toBe(false)
  })

  it('the bundled expansion base ships an imprinted XIAO footprint (docks out of the box)', () => {
    const base = load('seeed-xiao-expansion-base')
    const mount = base.mounts?.[0]
    expect(mount?.ref).toEqual({ lib: 'snakie-standard', part: 'seeed-xiao-rp2350' })
    const derived = (base.headers ?? []).flatMap((h) => h.pins).filter((p) => p.derived === mount?.id)
    expect(derived.length).toBe(14)
    // Docking compares a dragged board to the mount's REF board — so any XIAO
    // (RP2040 or RP2350) structurally matches this socket.
    const ref = load(mount!.ref!.part)
    expect(signaturesMatch(partSignature(ref), partSignature(load('seeed-xiao-rp2040')))).toBe(true)
  })

  it('the bundled Pico carrier ships an imprinted Pico footprint (docks out of the box)', () => {
    const carrier = load('pico-carrier-base')
    const mount = carrier.mounts?.[0]
    expect(mount?.ref).toEqual({ lib: 'snakie-standard', part: 'pico2w' })
    const derived = (carrier.headers ?? []).flatMap((h) => h.pins).filter((p) => p.derived === mount?.id)
    expect(derived.length).toBe(40)
  })

  it('the whole Pico family shares one footprint, so any Pico docks the carrier', () => {
    // pico2w's columns were misaligned (40 distinct y-levels), breaking its
    // signature vs pico/pico-w; once aligned they all duck-type together.
    const sig = partSignature(load('pico2w')) // the carrier's mount ref
    expect(sig).not.toBe('')
    for (const id of ['pico', 'pico-w', 'pico2w']) {
      expect(signaturesMatch(sig, partSignature(load(id)))).toBe(true)
    }
  })
})

describe('serialisation of the imprint fields (#166)', () => {
  it('round-trips PartMount.ref and PartPin.derived', () => {
    const part = partFromYaml(
      [
        'id: base',
        'name: Base',
        'headers:',
        '  - pins:',
        '      - { name: D0, type: io, x: 0.6, y: 0.3, derived: m1, locked: true }',
        'mounts:',
        '  - { id: m1, footprint: xiao, ref: { lib: snakie-standard, part: seeed-xiao-rp2350 }, x: 0.7, y: 0.35 }',
        ''
      ].join('\n')
    )
    expect(part.mounts?.[0]).toMatchObject({ id: 'm1', ref: { lib: 'snakie-standard', part: 'seeed-xiao-rp2350' } })
    expect(part.headers?.[0]?.pins?.[0]).toMatchObject({ name: 'D0', derived: 'm1' })
    // Survives a full write→read cycle.
    const back = partFromYaml(partToYaml(part))
    expect(back.mounts?.[0]?.ref).toEqual({ lib: 'snakie-standard', part: 'seeed-xiao-rp2350' })
    expect(back.headers?.[0]?.pins?.[0]?.derived).toBe('m1')
  })
})

describe('rear-only pads don’t change a board’s dockable footprint (#636)', () => {
  const xiao = (extra: PartPin[] = []): PartDefinition => ({
    id: 'xiao',
    name: 'XIAO',
    headers: [
      {
        edge: 'left',
        pins: [
          { name: 'D0', type: 'io', shape: 'castellated', x: 0.126, y: 0.216 },
          { name: 'D1', type: 'io', shape: 'castellated', x: 0.126, y: 0.328 },
          { name: '5V', type: 'pwr', shape: 'castellated', x: 0.898, y: 0.216 },
          { name: 'GND', type: 'gnd', shape: 'castellated', x: 0.898, y: 0.328 },
          ...extra
        ]
      }
    ]
  })

  it('a rear SMD pad is excluded — it faces away from the carrier', () => {
    // Adding battery pads to the underside must not stop the board seating in a
    // footprint it still physically fits.
    const withBattery = xiao([
      { name: 'BAT+', type: 'pwr', shape: 'smd', side: 'rear', x: 0.42, y: 0.1 },
      { name: 'BAT-', type: 'gnd', shape: 'smd', side: 'rear', x: 0.58, y: 0.1 }
    ])
    expect(partSignature(withBattery)).toBe(partSignature(xiao()))
    expect(signaturesMatch(partSignature(withBattery), partSignature(xiao()))).toBe(true)
  })

  it('but a rear pad that DRILLS THROUGH still counts — it does mate', () => {
    const withThroughHole = xiao([
      { name: 'TP1', type: 'other', shape: 'header', side: 'rear', x: 0.5, y: 0.5 }
    ])
    expect(partSignature(withThroughHole)).not.toBe(partSignature(xiao()))
  })

  it('a FRONT surface pad still counts — it faces the carrier', () => {
    const withFrontSmd = xiao([{ name: 'TP2', type: 'other', shape: 'smd', x: 0.5, y: 0.5 }])
    expect(partSignature(withFrontSmd)).not.toBe(partSignature(xiao()))
  })
})
