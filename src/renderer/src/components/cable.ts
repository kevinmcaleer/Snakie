/**
 * CABLES (#164/#165) — what joins two connectors, and whether it may.
 *
 * A cable in the Board View isn't a bundle of arbitrary wires: it's a physical
 * lead with a fixed number of conductors in fixed colours, and it only fits
 * sockets it was made for. Two things follow, and both live here as pure
 * functions so the canvas stays a renderer:
 *
 *  1. **Which contact joins which.** Contact order on a {@link PartConnector} is
 *     its orientation, so a straight lead between two identical sockets joins
 *     contact-for-contact. Only a cross-family adapter lead (Grove ↔ QWIIC) has
 *     to fall back to matching by signal role.
 *  2. **Whether it fits at all.** A servo lead doesn't go in a Grove socket, and
 *     a Grove I²C module doesn't belong in a Grove UART port. Refusing those —
 *     and saying why — is the whole reason connectors are drawn to scale.
 *
 * Orientation falls out for free: because pairing is by contact/role and never
 * by drag direction, a servo lead dragged on "backwards" still lands Signal to
 * Signal, V+ to V+, GND to GND.
 */
import { coerceJstFamily } from '../../../shared/part'
import type { PartConnector, PartPin } from '../../../shared/part'

/**
 * Conductor colours of the real cable, **in contact order** — so conductor `i`
 * is the colour of contact `i + 1`. These are the actual ribbon colours, which is
 * what makes a cable identifiable at a glance:
 *  - Grove  — yellow · white · red · black
 *  - QWIIC  — black · red · blue · yellow (GND · 3V3 · SDA · SCL)
 *  - DuPont — orange · red · brown (the standard servo lead)
 *
 * A plain `jst` has no standard colours; its wires keep their net colour.
 */
export const CABLE_COLOURS: Partial<Record<PartConnector['kind'], readonly string[]>> = {
  grove: ['#e8c33a', '#eceae1', '#d2392f', '#23262b'],
  qwiic: ['#23262b', '#d2392f', '#2f6fb3', '#e8c33a'],
  dupont: ['#e08a2e', '#d2392f', '#7a5230']
}

/** The colour of one conductor, or `undefined` when the kind has no standard
 *  colours (or the cable has more contacts than the standard lead). */
export function conductorColour(kind: PartConnector['kind'], contact: number): string | undefined {
  return CABLE_COLOURS[kind]?.[contact]
}

/** The signal a contact carries, reduced to what a cable cares about. */
export type CableRole = 'sda' | 'scl' | 'tx' | 'rx' | 'sig' | 'pwr' | 'gnd' | null

/** Roles that carry a signal (as opposed to power) — a cable joining only power
 *  and ground isn't a connection, it's a short with extra steps. */
const SIGNAL_ROLES: ReadonlySet<CableRole> = new Set<CableRole>(['sda', 'scl', 'tx', 'rx', 'sig'])

/** Classify a contact. Explicit `signals` win over the pin's name, so a contact
 *  named `D0` that's designated SDA is still matched as SDA. */
export function cableRole(pin: PartPin): CableRole {
  if (pin.type === 'gnd') return 'gnd'
  if (pin.type === 'pwr') return 'pwr'
  const name = (pin.name ?? '').trim().toUpperCase()
  if (pin.signals?.i2c === 'SDA' || name === 'SDA') return 'sda'
  if (pin.signals?.i2c === 'SCL' || name === 'SCL') return 'scl'
  if (pin.signals?.uart === 'TX' || name === 'TX') return 'tx'
  if (pin.signals?.uart === 'RX' || name === 'RX') return 'rx'
  // `NC` is a deliberately unconnected contact — pairing it would invent a wire.
  if (name === 'NC' || name === '') return null
  return pin.type === 'io' ? 'sig' : null
}

/** Human name for a connector kind/variant, for the "why not" message. */
export function connectorKindName(c: PartConnector): string {
  if (c.kind === 'grove') return c.variant ? `Grove ${c.variant.toUpperCase()}` : 'Grove'
  if (c.kind === 'dupont') return c.pins.length === 3 ? 'servo header' : 'DuPont header'
  if (c.kind === 'qwiic') return 'QWIIC'
  if (c.kind === 'terminal') return `${c.pins.length}-way terminal block`
  const fam = coerceJstFamily(c.variant)
  return fam ? `JST-${fam.toUpperCase()}` : 'JST'
}

/**
 * Which contacts a lead between `a` and `b` joins, as `[indexInA, indexInB]`.
 *
 * Identical sockets are joined **contact-for-contact** — that is literally what a
 * straight lead does, and it keeps a Grove UART port's TX/RX the way the modules
 * expect (the crossover lives in the board wiring, not the cable). Anything else
 * is an adapter lead, matched by role.
 */
export function pairContacts(a: PartConnector, b: PartConnector): [number, number][] {
  const sameHousing =
    a.kind === b.kind && (a.variant ?? null) === (b.variant ?? null) && a.pins.length === b.pins.length
  if (sameHousing) {
    return a.pins
      .map((pin, i): [number, number] | null => (cableRole(pin) ? [i, i] : null))
      .filter((p): p is [number, number] => p !== null)
  }
  const pairs: [number, number][] = []
  const takenB = new Set<number>()
  a.pins.forEach((pa, ia) => {
    const role = cableRole(pa)
    if (!role) return
    const ib = b.pins.findIndex((pb, i) => !takenB.has(i) && cableRole(pb) === role)
    if (ib < 0) return
    takenB.add(ib)
    pairs.push([ia, ib])
  })
  return pairs
}

/** Whether a lead may join two connectors, and if not, why not — phrased for a
 *  tooltip the user reads while still dragging. */
export interface CableFit {
  ok: boolean
  /** Present when `ok` is false: one sentence naming the actual mismatch. */
  reason?: string
  /** The contacts the lead would join (empty when it doesn't fit). */
  pairs: [number, number][]
}

const NO = (reason: string): CableFit => ({ ok: false, reason, pairs: [] })

/**
 * Can a lead run between these two connectors?
 *
 * DuPont blocks only mate other DuPont blocks — a servo lead has no shell and
 * won't enter a Grove socket. Grove ports of different variants are the same
 * housing wired differently, which is exactly the mistake worth catching: the
 * plug fits, so nothing physical stops you, and the module simply never responds.
 */
export function connectorFit(a: PartConnector, b: PartConnector): CableFit {
  const aDupont = a.kind === 'dupont'
  const bDupont = b.kind === 'dupont'
  if (aDupont !== bDupont) {
    const [lead, socket] = aDupont ? [a, b] : [b, a]
    return NO(`A ${connectorKindName(lead)} lead doesn't fit a ${connectorKindName(socket)} socket.`)
  }
  if (a.kind === 'grove' && b.kind === 'grove' && a.variant && b.variant && a.variant !== b.variant) {
    return NO(`That's a ${connectorKindName(b)} port — this one is ${connectorKindName(a)}.`)
  }
  // JST families differ by PITCH, so unlike Grove these genuinely can't seat —
  // refusing is describing the housing, not second-guessing the user (#668).
  if (a.kind === 'jst' && b.kind === 'jst') {
    const fa = coerceJstFamily(a.variant) ?? 'ph'
    const fb = coerceJstFamily(b.variant) ?? 'ph'
    if (fa !== fb) {
      return NO(`A ${connectorKindName(a)} lead doesn't fit a ${connectorKindName(b)} socket.`)
    }
  }
  const pairs = pairContacts(a, b)
  if (!pairs.some(([ia]) => SIGNAL_ROLES.has(cableRole(a.pins[ia])))) {
    return NO(`These two share no signal — a lead between them would only join power and ground.`)
  }
  if (aDupont && bDupont && a.pins.length !== b.pins.length) {
    return NO(`A ${a.pins.length}-way lead doesn't fit a ${b.pins.length}-way header.`)
  }
  return { ok: true, pairs }
}

/**
 * The angle a plug sits at — the ONE rule, for every connector kind (#697).
 *
 * Seen from above, a plug's shell covers the contacts it is pushed onto and the
 * cable leaves one END of that shell. So the angle runs ALONG the row of
 * contacts, not across it: a COLUMN of contacts takes its lead off the top or
 * bottom, a ROW off one side. Which end is the one nearer the board edge, so the
 * cable runs off the board rather than back across it.
 *
 * This deliberately replaced averaging the contacts' outward normals, which was
 * a second rule that only agreed with this one for connectors stored in
 * `connectors[]`. A HOUSED GROUP's contacts are ordinary pins that each work out
 * their own facing, so in a servo trio — where only the signal pin carries a
 * rotation — the three disagree and their average lands on a diagonal. That was
 * the plug drawn at an angle. Deriving from the housing instead means a new
 * connector kind cannot reintroduce the split, because there is nothing to keep
 * in step: the housing is the only thing consulted.
 *
 * A plug is part of the SOCKET it is pushed into, so this reads only the part it
 * is mounted on and never the mate. Deriving it from whatever is wired up (as
 * this once did) made every header swing round to face the other component, and
 * swing again whenever that component moved (#647). Only the lead should move.
 *
 * Degrees, in PART space — the caller turns it with the placed part.
 */
export function housingPlugAngle(conn: PartConnector): number {
  // The lead leaves through the housing's MOUTH, which is a LONG side — the face
  // the contacts look out of — not off one end. A QWIIC socket sitting along a
  // board's bottom edge takes its cable downward, out of the board; it does not
  // take it sideways out of the shell's end. (It used to do the latter, which
  // put the boot on a short edge and made leads enter a board from the side.)
  //
  // So: contacts in a ROW take their lead up or down, contacts in a COLUMN take
  // it left or right — in each case away from the middle of the part, which is
  // where the outside is.
  const column = ((conn.rotation ?? 0) / 90) % 2 === 1
  if (column) return conn.x < 0.5 ? 180 : 0 // column of contacts → out the side
  return conn.y < 0.5 ? -90 : 90 //            row of contacts   → out top/bottom
}
