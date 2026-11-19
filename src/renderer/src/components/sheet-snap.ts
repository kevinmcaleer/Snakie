/**
 * The small-screen pull-up sheet's three resting heights, and which one a drag
 * lands on. Sizes are the sheet's share of the editor + sheet column, in
 * percent — the unit the resizable panel group speaks.
 *
 *   top   the sheet nearly fills the column; the editor keeps a strip so you
 *         can still see where you are.
 *   mid   roughly half and half.
 *   min   just the sheet's own bar: the grip and the Console / Board /
 *         Instruments tab names, sitting on the bottom edge.
 */

/** Height of the sheet's bar (5px inset + 54px bar) plus the gap under it. */
export const SHEET_BAR_PX = 64
export const SHEET_MID = 45
export const SHEET_TOP = 78
/** How far towards the next stop (as a share of the gap) a flick must carry the
 *  sheet for it to go on there rather than spring back. Small, so a short
 *  deliberate flick is enough. */
export const SHEET_THROW = 0.1
/** Movement (px) below which a press on the bar is a tap, not a drag. */
export const SHEET_DRAG_SLOP = 6

export type SheetSnaps = readonly [min: number, mid: number, top: number]

/** The three stops for a column `columnPx` tall. `min` is a pixel height, so its
 *  percentage depends on the column: ~8% on a phone upright, ~22% on its side. */
export function sheetSnaps(columnPx: number): SheetSnaps {
  const min = columnPx > 0 ? Math.min(SHEET_MID - 10, (SHEET_BAR_PX / columnPx) * 100) : 10
  return [min, SHEET_MID, SHEET_TOP]
}

/** The sheet's size for a finger at `clientY`, given where on the bar it took
 *  hold (`grabOffsetPx` below the sheet's top edge). Clamped to min…top. */
export function sheetSizeAt(
  clientY: number,
  grabOffsetPx: number,
  column: { top: number; height: number },
  snaps: SheetSnaps
): number {
  if (column.height <= 0) return snaps[1]
  const sheetTop = clientY - grabOffsetPx
  const pct = ((column.top + column.height - sheetTop) / column.height) * 100
  return Math.max(snaps[0], Math.min(snaps[2], pct))
}

const nearestSnap = (size: number, snaps: SheetSnaps): number =>
  snaps.reduce((best, s) => (Math.abs(s - size) < Math.abs(best - size) ? s : best))

/** Where a released drag settles: the stop nearest to where the sheet was let
 *  go. A short flick would never get nearer to another stop than the one it
 *  started at (`from`), so when the nearest stop is still that one, a sheet that
 *  travelled a little way (`dyPx` < 0 is upward) goes on to the next stop in
 *  that direction instead of springing back. */
export function sheetSnapTarget(
  size: number,
  dyPx: number,
  snaps: SheetSnaps,
  from: number = size
): number {
  const nearest = nearestSnap(size, snaps)
  if (Math.abs(dyPx) <= SHEET_DRAG_SLOP || nearest !== nearestSnap(from, snaps)) return nearest
  const next = snaps[snaps.indexOf(nearest) + (dyPx < 0 ? 1 : -1)]
  if (next === undefined) return nearest
  return Math.abs(size - from) >= Math.abs(next - nearest) * SHEET_THROW ? next : nearest
}

/** Tapping the grip steps the sheet up a stop, and from the top back to min. */
export function nextSheetSnap(size: number, snaps: SheetSnaps): number {
  const at = sheetSnapTarget(size, 0, snaps)
  const i = snaps.indexOf(at)
  return snaps[(i + 1) % snaps.length]
}

/** Is the sheet resting at (or within a hair of) its minimised stop? */
export function isSheetMin(size: number, snaps: SheetSnaps): boolean {
  return size <= snaps[0] + 2
}
