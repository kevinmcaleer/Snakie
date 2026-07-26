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
  return 'JST'
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
  const pairs = pairContacts(a, b)
  if (!pairs.some(([ia]) => SIGNAL_ROLES.has(cableRole(a.pins[ia])))) {
    return NO(`These two share no signal — a lead between them would only join power and ground.`)
  }
  if (aDupont && bDupont && a.pins.length !== b.pins.length) {
    return NO(`A ${a.pins.length}-way lead doesn't fit a ${b.pins.length}-way header.`)
  }
  return { ok: true, pairs }
}
