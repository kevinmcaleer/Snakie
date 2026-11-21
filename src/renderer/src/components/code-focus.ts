/**
 * The identifiers the editor is pointing at, shared with the board views so a
 * Pin variable in the code and its pin on the board light up together.
 *
 * Two names are tracked: the word under the caret (or selection) and the word
 * under the mouse. The board spotlights the hovered name when it is a Pin
 * variable, else the caret's, so sweeping the mouse over other code doesn't
 * wipe out the pin you clicked on.
 *
 * A tiny external store rather than React context: the editor (which sets it)
 * and the mini board (which reads it) sit in different branches of the tree,
 * and it changes on every cursor move — `useSyncExternalStore` re-renders only
 * the readers, and only when a name actually changes.
 */
import { useSyncExternalStore } from 'react'

export interface CodeFocus {
  /** The word under the mouse pointer, or null. */
  hovered: string | null
  /** The word under the caret / selection, or null. */
  caret: string | null
}

let snapshot: CodeFocus = { hovered: null, caret: null }
const listeners = new Set<() => void>()

function publish(next: CodeFocus): void {
  if (next.hovered === snapshot.hovered && next.caret === snapshot.caret) return
  snapshot = next
  for (const l of listeners) l()
}

/** Publish the name under the caret (or null). Cheap when unchanged. */
export function setFocusedIdentifier(name: string | null): void {
  publish({ ...snapshot, caret: name })
}

/** Publish the name under the mouse (or null). Cheap when unchanged. */
export function setHoveredIdentifier(name: string | null): void {
  publish({ ...snapshot, hovered: name })
}

export function getCodeFocus(): CodeFocus {
  return snapshot
}


function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The hovered and caret identifiers, re-rendering when either changes. */
export function useCodeFocus(): CodeFocus {
  return useSyncExternalStore(subscribe, getCodeFocus, getCodeFocus)
}

/**
 * Which of the editor's names to spotlight: the hovered one if `isPin` accepts
 * it, otherwise the caret's if `isPin` accepts that, otherwise null.
 */
export function pickFocusedName(focus: CodeFocus, isPin: (name: string) => boolean): string | null {
  if (focus.hovered && isPin(focus.hovered)) return focus.hovered
  if (focus.caret && isPin(focus.caret)) return focus.caret
  return null
}
