/**
 * THE SHARED HIERARCHY SELECTION (#718, epic #720).
 *
 * "Selection survives switching workspace" needs a real home. It used to be
 * `useState` inside WiringCanvas (Electronics) and a second `useState` inside
 * RobotView (Build) — two states that never met, so selecting a part in
 * Electronics and switching to Build landed you nowhere.
 *
 * The home is deliberately NOT the layout store: the Board View also runs in a
 * SECOND renderer window (`board-main.tsx`), which has no LayoutProvider. So
 * this is a tiny module-level store with a `useSyncExternalStore` hook, mirrored
 * through `localStorage` so the pop-out board window and the main window agree
 * too (the `storage` event fans a change between windows for free).
 *
 * The stored value is a unified-hierarchy KEY (`'board'`, a part instance id,
 * `link:…`, `joint:…`) — workspace-independent by construction, which is the
 * whole point: each workspace maps the key onto its own subject.
 */
import { useCallback, useSyncExternalStore } from 'react'

const STORAGE_KEY = 'snakie.hierarchy.selected'

let selected: string | null = null
const listeners = new Set<() => void>()
/** Guards against re-broadcasting a value we just received from another window. */
let hydrated = false

function read(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null // private mode / storage disabled — session-only selection
  }
}

function hydrate(): void {
  if (hydrated) return
  hydrated = true
  selected = read()
  try {
    // Another window (the popped-out Board View) selected something.
    window.addEventListener('storage', (e) => {
      if (e.key !== STORAGE_KEY) return
      selected = e.newValue
      for (const l of listeners) l()
    })
  } catch {
    // No window (SSR / a unit test) — the in-memory store still works.
  }
}

/** The current selection key, without subscribing (for one-off reads). */
export function getHierarchySelection(): string | null {
  hydrate()
  return selected
}

/** Select a hierarchy row everywhere — pass null to clear. */
export function setHierarchySelection(key: string | null): void {
  hydrate()
  if (selected === key) return
  selected = key
  try {
    if (key === null) window.localStorage.removeItem(STORAGE_KEY)
    else window.localStorage.setItem(STORAGE_KEY, key)
  } catch {
    // Session-only; the in-memory value below is still authoritative.
  }
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  hydrate()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** `[selectedKey, select]` — shared across workspaces AND across windows. */
export function useHierarchySelection(): [string | null, (key: string | null) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => {
      hydrate()
      return selected
    },
    () => null // server render: nothing selected
  )
  const set = useCallback((key: string | null) => setHierarchySelection(key), [])
  return [value, set]
}

/** Test seam — drop the store back to "nothing selected", listeners intact. */
export function resetHierarchySelectionForTest(): void {
  selected = null
  hydrated = false
  for (const l of listeners) l()
}
