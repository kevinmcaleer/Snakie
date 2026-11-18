/**
 * "Is there work a reload would destroy?" (#971)
 * =============================================================================
 *
 * The browser build applies an update by reloading the page, and on a fresh
 * visit that should just happen — that is the whole point of #971. But Snakie is
 * an editor, and reloading over an unsaved buffer would be a worse bug than the
 * stale build it fixes. So the reload asks first.
 *
 * The question is asked from outside React (`web/web-updates.ts`, driven by a
 * service-worker event), and only React knows the answer. This is the seam: the
 * UI registers a probe, the updater consults it. It lives here rather than in
 * `web/` so the Electron bundle can import the registration side without pulling
 * in the browser's service-worker code.
 */

let probe: (() => boolean) | null = null

/**
 * Register the probe the updater consults. Returns an unregister function, so a
 * component can hand it straight back from `useEffect`.
 */
export function setUnsavedWorkProbe(next: () => boolean): () => void {
  probe = next
  return () => {
    if (probe === next) probe = null
  }
}

/**
 * Whether a reload right now would lose something.
 *
 * Defaults to TRUE with no probe registered, deliberately: before the UI has
 * mounted we cannot know, and the cost of being wrong is asymmetric — a
 * needless prompt is a small annoyance, a silently discarded buffer is not.
 */
export function hasUnsavedWork(): boolean {
  return probe ? probe() : true
}

/**
 * Saving the work a reload would otherwise lose.
 * =============================================================================
 *
 * The same seam, the other direction: the workspace registers a SAVER that
 * writes every open tab (unsaved edits included) to a one-shot snapshot the next
 * boot restores — see `store/reload-snapshot.ts`. Whatever applies an update
 * calls `saveWorkForReload()` immediately before it reloads or restarts.
 */
let saver: (() => boolean) | null = null

/** Register the saver. Returns an unregister function, like the probe. */
export function setWorkSaver(next: () => boolean): () => void {
  saver = next
  return () => {
    if (saver === next) saver = null
  }
}

/**
 * Snapshot the open work for the coming reload. True when it is safe to reload:
 * either the snapshot was written, or there is no UI mounted to hold any work.
 */
export function saveWorkForReload(): boolean {
  if (!saver) return true
  try {
    return saver()
  } catch {
    return false
  }
}

/**
 * Apply an update (reload on the web, restart on the desktop) without losing
 * work: snapshot first, and if that fails while something is unsaved, ask
 * before going ahead. `window.confirm` works in Electron's renderer (only
 * `window.prompt` doesn't).
 */
export async function applyUpdateKeepingWork(
  install: () => Promise<void>,
  confirmFn: (message: string) => boolean = (m) => window.confirm(m)
): Promise<boolean> {
  if (!saveWorkForReload() && hasUnsavedWork()) {
    const go = confirmFn(
      "Snakie couldn't keep a copy of your unsaved changes, so they would be lost by updating now.\n\n" +
        'Choose Cancel to save your files first, or OK to update anyway.'
    )
    if (!go) return false
  }
  await install()
  return true
}
