import { describe, it, expect } from 'vitest'
import { collectFootprints, slugifyFootprint, COMMON_FOOTPRINTS } from '../src/shared/footprints'
import type { PartLibraryWithParts } from '../src/shared/part'

describe('slugifyFootprint', () => {
  it('lower-cases, trims and hyphenates so equivalent spellings converge', () => {
    expect(slugifyFootprint('XIAO')).toBe('xiao')
    expect(slugifyFootprint('  Xiao ')).toBe('xiao')
    expect(slugifyFootprint('Nano ESP32')).toBe('nano-esp32')
    expect(slugifyFootprint('pico__w')).toBe('pico-w')
  })
  it('returns empty for a value that slugs to nothing', () => {
    expect(slugifyFootprint('   ')).toBe('')
    expect(slugifyFootprint('!!!')).toBe('')
  })
})

const lib = (parts: PartLibraryWithParts['parts']): PartLibraryWithParts =>
  ({ id: 'l', name: 'L', parts }) as PartLibraryWithParts

describe('collectFootprints', () => {
  it('always offers the curated standards even with no installed parts', () => {
    const out = collectFootprints([])
    expect(out.every((f) => f.common)).toBe(true)
    expect(out.map((f) => f.id).sort()).toEqual(COMMON_FOOTPRINTS.map((c) => c.id).sort())
    expect(out.every((f) => f.count === 0)).toBe(true)
  })

  it('counts footprints from both parts and carrier mounts', () => {
    const libs = [
      lib([
        { id: 'a', footprint: 'xiao' } as never,
        { id: 'b', footprint: 'XIAO' } as never, // slug-collapses onto xiao
        { id: 'base', mounts: [{ id: 'm', footprint: 'xiao', x: 0.5, y: 0.5 }] } as never
      ])
    ]
    const xiao = collectFootprints(libs).find((f) => f.id === 'xiao')
    expect(xiao?.count).toBe(3)
  })

  it('surfaces an uncurated in-use footprint (labelled by its id) and sorts most-used first', () => {
    const libs = [
      lib([
        { id: 'a', footprint: 'my-shield' } as never,
        { id: 'b', footprint: 'my-shield' } as never
      ])
    ]
    const out = collectFootprints(libs)
    const custom = out.find((f) => f.id === 'my-shield')
    expect(custom).toMatchObject({ id: 'my-shield', label: 'my-shield', count: 2, common: false })
    // A count-2 custom footprint outranks the count-0 curated standards.
    expect(out[0].id).toBe('my-shield')
  })
})
