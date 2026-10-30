import { describe, expect, it } from 'vitest'
import { createEmbedPartsApi, dataUrlToBlob, installPartsBackend } from '../src/renderer/src/embed/parts-backend'
import type { PartDefinition, PartLibraryWithParts } from '../src/shared/part'

// snakie#1277: the embedded components reach the host's parts through
// window.api.parts.
const lib: PartLibraryWithParts = { id: 'host', name: 'Host', parts: [{ id: 'pico', name: 'Pico' } as PartDefinition] }

describe('embed parts backend', () => {
  it('lists and saves through the host', async () => {
    const saved: string[] = []
    const api = createEmbedPartsApi({
      listLibraries: async () => [lib],
      savePart: async (libraryId, part) => {
        saved.push(`${libraryId}/${part.id}`)
        return { ok: true, id: part.id, libraryId }
      }
    }) as Record<string, (...a: unknown[]) => Promise<unknown>>
    expect(await api.listLibraries()).toEqual([lib])
    expect(await api.savePart('host', { id: 'servo', name: 'Servo' })).toEqual({ ok: true, id: 'servo', libraryId: 'host' })
    expect(saved).toEqual(['host/servo'])
    expect(await api.listPartFiles('host', 'pico')).toEqual([])
    expect(await api.partsFolder()).toBe('')
    // Desktop-only: absent, so the Part Editor says "needs the desktop app".
    expect(api.importMesh).toBeUndefined()
  })

  it('turns a host error into a failed write, not a rejection', async () => {
    const api = createEmbedPartsApi({
      listLibraries: async () => [],
      savePart: async () => {
        throw new Error('403 too new')
      }
    }) as Record<string, (...a: unknown[]) => Promise<unknown>>
    expect(await api.savePart('host', { id: 'x', name: 'X' })).toEqual({ ok: false, error: '403 too new' })
  })

  it('installs onto a window-like target', async () => {
    const target: { api?: Record<string, unknown> } = { api: { device: {} } }
    installPartsBackend({ listLibraries: async () => [lib], savePart: async () => ({ ok: true }) }, target)
    expect(target.api?.device).toEqual({})
    expect(await (target.api?.parts as { listLibraries: () => Promise<unknown> }).listLibraries()).toEqual([lib])
  })

  it('reads data URLs into blobs', async () => {
    const blob = dataUrlToBlob('data:image/png;base64,iVBORw0K')
    expect(blob?.type).toBe('image/png')
    expect(blob?.size).toBe(6)
    expect(await dataUrlToBlob('data:text/plain,hi%20there')?.text()).toBe('hi there')
    expect(dataUrlToBlob('https://example.com/a.png')).toBeNull()
    expect(dataUrlToBlob(undefined)).toBeNull()
  })
})
