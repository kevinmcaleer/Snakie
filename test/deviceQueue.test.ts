import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  DeviceOperationCancelled,
  cancelDeviceQueue,
  dismissDeviceQueue,
  enqueueDeviceTask,
  getDeviceQueueSnapshot,
  queueDialogAction,
  queueProgress,
  queueRows,
  queueTitle,
  resetDeviceQueueForTest,
  type DeviceTaskView
} from '../src/renderer/src/lib/device-queue'

/**
 * Device operations must QUEUE, not race (#837).
 *
 * The bug this pins: `withFsLock` (#850) made each file-write sequence atomic on
 * the wire, but nothing stopped two OPERATIONS being started at once. A freshly
 * connected board can show the instruments-library banner, the missing-library
 * banner, the Board View's driver banner and the Modules panel together —
 * accepting two of them started two installs that then took turns at the port,
 * each reporting progress over the other.
 *
 * Asserted by recording when each task's `run` STARTS, so the test states the
 * property (the second one does not begin until the first has finished) rather
 * than re-describing the implementation.
 */

/** A promise plus its settle functions — stands in for a slow board. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

/** Let every pending microtask + timer callback run. */
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

beforeEach(() => resetDeviceQueueForTest())

describe('the device queue runs one operation at a time (#837)', () => {
  it('holds the second task until the first has finished', async () => {
    const log: string[] = []
    const first = deferred<void>()
    const second = deferred<void>()

    const a = enqueueDeviceTask({
      key: 'a',
      label: 'Installing A',
      run: async () => {
        log.push('a:start')
        await first.promise
        log.push('a:end')
      }
    })
    const b = enqueueDeviceTask({
      key: 'b',
      label: 'Installing B',
      run: async () => {
        log.push('b:start')
        await second.promise
        log.push('b:end')
      }
    })

    await tick()
    // The whole point: B has not touched the board yet.
    expect(log).toEqual(['a:start'])
    expect(getDeviceQueueSnapshot().tasks.map((t) => t.state)).toEqual(['running', 'waiting'])
    expect(getDeviceQueueSnapshot().busy).toBe(true)

    first.resolve()
    await a
    await tick()
    expect(log).toEqual(['a:start', 'a:end', 'b:start'])

    second.resolve()
    await b
    await tick()
    expect(log).toEqual(['a:start', 'a:end', 'b:start', 'b:end'])
    expect(getDeviceQueueSnapshot().busy).toBe(false)
  })

  it('joins a task already queued under the same key instead of repeating it', async () => {
    // Two banners can offer the same driver; installing it twice is a round trip
    // nobody benefits from.
    let runs = 0
    const gate = deferred<string>()
    const run = (): Promise<string> => {
      runs++
      return gate.promise
    }

    const a = enqueueDeviceTask({ key: 'module:vl53l0x', label: 'Installing VL53L0X', run })
    const b = enqueueDeviceTask({ key: 'module:vl53l0x', label: 'Installing VL53L0X', run })
    await tick()

    expect(getDeviceQueueSnapshot().tasks).toHaveLength(1)
    gate.resolve('installed')
    expect(await a).toBe('installed')
    expect(await b).toBe('installed')
    expect(runs).toBe(1)
  })

  it('gives the caller back whatever the task returned, and whatever it threw', async () => {
    await expect(
      enqueueDeviceTask({ key: 'ok', label: 'ok', run: async () => 42 })
    ).resolves.toBe(42)
    await expect(
      enqueueDeviceTask({
        key: 'bad',
        label: 'bad',
        run: async () => {
          throw new Error('OSError: 28')
        }
      })
    ).rejects.toThrow('OSError: 28')
    // A failure stays on the list so the modal can show it.
    expect(getDeviceQueueSnapshot().error).toBe('OSError: 28')
    dismissDeviceQueue()
    expect(getDeviceQueueSnapshot().tasks).toHaveLength(0)
  })
})

describe('cancelling hands the app back even when the board is wedged', () => {
  it('releases the UI without waiting for a task that never returns', async () => {
    // A board that has stopped answering will not start answering because we
    // waited longer — so cancel detaches rather than joining the hang.
    const stuck = enqueueDeviceTask({
      key: 'stuck',
      label: 'Copying mylib → /lib',
      run: () => new Promise<void>(() => {})
    })
    let behindRan = false
    const behind = enqueueDeviceTask({
      key: 'behind',
      label: 'Installing VL53L0X',
      run: async () => {
        behindRan = true
      }
    })
    await tick()

    cancelDeviceQueue()

    const snap = getDeviceQueueSnapshot()
    expect(snap.tasks).toHaveLength(0)
    expect(snap.busy).toBe(false)
    await expect(stuck).rejects.toBeInstanceOf(DeviceOperationCancelled)
    await expect(behind).rejects.toBeInstanceOf(DeviceOperationCancelled)

    // The task that was still waiting never touched the board at all.
    await tick()
    expect(behindRan).toBe(false)
  })

  it('tells a cooperative task to stop', async () => {
    let sawCancel = false
    const started = deferred<void>()
    const task = enqueueDeviceTask({
      key: 'copy',
      label: 'Copying mylib → /lib',
      run: async (ctx) => {
        started.resolve()
        await tick()
        sawCancel = ctx.cancelled
      }
    })
    await started.promise
    cancelDeviceQueue()
    await expect(task).rejects.toBeInstanceOf(DeviceOperationCancelled)
    await tick()
    expect(sawCancel).toBe(true)
  })
})

// --- The view the modal renders ---------------------------------------------

function task(over: Partial<DeviceTaskView> = {}): DeviceTaskView {
  return { id: 1, key: 'k', label: 'Installing X', state: 'running', steps: [], ...over }
}

describe('what the modal is told', () => {
  it('lists a task’s own steps indented under it', () => {
    const rows = queueRows([
      task({
        id: 7,
        label: 'Copying mylib → /lib',
        steps: [
          { label: 'a.py', state: 'done' },
          { label: 'b.py', state: 'running' }
        ]
      })
    ])
    expect(rows.map((r) => [r.label, r.state, r.indent ?? false])).toEqual([
      ['Copying mylib → /lib', 'copying', false],
      ['a.py', 'done', true],
      ['b.py', 'copying', true]
    ])
    // Distinct keys: a step can share a name with the task above it.
    expect(new Set(rows.map((r) => r.id)).size).toBe(3)
  })

  it('reads a cancelled task as a failure, because that is what it is', () => {
    expect(queueRows([task({ state: 'cancelled' })])[0].state).toBe('error')
  })

  it('counts leaves, so a twelve-file copy is not thirteen things to do', () => {
    expect(
      queueProgress([
        task({
          id: 1,
          steps: [
            { label: 'a', state: 'done' },
            { label: 'b', state: 'done' },
            { label: 'c', state: 'pending' }
          ]
        }),
        task({ id: 2, state: 'waiting' })
      ])
    ).toEqual({ done: 2, total: 4 })
  })

  it('names a single operation, and counts several', () => {
    expect(queueTitle([task({ label: 'Installing VL53L0X' })])).toBe('Installing VL53L0X')
    expect(queueTitle([task({ id: 1 }), task({ id: 2 })])).toContain('2 operations')
  })
})

describe('when the modal should appear', () => {
  const snap = (
    over: Partial<ReturnType<typeof getDeviceQueueSnapshot>> = {}
  ): ReturnType<typeof getDeviceQueueSnapshot> => ({
    tasks: [task()],
    busy: true,
    error: null,
    minimised: false,
    ...over
  })

  it('stays away when there is nothing queued', () => {
    expect(queueDialogAction(snap({ tasks: [], busy: false }), false)).toBe('hide')
    expect(queueDialogAction(snap({ tasks: [], busy: false }), true)).toBe('hide')
  })

  it('arms a delay rather than flashing up for a one-file write', () => {
    expect(queueDialogAction(snap(), false)).toBe('arm')
  })

  it('stays up once it is up', () => {
    expect(queueDialogAction(snap(), true)).toBe('show')
  })

  it('surfaces a failure however quick it was', () => {
    // An error the user never saw is an error that did not happen, to them.
    expect(queueDialogAction(snap({ busy: false, error: 'OSError: 28' }), false)).toBe('show')
  })

  it('clears rows nobody ever saw, so they don’t front the NEXT operation', () => {
    expect(queueDialogAction(snap({ busy: false }), false)).toBe('clear')
  })
})

describe('the wiring holds the pieces together', () => {
  const read = (p: string): string => readFileSync(p, 'utf8')

  it('routes every device file operation through the queue', () => {
    const sites: [string, string][] = [
      // The two driver banners share this installer, so wrapping it here queues
      // both of them.
      ['src/renderer/src/components/driver-install.ts', 'enqueueDeviceTask'],
      ['src/renderer/src/components/ModulesPanel.tsx', 'enqueueDeviceTask'],
      ['src/renderer/src/components/PackagesPanel.tsx', 'enqueueDeviceTask'],
      ['src/renderer/src/components/PartsPanel.tsx', 'enqueueDeviceTask'],
      // The instruments-library banner + the missing-library banner's mip route.
      ['src/renderer/src/components/AppShell.tsx', 'enqueueDeviceTask'],
      ['src/renderer/src/components/UploadControls.tsx', 'enqueueDeviceTask']
    ]
    for (const [file, needle] of sites) expect(read(file), file).toContain(needle)
  })

  it('leaves no second progress dialog to contradict the first', () => {
    // Two dialogs on screen could say different things about one board.
    const src = read('src/renderer/src/components/UploadControls.tsx')
    expect(src).not.toContain('TransferProgressDialog')
  })

  it('mounts the busy modal in BOTH renderer entries', () => {
    // The popped-out Board View has its own queue — its driver banner installs
    // from over there — so it needs its own copy of the modal.
    for (const entry of ['src/renderer/src/App.tsx', 'src/renderer/src/board-main.tsx']) {
      expect(read(entry), entry).toContain('<DeviceQueueDialog />')
    }
  })

  it('stops a RUN of driver installs when the user cancels', () => {
    // A failed row does not stop the run — installing what can be installed is
    // useful. A cancel must: queueing the next driver behind the user's cancel
    // answers a different question from the one they asked.
    expect(read('src/renderer/src/components/driver-install.ts')).toContain(
      'cancelled: err instanceof DeviceOperationCancelled'
    )
    expect(read('src/renderer/src/components/DriverInstallBanner.tsx')).toContain(
      'if (!(await installOne(need, d))) return'
    )
  })

  it('keeps the folder copy’s per-file receipt (#848) as the task’s steps', () => {
    const src = read('src/renderer/src/components/UploadControls.tsx')
    expect(src).toContain('ctx.setSteps(plan.files.map((f) => f.label))')
    expect(src).toContain('() => ctx.cancelled')
  })
})
