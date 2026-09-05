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
  error,
  minimised: false
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

/**
 * Minimise and maximise the copy dialog (#890).
 *
 * #889 let the dialog be pushed aside, but the state lived inside the dialog —
 * so nothing else could bring it back, and "minimise" was really just a
 * one-way hide. Moving it onto the queue gives the round trip two ends: the
 * dialog puts it away, the status-bar popup fetches it back.
 */
describe('the minimise round trip', () => {
  it('is queue state, so both ends can reach it', async () => {
    const q = await import('../src/renderer/src/lib/device-queue')
    expect(typeof q.minimiseDeviceQueue).toBe('function')
    expect(typeof q.restoreDeviceQueue).toBe('function')
    expect(q.getDeviceQueueSnapshot()).toHaveProperty('minimised')
  })

  it('minimising an empty queue leaves nothing minimised', async () => {
    const q = await import('../src/renderer/src/lib/device-queue')
    q.resetDeviceQueueForTest()
    q.minimiseDeviceQueue()
    // Nothing to hide, so `highestTaskId` is null and the flag must not stick —
    // otherwise the NEXT operation would open minimised.
    expect(q.getDeviceQueueSnapshot().minimised).toBe(false)
  })

  it('stops being minimised once the work has drained', async () => {
    // `some()` over an empty list is false, so the flag outlived the tasks it
    // was hiding — and the popup then offered a maximise with nothing behind it.
    expect(stayHidden(snap([]), 5)).toBe(false)
  })

  it('restoring clears it', async () => {
    const q = await import('../src/renderer/src/lib/device-queue')
    q.resetDeviceQueueForTest()
    q.restoreDeviceQueue()
    expect(q.getDeviceQueueSnapshot().minimised).toBe(false)
  })
})

describe('the dialog offers Minimise beside Cancel, not instead of it', () => {
  const dlg = readFileSync('src/renderer/src/components/TransferProgressDialog.tsx', 'utf8')
  const queue = readFileSync('src/renderer/src/components/DeviceQueueDialog.tsx', 'utf8')

  it('shows both while work is running', () => {
    // "I want my app back" and "stop touching my board" are different wishes.
    // A dialog offering only the second makes the first cost the transfer.
    expect(dlg).toContain('{minimiseLabel && (')
    expect(dlg).toContain('Cancel')
  })

  it('only calls it Minimise where it actually minimises', () => {
    // A folder copy from the Files panel closes for real; the queue minimises.
    expect(queue).toContain("minimiseLabel={snap.busy ? 'Minimise' : undefined}")
  })

  it('minimises rather than dismissing while busy', () => {
    expect(queue).toContain('if (snap.busy) minimiseDeviceQueue()')
  })

  it('hides on the queue’s own flag, not a local copy', () => {
    expect(queue).toContain('if (snap.minimised ||')
  })
})

describe('the popup can bring the dialog back', () => {
  const src = readFileSync('src/renderer/src/components/SyncIndicator.tsx', 'utf8')

  it('offers maximise, top-left, only when there is something to restore', () => {
    expect(src).toContain('{queue.minimised && (')
    expect(src).toContain('onClick={restoreDeviceQueue}')
  })

  it('names the control for a screen reader', () => {
    expect(src).toMatch(/aria-label="Show the copy progress again"/)
  })
})

describe('the popup reads clearly (#890)', () => {
  const css = readFileSync('src/renderer/src/components/SyncIndicator.css', 'utf8')
  const popup = css.slice(css.indexOf('.syncind__popup {'), css.indexOf('/* --- Stop'))

  it('uses the app’s dark panel and white ink, not the theme surface', () => {
    // `--bg-elevated` over a status bar that is itself elevated left almost no
    // separation, and on the skeuomorph skin put near-black 0.72rem type on
    // brushed metal. A floating readout wants contrast, not continuity.
    expect(popup).toContain('background: #1f2430')
    expect(popup).toContain('color: #f4f6f8')
  })

  it('takes no foreground from the theme inside the popup', () => {
    expect(popup).not.toContain('var(--text)')
    expect(popup).not.toContain('var(--text-muted)')
    expect(popup).not.toContain('var(--danger)')
  })

  it('keeps the status-bar GLYPH on theme tokens', () => {
    // The glyph sits IN the status bar, which is a themed surface — it should
    // match its surroundings, unlike the popup that floats above them.
    const btn = css.slice(css.indexOf('.syncind__btn--on'), css.indexOf('.syncind__btn--syncing'))
    expect(btn).toContain('var(--')
  })

  it('gives each row state its own strong colour', () => {
    for (const c of ['#e7bf62', '#6fdc9b', '#ff9b8a']) {
      expect(css, c).toContain(c)
    }
  })
})
