import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeDirectoryHandle } from './helpers/fakeOpfs'
import { blankRobot } from '../src/shared/robot'

vi.mock('../src/renderer/src/web/fs/idb', () => ({
  idbGet: vi.fn(async () => undefined),
  idbSet: vi.fn(async () => undefined),
  idbDelete: vi.fn(async () => undefined)
}))

async function freshOpfsRobot(): Promise<typeof import('../src/renderer/src/web/fs/opfsRobot')> {
  vi.resetModules()
  return import('../src/renderer/src/web/fs/opfsRobot')
}

describe('opfsRobot', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', { storage: { getDirectory: async () => new FakeDirectoryHandle('') } })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('load() returns a blank robot definition when robot.yml does not exist yet', async () => {
    const { createOpfsRobot } = await freshOpfsRobot()
    const robot = createOpfsRobot()
    await expect(robot.load()).resolves.toEqual(blankRobot())
  })

  it('save() then load() round-trips a robot definition', async () => {
    const { createOpfsRobot } = await freshOpfsRobot()
    const robot = createOpfsRobot()
    const def = {
      ...blankRobot(),
      parts: [{ id: 'p1', lib: 'core', part: 'led', x: 0, y: 0 }]
    }
    const result = await robot.save(undefined, def)
    expect(result.ok).toBe(true)
    const loaded = await robot.load()
    expect(loaded.parts).toEqual(def.parts)
  })

  it('save() notifies onChanged subscribers', async () => {
    const { createOpfsRobot } = await freshOpfsRobot()
    const robot = createOpfsRobot()
    const cb = vi.fn()
    const unsubscribe = robot.onChanged(cb)
    await robot.save(undefined, blankRobot())
    expect(cb).toHaveBeenCalledTimes(1)
    unsubscribe()
    await robot.save(undefined, blankRobot())
    expect(cb).toHaveBeenCalledTimes(1)
  })
})
