/**
 * Footprint imprinting (#166, phase 2) — stamping a reference board's real pins
 * into a carrier's mount. Adding a footprint isn't a labelled rectangle: it copies
 * the reference MCU's actual pads (type + position + name + GPIO) into the carrier
 * as {@link PartPin.derived} pins — locked, read-only, sized + placed at the mount —
 * so the carrier gains real, wireable pins for a seated board to bond onto, and the
 * mount's structural signature (see {@link ./footprint-signature}) comes straight
 * from them.
 *
 * A SNAPSHOT (per the design): the pins are copied at imprint time; {@link PartMount.ref}
 * records the source so the editor can re-imprint ("re-sync from source"). Pure +
 * dependency-light so the Part Editor and tests share one imprint definition.
 */

import type { PartDefinition, PartMount, PartPin } from './part'
import { slugifyFootprint } from './footprints'

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))

/** Where the mount sits + how it's turned — the transform an imprint needs. */
export interface MountPlacement {
  id: string
  /** Normalised centre of the footprint block within the carrier. */
  x: number
  y: number
  /** Block rotation in degrees (0/90/180/270). */
  rotation?: number
  /** Optional silk label + footprint tag overrides (else derived from the source). */
  label?: string
  footprint?: string
}

/** The footprint block's size as a fraction of the carrier — from real mm
 *  dimensions when both boards have them (physically to scale), else a default. */
function blockFraction(
  ref: PartDefinition,
  carrier: PartDefinition
): { fw: number; fh: number; mm: boolean } {
  const rw = ref.dimensions?.width
  const rh = ref.dimensions?.height
  const cw = carrier.dimensions?.width
  const ch = carrier.dimensions?.height
  if (rw && rh && cw && ch && cw > 0 && ch > 0) {
    return { fw: clamp01(rw / cw), fh: clamp01(rh / ch), mm: true }
  }
  return { fw: 0.3, fh: 0.3, mm: false }
}

const rotate = (x: number, y: number, deg: number): { x: number; y: number } => {
  const r = (deg * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  return { x: x * c - y * s, y: x * s + y * c }
}

/**
 * The derived pins for one mount: the reference board's positioned pins, scaled to
 * the reference's real size within the carrier, rotated about the mount centre, and
 * placed at it. Names / types / GPIO / capabilities are carried through; each pin is
 * flagged `derived = mount.id` and `locked` so it's read-only in the editor.
 */
export function imprintPins(
  ref: PartDefinition,
  mount: MountPlacement,
  carrier: PartDefinition
): PartPin[] {
  const { fw, fh, mm } = blockFraction(ref, carrier)
  const rot = (((mount.rotation ?? 0) % 360) + 360) % 360
  const cw = carrier.dimensions?.width ?? 1
  const ch = carrier.dimensions?.height ?? 1
  const out: PartPin[] = []
  for (const h of ref.headers ?? []) {
    for (const p of h.pins ?? []) {
      if (p.x === undefined || p.y === undefined) continue
      // Offset from the reference board's centre, in its own normalised frame.
      const ox = (p.x - 0.5) * fw
      const oy = (p.y - 0.5) * fh
      // Rotate isotropically in mm (so a non-square carrier doesn't shear the
      // block), then convert back to carrier-normalised space.
      const r = mm && cw > 0 && ch > 0 ? rotate(ox * cw, oy * ch, rot) : rotate(ox, oy, rot)
      const nx = mm && cw > 0 ? mount.x + r.x / cw : mount.x + r.x
      const ny = mm && ch > 0 ? mount.y + r.y / ch : mount.y + r.y
      const np: PartPin = {
        name: p.name,
        type: p.type,
        x: clamp01(nx),
        y: clamp01(ny),
        derived: mount.id,
        // Read-only, and its silk annotation is suppressed — a dense imprinted block
        // (e.g. a XIAO's 14 pins mid-board) would otherwise draw 14 edge leaders. The
        // type-coloured pads convey the footprint; names live on for bonding + hover.
        locked: true,
        labelHidden: true
      }
      if (p.number !== undefined) np.number = p.number
      if (p.type === 'io' && p.gpio !== undefined) np.gpio = p.gpio
      if (p.type === 'io' && p.capabilities?.length) np.capabilities = [...p.capabilities]
      if (p.type === 'io' && p.signals) np.signals = { ...p.signals }
      if (p.type === 'io' && p.buses) np.buses = { ...p.buses }
      if (p.shape) np.shape = p.shape
      if (p.label && p.label !== p.name) np.label = p.label
      out.push(np)
    }
  }
  return out
}

/** Strip a mount's derived pins out of a carrier (dropping any header left empty). */
function stripDerived(carrier: PartDefinition, mountId: string): PartDefinition {
  const headers = (carrier.headers ?? [])
    .map((h) => ({ ...h, pins: h.pins.filter((p) => p.derived !== mountId) }))
    .filter((h) => h.pins.length > 0)
  return { ...carrier, headers }
}

/**
 * Add or refresh a mount's footprint: replace its derived pins with a fresh imprint
 * (in their own header) and upsert the {@link PartMount} carrying `ref`. Used for the
 * initial "add footprint", a rotate, and "re-sync from source".
 */
export function applyImprint(
  carrier: PartDefinition,
  ref: PartDefinition,
  refId: { lib: string; part: string },
  mount: MountPlacement
): PartDefinition {
  const base = stripDerived(carrier, mount.id)
  const pins = imprintPins(ref, mount, carrier)
  // Free-positioned pins (x/y drive placement), so `edge` is only nominal here.
  const headers = [...(base.headers ?? []), { edge: 'left' as const, pins }]
  const mounts = [...(base.mounts ?? [])]
  const footprint =
    slugifyFootprint(mount.footprint ?? '') ||
    slugifyFootprint(ref.footprint ?? '') ||
    slugifyFootprint(ref.name ?? ref.id ?? mount.id)
  const entry: PartMount = {
    id: mount.id,
    footprint,
    ref: refId,
    x: clamp01(mount.x),
    y: clamp01(mount.y)
  }
  if (mount.rotation) entry.rotation = mount.rotation
  if (mount.label) entry.label = mount.label
  const idx = mounts.findIndex((m) => m.id === mount.id)
  if (idx >= 0) mounts[idx] = entry
  else mounts.push(entry)
  return { ...base, headers, mounts }
}

/** Remove a mount and its derived pins from a carrier. */
export function removeMountImprint(carrier: PartDefinition, mountId: string): PartDefinition {
  const base = stripDerived(carrier, mountId)
  return { ...base, mounts: (base.mounts ?? []).filter((m) => m.id !== mountId) }
}

/**
 * Translate a mount and its derived pins by a delta (for a cheap on-canvas DRAG that
 * needs no reference board — the block just shifts rigidly). Positions are clamped.
 */
export function translateMount(carrier: PartDefinition, mountId: string, dx: number, dy: number): PartDefinition {
  const headers = (carrier.headers ?? []).map((h) => ({
    ...h,
    pins: h.pins.map((p) =>
      p.derived === mountId && p.x !== undefined && p.y !== undefined
        ? { ...p, x: clamp01(p.x + dx), y: clamp01(p.y + dy) }
        : p
    )
  }))
  const mounts = (carrier.mounts ?? []).map((m) =>
    m.id === mountId ? { ...m, x: clamp01(m.x + dx), y: clamp01(m.y + dy) } : m
  )
  return { ...carrier, headers, mounts }
}
