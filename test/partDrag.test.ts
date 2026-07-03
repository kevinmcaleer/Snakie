import { describe, it, expect } from 'vitest'
import { PART_DRAG_MIME, encodePartDrag, decodePartDrag } from '../src/renderer/src/components/part-drag'

/** A minimal DataTransfer stand-in — jsdom doesn't provide one, and the codec only
 *  touches setData/getData/types/effectAllowed. */
function fakeDataTransfer(): DataTransfer {
  const store = new Map<string, string>()
  return {
    effectAllowed: 'none',
    dropEffect: 'none',
    get types(): string[] {
      return Array.from(store.keys())
    },
    setData(type: string, data: string): void {
      store.set(type, data)
    },
    getData(type: string): string {
      return store.get(type) ?? ''
    }
  } as unknown as DataTransfer
}

describe('part-drag codec', () => {
  it('round-trips a library + part id through a DataTransfer', () => {
    const dt = fakeDataTransfer()
    encodePartDrag(dt, { libraryId: 'snakie-standard', partId: 'sg90' })
    expect(dt.types).toContain(PART_DRAG_MIME)
    expect(dt.effectAllowed).toBe('copy')
    expect(decodePartDrag(dt)).toEqual({ libraryId: 'snakie-standard', partId: 'sg90' })
  })

  it('returns null when the transfer carries no part payload', () => {
    const dt = fakeDataTransfer()
    expect(decodePartDrag(dt)).toBeNull()
    dt.setData('text/plain', 'hello')
    expect(decodePartDrag(dt)).toBeNull()
  })

  it('returns null for a malformed or incomplete payload', () => {
    const dt = fakeDataTransfer()
    dt.setData(PART_DRAG_MIME, '{ not json')
    expect(decodePartDrag(dt)).toBeNull()
    dt.setData(PART_DRAG_MIME, JSON.stringify({ libraryId: 'x' }))
    expect(decodePartDrag(dt)).toBeNull()
  })
})
