import { describe, expect, it } from 'vitest'
import {
  SHEET_MID,
  SHEET_TOP,
  isSheetMin,
  nextSheetSnap,
  sheetSizeAt,
  sheetSnapTarget,
  sheetSnaps
} from '../src/renderer/src/components/sheet-snap'

describe('console sheet snap stops', () => {
  const portrait = sheetSnaps(868)
  const landscape = sheetSnaps(312)

  it('minimises to the height of its bar, whatever the column height', () => {
    expect((portrait[0] / 100) * 868).toBeCloseTo(64)
    expect((landscape[0] / 100) * 312).toBeCloseTo(64)
    expect(portrait.slice(1)).toEqual([SHEET_MID, SHEET_TOP])
  })

  it('keeps the minimised stop below the middle on a very short column', () => {
    expect(sheetSnaps(120)[0]).toBeLessThan(SHEET_MID)
    expect(sheetSnaps(0)[0]).toBeLessThan(SHEET_MID)
  })

  it('follows the finger and clamps between minimised and top', () => {
    const column = { top: 56, height: 868 }
    expect(sheetSizeAt(56 + 434 + 30, 30, column, portrait)).toBeCloseTo(50)
    expect(sheetSizeAt(5000, 30, column, portrait)).toBe(portrait[0])
    expect(sheetSizeAt(-500, 30, column, portrait)).toBe(SHEET_TOP)
  })

  it('settles on the nearest stop when released without travel', () => {
    expect(sheetSnapTarget(12, 0, portrait)).toBe(portrait[0])
    expect(sheetSnapTarget(50, 0, portrait)).toBe(SHEET_MID)
    expect(sheetSnapTarget(70, 0, portrait)).toBe(SHEET_TOP)
  })

  it('sends a short flick on to the next stop instead of springing back', () => {
    expect(sheetSnapTarget(SHEET_MID + 5, -40, portrait, SHEET_MID)).toBe(SHEET_TOP)
    expect(sheetSnapTarget(SHEET_MID - 5, 40, portrait, SHEET_MID)).toBe(portrait[0])
    expect(sheetSnapTarget(SHEET_TOP - 5, 40, portrait, SHEET_TOP)).toBe(SHEET_MID)
    // A twitch is not a flick…
    expect(sheetSnapTarget(SHEET_MID + 1, -9, portrait, SHEET_MID)).toBe(SHEET_MID)
    // …and there is nowhere to go past the ends.
    expect(sheetSnapTarget(SHEET_TOP, -40, portrait, SHEET_TOP - 2)).toBe(SHEET_TOP)
  })

  it('lands on the stop you dragged it to, not the one beyond', () => {
    // Pulled down from the top to just under the middle: the middle, not minimised.
    expect(sheetSnapTarget(39, 120, landscape, SHEET_TOP)).toBe(SHEET_MID)
    expect(sheetSnapTarget(12, 400, portrait, SHEET_TOP)).toBe(portrait[0])
  })

  it('steps minimised, middle, top and round again on a grip tap', () => {
    expect(nextSheetSnap(portrait[0], portrait)).toBe(SHEET_MID)
    expect(nextSheetSnap(SHEET_MID, portrait)).toBe(SHEET_TOP)
    expect(nextSheetSnap(SHEET_TOP, portrait)).toBe(portrait[0])
  })

  it('knows when the sheet is minimised', () => {
    expect(isSheetMin(portrait[0], portrait)).toBe(true)
    expect(isSheetMin(landscape[0] + 1, landscape)).toBe(true)
    expect(isSheetMin(SHEET_MID, portrait)).toBe(false)
  })
})
