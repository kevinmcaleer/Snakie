/**
 * WEB parts-library backend — epic #267 / #475.
 * =============================================================================
 *
 * Implements the read side of `window.api.parts` in the browser. The desktop
 * reads installed part libraries off disk (`examples/parts/snakie-standard` +
 * the user's `my-parts`); the browser has none, so we serve the bundled Standard
 * Parts library that the {@link ../../../../vite-plugin-standard-parts} plugin
 * inlined at build time (part geometry as JSON, images as emitted assets).
 *
 * This is what lets the board view resolve a placed part's shapes/pins — without
 * it, a wired-up servo renders as just its title. Only READ operations are real
 * (listLibraries + a no-op update check); authoring/registry writes stay stubbed
 * (no per-user library storage on the web yet).
 */
import standardLibraries from 'virtual:snakie-standard-parts'
import type { PartLibraryWithParts } from '../../../shared/part'

/** Build the read-only `parts` Api object (merged onto `window.api.parts`). */
export function createWebPartsApi(): Record<string, unknown> {
  const libraries = standardLibraries as PartLibraryWithParts[]
  return {
    listLibraries: async (): Promise<PartLibraryWithParts[]> => libraries,
    // Read-only on the web: no per-user library storage, nothing to update.
    checkUpdates: async () => [],
    cachedUpdates: async () => []
  }
}
