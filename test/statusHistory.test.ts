import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  appendEntry,
  clampHistoryLimit,
  formatHistoryText,
  formatTime,
  HISTORY_LIMIT_DEFAULT,
  HISTORY_LIMIT_MAX,
  HISTORY_LIMIT_MIN,
  historyFileName,
  isRecordable,
  parseHistory,
  trimToLimit,
  type StatusEntry
} from '../src/shared/status-history'

/**
 * Keeping what the status bar said (#953).
 *
 * The bar holds one line and each message wipes the one before it, so anything
 * you were not looking at is gone — including the messages that matter
 * afterwards. The rules for what is kept, how many, and how it reads when copied
 * out are here, DOM-free, because every one of them is a decision rather than a
 * rendering detail.
 */

const at = (n: number): number => Date.UTC(2026, 8, 6, 12, 0, n)
const entry = (id: number, text = `msg ${id}`): StatusEntry => ({
  id,
  text,
  at: at(id),
  priority: 2
})

describe('what gets recorded', () => {
  it('ignores the empty text that CLEARS the bar', () => {
    // An empty message is how the slot is emptied, not something that was said.
    // Recorded, it would bury the log in blank lines.
    expect(isRecordable('')).toBe(false)
    expect(isRecordable('   ')).toBe(false)
    expect(isRecordable('Synced')).toBe(true)
  })

  it('ignores anything that is not a string at all', () => {
    // The detail crosses a window event and a plugin can post it.
    for (const bad of [null, undefined, 42, {}, []]) expect(isRecordable(bad)).toBe(false)
  })
})

describe('the ring buffer', () => {
  it('keeps newest LAST, which is how a log reads', () => {
    let list: StatusEntry[] = []
    for (const i of [1, 2, 3]) list = appendEntry(list, entry(i), 10)
    expect(list.map((e) => e.id)).toEqual([1, 2, 3])
  })

  it('drops the oldest past the limit', () => {
    // The limit is clamped to its floor first, so a test below HISTORY_LIMIT_MIN
    // would be testing the clamp instead of the buffer.
    let list: StatusEntry[] = []
    for (let i = 1; i <= 14; i++) list = appendEntry(list, entry(i), HISTORY_LIMIT_MIN)
    expect(list.map((e) => e.id)).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14])
  })

  it('never grows past the limit however many arrive', () => {
    let list: StatusEntry[] = []
    for (let i = 1; i <= 500; i++) list = appendEntry(list, entry(i), 25)
    expect(list).toHaveLength(25)
  })

  it('applies a LOWERED limit to what is already stored', () => {
    // Otherwise the number in Settings and the number of lines on screen
    // disagree until enough new messages arrive to reconcile them.
    const list = Array.from({ length: 30 }, (_, i) => entry(i + 1))
    const trimmed = trimToLimit(list, HISTORY_LIMIT_MIN)
    expect(trimmed).toHaveLength(HISTORY_LIMIT_MIN)
    expect(trimmed[trimmed.length - 1].id, 'the newest survives').toBe(30)
    expect(trimmed[0].id, 'the oldest goes').toBe(21)
  })

  it('does not mutate what it was given', () => {
    const before = [entry(1)]
    appendEntry(before, entry(2), 10)
    trimToLimit(before, 10)
    expect(before).toHaveLength(1)
  })
})

describe('the limit is held to its bounds', () => {
  it('clamps anything out of range', () => {
    expect(clampHistoryLimit(1)).toBe(HISTORY_LIMIT_MIN)
    expect(clampHistoryLimit(999999)).toBe(HISTORY_LIMIT_MAX)
    expect(clampHistoryLimit(250)).toBe(250)
  })

  it('falls back to the default on nonsense, rather than to zero', () => {
    // A zero limit would be a second, silent way to say "keep none" that the UI
    // could not show — that is what the enabled switch is for.
    for (const bad of [NaN, Infinity, 'abc', null, undefined, '', {}]) {
      expect(clampHistoryLimit(bad), String(bad)).toBe(HISTORY_LIMIT_DEFAULT)
    }
    // A real zero is a real answer — the floor — because "keep none" is the
    // enabled switch, not a limit of nothing.
    expect(clampHistoryLimit(0)).toBe(HISTORY_LIMIT_MIN)
  })

  it('floors a fraction rather than storing one', () => {
    expect(clampHistoryLimit(200.7)).toBe(200)
  })
})

describe('the log as text', () => {
  it('is one line per message, timestamped, oldest first', () => {
    // Oldest first in the FILE even though the screen shows newest first: a
    // saved log is read by other tools and by scrolling down, and both want
    // time running forwards.
    const text = formatHistoryText([entry(1, 'first'), entry(2, 'second')])
    const lines = text.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('first')
    expect(lines[1]).toContain('second')
    expect(lines[0]).toMatch(/^\d\d:\d\d:\d\d {2}first$/)
  })

  it('is empty for an empty log, not a stray newline', () => {
    expect(formatHistoryText([])).toBe('')
  })

  it('pads the clock so the times form a column', () => {
    expect(formatTime(Date.UTC(2026, 0, 1, 0, 0, 0))).toMatch(/^\d\d:\d\d:\d\d$/)
  })
})

describe('the saved file is named usefully', () => {
  it('sorts by name and has no spaces', () => {
    const name = historyFileName(new Date(2026, 8, 6, 9, 5, 3))
    expect(name).toBe('snakie-status-20260906-090503.txt')
    expect(name).not.toContain(' ')
  })
})

describe('a stored log is untrusted', () => {
  it('drops malformed rows rather than rendering them', () => {
    const parsed = parseHistory([
      { id: 1, text: 'good', at: 123, priority: 2 },
      { id: 2, text: '' },
      null,
      'nope',
      { id: 3, at: 5 },
      { id: 4, text: 'also good', at: 9, priority: 0 }
    ])
    expect(parsed.map((e) => e.text)).toEqual(['good', 'also good'])
  })

  it('survives a value that is not an array at all', () => {
    for (const bad of [null, undefined, 'x', 42, {}]) expect(parseHistory(bad)).toEqual([])
  })

  it('repairs a missing timestamp instead of rendering NaN', () => {
    const [e] = parseHistory([{ text: 'x' }])
    expect(Number.isFinite(e.at)).toBe(true)
  })
})

describe('the wiring is where it has to be', () => {
  const store = readFileSync('src/renderer/src/store/status-history.ts', 'utf8')

  it('records at the EVENT, so a plugin posting directly is kept too', () => {
    // Not everything reaching the bar goes through `showStatus` — a plugin can
    // dispatch `snakie:status` itself, and those messages are worth keeping.
    expect(store).toContain('window.addEventListener(STATUS_EVENT')
  })

  it('listens at module load, not from a component', () => {
    // The panel that reads the history is opened AFTER the message you wanted,
    // so capture cannot depend on anything being mounted.
    expect(store).toMatch(/if \(typeof window !== 'undefined'\) \{\s*window\.addEventListener/)
  })

  it('turning history off actually discards it', () => {
    // A switch that says "do not keep a history" and leaves the old one on disk
    // is not telling the truth.
    const fn = store.slice(store.indexOf('export function setStatusHistoryEnabled'))
    expect(fn.slice(0, 600)).toContain('entries = []')
  })
})

describe('the status bar offers the way in', () => {
  const bar = readFileSync('src/renderer/src/components/StatusBar.tsx', 'utf8')

  it('makes the message itself clickable', () => {
    // The obvious thing to click to see the messages before it.
    expect(bar).toContain('statusbar__plugin--history')
    expect(bar).toContain('setHistoryOpen')
  })

  it('offers both the popup and the full view', () => {
    expect(bar).toContain('<StatusHistoryPopup')
    expect(bar).toContain('<StatusHistoryView')
  })
})
