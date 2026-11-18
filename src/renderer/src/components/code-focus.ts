/**
 * The identifier under the editor's cursor, shared with the board views so a
 * Pin variable in the code and its pin on the board light up together.
 *
 * A tiny external store rather than React context: the editor (which sets it)
 * and the mini board (which reads it) sit in different branches of the tree,
 * and it changes on every cursor move — `useSyncExternalStore` re-renders only
 * the readers, and only when the name actually changes.
 */
import { useSyncExternalStore } from 'react'

let focused: string | null = null
const listeners = new Set<() => void>()

/** Publish the name under the cursor (or null). Cheap when unchanged. */
export function setFocusedIdentifier(name: string | null): void {
  if (name === focused) return
  focused = name
  for (const l of listeners) l()
}

export function getFocusedIdentifier(): string | null {
  return focused
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The identifier under the editor's cursor, re-rendering when it changes. */
export function useFocusedIdentifier(): string | null {
  return useSyncExternalStore(subscribe, getFocusedIdentifier, getFocusedIdentifier)
}
