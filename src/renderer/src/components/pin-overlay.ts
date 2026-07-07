/**
 * PIN-OVERLAY helpers — Obsidian-style pinnable panels (modes review).
 * =============================================================================
 *
 * In the focused Board mode the side panels (parts library, connections table)
 * behave like Obsidian's sidebars: they open as OVERLAYS over the canvas and
 * auto-hide when they lose focus — unless PINNED, in which case they stay put
 * (the pin sits at the top-left of the panel header). The floating Board View
 * window defaults to pinned, which is exactly the pre-review behaviour.
 *
 * DOM-free decision + persistence helpers so the behaviour is unit-testable;
 * the components own the actual focus wiring.
 */

/** Minimal storage shape (mirrors `store/layout.ts`'s StorageLike). */
export interface PinStorage {
  getItem(key: string): string | null
  setItem?(key: string, value: string): void
}

/**
 * Should an unpinned panel hide after a focusout? True when focus moved OUTSIDE
 * the panel (`next` not contained in it). A pinned panel never auto-hides; a
 * null `next` (focus left the document / clicked bare canvas) does hide.
 */
export function shouldAutoHide(
  pinned: boolean,
  panel: { contains(other: Node | null): boolean } | null,
  next: EventTarget | null
): boolean {
  if (pinned) return false
  if (!panel) return false
  // Duck-typed rather than `instanceof Node` — robust across realms (and the
  // node test env, which has no DOM globals).
  const node = next && typeof next === 'object' ? (next as Node) : null
  if (node && panel.contains(node)) return false
  return true
}

/** Read a persisted pin flag; anything unreadable → `fallback`. */
export function loadPin(storage: PinStorage, key: string, fallback: boolean): boolean {
  try {
    const raw = storage.getItem(key)
    if (raw === null) return fallback
    const v = JSON.parse(raw)
    return typeof v === 'boolean' ? v : fallback
  } catch {
    return fallback
  }
}

/** Persist a pin flag (best-effort — storage may be unavailable). */
export function savePin(storage: PinStorage, key: string, value: boolean): void {
  try {
    storage.setItem?.(key, JSON.stringify(value))
  } catch {
    // Quota/full/denied — the pin just won't stick across restarts.
  }
}

/** The persisted pin keys (one per pinnable board panel). */
export const PIN_KEYS = {
  library: 'snakie.board.pin.library',
  connections: 'snakie.board.pin.connections'
} as const
