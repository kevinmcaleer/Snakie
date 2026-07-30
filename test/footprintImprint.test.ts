import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { imprintPins, applyImprint, removeMountImprint, translateMount, rotateMount } from '../src/shared/footprint-imprint'
import { partSignature, mountSignature, signaturesMatch } from '../src/shared/footprint-signature'
import { partFromYaml } from '../src/shared/part-yaml'
import type { PartDefinition } from '../src/shared/part'

const load = (id: string): PartDefinition =>
  partFromYaml(readFileSync(join(__dirname, `../examples/parts/snakie-standard/${id}/parts.yml`), 'utf-8'))

const blankCarrier = (w = 58, h = 42.5): PartDefinition =>
  ({ parts: [], connections: [], headers: [], dimensions: { width: w, height: h } }) as unknown as PartDefinition

describe('imprintPins (#166 phase 2)', () => {
  it('copies every MATING reference pin as a derived, locked pin', () => {
    const xiao = load('seeed-xiao-rp2350')
    const all = (xiao.headers ?? []).flatMap((h) => h.pins).filter((p) => p.x !== undefined)
    // A footprint imprints what the board presents DOWNWARD. A rear-only surface
    // pad (the XIAO's BAT+/BAT−) faces away from the carrier and touches nothing,
    // so it isn't imprinted — otherwise the carrier grows phantom pads and the
    // imprint's signature stops matching the board it was taken from.
    const mating = all.filter((p) => p.side !== 'rear' || p.shape === 'castellated')
    expect(mating.length).toBeLessThan(all.length) // the XIAO really has rear pads
    const pins = imprintPins(xiao, { id: 'm1', x: 0.7, y: 0.35 }, blankCarrier())
    expect(pins.length).toBe(mating.length)
    expect(pins.some((p) => p.name === 'BAT+')).toBe(false)
    expect(pins.every((p) => p.derived === 'm1' && p.locked === true)).toBe(true)
    // Types + names carried through; positions land inside the board.
    expect(pins.some((p) => p.type === 'pwr')).toBe(true)
    expect(pins.some((p) => p.name === 'D0')).toBe(true)
    expect(pins.every((p) => p.x! >= 0 && p.x! <= 1 && p.y! >= 0 && p.y! <= 1)).toBe(true)
  })

  it('the imprint shares the reference board’s signature (so a seated board docks)', () => {
    const xiao = load('seeed-xiao-rp2350')
    const carrier = applyImprint(blankCarrier(), xiao, { lib: 'snakie-standard', part: 'seeed-xiao-rp2350' }, {
      id: 'm1',
      x: 0.7,
      y: 0.35
    })
    expect(signaturesMatch(mountSignature(carrier, 'm1'), partSignature(xiao))).toBe(true)
    // And a *compatible* board (XIAO 2040) matches the same socket.
    expect(signaturesMatch(mountSignature(carrier, 'm1'), partSignature(load('seeed-xiao-rp2040')))).toBe(true)
  })

  it('scales the block to the reference board’s real size within the carrier', () => {
    const xiao = load('seeed-xiao-rp2350') // 17.8 x 21 mm
    const pins = imprintPins(xiao, { id: 'm1', x: 0.5, y: 0.5 }, blankCarrier(58, 42.5))
    const xs = pins.map((p) => p.x!)
    const ys = pins.map((p) => p.y!)
    const wSpan = Math.max(...xs) - Math.min(...xs)
    const hSpan = Math.max(...ys) - Math.min(...ys)
    // Scaled to the carrier (well under half its size), and taller than wide —
    // the XIAO is 17.8 × 21 mm on a 58 × 42.5 mm base, so aspect is preserved.
    expect(wSpan).toBeLessThan(0.5)
    expect(hSpan).toBeLessThan(0.5)
    expect(hSpan).toBeGreaterThan(wSpan)
  })
})

describe('applyImprint / removeMountImprint / translateMount', () => {
  const xiao = load('seeed-xiao-rp2350')
  const refId = { lib: 'snakie-standard', part: 'seeed-xiao-rp2350' }

  it('upserts the mount with its ref and adds the derived pins (idempotent re-apply)', () => {
    let c = applyImprint(blankCarrier(), xiao, refId, { id: 'm1', x: 0.5, y: 0.5 })
    const n1 = (c.headers ?? []).flatMap((h) => h.pins).filter((p) => p.derived === 'm1').length
    expect(c.mounts?.[0]).toMatchObject({ id: 'm1', ref: refId })
    expect(c.mounts?.[0]?.footprint).toBe('xiao') // from the reference's footprint tag
    // Re-applying (e.g. re-sync) replaces, doesn't duplicate.
    c = applyImprint(c, xiao, refId, { id: 'm1', x: 0.5, y: 0.5 })
    const n2 = (c.headers ?? []).flatMap((h) => h.pins).filter((p) => p.derived === 'm1').length
    expect(n2).toBe(n1)
    expect(c.mounts).toHaveLength(1)
  })

  it('removes the mount and its derived pins', () => {
    const c = removeMountImprint(applyImprint(blankCarrier(), xiao, refId, { id: 'm1', x: 0.5, y: 0.5 }), 'm1')
    expect(c.mounts ?? []).toHaveLength(0)
    expect((c.headers ?? []).flatMap((h) => h.pins).some((p) => p.derived === 'm1')).toBe(false)
  })

  it('rotateMount spins the block as a GROUP — the row/column grid rotates', () => {
    const c0 = applyImprint(blankCarrier(58, 42.5), xiao, refId, { id: 'm1', x: 0.5, y: 0.5 })
    // Count distinct levels (clusters) along an axis — the XIAO is 2 columns × 7 rows.
    const levels = (vals: number[], gap = 0.03): number => {
      let n = 0
      let prev = -Infinity
      for (const v of [...vals].sort((a, b) => a - b)) {
        if (v - prev > gap) n++
        prev = v
      }
      return n
    }
    const grid = (c: PartDefinition): { cols: number; rows: number } => {
      const ps = (c.headers ?? []).flatMap((h) => h.pins).filter((p) => p.derived === 'm1')
      return { cols: levels(ps.map((p) => p.x!)), rows: levels(ps.map((p) => p.y!)) }
    }
    expect(grid(c0)).toEqual({ cols: 2, rows: 7 })
    const c90 = rotateMount(c0, 'm1', 90)
    // A quarter turn rotates the whole grid: columns and rows swap.
    expect(grid(c90)).toEqual({ cols: 7, rows: 2 })
    expect(c90.mounts?.[0]?.rotation).toBe(90)
    // Four quarter-turns return to the original grid + rotation 0.
    const c360 = rotateMount(rotateMount(rotateMount(c90, 'm1', 90), 'm1', 90), 'm1', 90)
    expect(grid(c360)).toEqual({ cols: 2, rows: 7 })
    expect(c360.mounts?.[0]?.rotation).toBeUndefined()
  })

  it('translateMount shifts the mount + its pins rigidly (signature unchanged)', () => {
    const c0 = applyImprint(blankCarrier(), xiao, refId, { id: 'm1', x: 0.4, y: 0.4 })
    const c1 = translateMount(c0, 'm1', 0.1, -0.05)
    expect(c1.mounts?.[0]).toMatchObject({ x: 0.5 })
    expect(c1.mounts?.[0]?.y).toBeCloseTo(0.35, 5)
    // A rigid shift can't change the structural signature.
    expect(mountSignature(c1, 'm1')).toBe(mountSignature(c0, 'm1'))
  })
})
