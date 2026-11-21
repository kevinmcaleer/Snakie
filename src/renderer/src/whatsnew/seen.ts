/**
 * What's new: which release notes you've seen. This file loads with the shell,
 * so it holds only the bookmark; the notes themselves load later (./notes.ts).
 */
export const SEEN_KEY = 'snakie.whatsNew.seen'

/** The note ids you've seen, or null on a first visit (or with storage blocked or garbled). */
export function loadSeen(): Set<string> | null {
  try {
    const v = JSON.parse(localStorage.getItem(SEEN_KEY) ?? 'null') as unknown
    return Array.isArray(v) ? new Set(v.filter((x): x is string => typeof x === 'string')) : null
  } catch {
    return null
  }
}

/** Marks every id in the list seen. Stores the whole list, so notes removed later drop out of storage too. */
export function saveSeen(ids: readonly string[]): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(ids))
  } catch {
    /* storage blocked: the card shows again next visit */
  }
}

/**
 * The ids you haven't seen, in the order given. A first visit has nothing new:
 * a brand-new user gets the starter program, not a list of changes.
 */
export function unseenIds(ids: readonly string[], seen: ReadonlySet<string> | null): string[] {
  if (seen === null) return []
  return ids.filter((id) => !seen.has(id))
}
