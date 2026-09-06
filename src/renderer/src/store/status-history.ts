import { useCallback, useEffect, useState } from 'react'
import {
  appendEntry,
  clampHistoryLimit,
  HISTORY_LIMIT_DEFAULT,
  isRecordable,
  parseHistory,
  trimToLimit,
  type StatusEntry
} from '../../../shared/status-history'
import { STATUS_EVENT } from '../lib/status-bar'

/**
 * KEEPING WHAT THE STATUS BAR SAID (#953).
 * =============================================================================
 *
 * The bar holds one line and every message wipes the one before it. That is
 * right for a status bar and wrong for the messages you want afterwards — which
 * file failed to sync, what the compile said, why the install stopped.
 *
 * RECORDED AT THE EVENT, not in `showStatus`. Everything that reaches the bar
 * goes through the `snakie:status` window event, but not everything goes through
 * `showStatus`: a plugin can post to the bar directly. Listening to the event
 * catches both, and means a future poster is recorded without knowing this
 * module exists.
 *
 * ONE LISTENER for the whole renderer, attached at module load rather than by a
 * component, so history accrues whether or not anything is watching it — the
 * panel that reads it is opened *after* the message you wanted.
 *
 * Persisted to `localStorage` so it survives a reload. The cap is a ring buffer,
 * so the stored value cannot grow without bound; turning history off clears what
 * is there, because a switch labelled "don't keep a history" that leaves the old
 * one on disk is not telling the truth.
 */

const ENTRIES_KEY = 'snakie.statusHistory'
const LIMIT_KEY = 'snakie.statusHistoryLimit'
const ENABLED_KEY = 'snakie.statusHistoryEnabled'

let entries: StatusEntry[] = []
let limit = HISTORY_LIMIT_DEFAULT
let enabled = true
let nextId = 1
let loaded = false

const listeners = new Set<() => void>()
const notify = (): void => listeners.forEach((l) => l())

/** Read persisted state once, tolerating anything the store holds. */
function load(): void {
  if (loaded) return
  loaded = true
  try {
    limit = clampHistoryLimit(JSON.parse(window.localStorage.getItem(LIMIT_KEY) ?? 'null'))
  } catch {
    limit = HISTORY_LIMIT_DEFAULT
  }
  try {
    enabled = window.localStorage.getItem(ENABLED_KEY) !== 'false'
  } catch {
    enabled = true
  }
  try {
    entries = trimToLimit(
      parseHistory(JSON.parse(window.localStorage.getItem(ENTRIES_KEY) ?? '[]')),
      limit
    )
    nextId = entries.reduce((m, e) => Math.max(m, e.id), 0) + 1
  } catch {
    entries = []
  }
}

/** Best-effort persist. Storage can be off, or full. */
function save(): void {
  try {
    window.localStorage.setItem(ENTRIES_KEY, JSON.stringify(entries))
  } catch {
    // A log that cannot be written is not worth an error the user can do
    // nothing about; it stays in memory for this session.
  }
}

/** Record one message, if history is on. */
export function recordStatus(text: string, priority = 0): void {
  load()
  if (!enabled || !isRecordable(text)) return
  entries = appendEntry(entries, { id: nextId++, text, at: Date.now(), priority }, limit)
  save()
  notify()
}

/** Everything kept, oldest first. */
export function statusHistory(): StatusEntry[] {
  load()
  return entries
}

export function clearStatusHistory(): void {
  load()
  entries = []
  save()
  notify()
}

export function statusHistoryLimit(): number {
  load()
  return limit
}

export function setStatusHistoryLimit(value: number): void {
  load()
  limit = clampHistoryLimit(value)
  // Applied to what is ALREADY stored, or the number in Settings and the number
  // of lines on screen disagree until enough new messages arrive.
  entries = trimToLimit(entries, limit)
  try {
    window.localStorage.setItem(LIMIT_KEY, JSON.stringify(limit))
  } catch {
    /* keep the in-memory value */
  }
  save()
  notify()
}

export function statusHistoryEnabled(): boolean {
  load()
  return enabled
}

export function setStatusHistoryEnabled(on: boolean): void {
  load()
  enabled = on
  try {
    window.localStorage.setItem(ENABLED_KEY, String(on))
  } catch {
    /* keep the in-memory value */
  }
  // Turning it off discards what was kept: a switch that says "do not keep a
  // history" and leaves the old one on disk is not telling the truth.
  if (!on) {
    entries = []
    save()
  }
  notify()
}

/** Module-level capture, so history accrues with nothing mounted. */
if (typeof window !== 'undefined') {
  window.addEventListener(STATUS_EVENT, (e: Event) => {
    const detail = (e as CustomEvent<{ text?: unknown; priority?: number }>).detail
    if (isRecordable(detail?.text)) recordStatus(detail.text, detail?.priority ?? 0)
  })
}

/** React view of the log. */
export function useStatusHistory(): {
  entries: StatusEntry[]
  limit: number
  enabled: boolean
  clear: () => void
  setLimit: (n: number) => void
  setEnabled: (on: boolean) => void
} {
  const [, bump] = useState(0)
  useEffect(() => {
    const l = (): void => bump((n) => n + 1)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  return {
    entries: statusHistory(),
    limit: statusHistoryLimit(),
    enabled: statusHistoryEnabled(),
    clear: useCallback(clearStatusHistory, []),
    setLimit: useCallback(setStatusHistoryLimit, []),
    setEnabled: useCallback(setStatusHistoryEnabled, [])
  }
}

/** Test seam: forget everything, including what was loaded from storage. */
export function resetStatusHistoryForTest(): void {
  entries = []
  limit = HISTORY_LIMIT_DEFAULT
  enabled = true
  nextId = 1
  loaded = true
}
