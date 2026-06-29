/**
 * Parts Library + Part Editor IPC layer (#129 / #130).
 *
 * Mirrors the Board View's IPC module: the renderer has no filesystem/network,
 * so every parts operation is an `invoke` handled here. All handlers return a
 * serialisable value (data, or a `{ ok, error }` {@link WriteResult}) and NEVER
 * throw across the bridge.
 *
 *   parts:listLibraries  → installed libraries + their parts (image inlined)
 *   parts:openPartsFolder → reveal <userData>/parts in the OS file manager
 *   parts:savePart        → write a part's parts.yml + image asset
 *   parts:deletePart      → delete a part folder
 *   parts:createLibrary   → create an empty library (manifest)
 *   parts:deleteLibrary   → delete a whole library folder
 *   parts:fetchRegistry   → fetch the master community registry
 *   parts:installLibrary  → clone a registry library into the parts folder
 *   parts:checkUpdates    → which installed libraries have a newer registry version
 */

import { ipcMain, shell } from 'electron'
import { promises as fsp } from 'fs'
import {
  LOCAL_LIBRARY_ID,
  createLibrary,
  deleteLibrary,
  deletePart,
  ensureLibrary,
  partsDir,
  promoteToStandard,
  publishStandardLibrary,
  readDriverSource,
  readLibraries,
  seedStandardLibrary,
  writePart
} from './library'
import { checkUpdates, fetchRegistry, installLibrary } from './registry'
import type { LibraryUpdate, PartDefinition, PartLibrary, RegistryEntry } from '../../shared/part'

/** Result of the most recent update check — primed once on startup (#194) so the
 *  parts UI can show an "update available" indicator instantly. */
let cachedUpdates: LibraryUpdate[] = []

/** Payload for `parts:savePart`. */
interface SavePartArgs {
  libraryId?: string
  part: PartDefinition
}

/** Payload for `parts:deletePart`. */
interface DeletePartArgs {
  libraryId: string
  partId: string
}

/** Register every Parts IPC handler. Idempotent enough for one-time setup. */
export function registerPartsIpc(): void {
  // Seed the bundled Standard Boards library before the first listing, so the
  // board selector has its canonical boards on a fresh install (idempotent).
  ipcMain.handle('parts:listLibraries', async () => {
    await seedStandardLibrary()
    return readLibraries()
  })

  ipcMain.handle('parts:openPartsFolder', async () => {
    const dir = partsDir()
    try {
      await fsp.mkdir(dir, { recursive: true })
    } catch {
      // Best effort — still try to reveal it.
    }
    await shell.openPath(dir)
  })

  ipcMain.handle('parts:savePart', async (_e, args: SavePartArgs) => {
    const libraryId = args?.libraryId?.trim() || LOCAL_LIBRARY_ID
    // Auto-provision the local "my-parts" library so a first save just works.
    if (libraryId === LOCAL_LIBRARY_ID) {
      await ensureLibrary({
        id: LOCAL_LIBRARY_ID,
        name: 'My Parts',
        description: 'Parts you authored in the Part Editor.',
        version: '0.1.0',
        source: 'local'
      })
    } else {
      await ensureLibrary({ id: libraryId, name: libraryId })
    }
    return writePart(libraryId, args.part)
  })

  ipcMain.handle('parts:deletePart', (_e, args: DeletePartArgs) =>
    deletePart(args?.libraryId ?? '', args?.partId ?? '')
  )

  ipcMain.handle('parts:promoteToStandard', (_e, args: { libraryId: string; partId: string }) =>
    promoteToStandard(args?.libraryId ?? '', args?.partId ?? '')
  )

  ipcMain.handle('parts:publishStandard', (_e, message?: string) =>
    publishStandardLibrary(message || undefined)
  )

  ipcMain.handle('parts:createLibrary', (_e, meta: PartLibrary) => createLibrary(meta))

  ipcMain.handle('parts:deleteLibrary', (_e, libraryId: string) => deleteLibrary(libraryId))

  ipcMain.handle(
    'parts:readDriverSource',
    (_e, args: { libraryId: string; partId: string; source: string }) =>
      readDriverSource(args?.libraryId ?? '', args?.partId ?? '', args?.source ?? '')
  )

  ipcMain.handle('parts:fetchRegistry', (_e, url?: string) => fetchRegistry(url || undefined))

  ipcMain.handle('parts:installLibrary', (_e, entry: RegistryEntry) => installLibrary(entry))

  ipcMain.handle('parts:checkUpdates', async (_e, url?: string) => {
    cachedUpdates = await checkUpdates(url || undefined)
    return cachedUpdates
  })

  ipcMain.handle('parts:cachedUpdates', () => cachedUpdates)

  // On startup (#194): check GitHub for newer library versions — including the
  // Standard library — once, in the background, and cache the result so the parts
  // UI shows the indicator immediately. Failures (offline) are swallowed.
  void checkUpdates()
    .then((u) => {
      cachedUpdates = u
      const n = u.filter((x) => x.updateAvailable).length
      if (n > 0) console.log(`[parts] ${n} library update(s) available`)
    })
    .catch(() => undefined)
}
