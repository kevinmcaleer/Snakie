import { describe, it, expect } from 'vitest'
import { HELP_SECTIONS, detectProjectParts, type HelpNode } from '../src/renderer/src/components/help-content'
import { HELP_ARTICLES } from '../src/renderer/src/components/help-articles'
import { INSTRUMENTS } from '../src/renderer/src/components/instruments-registry'
import type { PartLibraryWithParts } from '../src/preload/index.d'

const find = (nodes: HelpNode[], id: string): HelpNode | undefined => {
  for (const n of nodes) {
    if (n.id === id) return n
    const f = n.children ? find(n.children, id) : undefined
    if (f) return f
  }
  return undefined
}

describe('help tree', () => {
  it('has an article per registered instrument, and each has authored content', () => {
    const instruments = find(HELP_SECTIONS, 'instruments')!
    expect(instruments.children).toHaveLength(INSTRUMENTS.length)
    for (const d of INSTRUMENTS) {
      const node = find(HELP_SECTIONS, `inst-${d.id}`)
      expect(node, `article for ${d.id}`).toBeTruthy()
      expect((HELP_ARTICLES[`inst-${d.id}`] ?? '').length, `content for inst-${d.id}`).toBeGreaterThan(20)
    }
  })

  it('has Getting Started + Reference (Language/Buses/Pinouts) with content', () => {
    for (const id of ['getting-started', 'reference', 'ref-language', 'ref-buses', 'ref-pinouts']) {
      expect(find(HELP_SECTIONS, id), id).toBeTruthy()
    }
    for (const id of ['gs-connect', 'ref-i2c', 'ref-pwm', 'ref-pinout']) {
      expect((HELP_ARTICLES[id] ?? '').length, id).toBeGreaterThan(20)
    }
  })
})

const libs = (parts: object[]): PartLibraryWithParts[] =>
  [{ id: 'l', name: 'L', parts } as unknown as PartLibraryWithParts]

describe('detectProjectParts (In This Project)', () => {
  const sg90 = { id: 'sg90', name: 'SG90 Servo', library: { module: 'servo' }, helpText: '# SG90', headers: [] }
  const vl = { id: 'vl53l0x', name: 'VL53L0X', helpText: '# ToF', headers: [] }

  it('surfaces a part when the file imports its module', () => {
    const out = detectProjectParts('from servo import Servo\ns = Servo(16)', libs([sg90, vl]))
    expect(out.map((p) => p.part.id)).toEqual(['sg90'])
    expect(out[0].live).toBe(true)
    expect(out[0].articleId).toBe('part-sg90')
    expect(out[0].atCursor).toBe(false)
  })

  it('matches by part id too (import vl53l0x)', () => {
    const out = detectProjectParts('import vl53l0x', libs([sg90, vl]))
    expect(out.map((p) => p.part.id)).toEqual(['vl53l0x'])
  })

  it('tags the part whose declaration line the caret is on', () => {
    const out = detectProjectParts('from servo import Servo', libs([sg90]), 'from servo import Servo')
    expect(out[0].atCursor).toBe(true)
  })

  it('returns nothing when no known part is imported', () => {
    expect(detectProjectParts('print("hi")', libs([sg90, vl]))).toEqual([])
    expect(detectProjectParts('', libs([sg90]))).toEqual([])
  })
})
