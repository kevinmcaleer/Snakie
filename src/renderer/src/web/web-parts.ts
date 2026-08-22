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
import standardLibraries, { driverSources } from 'virtual:snakie-standard-parts'
import type { PartLibraryWithParts } from '../../../shared/part'

interface DriverSourceResult {
  ok: boolean
  contents?: string
  error?: string
}

/** Build the read-only `parts` Api object (merged onto `window.api.parts`). */
export function createWebPartsApi(): Record<string, unknown> {
  const libraries = standardLibraries as PartLibraryWithParts[]
  return {
    listLibraries: async (): Promise<PartLibraryWithParts[]> => libraries,
    // Serve a bundled part's driver file (e.g. sg90 → servo.py) so the
    // "install driver" banner works on the web (#475/#476 follow-up). The
    // desktop reads it off disk past the CSP; here it's inlined at build time.
    readDriverSource: async (
      _libraryId: string,
      partId: string,
      source: string
    ): Promise<DriverSourceResult> => {
      const contents = (driverSources as Record<string, string>)[`${partId}/${source}`]
      return contents != null
        ? { ok: true, contents }
        : { ok: false, error: `No bundled driver "${source}" for ${partId}.` }
    },
    // #655: the files "beside the part" on the web are whatever the build
    // inlined into driverSources for that part id.
    listPartFiles: async (_libraryId: string, partId: string): Promise<string[]> =>
      Object.keys(driverSources as Record<string, string>)
        .filter((k) => k.startsWith(`${partId}/`))
        .map((k) => k.slice(partId.length + 1))
        .sort(),
    // Read-only on the web: no per-user library storage, nothing to update. The
    // bundled parts ARE the install here, so none can be edited or fall behind
    // (#643) and there is nothing a reset could restore.
    checkUpdates: async () => [],
    cachedUpdates: async () => [],
    // No filesystem in the browser, so there is no folder to name or reveal.
    partsFolder: async () => '',
    bundledStatus: async () => [],
    resetToBundled: async () => ({ ok: false, error: 'Parts are read-only on the web.' }),
    // #741: linking a model copies a file into the part's folder, and there is
    // no folder here. The 3-D view still SHOWS a bundled part's model.
    importMesh: async () => ({
      ok: false,
      error: 'Linking a 3-D model needs the desktop app — parts are read-only on the web.'
    })
  }
}
