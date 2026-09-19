/**
 * Putting the finished PDF somewhere (#1114) — the one thing that differs
 * between the two hosts.
 *
 * Desktop gets the native save dialog and writes the bytes through the fs
 * bridge; the web build downloads it. Both take the same default name, which is
 * whatever the title page resolved the project to.
 */

import { downloadBlob } from '../../components/svg-export'
import { isElectron } from '../platform'

/** What happened to the file. `cancelled` is the user closing the dialog. */
export type SaveOutcome = 'saved' | 'cancelled'

/** Where a saved file went, for the message afterwards. */
export interface SaveResult {
  outcome: SaveOutcome
  /** The chosen path on desktop; the file name on the web. */
  path?: string
}

/** Save `bytes` as `fileName`, on whichever host we are. */
export async function savePdf(
  bytes: Uint8Array<ArrayBuffer>,
  fileName: string
): Promise<SaveResult> {
  if (isElectron()) {
    const path = await window.api.fs.saveFileDialog(fileName, {
      filters: [{ name: 'PDF document', extensions: ['pdf'] }]
    })
    if (!path) return { outcome: 'cancelled' }
    await window.api.fs.writeFileBytes(path, bytes)
    return { outcome: 'saved', path }
  }
  downloadBlob(new Blob([bytes], { type: 'application/pdf' }), fileName)
  return { outcome: 'saved', path: fileName }
}
