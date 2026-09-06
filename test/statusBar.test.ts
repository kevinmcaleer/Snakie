import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { clearStatus, resetStatusForTest, showStatus, STATUS_EVENT } from '../src/renderer/src/lib/status-bar'

/**
 * The status bar's one transient slot (#952).
 *
 * `Compiled robot.mpy — 5157 bytes` was rendered inside the Files panel and
 * never went away: it sat there until something else replaced it. The status bar
 * is where a momentary action belongs — it is where syncing already reports
 * itself — and the point of a transient message is that it goes.
 *
 * The slot is STICKY, so whoever posts a terminal message schedules its removal.
 * Two callers had already written that by hand with their own timers, and #949
 * was about to make it three; the tests below are mostly about the timer being
 * shared, because that is the part separate implementations get wrong.
 */

/**
 * The suite runs in `environment: 'node'`, so there is no `window` — and this
 * module only needs the one thing a window is here: something to dispatch events
 * on. Node's own `EventTarget` is that, exactly, so the stub is honest rather
 * than a mock that could drift from what a browser does.
 */
beforeAll(() => {
  ;(globalThis as { window?: unknown }).window = new EventTarget()
})

/** Collect what reaches the window, the way StatusBar would. */
function listen(): { seen: { text: string; priority?: number }[]; stop: () => void } {
  const seen: { text: string; priority?: number }[] = []
  const on = (e: Event): void => {
    seen.push((e as CustomEvent<{ text: string; priority?: number }>).detail)
  }
  window.addEventListener(STATUS_EVENT, on)
  return { seen, stop: () => window.removeEventListener(STATUS_EVENT, on) }
}

afterEach(() => {
  resetStatusForTest()
  vi.useRealTimers()
})

describe('a message reaches the bar', () => {
  it('carries its text and priority', () => {
    const l = listen()
    showStatus('Compiled robot.mpy — 5157 bytes', { priority: 4 })
    l.stop()
    expect(l.seen).toEqual([{ text: 'Compiled robot.mpy — 5157 bytes', priority: 4 }])
  })

  it('defaults to the priority sync already uses', () => {
    const l = listen()
    showStatus('hello')
    l.stop()
    expect(l.seen[0].priority).toBe(2)
  })

  it('clears with an empty text, which is how the bar empties the slot', () => {
    const l = listen()
    clearStatus()
    l.stop()
    expect(l.seen[0].text).toBe('')
  })
})

describe('a terminal message goes away by itself', () => {
  it('clears after the time it was given', () => {
    vi.useFakeTimers()
    const l = listen()
    showStatus('done', { clearAfterMs: 5000 })
    expect(l.seen).toHaveLength(1)
    vi.advanceTimersByTime(4999)
    expect(l.seen, 'not yet').toHaveLength(1)
    vi.advanceTimersByTime(1)
    l.stop()
    expect(l.seen[1].text).toBe('')
  })

  it('stays put with no linger, which is what an in-progress message wants', () => {
    // "Syncing…" should be replaced by the message that says how it ended, not
    // wiped to an empty bar partway through.
    vi.useFakeTimers()
    const l = listen()
    showStatus('Syncing…')
    vi.advanceTimersByTime(60_000)
    l.stop()
    expect(l.seen).toHaveLength(1)
  })
})

describe('one slot, one timer', () => {
  it('a newer message cancels the older one’s clear', () => {
    // The failure separate timers produce: the first message's countdown fires
    // while the SECOND message is on screen, and wipes it mid-life.
    vi.useFakeTimers()
    const l = listen()
    showStatus('first', { clearAfterMs: 1000 })
    vi.advanceTimersByTime(900)
    showStatus('second', { clearAfterMs: 5000 })
    vi.advanceTimersByTime(200) // past when `first` would have cleared
    expect(l.seen.map((s) => s.text), 'second must still be showing').toEqual(['first', 'second'])
    vi.advanceTimersByTime(4800)
    l.stop()
    expect(l.seen[2].text).toBe('')
  })

  it('an explicit clear cancels a pending one too', () => {
    vi.useFakeTimers()
    const l = listen()
    showStatus('a', { clearAfterMs: 1000 })
    clearStatus()
    vi.advanceTimersByTime(5000)
    l.stop()
    expect(l.seen.map((s) => s.text)).toEqual(['a', ''])
  })
})

describe('nobody hand-rolls it any more', () => {
  it('the compile message goes to the bar, not into the Files panel', () => {
    const tree = readFileSync('src/renderer/src/components/LocalFileTree.tsx', 'utf8')
    expect(tree).toContain('showStatus(`Compiled ')
    expect(tree).toContain('clearAfterMs')
    // The in-panel version had no way to go away.
    expect(tree).not.toContain('localtree__notice')
    expect(tree).not.toContain('setNotice')
  })

  it('the two earlier copies were migrated rather than left to drift', () => {
    for (const f of ['src/renderer/src/store/sync.ts', 'src/renderer/src/components/RobotDockPanel.tsx']) {
      const src = readFileSync(f, 'utf8')
      expect(src, f).toContain('showStatus(')
      // No local timer, and no raw event dispatch, in either.
      expect(src, f).not.toMatch(/new CustomEvent\('snakie:status'/)
    }
  })
})
