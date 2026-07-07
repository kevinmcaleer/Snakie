import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeDirectoryHandle } from './helpers/fakeOpfs'

vi.mock('../src/renderer/src/web/fs/idb', () => ({
  idbGet: vi.fn(async () => undefined),
  idbSet: vi.fn(async () => undefined),
  idbDelete: vi.fn(async () => undefined)
}))

async function freshWebApi(): Promise<typeof import('../src/renderer/src/web/webApi')> {
  vi.resetModules()
  return import('../src/renderer/src/web/webApi')
}

describe('createWebApi', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', { storage: { getDirectory: async () => new FakeDirectoryHandle('') } })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('wires the injected device, real fs/robot, and keeps everything else inert', async () => {
    const { createWebApi } = await freshWebApi()
    const fakeDevice = { getStatus: vi.fn() } as unknown as Awaited<
      ReturnType<typeof createWebApi>
    >['device']
    const api = createWebApi(fakeDevice)

    expect(api.device).toBe(fakeDevice)
    // fs/robot come from the OPFS layer (real objects, not inert stubs).
    await expect(api.fs.openFolderDialog()).resolves.toBe('/project')
    await expect(api.robot.load()).resolves.toEqual({ parts: [], connections: [] })
    // Explicitly-inert namespaces are untouched.
    await expect(api.git.status()).resolves.toMatchObject({ isRepo: false })
    await expect(api.plugins.status()).resolves.toMatchObject({ pythonFound: false })
  })

  it('ping()/diagnostics() report web-specific values', async () => {
    const { createWebApi } = await freshWebApi()
    const fakeDevice = {} as unknown as Awaited<ReturnType<typeof createWebApi>>['device']
    const api = createWebApi(fakeDevice)

    await expect(api.ping()).resolves.toBe('pong (web)')
    const diag = await api.diagnostics()
    expect(diag.electron).toBe('n/a (web)')
  })
})
