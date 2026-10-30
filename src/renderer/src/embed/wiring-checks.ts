/**
 * PIN CHECKS FOR THE EMBEDDED WIRING CANVAS (snakie#1277, kevsrobots#268).
 * =============================================================================
 *
 * Warnings about a wiring, for a host to show beside the canvas. Never
 * blocking: a wiring with warnings still saves. Wires are grouped into nets
 * (every pin joined by wires, directly or through other pins), and each net is
 * read by the pin types the parts declare:
 *
 *  - a power pin and a ground pin on one net: a short
 *  - two of the board's own power pins with different names on one net (3V3
 *    joined to VBUS): two supplies fighting
 *  - two of the board's GPIO pins on one net: both drive the same wire
 *
 * plus a placed part whose power or ground pin isn't wired at all, and a
 * placed part the libraries don't have. Pure + DOM-free.
 */
import { resolvedPins } from '../components/part-editor.util'
import { findPart, type PartDefinition, type PartPin } from '../../../shared/part'
import type { RobotDefinition } from '../../../shared/robot'

export interface WiringWarning {
  /** `short` and `rails` are the ones that can damage a board. */
  kind: 'short' | 'rails' | 'gpio' | 'unwired' | 'missing'
  message: string
}

interface Pad {
  owner: string // 'board' or the part instance id
  label: string // for messages: "GP0", "SG90 V+"
  pin: PartPin | null
}

/** `board.GP0#0` → { owner: 'board', name: 'GP0', index: 0 }. */
export function parseEndpoint(end: string): { owner: string; name: string; index: number | null } | null {
  const m = /^([^.]+)\.(.+?)(?:#(\d+))?$/.exec(end ?? '')
  if (!m) return null
  return { owner: m[1], name: m[2], index: m[3] !== undefined ? Number(m[3]) : null }
}

function padOf(part: PartDefinition | null, name: string, index: number | null): PartPin | null {
  if (!part) return null
  const pins = resolvedPins(part).map((r) => r.pin)
  if (index !== null && pins[index] && pins[index].name === name) return pins[index]
  return pins.find((p) => p.name === name) ?? (index !== null ? (pins[index] ?? null) : null)
}

const pinText = (pin: PartPin | null, name: string): string => pin?.label || pin?.name || name

export function wiringWarnings(
  robot: RobotDefinition,
  libraries: { id: string; parts?: PartDefinition[] }[],
  board: PartDefinition | null
): WiringWarning[] {
  const out: WiringWarning[] = []
  const parts = new Map<string, PartDefinition | null>()
  const names = new Map<string, string>()
  for (const p of robot.parts ?? []) {
    const def = findPart(libraries, p.lib, p.part)
    parts.set(p.id, def)
    names.set(p.id, p.label || def?.name || p.part)
    if (!def) out.push({ kind: 'missing', message: `${p.label || p.part} isn't in this project's parts.` })
  }

  // Union-find over pad keys.
  const parent = new Map<string, string>()
  const pads = new Map<string, Pad>()
  const find = (k: string): string => {
    let r = k
    while (parent.get(r) !== r) r = parent.get(r) as string
    parent.set(k, r)
    return r
  }
  const pad = (end: string): string | null => {
    const e = parseEndpoint(end)
    if (!e) return null
    const owner = e.owner
    const def = owner === 'board' ? board : (parts.get(owner) ?? null)
    const pin = padOf(def, e.name, e.index)
    const key = `${owner}.${pin?.name ?? e.name}`
    if (!pads.has(key)) {
      pads.set(key, {
        owner,
        label: owner === 'board' ? pinText(pin, e.name) : `${names.get(owner) ?? owner} ${pinText(pin, e.name)}`,
        pin
      })
      parent.set(key, key)
    }
    return key
  }
  for (const c of robot.connections ?? []) {
    const a = pad(c.from)
    const b = pad(c.to)
    if (a && b) parent.set(find(a), find(b))
  }

  const nets = new Map<string, Pad[]>()
  for (const k of pads.keys()) {
    const r = find(k)
    nets.set(r, [...(nets.get(r) ?? []), pads.get(k) as Pad])
  }
  for (const net of nets.values()) {
    const pwr = net.filter((p) => p.pin?.type === 'pwr')
    const gnd = net.filter((p) => p.pin?.type === 'gnd')
    if (pwr.length && gnd.length) {
      out.push({
        kind: 'short',
        message: `${pwr[0].label} and ${gnd[0].label} are joined: that shorts power to ground.`
      })
    }
    const rails = [...new Set(pwr.filter((p) => p.owner === 'board').map((p) => p.label.toUpperCase()))]
    if (rails.length > 1) {
      out.push({ kind: 'rails', message: `${rails.join(' and ')} are joined: two supplies on one wire.` })
    }
    const gpio = net.filter((p) => p.owner === 'board' && p.pin?.type === 'io')
    if (gpio.length > 1) {
      out.push({
        kind: 'gpio',
        message: `${gpio.map((p) => p.label).join(' and ')} are joined: both pins drive the same wire.`
      })
    }
  }

  // A placed part's power and ground pins, unwired.
  for (const p of robot.parts ?? []) {
    const def = parts.get(p.id)
    if (!def || p.mountedOn) continue
    for (const { pin } of resolvedPins(def)) {
      if ((pin.type === 'pwr' || pin.type === 'gnd') && !pads.has(`${p.id}.${pin.name}`)) {
        out.push({ kind: 'unwired', message: `${names.get(p.id)}'s ${pinText(pin, pin.name)} isn't wired.` })
      }
    }
  }
  return out
}
