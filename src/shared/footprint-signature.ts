/**
 * Structural footprint signatures (#166) — the "duck typing" that decides which
 * boards can dock into a carrier's mount. A footprint's identity is its PIN LAYOUT,
 * not a name: the ordered set of pins by electrical TYPE and RELATIVE position. Two
 * boards with the same signature are interchangeable in the same socket (a XIAO
 * RP2040 and RP2350 share a layout, so they share a signature), regardless of the
 * `footprint` tag, pin names, GPIO numbers or capabilities — which differ between
 * otherwise-compatible boards.
 *
 * The signature is translation- and scale-invariant, and — deliberately — aspect
 * invariant: the pin cluster is stretched to a unit square, so two boards with the
 * SAME pin GRID (same rows/columns of the same types) match even when authored at
 * different normalised sizes. That's why a XIAO RP2040 and RP2350 — whose pins were
 * placed against differently-sized board images, so their raw positions differ —
 * still share a signature. Orientation-specific (a rotated seat is the mount's
 * rotation, not here). Pure + dependency-free so the renderer (docking), the Part
 * Editor (imprint/compat) and tests all share one definition of "compatible".
 */

import type { PartDefinition, PartPinType } from './part'

/** The minimal per-pin input a signature needs: role + normalised position. */
export interface SigPin {
  type: PartPinType
  x: number
  y: number
}

/** Gap (in unit-square space) that separates two distinct rows/columns. Larger than
 *  authoring jitter (~0.01 between independently-drawn versions of a board) and far
 *  smaller than real pin spacing, so each row/column collapses to one grid level. */
const LEVEL_GAP = 0.05

/**
 * Assign each value an integer LEVEL index by 1-D clustering: sort the distinct
 * values, start a new level when the gap to the previous exceeds {@link LEVEL_GAP}.
 * This is what makes the signature robust — a row's pins (and the same row on a
 * differently-authored sibling board) land on one integer level instead of two
 * float buckets that a fixed grid could split.
 */
function levelIndex(values: number[]): (v: number) => number {
  const uniq = [...new Set(values)].sort((a, b) => a - b)
  const byVal = new Map<number, number>()
  let idx = 0
  let prev: number | null = null
  for (const v of uniq) {
    if (prev !== null && v - prev > LEVEL_GAP) idx++
    byVal.set(v, idx)
    prev = v
  }
  return (v) => byVal.get(v) ?? -1
}

/**
 * Canonical structural signature of a pin cluster. Empty string for no pins (never
 * matches anything). Each axis is stretched to a unit span independently (aspect-
 * invariant — the same grid at different authored sizes matches), then reduced to
 * integer row/column LEVELS so authoring jitter can't split a level. Sorted, so pin
 * order is irrelevant. A single row and a single column stay distinct (one axis
 * collapses to level 0 while the other spreads).
 */
export function pinSignature(pins: SigPin[]): string {
  const pts = pins.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
  if (pts.length === 0) return ''
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const w = Math.max(...xs) - minX
  const h = Math.max(...ys) - minY
  const EPS = 1e-6
  const nxs = pts.map((p) => (w > EPS ? (p.x - minX) / w : 0))
  const nys = pts.map((p) => (h > EPS ? (p.y - minY) / h : 0))
  const col = levelIndex(nxs)
  const row = levelIndex(nys)
  const tokens = pts.map((p, i) => `${p.type}@${col(nxs[i])},${row(nys[i])}`).sort()
  return `${pts.length}|${tokens.join(';')}`
}

/** A part's own pins (flattened across headers), positioned ones only. */
export function partSigPins(part: PartDefinition): SigPin[] {
  const out: SigPin[] = []
  for (const h of part.headers ?? [])
    for (const p of h.pins ?? [])
      if (p.x !== undefined && p.y !== undefined) out.push({ type: p.type, x: p.x, y: p.y })
  return out
}

/** Signature of a whole board's pins — its dockable footprint as a SOURCE board. */
export function partSignature(part: PartDefinition): string {
  return pinSignature(partSigPins(part))
}

/** The pins imprinted into a carrier from one mount's footprint (#166) — the
 *  {@link PartPin.derived} pins tagged with this mount id. */
export function mountSigPins(carrier: PartDefinition, mountId: string): SigPin[] {
  const out: SigPin[] = []
  for (const h of carrier.headers ?? [])
    for (const p of h.pins ?? [])
      if (p.derived === mountId && p.x !== undefined && p.y !== undefined)
        out.push({ type: p.type, x: p.x, y: p.y })
  return out
}

/** Signature a carrier MOUNT accepts — from its imprinted pins. */
export function mountSignature(carrier: PartDefinition, mountId: string): string {
  return pinSignature(mountSigPins(carrier, mountId))
}

/** True when two signatures are the same non-empty layout (dock-compatible). */
export function signaturesMatch(a: string, b: string): boolean {
  return a !== '' && a === b
}
