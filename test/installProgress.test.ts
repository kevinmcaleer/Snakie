import { describe, it, expect, beforeEach } from 'vitest'
import {
  installPlanMessage,
  installStepLabel,
  installStepLabels,
  packageDisplayName,
  type InstallFileProgress
} from '../src/shared/install-file-progress'
import { installStepReporter } from '../src/renderer/src/lib/install-steps'
import {
  enqueueDeviceTask,
  getDeviceQueueSnapshot,
  queueProgress,
  queueRows,
  resetDeviceQueueForTest,
  type DeviceStepState,
  type DeviceTaskContext
} from '../src/renderer/src/lib/device-queue'
import { writeFilesToDevice, type InstallFile } from '../src/renderer/src/web/web-install'

/**
 * AN INSTALL HAS TO LOOK LIKE IT IS MOVING (#895).
 *
 * The bug these pin: a library install was enqueued as ONE device-queue task
 * whose `run` never touched `ctx.setSteps`, so the Arduino Modulino package —
 * 22 files plus three dependency packages, minutes over the raw REPL — showed a
 * single motionless row for the whole install. It reads as a hang, and the
 * documented response to a hang is Disconnect, which mid-write is exactly what
 * #864 exists to stop being destructive.
 *
 * So the property under test is the one the user sees: after the plan resolves,
 * the queue knows how many files there are, ticks them off one at a time, and
 * names the dependency that brought each file it did not obviously ask for.
 *
 * The last test drives the REAL writer into the REAL queue over a fake board,
 * so it fails if either end of the chain stops reporting — not only if the
 * label helpers regress.
 */

/** A `DeviceTaskContext` that records what it was told. */
function fakeContext(): DeviceTaskContext & {
  labels: string[]
  moves: [number, DeviceStepState][]
} {
  const labels: string[] = []
  const moves: [number, DeviceStepState][] = []
  return {
    labels,
    moves,
    cancelled: false,
    setSteps(next): void {
      labels.length = 0
      labels.push(...next)
    },
    step(index, state): void {
      moves.push([index, state])
    }
  }
}

/** A board that records its writes, and can be made to pause on one of them. */
function fakeDevice(pauseOn?: string): {
  writes: string[]
  release: () => void
  mkdir(p: string): Promise<void>
  writeFile(p: string, c: string): Promise<void>
} {
  const writes: string[] = []
  let release = (): void => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  return {
    writes,
    release: () => release(),
    mkdir: async () => {},
    writeFile: async (p) => {
      if (p === pauseOn) await held
      writes.push(p)
    }
  }
}

/** Let every pending microtask + timer callback run. */
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

/** Spin the loop until `ready`, so a test never counts the queue's awaits. */
async function settle(ready: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !ready(); i++) await tick()
}

beforeEach(() => resetDeviceQueueForTest())

describe('a file becomes a row the user can watch (#895)', () => {
  it('drops the `/lib/` every library shares, and keeps a path that is not in it', () => {
    // Twenty-two rows all starting with the same five characters spend the
    // width that tells them apart; a path outside /lib IS the information.
    expect(installStepLabel('/lib/modulino/__init__.py')).toBe('modulino/__init__.py')
    expect(installStepLabel('/instruments.py')).toBe('/instruments.py')
  })

  it('names the dependency that brought a file the user never asked for', () => {
    const labels = installStepLabels([
      { path: '/lib/modulino/__init__.py' },
      { path: '/lib/modulino/movement.py' },
      { path: '/lib/lsm6dsox.py', dependency: 'lsm6dsox' },
      { path: '/lib/micropython_hs3003.py', dependency: 'HS3003' }
    ])
    expect(labels).toEqual([
      'modulino/__init__.py',
      'modulino/movement.py',
      'lsm6dsox — lsm6dsox.py',
      'HS3003 — micropython_hs3003.py'
    ])
  })
})

describe('a package spec, shortened to something worth listing (#895)', () => {
  it('keeps the tail that identifies it and drops what every sibling shares', () => {
    expect(packageDisplayName('github:arduino/arduino-modulino-mpy')).toBe(
      'arduino-modulino-mpy'
    )
    expect(packageDisplayName('lsm6dsox')).toBe('lsm6dsox')
    expect(
      packageDisplayName(
        'github:micropython/micropython-lib/micropython/drivers/storage/sdcard/sdcard.py'
      )
    ).toBe('sdcard')
    expect(packageDisplayName('https://example.com/drivers/thing.mpy')).toBe('thing')
  })

  it('falls back to the spec rather than showing nothing', () => {
    expect(packageDisplayName('github:')).toBe('github:')
  })
})

describe('the sentence that announces the write leg (#895)', () => {
  it('counts the dependency packages, because that is why it is slow', () => {
    expect(installPlanMessage([{ path: '/lib/vl53l0x.py' }])).toBe('Writing 1 file…')
    expect(
      installPlanMessage([
        { path: '/lib/modulino/__init__.py' },
        { path: '/lib/lsm6dsox.py', dependency: 'lsm6dsox' },
        { path: '/lib/ltr381rgb.py', dependency: 'ltr-381rgb-01' }
      ])
    ).toBe('Writing 3 files, including 2 dependency packages…')
  })

  it('says "package" when there is one of them', () => {
    expect(
      installPlanMessage([
        { path: '/lib/modulino/__init__.py' },
        { path: '/lib/lsm6dsox.py', dependency: 'lsm6dsox' }
      ])
    ).toBe('Writing 2 files, including 1 dependency package…')
  })
})

describe('install progress becomes the queue task’s steps (#895)', () => {
  it('declares the whole list before the first file moves', () => {
    const ctx = fakeContext()
    const report = installStepReporter(ctx)
    report({
      files: [{ path: '/lib/a.py' }, { path: '/lib/b.py', dependency: 'bee' }]
    })
    expect(ctx.labels).toEqual(['a.py', 'bee — b.py'])
    expect(ctx.moves).toEqual([])
  })

  it('moves the step the event names', () => {
    const ctx = fakeContext()
    const report = installStepReporter(ctx)
    report({ files: [{ path: '/lib/a.py' }, { path: '/lib/b.py' }] })
    report({ fileIndex: 0, fileState: 'running' })
    report({ fileIndex: 0, fileState: 'done' })
    report({ fileIndex: 1, fileState: 'error' })
    expect(ctx.moves).toEqual([
      [0, 'running'],
      [0, 'done'],
      [1, 'error']
    ])
  })

  it('still hands every event to the caller, whose install log needs the notes', () => {
    // The panels collect `note` messages for their install log. Taking the
    // queue's reporting must not cost them that.
    const ctx = fakeContext()
    const seen: string[] = []
    const report = installStepReporter<InstallFileProgress & { message?: string }>(
      ctx,
      (event) => {
        if (event.message) seen.push(event.message)
      }
    )
    report({ message: 'Downloaded modulino with its dependencies lsm6dsox…' })
    report({ files: [{ path: '/lib/a.py' }] })
    report({ message: 'Writing 1 file…', fileIndex: 0, fileState: 'running' })
    expect(seen).toEqual([
      'Downloaded modulino with its dependencies lsm6dsox…',
      'Writing 1 file…'
    ])
    expect(ctx.labels).toEqual(['a.py'])
  })

  it('ignores an event that is about no file at all', () => {
    const ctx = fakeContext()
    const report = installStepReporter(ctx)
    report({ files: [{ path: '/lib/a.py' }] })
    report({ fileIndex: 0 })
    report({ fileState: 'done' })
    expect(ctx.moves).toEqual([])
  })
})

describe('the whole chain: a real install into the real queue (#895)', () => {
  /** A plan shaped like the reported one — a package plus a dependency. */
  const plan: InstallFile[] = [
    { path: '/lib/modulino/__init__.py', contents: 'a' },
    { path: '/lib/modulino/movement.py', contents: 'b' },
    { path: '/lib/lsm6dsox.py', contents: 'c', dependency: 'lsm6dsox' }
  ]

  it('shows one row per file, ticking off as the board takes them', async () => {
    const device = fakeDevice('/lib/lsm6dsox.py')
    const done = enqueueDeviceTask({
      key: 'module:modulino',
      label: 'Installing Arduino Modulino',
      run: (ctx) => {
        // Exactly what the two install backends do with the writer's `onStep`:
        // fold the structured detail into the progress event they already emit.
        const report = installStepReporter<InstallFileProgress>(ctx)
        return writeFilesToDevice('modulino', plan, device, (_message, detail) =>
          report({ ...detail })
        )
      }
    })
    await settle(() => device.writes.length === 2)

    // Held on the last file: the queue knows there are three, and that two are
    // finished. Before this, the whole install was a single motionless row.
    const midway = getDeviceQueueSnapshot().tasks
    expect(queueProgress(midway)).toEqual({ done: 2, total: 3 })
    expect(queueRows(midway).map((r) => r.label)).toEqual([
      'Installing Arduino Modulino',
      'modulino/__init__.py',
      'modulino/movement.py',
      'lsm6dsox — lsm6dsox.py'
    ])
    expect(queueRows(midway).map((r) => r.state)).toEqual([
      'copying',
      'done',
      'done',
      'copying'
    ])

    device.release()
    const outcome = await done
    expect(outcome.ok).toBe(true)
    await settle(() => !getDeviceQueueSnapshot().busy)
    expect(queueProgress(getDeviceQueueSnapshot().tasks)).toEqual({ done: 3, total: 3 })
  })
})
