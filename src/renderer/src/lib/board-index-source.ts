/**
 * Getting the board index in front of the Board Finder (#893).
 * =============================================================================
 *
 * Two sources, and the newer wins:
 *
 *   1. the BUNDLED seed at `/boards/boards.json`, a static asset in both the
 *      Electron and the web build. No IPC, no filesystem, no network — so a
 *      fresh install and the offline classroom build (#267) open a full gallery
 *      the first time, before anything has been fetched;
 *   2. the PUBLISHED document, fetched through main (the renderer's CSP forbids
 *      outbound requests) and cached under `userData`.
 *
 * The fetch is deliberately not awaited before the gallery draws. A board index
 * is not worth a spinner: the bundled copy is complete and correct as of the
 * release, and the fetched one differs only by boards added upstream since. So
 * the gallery opens instantly on the seed and quietly re-renders if something
 * newer arrives.
 *
 * The published document does not exist yet — `snakie-parts` has not been
 * created — so today the fetch always fails and the seed always wins. That is
 * the designed steady state for an offline machine anyway, which is why it is
 * built this way round rather than as a fetch with a fallback.
 */
import {
  EMPTY_INDEX,
  newerIndex,
  parseBoardIndex,
  type BoardIndex
} from '../../../shared/board-index'

/** Where the bundled seed is served from, in both builds. */
export const BUNDLED_INDEX_URL = '/boards/boards.json'

/** A board's bundled thumbnail, or null when it has none. */
export function thumbUrl(thumb: string | null): string | null {
  return thumb ? `/boards/thumbs/${thumb}` : null
}

/** Read the seed. Never throws — a broken seed means an empty gallery, not a crash. */
export async function loadBundledIndex(): Promise<BoardIndex> {
  try {
    const res = await fetch(BUNDLED_INDEX_URL)
    if (!res.ok) return EMPTY_INDEX
    return parseBoardIndex(await res.json()) ?? EMPTY_INDEX
  } catch {
    return EMPTY_INDEX
  }
}

/**
 * Ask main for the published document. Resolves null on any failure — offline,
 * a repo that does not exist yet, a schema this build is too old to read.
 */
export async function loadPublishedIndex(): Promise<BoardIndex | null> {
  try {
    const raw = await window.api.boards.fetchIndex()
    return raw ? parseBoardIndex(raw) : null
  } catch {
    return null
  }
}

/**
 * The index to draw: the seed immediately, then whichever of the two is newer.
 *
 * `onUpdate` fires only when the fetched document genuinely wins, so a caller
 * that renders on the seed does not re-render for nothing.
 */
export async function loadBoardIndex(
  onUpdate?: (index: BoardIndex) => void
): Promise<BoardIndex> {
  const bundled = await loadBundledIndex()
  void loadPublishedIndex().then((fetched) => {
    const best = newerIndex(bundled, fetched)
    if (best && best !== bundled) onUpdate?.(best)
  })
  return bundled
}
