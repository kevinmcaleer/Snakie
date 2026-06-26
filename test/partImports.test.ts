import { describe, it, expect } from 'vitest'
import {
  parsePyImports,
  requiredPartModules,
  missingImports,
  missingOnBoard
} from '../src/renderer/src/components/part-imports'
import type { RobotDefinition } from '../src/shared/robot'
import type { PartDefinition } from '../src/shared/part'

describe('parsePyImports', () => {
  it('extracts top-level module names from import / from forms', () => {
    const src = [
      'import machine',
      'import time, ujson as j',
      'from vl53l0x import VL53L0X',
      'from a.b.c import d',
      'from . import sibling', // relative → skipped
      '  import indented',
      '# import commented'
    ].join('\n')
    const mods = parsePyImports(src)
    expect([...mods].sort()).toEqual(['a', 'indented', 'machine', 'time', 'ujson', 'vl53l0x'])
    expect(mods.has('sibling')).toBe(false) // relative import dropped
  })
})

describe('requiredPartModules', () => {
  const libs = [
    {
      id: 'my-parts',
      parts: [
        { id: 'tof', name: 'VL53L0X', headers: [], library: { module: 'vl53l0x', url: 'github:x/vl53l0x', docs: 'https://d' } } as PartDefinition,
        { id: 'nolib', name: 'Resistor', headers: [] } as PartDefinition
      ]
    }
  ]
  const robot = (): RobotDefinition => ({
    board: 'pico2w',
    parts: [
      { id: 'p1', lib: 'my-parts', part: 'tof', label: 'distance', x: 0, y: 0 },
      { id: 'p2', lib: 'my-parts', part: 'tof', label: 'distance2', x: 0, y: 0 },
      { id: 'p3', lib: 'my-parts', part: 'nolib', x: 0, y: 0 }
    ],
    connections: []
  } as unknown as RobotDefinition)

  it('collects linked modules, deduped, with the using parts + url/docs', () => {
    const req = requiredPartModules(robot(), libs)
    expect(req).toHaveLength(1)
    expect(req[0].module).toBe('vl53l0x')
    expect(req[0].url).toBe('github:x/vl53l0x')
    expect(req[0].parts).toEqual(['distance', 'distance2']) // both refs, one module
  })

  it('ignores parts with no linked library', () => {
    const req = requiredPartModules(
      { board: 'b', parts: [{ id: 'p', lib: 'my-parts', part: 'nolib', x: 0, y: 0 }], connections: [] } as unknown as RobotDefinition,
      libs
    )
    expect(req).toEqual([])
  })
})

describe('missingImports / missingOnBoard', () => {
  const req = [
    { module: 'vl53l0x', parts: ['distance'] },
    { module: 'bmp280', parts: ['pressure'] }
  ]
  it('flags required modules not imported by the file', () => {
    const m = missingImports(req, 'import machine\nfrom vl53l0x import VL53L0X\n')
    expect(m.map((r) => r.module)).toEqual(['bmp280'])
  })
  it('flags required modules not present on the board', () => {
    const m = missingOnBoard(req, new Set(['vl53l0x']))
    expect(m.map((r) => r.module)).toEqual(['bmp280'])
  })
})
