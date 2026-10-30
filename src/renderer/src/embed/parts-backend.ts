/**
 * EMBED parts backend — kevinmcaleer/kevsrobots.com#254 (snakie#1277).
 * =============================================================================
 *
 * The catalog, Part Editor and wiring canvas reach the parts libraries through
 * `window.api.parts`, which the desktop preload and the web build's
 * {@link ../web/web-parts} provide. A page embedding them (kevsrobots.com) has
 * neither: it has its own API. {@link PartsBackend} is the slice of
 * `window.api.parts` those three components use, and {@link installPartsBackend}
 * puts a host's implementation there, so the components run unchanged.
 *
 * Everything else on `window.api` stays the preload fallback's inert stubs.
 */
import type { PartDefinition, PartLibraryWithParts } from '../../../shared/part'

/** What a `savePart` resolves to (the preload's `PartsWriteResult`). */
export interface EmbedWriteResult {
  ok: boolean
  error?: string
  id?: string
  libraryId?: string
}

/** The calls the embedded components make on `window.api.parts`. */
export interface PartsBackend {
  /** Every library the components may show or resolve parts from. */
  listLibraries(): Promise<PartLibraryWithParts[]>
  /** Save an authored part. Runtime-only `imageData` (a data URL) rides along. */
  savePart(libraryId: string, part: PartDefinition): Promise<EmbedWriteResult>
  /** Files beside a part (drivers, meshes). Optional: none by default. */
  listPartFiles?(libraryId: string, partId: string): Promise<string[]>
}

/** Turn a `data:` URL into a Blob, so a host can upload the photo a user picked
 *  in the Part Editor. Null for anything that isn't one (an http URL is the
 *  host's own image already). */
export function dataUrlToBlob(url: string | undefined): Blob | null {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url ?? '')
  if (!m) return null
  const type = m[1] || 'application/octet-stream'
  if (!m[2]) return new Blob([decodeURIComponent(m[3])], { type })
  const bin = atob(m[3])
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type })
}

/**
 * The `window.api.parts` object for a host backend. Reads go to the host;
 * desktop-only calls (folders, registry, meshes on disk) answer the way the web
 * build does — empty, or "not here" — so the components hide those affordances.
 */
export function createEmbedPartsApi(backend: PartsBackend): Record<string, unknown> {
  const notHere = async (): Promise<EmbedWriteResult> => ({ ok: false, error: 'Not available here.' })
  return {
    listLibraries: () => backend.listLibraries(),
    savePart: async (libraryId: string, part: PartDefinition): Promise<EmbedWriteResult> => {
      try {
        return await backend.savePart(libraryId, part)
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    },
    listPartFiles: async (libraryId: string, partId: string): Promise<string[]> =>
      backend.listPartFiles ? backend.listPartFiles(libraryId, partId).catch(() => []) : [],
    partsFolder: async () => '',
    checkUpdates: async () => [],
    cachedUpdates: async () => [],
    bundledStatus: async () => [],
    deletePart: notHere,
    resetToBundled: notHere,
    // No `importMesh`: the Part Editor reads its absence as "link a model in the
    // desktop app", which is the truth here too.
    importMesh: undefined,
    onChanged: () => () => undefined
  }
}

/** Point `window.api.parts` at a host backend. The preload fallback must have
 *  installed `window.api` first (the embed entry imports it before this runs). */
export function installPartsBackend(backend: PartsBackend, target: { api?: Record<string, unknown> } = window as never): void {
  if (!target.api) target.api = {}
  target.api.parts = createEmbedPartsApi(backend)
}
