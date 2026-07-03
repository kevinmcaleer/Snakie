/**
 * Drag-and-drop payload for dragging a library part from the Parts panel onto the
 * Board View's wiring canvas (#159). A custom MIME type carries the library + part
 * id; the canvas resolves it against its installed libraries and drops the part at
 * the cursor. Kept in its own module so the drag SOURCE (PartsPanel) and the drop
 * TARGET (WiringCanvas) share one contract without importing each other.
 */

/** The drag payload's MIME type. Custom types survive within the app's own DnD. */
export const PART_DRAG_MIME = 'application/x-snakie-part'

export interface PartDragPayload {
  libraryId: string
  partId: string
}

/** Stamp a part-drag payload onto a drag's DataTransfer (copy semantics). */
export function encodePartDrag(dt: DataTransfer, payload: PartDragPayload): void {
  dt.setData(PART_DRAG_MIME, JSON.stringify(payload))
  dt.effectAllowed = 'copy'
}

/** Read a part-drag payload back on drop, or null when it isn't one of ours. */
export function decodePartDrag(dt: DataTransfer): PartDragPayload | null {
  const raw = dt.getData(PART_DRAG_MIME)
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as PartDragPayload
    if (v && typeof v.libraryId === 'string' && typeof v.partId === 'string') return v
  } catch {
    // Malformed payload — treat as "not a part drag".
  }
  return null
}
