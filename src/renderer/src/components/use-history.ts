/**
 * UNDO/REDO HISTORY (#187)
 * ========================
 *
 * A tiny past/present/future history stack + a React hook that drops in for a
 * `useState` whose single value is the whole editable document (the Part Editor
 * keeps its entire {@link PartDefinition} in one state and routes EVERY edit
 * through `setPart`, so wrapping that one value gives undo over *all* operations).
 *
 * Drags stream many `set` calls per gesture (the canvas commits on every pointer
 * move), so a naive "checkpoint per set" would make Ctrl+Z step one pixel at a
 * time. The hook COALESCES sets that land within `coalesceMs` of each other into
 * a single checkpoint — so one drag = one undo step — while distinct, spaced-out
 * actions each get their own. The pure stack ops below are time-free and unit-
 * tested; the hook layers the coalescing clock on top.
 */
import { useCallback, useRef, useState } from 'react'

export interface History<T> {
  /** Older checkpoints, oldest first; the last is the most recent undo target. */
  past: T[]
  /** The live value. */
  present: T
  /** Redone-from checkpoints, next-redo first. */
  future: T[]
}

/** A fresh history holding just `present`. */
export function historyInit<T>(present: T): History<T> {
  return { past: [], present, future: [] }
}

/**
 * Commit a NEW checkpoint: the current present moves into `past` and `next`
 * becomes present, clearing the redo stack. `limit` caps retained checkpoints.
 */
export function historyPush<T>(h: History<T>, next: T, limit = 200): History<T> {
  const past = [...h.past, h.present]
  return { past: past.length > limit ? past.slice(past.length - limit) : past, present: next, future: [] }
}

/** Replace the present WITHOUT a checkpoint (a coalesced same-gesture update). */
export function historyReplace<T>(h: History<T>, next: T): History<T> {
  return { past: h.past, present: next, future: [] }
}

/** Step back one checkpoint (no-op when there's nothing to undo). */
export function historyUndo<T>(h: History<T>): History<T> {
  if (h.past.length === 0) return h
  const present = h.past[h.past.length - 1]
  return { past: h.past.slice(0, -1), present, future: [h.present, ...h.future] }
}

/** Step forward one checkpoint (no-op when there's nothing to redo). */
export function historyRedo<T>(h: History<T>): History<T> {
  if (h.future.length === 0) return h
  const [present, ...future] = h.future
  return { past: [...h.past, h.present], present, future }
}

export const canUndo = <T>(h: History<T>): boolean => h.past.length > 0
export const canRedo = <T>(h: History<T>): boolean => h.future.length > 0

export interface UseHistory<T> {
  /** The live value (drop-in for the `useState` value). */
  state: T
  /** Drop-in for the `useState` setter — supports a value or updater fn. */
  set: React.Dispatch<React.SetStateAction<T>>
  undo: () => void
  redo: () => void
  /** Replace the whole document and CLEAR history (e.g. loading a new part). */
  reset: (next: T) => void
  canUndo: boolean
  canRedo: boolean
}

/**
 * `useState` with undo/redo. `set` coalesces rapid successive updates (within
 * `coalesceMs`) into one checkpoint so a drag is a single undo step; `undo`/`redo`
 * walk the stack; `reset` swaps the document and drops history.
 */
export function useHistory<T>(
  initial: T,
  opts?: { coalesceMs?: number; limit?: number }
): UseHistory<T> {
  const coalesceMs = opts?.coalesceMs ?? 350
  const limit = opts?.limit ?? 200
  const [hist, setHist] = useState<History<T>>(() => historyInit(initial))
  // Timestamp of the last `set` — drives gesture coalescing. Computed OUTSIDE the
  // state updater so React 18 StrictMode's double-invoke can't double-advance it.
  const lastSetRef = useRef(0)

  const set = useCallback<React.Dispatch<React.SetStateAction<T>>>(
    (action) => {
      const now = Date.now()
      const coalesce = now - lastSetRef.current < coalesceMs
      lastSetRef.current = now
      setHist((h) => {
        const next =
          typeof action === 'function' ? (action as (prev: T) => T)(h.present) : action
        if (Object.is(next, h.present)) return h
        return coalesce ? historyReplace(h, next) : historyPush(h, next, limit)
      })
    },
    [coalesceMs, limit]
  )

  // Undo/redo/reset are discrete: reset the coalesce clock so the NEXT edit starts
  // a fresh checkpoint rather than merging into the pre-undo gesture.
  const undo = useCallback(() => {
    lastSetRef.current = 0
    setHist((h) => historyUndo(h))
  }, [])
  const redo = useCallback(() => {
    lastSetRef.current = 0
    setHist((h) => historyRedo(h))
  }, [])
  const reset = useCallback((next: T) => {
    lastSetRef.current = 0
    setHist(historyInit(next))
  }, [])

  return {
    state: hist.present,
    set,
    undo,
    redo,
    reset,
    canUndo: hist.past.length > 0,
    canRedo: hist.future.length > 0
  }
}
