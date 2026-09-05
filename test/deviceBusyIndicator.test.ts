import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  highestTaskId,
  stayHidden,
  type DeviceQueueSnapshot,
  type DeviceTaskView
} from '../src/renderer/src/lib/device-queue'
import { busySummary } from '../src/renderer/src/components/SyncIndicator'

/**
 * Saying that the board is busy, without holding the app hostage (#889).
 *
 * The queue (#837) put a modal up and kept it up: `dismissDeviceQueue` only
 * cleared FINISHED rows, so closing it during a five-minute folder copy did
 * nothing at all. The ask was to be able to step out of the way and carry on,
 * with the busy state still visible somewhere — and to be able to stop the
 * queue from there.
 *
 * The risk in "let them hide it" is obvious: hide it once and never hear about
 * the board again. These pin the two rules that stop that happening.
 */

const task = (id: number, state: DeviceTaskView['state'] = 'running'): DeviceTaskView => ({
  id,
  key: `k${id}`,
  label: `Task ${id}`,
  state,
  steps: []
})

const snap = (tasks: DeviceTaskView[], error: string | null = null): DeviceQueueSnapshot => ({
  tasks,
  busy: tasks.some((t) => t.state === 'running' || t.state === 'waiting'),
  error
})

describe('pushing the modal aside', () => {
  it('stays out of the way for the work that was pushed aside', () => {
    expect(stayHidden(snap([task(1), task(2)]), 2)).toBe(true)
  })

  it('comes back for work the user has not seen', () => {
    // They dismissed the folder copy they knew about. The driver install that
    // started afterwards is a different thing and has to announce itself.
    expect(stayHidden(snap([task(1), task(2), task(3)]), 2)).toBe(false)
  })

  it('comes back on a failure, always', () => {
    // An error nobody saw did not happen, as far as the user is concerned.
    expect(stayHidden(snap([task(1)], 'device is full'), 5)).toBe(false)
  })

  it('does nothing when the user never dismissed anything', () => {
    expect(stayHidden(snap([task(1)]), null)).toBe(false)
  })

  it('a dismissal covers everything queued at the time, not just the running one', () => {
    // Three queued, one running: dismissing means "all of this", or the modal
    // reappears the instant the second one starts.
    const tasks = [task(1), task(2, 'waiting'), task(3, 'waiting')]
    expect(highestTaskId(tasks)).toBe(3)
    expect(stayHidden(snap(tasks), highestTaskId(tasks))).toBe(true)
  })

  it('reads the highest id, not the last one added', () => {
    expect(highestTaskId([task(7), task(2), task(5)])).toBe(7)
    expect(highestTaskId([])).toBeNull()
  })
})

describe('what the status bar says while the board works', () => {
  it('counts the operations, with the singular right', () => {
    expect(busySummary(1)).toBe('Working on the board — 1 operation')
    expect(busySummary(3)).toBe('Working on the board — 3 operations')
  })
})

describe('the indicator', () => {
  const src = readFileSync('src/renderer/src/components/SyncIndicator.tsx', 'utf8')

  it('appears while the board is busy even with nothing tagged', () => {
    // The old guard returned null unless sync was on or something was tagged —
    // which is most users, most of the time, including during an install.
    expect(src).toContain('if (!busy && !syncOnSave && syncedFiles.length === 0) return null')
  })

  it('lets board activity outrank the sync state', () => {
    // A running install is the more urgent fact, and the one the user cannot
    // otherwise see once the modal has been pushed aside.
    expect(src).toContain('busy ? \'syncing\' : syncMode(')
    expect(src).toContain('busy ? busySummary(live.length) : syncSummary(')
  })

  it('offers a Stop, so the queue is never unstoppable from here', () => {
    expect(src).toContain('onClick={cancelDeviceQueue}')
  })

  it('counts the queue steps, not the tagged files, while busy', () => {
    expect(src).toContain('const work = queueProgress(live)')
  })
})

describe('the device tree hazard bar', () => {
  const tsx = readFileSync('src/renderer/src/components/DeviceFileTree.tsx', 'utf8')
  const css = readFileSync('src/renderer/src/components/DeviceFileTree.css', 'utf8')

  it('shows only while the board is being written to', () => {
    expect(tsx).toContain('{queueBusy && (')
    expect(tsx).toContain('devicetree__busy')
  })

  it('says what it means to a screen reader', () => {
    // Stripes carry nothing without sight.
    expect(tsx).toMatch(/aria-label="The board is busy[^"]*"/)
  })

  it('takes its colour from the theme, not from a literal hazard yellow', () => {
    const rule = css.slice(css.indexOf('.devicetree__busy {'), css.indexOf('@keyframes devicetree-hazard'))
    expect(rule).toContain('var(--accent)')
    expect(rule).not.toMatch(/#[0-9a-f]{3,8}\b/i)
  })

  it('drops the animation for anyone who asked for less motion, keeping the bar', () => {
    // The bar is the message; the movement is decoration.
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)', css.indexOf('.devicetree__busy')))
    expect(reduced).toContain('animation: none')
    expect(reduced).not.toContain('display: none')
  })
})
