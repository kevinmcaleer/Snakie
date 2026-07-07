import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeDirectoryHandle } from './helpers/fakeOpfs'

/**
 * `handleResolver.ts` caches its resolved root handle in a module-level
 * variable, so each test re-imports the module fresh (`vi.resetModules()`)
 * to avoid state leaking across tests, and mocks `./idb` so no real
 * IndexedDB is needed.
 */
vi.mock('../src/renderer/src/web/fs/idb', () => ({
  idbGet: vi.fn(async () => undefined),
  idbSet: vi.fn(async () => undefined),
  idbDelete: vi.fn(async () => undefined)
}))

async function freshResolver(): Promise<typeof import('../src/renderer/src/web/fs/handleResolver')> {
  vi.resetModules()
  return import('../src/renderer/src/web/fs/handleResolver')
}

describe('handleResolver', () => {
  let opfsRoot: FakeDirectoryHandle

  beforeEach(() => {
    opfsRoot = new FakeDirectoryHandle('')
    vi.stubGlobal('navigator', { storage: { getDirectory: async () => opfsRoot } })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolves the project root from OPFS by default, auto-creating it', async () => {
    const { getProjectRoot, PROJECT_ROOT } = await freshResolver()
    expect(PROJECT_ROOT).toBe('/project')
    const root = await getProjectRoot()
    expect((root as unknown as FakeDirectoryHandle).name).toBe('project')
    // Cached on the fake OPFS root so a second call resolves the SAME handle.
    expect(opfsRoot.children.get('project')).toBe(root)
  })

  it('caches the root across repeated getProjectRoot() calls', async () => {
    const { getProjectRoot } = await freshResolver()
    const first = await getProjectRoot()
    const second = await getProjectRoot()
    expect(first).toBe(second)
  })

  it('resolveDirHandle creates nested directories on demand', async () => {
    const { resolveDirHandle } = await freshResolver()
    const dir = await resolveDirHandle('/project/lib/nested', { create: true })
    expect((dir as unknown as FakeDirectoryHandle).name).toBe('nested')
  })

  it('resolveDirHandle without create throws for a missing directory', async () => {
    const { resolveDirHandle } = await freshResolver()
    await expect(resolveDirHandle('/project/missing')).rejects.toThrow()
  })

  it('resolveFileHandle creates parent directories and the file', async () => {
    const { resolveFileHandle } = await freshResolver()
    const file = await resolveFileHandle('/project/lib/main.py', { create: true })
    expect(file.name).toBe('main.py')
  })

  it('splitPath / toVirtualPath round-trip', async () => {
    const { splitPath, toVirtualPath, PROJECT_ROOT } = await freshResolver()
    expect(splitPath('/project/lib/main.py')).toEqual(['lib', 'main.py'])
    expect(splitPath(PROJECT_ROOT)).toEqual([])
    expect(toVirtualPath(['lib', 'main.py'])).toBe('/project/lib/main.py')
    expect(toVirtualPath([])).toBe(PROJECT_ROOT)
  })

  it('supportsDirectoryPicker() is false with no window.showDirectoryPicker', async () => {
    const { supportsDirectoryPicker } = await freshResolver()
    expect(supportsDirectoryPicker()).toBe(false)
  })

  it('pickProjectFolder() falls back to OPFS when the picker is unsupported', async () => {
    const { pickProjectFolder, PROJECT_ROOT } = await freshResolver()
    await expect(pickProjectFolder()).resolves.toBe(PROJECT_ROOT)
  })

  it('pickProjectFolder() uses showDirectoryPicker() when available', async () => {
    const picked = new FakeDirectoryHandle('my-real-folder')
    vi.stubGlobal('window', {
      showDirectoryPicker: vi.fn(async () => picked)
    })
    const { pickProjectFolder, getProjectRoot } = await freshResolver()
    const path = await pickProjectFolder()
    expect(path).toBe('/project')
    expect(await getProjectRoot()).toBe(picked)
  })

  it('pickProjectFolder() falls back to OPFS when the user cancels the picker', async () => {
    vi.stubGlobal('window', {
      showDirectoryPicker: vi.fn(async () => {
        throw new DOMException('cancelled', 'AbortError')
      })
    })
    const { pickProjectFolder, getProjectRoot, PROJECT_ROOT } = await freshResolver()
    await expect(pickProjectFolder()).resolves.toBe(PROJECT_ROOT)
    expect((await getProjectRoot()) as unknown as FakeDirectoryHandle).toBeInstanceOf(FakeDirectoryHandle)
  })
})
