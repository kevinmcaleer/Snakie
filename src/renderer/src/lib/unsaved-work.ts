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
