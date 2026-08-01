import { describe, it, expect } from 'vitest'
import {
  faceImageData,
  faceImageLayer,
  withFaceImageLayer
} from '../src/renderer/src/components/part-editor.util'
import type { PartDefinition } from '../src/shared/part'

/**
 * Front and rear photos have SEPARATE placement (#687).
 *
 * Reported as: adding a rear image gave it the front board's aspect, and adjusting
 * the rear moved the front. Every image control — drag, resize, lock-aspect, the
 * background eraser — wrote `part.imageLayer` whichever face was on screen.
 */
const PART = {
  id: 'p',
  name: 'P',
  headers: [],
  imageData: 'data:image/png;base64,FRONT',
  imageLayer: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
  rear: {
    image: 'rear.webp',
    imageData: 'data:image/png;base64,REAR',
    imageLayer: { x: 0, y: 0, w: 1, h: 1 }
  }
} as unknown as PartDefinition

describe('faceImageLayer / faceImageData (#687)', () => {
  it('reads each face its own layer and photo', () => {
    expect(faceImageLayer(PART, 'front')).toEqual({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 })
    expect(faceImageLayer(PART, 'rear')).toEqual({ x: 0, y: 0, w: 1, h: 1 })
    expect(faceImageData(PART, 'front')).toContain('FRONT')
    expect(faceImageData(PART, 'rear')).toContain('REAR')
  })

  it('falls back to the full board box when a face has no layer yet', () => {
    const bare = { ...PART, rear: { image: 'rear.webp' } } as unknown as PartDefinition
    expect(faceImageLayer(bare, 'rear')).toEqual({ x: 0, y: 0, w: 1, h: 1 })
  })
})

describe('withFaceImageLayer (#687)', () => {
  it('editing the REAR leaves the front untouched', () => {
    const patch = withFaceImageLayer(PART, 'rear', { w: 0.5 })
    expect(patch.rear?.imageLayer).toEqual({ x: 0, y: 0, w: 0.5, h: 1 })
    expect(patch.imageLayer).toBeUndefined() // the reported bug
  })

  it('editing the FRONT leaves the rear untouched', () => {
    const patch = withFaceImageLayer(PART, 'front', { w: 0.5 })
    expect(patch.imageLayer).toEqual({ x: 0.1, y: 0.1, w: 0.5, h: 0.8 })
    expect(patch.rear).toBeUndefined()
  })

  it('keeps the rest of the rear block — its filename and inlined data', () => {
    const patch = withFaceImageLayer(PART, 'rear', { x: 0.2 })
    expect(patch.rear?.image).toBe('rear.webp')
    expect(patch.rear?.imageData).toContain('REAR')
  })

  it('creates the rear block when the part has none', () => {
    const bare = { id: 'p', name: 'P', headers: [] } as unknown as PartDefinition
    expect(withFaceImageLayer(bare, 'rear', { w: 0.4 }).rear?.imageLayer).toEqual({
      x: 0,
      y: 0,
      w: 0.4,
      h: 1
    })
  })

  it('is pure — the source part is never mutated', () => {
    const before = JSON.stringify(PART)
    withFaceImageLayer(PART, 'rear', { w: 0.3 })
    withFaceImageLayer(PART, 'front', { w: 0.3 })
    expect(JSON.stringify(PART)).toBe(before)
  })
})
