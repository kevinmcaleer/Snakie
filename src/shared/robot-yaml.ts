/**
 * `robot.yml` (de)serialisation for the robot definition file (#128).
 *
 * Tolerant on the way IN (coerces/defaults a hand-edited file) and tidy on the
 * way OUT (drops empty fields). Depends only on the `yaml` package; no
 * React/Node/Electron. Used by the main process (disk IO) and the tests.
 */

import { parse, stringify } from 'yaml'
import type { RobotConnection, RobotDefinition, RobotNet, RobotPart } from './robot'

const NETS: RobotNet[] = ['vcc', 'gnd', 'signal']

function str(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined
  const s = String(v).trim()
  return s === '' ? undefined : s
}
function num(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : (v as number)
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined
}

function coercePart(raw: unknown): RobotPart | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = str(r.id)
  const lib = str(r.lib)
  const part = str(r.part)
  if (!id || !lib || !part) return null
  const out: RobotPart = { id, lib, part }
  const label = str(r.label)
  if (label) out.label = label
  const x = num(r.x)
  const y = num(r.y)
  if (x !== undefined) out.x = x
  if (y !== undefined) out.y = y
  const rotation = num(r.rotation)
  if (rotation !== undefined) {
    const snapped = (((Math.round(rotation / 90) * 90) % 360) + 360) % 360
    if (snapped) out.rotation = snapped // drop a no-op 0
  }
  return out
}

function coerceConnection(raw: unknown): RobotConnection | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const from = str(r.from)
  const to = str(r.to)
  if (!from || !to) return null
  const out: RobotConnection = { id: str(r.id) ?? `${from}__${to}`, from, to }
  if (NETS.includes(r.net as RobotNet)) out.net = r.net as RobotNet
  const color = str(r.color)
  if (color) out.color = color
  return out
}

/** Serialise a {@link RobotDefinition} to `robot.yml` text (drops empties). */
export function robotToYaml(def: RobotDefinition): string {
  const obj: Record<string, unknown> = {}
  if (str(def.name)) obj.name = def.name
  if (str(def.board)) obj.board = def.board
  if (typeof def.boardX === 'number') obj.boardX = def.boardX
  if (typeof def.boardY === 'number') obj.boardY = def.boardY
  obj.parts = (def.parts ?? []).map((p) => {
    const o: Record<string, unknown> = { id: p.id, lib: p.lib, part: p.part }
    if (p.label) o.label = p.label
    if (p.x !== undefined) o.x = p.x
    if (p.y !== undefined) o.y = p.y
    if (p.rotation) o.rotation = p.rotation // omit 0
    return o
  })
  obj.connections = (def.connections ?? []).map((c) => {
    const o: Record<string, unknown> = { id: c.id, from: c.from, to: c.to }
    if (c.net) o.net = c.net
    if (c.color) o.color = c.color
    return o
  })
  return stringify(obj, { lineWidth: 0 })
}

/** Parse `robot.yml` text into a {@link RobotDefinition}. Never throws on a
 *  structurally-odd doc (returns empty parts/connections). */
export function robotFromYaml(text: string): RobotDefinition {
  const raw = (parse(text) ?? {}) as Record<string, unknown>
  const def: RobotDefinition = {
    parts: Array.isArray(raw.parts)
      ? raw.parts.map(coercePart).filter((p): p is RobotPart => p !== null)
      : [],
    connections: Array.isArray(raw.connections)
      ? raw.connections.map(coerceConnection).filter((c): c is RobotConnection => c !== null)
      : []
  }
  if (str(raw.name)) def.name = str(raw.name)
  if (str(raw.board)) def.board = str(raw.board)
  const bx = num(raw.boardX)
  const by = num(raw.boardY)
  if (bx !== undefined) def.boardX = bx
  if (by !== undefined) def.boardY = by
  return def
}
