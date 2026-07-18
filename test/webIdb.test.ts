import { describe, it, expect } from 'vitest'
import { loadFolderHandle, saveFolderHandle, clearFolderHandle } from '../src/renderer/src/web/web-idb'

/**
 * The IndexedDB folder-handle slot (#476) must degrade gracefully where IDB is
 * unavailable (private mode, blocked storage, or — as here — a plain node test
 * env with no `indexedDB` global): reads resolve to null and writes resolve
 * without throwing, so persistence is simply skipped rather than crashing boot.
 */
describe('web-idb graceful fallback (no IndexedDB)', () => {
  it('load resolves to null when IndexedDB is unavailable', async () => {
    expect(await loadFolderHandle()).toBeNull()
  })
  it('save resolves (no-op) rather than throwing', async () => {
    await expect(saveFolderHandle({ any: 'handle' })).resolves.toBeUndefined()
  })
  it('clear resolves (no-op) rather than throwing', async () => {
    await expect(clearFolderHandle()).resolves.toBeUndefined()
  })
})
