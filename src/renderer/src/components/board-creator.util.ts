/**
 * Pure (DOM-free) helpers backing the Board Creator (issue #94).
 *
 * Everything in here is plain data-in / data-out so it can be unit-tested in a
 * node environment (mirrors `parse-pins.ts`, `Plotter.parse.ts`, etc.). The
 * React component (`BoardCreator.tsx`) is a thin shell over these functions.
 *
 * The {@link BoardDefinition} JSON is the **single round-trippable source of
 * truth**: a saved board re-loads back into the editor unchanged (see
 * {@link normaliseBoard} + the `def → JSON → parse` round-trip the tests assert).
 * SVG export (in the component) is a one-way convenience and is NOT how boards
 * are stored.
 */

import { mergeBoards } from './board-defs'
import type {
  BoardDefinition,
  BoardFeature,
  BoardHeader,
  BoardPad,
  BoardPadType
} from '../../../shared/board'

/** The pad types the creator offers, in UI order. */
export const PAD_TYPES: BoardPadType[] = ['gpio', 'gnd', 'vcc', 'other']

/** Human labels for each pad type (creator UI + docs). */
export const PAD_TYPE_LABEL: Record<BoardPadType, string> = {
  gpio: 'GPIO',
  gnd: 'GND',
  vcc: 'VCC',
  other: 'Other'
}

/** The feature kinds the creator offers, in UI order. */
export const FEATURE_KINDS: BoardFeature['kind'][] = ['mcu', 'wifi', 'usb', 'chip', 'led']

/** The header edges the creator offers, in UI order. */
export const HEADER_EDGES: BoardHeader['edge'][] = ['left', 'right', 'top', 'bottom']

/**
 * Sanitise a free-text name/id into a safe board id stem: lower-case, keep only
 * `[a-z0-9-_]`, collapse runs of anything else to a single `-`, trim leading /
 * trailing `-`. MUST match `sanitiseId` in `src/main/board.ts` so the renderer
 * preview of the filename agrees with what main actually writes.
 */
export function sanitiseBoardId(input: string): string {
  return String(input ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Clamp a number into `[min,max]`, treating non-finite input as `min`. */
function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}

/**
 * A fresh, sensible blank board: one left + one right header (a couple of pads
 * each, incl. a power pad) and a centre MCU feature, so the preview shows
 * something immediately. `id` is derived from the name on save.
 */
export function blankBoard(): BoardDefinition {
  return {
    id: 'my-board',
    name: 'My Board',
    mcu: 'RP2040',
    pcbColor: '#0f5a2e',
    aspect: 0.52,
    ledLabel: 'LED',
    features: [{ label: 'MCU', kind: 'mcu', x: 0.32, y: 0.42, w: 0.36, h: 0.18 }],
    headers: [
      {
        edge: 'left',
        pins: [
          { gpio: 0, label: 'GP0', name: 'GPIO 0', type: 'gpio' },
          { gpio: 1, label: 'GP1', name: 'GPIO 1', type: 'gpio' },
          { label: 'GND', name: 'Ground', type: 'gnd' }
        ]
      },
      {
        edge: 'right',
        pins: [
          { label: '3V3', name: '3.3V Out', type: 'vcc' },
          { gpio: 2, label: 'GP2', name: 'GPIO 2', type: 'gpio' },
          { gpio: 3, label: 'GP3', name: 'GPIO 3', type: 'gpio' }
        ]
      }
    ]
  }
}

/** A fresh blank pad (defaults to a GPIO pad). */
export function blankPad(): BoardPad {
  return { label: 'GP0', name: '', type: 'gpio', gpio: 0 }
}

/** A fresh blank header on the given edge (defaults to a single GPIO pad). */
export function blankHeader(edge: BoardHeader['edge'] = 'left'): BoardHeader {
  return { edge, pins: [blankPad()] }
}

/** A fresh blank feature (a centre chip). */
export function blankFeature(): BoardFeature {
  return { label: 'CHIP', kind: 'chip', x: 0.35, y: 0.4, w: 0.3, h: 0.2 }
}

/** Normalise a single pad: default the type to `'gpio'`, coerce/clean fields. */
function normalisePad(pad: BoardPad): BoardPad {
  const type: BoardPadType = PAD_TYPES.includes(pad.type as BoardPadType)
    ? (pad.type as BoardPadType)
    : 'gpio'
  const out: BoardPad = { label: String(pad.label ?? '').trim(), type }
  // Only GPIO pads carry a numeric gpio (power/other pads never wire).
  if (type === 'gpio' && typeof pad.gpio === 'number' && Number.isFinite(pad.gpio)) {
    out.gpio = pad.gpio
  }
  const name = String(pad.name ?? '').trim()
  if (name) out.name = name
  return out
}

/** Normalise a feature: clamp normalised coords, default the kind. */
function normaliseFeature(f: BoardFeature): BoardFeature {
  const kind = FEATURE_KINDS.includes(f.kind) ? f.kind : 'chip'
  return {
    label: String(f.label ?? '').trim(),
    kind,
    // Allow slight overhang (USB nub) but keep within sane bounds.
    x: clamp(f.x, -0.2, 1.2),
    y: clamp(f.y, -0.2, 1.2),
    w: clamp(f.w, 0.01, 1.4),
    h: clamp(f.h, 0.01, 1.4)
  }
}

/**
 * Normalise + minimally validate a working {@link BoardDefinition} into a
 * clean, drawable, round-trippable form:
 *  - defaults each pad's `type` to `'gpio'`,
 *  - drops empty headers (no pads) and pads with no label,
 *  - clamps feature coords, defaults aspect, keeps `image`/`ledLabel` verbatim.
 *
 * Pure: returns a NEW object; never throws. The result equals its own
 * `JSON.parse(JSON.stringify(...))` (the round-trip the tests assert).
 */
export function normaliseBoard(def: BoardDefinition): BoardDefinition {
  const headers: BoardHeader[] = (Array.isArray(def.headers) ? def.headers : [])
    .map((h) => ({
      edge: HEADER_EDGES.includes(h.edge) ? h.edge : 'left',
      pins: (Array.isArray(h.pins) ? h.pins : []).map(normalisePad).filter((p) => p.label !== '')
    }))
    .filter((h) => h.pins.length > 0)

  const out: BoardDefinition = {
    id: sanitiseBoardId(def.id) || 'my-board',
    name: String(def.name ?? '').trim() || 'Untitled Board',
    mcu: String(def.mcu ?? '').trim(),
    pcbColor: String(def.pcbColor ?? '').trim() || '#0f5a2e',
    aspect: Number.isFinite(def.aspect) && def.aspect > 0 ? def.aspect : 0.52,
    headers
  }

  const ledLabel = String(def.ledLabel ?? '').trim()
  if (ledLabel) out.ledLabel = ledLabel

  if (Array.isArray(def.features) && def.features.length > 0) {
    out.features = def.features.map(normaliseFeature).filter((f) => f.label !== '')
  }

  if (typeof def.image === 'string' && def.image.length > 0) out.image = def.image

  return out
}

/** A blocking-error string if the board can't be saved, else null. */
export function validateBoard(def: BoardDefinition): string | null {
  if (!sanitiseBoardId(def.id)) return 'Give the board a name (it becomes the saved id).'
  const headers = Array.isArray(def.headers) ? def.headers : []
  const padCount = headers.reduce((n, h) => n + (h.pins?.length ?? 0), 0)
  if (padCount === 0) return 'Add at least one pad to a header.'
  return null
}

/** All labels/pad names declared on the board — the `ledLabel` picker options. */
export function ledLabelOptions(def: BoardDefinition): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const h of def.headers ?? []) {
    for (const p of h.pins ?? []) {
      const lbl = String(p.label ?? '').trim()
      if (lbl && !seen.has(lbl)) {
        seen.add(lbl)
        out.push(lbl)
      }
    }
  }
  return out
}

/**
 * True if saving `def` would collide with an EXISTING board the creator didn't
 * just open (a built-in id or another user board). Used to warn before save.
 */
export function idCollides(
  def: BoardDefinition,
  userBoards: BoardDefinition[],
  openedId: string | null
): boolean {
  const id = sanitiseBoardId(def.id)
  if (!id) return false
  if (openedId && sanitiseBoardId(openedId) === id) return false
  return mergeBoards(userBoards).some((b) => sanitiseBoardId(b.id) === id)
}

/** Serialize a board to the exact pretty JSON the main process writes. */
export function toJson(def: BoardDefinition): string {
  return JSON.stringify(normaliseBoard(def), null, 2)
}

/** Parse a board back from JSON (the load-from-disk round-trip). Throws on bad JSON. */
export function fromJson(json: string): BoardDefinition {
  return normaliseBoard(JSON.parse(json) as BoardDefinition)
}
