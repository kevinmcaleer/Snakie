import { NOTES } from './notes'
import { loadSeen, saveSeen, unseenIds } from './seen'

/**
 * Loads with the notes, after first paint: the notes you haven't seen, newest
 * first. A first visit marks every note seen and returns none.
 */
export function freshNotes(): string[] {
  const ids = NOTES.map((n) => n.id)
  const seen = loadSeen()
  if (seen === null && ids.length) saveSeen(ids)
  return unseenIds(ids, seen)
}

/** Marks every note seen. */
export function markAllSeen(): void {
  if (NOTES.length) saveSeen(NOTES.map((n) => n.id))
}
