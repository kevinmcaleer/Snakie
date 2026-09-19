import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { partFromYaml } from '../src/shared/part-yaml'
import { buildNetlist, flattenPartPins } from '../src/shared/netlist'
import type { RobotDefinition } from '../src/shared/robot'

/**
 * The bundled 400-point breadboard: its 400 tie points are wired internally like
 * the real thing via `rails` (#695) — each row's a–e and f–j are two 5-way nets,
 * and each power rail is one 25-way net.
 */
const DIR = join(__dirname, '..', 'examples', 'parts', 'snakie-standard', 'breadboard-400')
const part = partFromYaml(readFileSync(join(DIR, 'parts.yml'), 'utf8'))
const pins = flattenPartPins(part)
const defs = new Map([['bb', part]])

/** Endpoint for a tie point by its name (`a1`, `L+3`). */
const ep = (name: string): string => {
  const i = pins.findIndex((p) => p.name === name)
  expect(i, name).toBeGreaterThanOrEqual(0)
  return `bb.${name}#${i}`
}

const robot: RobotDefinition = {
  parts: [{ id: 'bb', lib: 'snakie-standard', part: 'breadboard-400' }],
  connections: []
}
const nl = buildNetlist(robot, null, defs)
const sameNet = (a: string, b: string): boolean => nl.nodeOf[ep(a)] === nl.nodeOf[ep(b)]

describe('breadboard-400 part', () => {
  it('has 400 uniquely named tie points, all label-less square holes', () => {
    expect(pins).toHaveLength(400)
    expect(new Set(pins.map((p) => p.name)).size).toBe(400)
    for (const p of pins) {
      expect(p.type).toBe('other')
      expect(p.labelHidden).toBe(true)
      expect(p.x).toBeGreaterThan(0)
      expect(p.x).toBeLessThan(1)
      expect(p.y).toBeGreaterThan(0)
      expect(p.y).toBeLessThan(1)
    }
  })

  it('declares 64 rails: 60 row halves + 4 power rails, every pin named once', () => {
    const rails = part.rails ?? []
    expect(rails).toHaveLength(64)
    const railed = rails.flatMap((r) => r.pins)
    expect(railed).toHaveLength(400)
    expect(new Set(railed).size).toBe(400)
    expect(rails.filter((r) => r.pins.length === 25)).toHaveLength(4)
    expect(rails.filter((r) => r.pins.length === 5)).toHaveLength(60)
  })

  it('joins a–e and f–j within a row, but not across the channel or between rows', () => {
    expect(sameNet('a1', 'e1')).toBe(true)
    expect(sameNet('b7', 'c7')).toBe(true)
    expect(sameNet('f30', 'j30')).toBe(true)
    expect(sameNet('e1', 'f1')).toBe(false)
    expect(sameNet('a1', 'a2')).toBe(false)
    expect(sameNet('j29', 'j30')).toBe(false)
  })

  it('runs each power rail the full length, keeping + / − and left / right apart', () => {
    expect(sameNet('L+1', 'L+25')).toBe(true)
    expect(sameNet('R-1', 'R-25')).toBe(true)
    expect(sameNet('L+1', 'L-1')).toBe(false)
    expect(sameNet('L+1', 'R+1')).toBe(false)
    expect(sameNet('L-5', 'a5')).toBe(false)
  })

  it('bundles its image, mini-help and 3-D model', () => {
    expect(part.image).toBe('image.png')
    expect(part.help).toBe('help.md')
    expect(part.mesh).toBe('model.stl')
    expect(part.meshUnits).toBe('mm')
    for (const f of ['image.png', 'help.md', 'model.stl']) expect(existsSync(join(DIR, f)), f).toBe(true)
  })
})
