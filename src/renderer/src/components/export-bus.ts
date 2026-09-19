/**
 * THE EXPORT-TO-PDF ACTION BUS (#1114).
 *
 * The same pattern as `device-bus.ts`, for the same reason: the toolbar owns
 * the print button, its busy state and its error surface, and `File ▸ Export to
 * PDF…` has to reach exactly that — not a second implementation that drifts
 * from it. The menu pulls the trigger; the toolbar does the work.
 */

const EXPORT_PDF_EVENT = 'snakie:export-pdf'

/** Ask whoever owns the export to run it. */
export function dispatchExportPdf(): void {
  window.dispatchEvent(new Event(EXPORT_PDF_EVENT))
}

/** Listen for the request. Returns the unsubscribe. */
export function onExportPdf(run: () => void): () => void {
  window.addEventListener(EXPORT_PDF_EVENT, run)
  return () => window.removeEventListener(EXPORT_PDF_EVENT, run)
}
