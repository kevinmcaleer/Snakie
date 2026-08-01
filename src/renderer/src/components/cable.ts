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
 * The angle a plug sits at for a HOUSED GROUP, from the housing itself (#697).
 *
 * A stored connector's contacts are laid out from its body, so they all share one
 * outward normal and averaging them is exact. A housed group's contacts are
 * ordinary pins that each work out their own facing — and in a servo trio only
 * the signal pin carries a rotation, so the three disagree and the average comes
 * out at a diagonal. That is the plug drawn at an angle.
 *
 * They are one physical connector, so the facing is a property of the HOUSING: a
 * lead goes in perpendicular to the row of contacts, and outward from the board.
 * A column of contacts is entered from the side; a row from above or below.
 *
 * Returned in the same convention as {@link plugAngle} — degrees of the outward
 * normal — and in PART space, so the caller must turn it with the placed part.
 */
export function housingPlugAngle(conn: PartConnector): number {
  const column = ((conn.rotation ?? 0) / 90) % 2 === 1
  if (column) return conn.x < 0.5 ? 180 : 0 // entered from the left / right
  return conn.y < 0.5 ? -90 : 90 //            entered from above / below
}

/**
 * The angle (degrees) a cable plug sits at, from its connector's contact normals.
 *
 * A plug is part of the SOCKET it's pushed into, so its orientation belongs to the
 * part it's mounted on — not to whatever happens to be wired to it. Deriving it
 * from the mate's position (as this once did) made every header swing round to
 * face the other component, and re-orient again whenever that component moved.
 * Only the lead between them should move.
 *
 * Each contact carries an outward normal that is already rotated with the placed
 * part, so averaging them gives the direction the lead leaves the socket, in world
 * space. Contacts of one connector share a normal; the average is a cheap way to
 * be robust to a malformed part whose contacts disagree.
 *
 * Returns `0` for an empty or degenerate set (normals that cancel out), so a bad
 * part yields a consistently-placed plug rather than a NaN transform.
 */
export function plugAngle(normals: readonly { ox: number; oy: number }[]): number {
  if (normals.length === 0) return 0
  let nx = 0
  let ny = 0
  for (const n of normals) {
    nx += n.ox
    ny += n.oy
  }
  nx /= normals.length
  ny /= normals.length
  if (Math.hypot(nx, ny) < 1e-6) return 0
  return (Math.atan2(ny, nx) * 180) / Math.PI
}
