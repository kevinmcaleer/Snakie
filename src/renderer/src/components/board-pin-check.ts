/**
 * BOARD-AWARE BUS PIN CHECK
 * =========================
 *
 * Validates the I2C / SPI / UART wiring in a MicroPython file against the
 * currently-selected board's real per-pin bus data (each board pin carries its
 * fixed-function `signals` — SDA/SCL, SCK/TX/RX/CSn, TX/RX — and `buses` — the
 * hardware instance number, e.g. I2C0 vs I2C1). It flags:
 *
 *   1. a pin used for a bus role that the board can't do on that bus at all,
 *   2. the constructor `id` not matching the bus the chosen pins belong to
 *      (with a quick-fix to correct the id),
 *   3. a pin used in the wrong role (SDA where SCL is expected — swapped),
 *   4. the role pins resolving to two DIFFERENT hardware buses.
 *
 * Pure + DOM-free (no `monaco`), so it unit-tests directly. The Monaco layer
 * ({@link ./board-pin-diagnostics}) turns {@link BusDiagnostic}s into squiggles +
 * a code action. Positions are 1-based (line, column) to match Monaco markers.
 */
import { buildPinVarMap, resolvePinToken } from './parse-pins'

/** One board pin's bus-relevant data (projected from a PartDefinition pin). */
export interface BoardPinInfo {
  gpio: number
  label: string
  capabilities: string[]
  signals?: { i2c?: string; spi?: string; uart?: string; pwm?: string }
  buses?: { i2c?: number; spi?: number; uart?: number; adc?: number }
}

/** A problem found in the wiring, with an optional one-click fix. */
export interface BusDiagnostic {
  line: number
  startCol: number
  endCol: number
  message: string
  severity: 'error' | 'warning'
  /** Quick-fix: replace [line, startCol..endCol] with `text` (correct the id). */
  fix?: { title: string; line: number; startCol: number; endCol: number; text: string }
}

type BusKey = 'i2c' | 'spi' | 'uart'

/** Each bus constructor's role kwargs → the board `signals` value they require. */
const BUS_SPECS: Record<string, { busKey: BusKey; label: string; roles: Record<string, string> }> = {
  I2C: { busKey: 'i2c', label: 'I2C', roles: { sda: 'SDA', scl: 'SCL' } },
  // RP-family SPI signal names: mosi = TX (master-out), miso = RX (master-in).
  SPI: { busKey: 'spi', label: 'SPI', roles: { sck: 'SCK', mosi: 'TX', miso: 'RX', cs: 'CSn' } },
  UART: { busKey: 'uart', label: 'UART', roles: { tx: 'TX', rx: 'RX' } }
}

const VAL = `"[^"]*"|'[^']*'|[^,)\\s]+`

/** Strip surrounding quotes from a value token. */
function unquote(s: string): string {
  const m = s.match(/^(?:"([^"]*)"|'([^']*)')$/)
  return (m ? (m[1] ?? m[2]) : s).trim()
}

/** Find the matched closing `)` for the `(` at `openIdx` within a single line. */
function matchParen(src: string, openIdx: number): number {
  let depth = 0
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === '(') depth++
    else if (src[i] === ')') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

interface RolePin {
  roleKw: string
  expected: string
  token: string
  resolved: string
  startCol: number
  endCol: number
}
interface BusUsage {
  type: keyof typeof BUS_SPECS
  busKey: BusKey
  line: number
  ctorStartCol: number
  ctorEndCol: number
  idValue?: number
  idRange?: { startCol: number; endCol: number }
  pins: RolePin[]
}

/** Scan `source` for I2C/SPI/UART constructors, capturing the bus id + each role
 *  kwarg's pin token with 1-based source positions (single-line constructors). */
function findBusUsages(source: string, varMap: Map<string, string>): BusUsage[] {
  const out: BusUsage[] = []
  const lines = source.split('\n')
  for (let li = 0; li < lines.length; li++) {
    const rawLine = lines[li]
    const hash = rawLine.indexOf('#')
    const line = hash >= 0 ? rawLine.slice(0, hash) : rawLine
    const ctor = line.match(/(?:machine\.)?(I2C|SPI|UART)\s*\(/)
    if (!ctor) continue
    const type = ctor[1] as keyof typeof BUS_SPECS
    const spec = BUS_SPECS[type]
    const openIdx = line.indexOf('(', ctor.index)
    const closeIdx = matchParen(line, openIdx)
    const argsStart = openIdx + 1
    const args = (closeIdx > openIdx ? line.slice(argsStart, closeIdx) : line.slice(argsStart))

    const usage: BusUsage = {
      type,
      busKey: spec.busKey,
      line: li + 1,
      ctorStartCol: (ctor.index ?? 0) + 1,
      ctorEndCol: (closeIdx > openIdx ? closeIdx + 1 : line.length) + 1,
      pins: []
    }

    // Bus id: `id=N` kwarg, else the first bare positional integer.
    const idKw = args.match(/\bid\s*=\s*(\d+)/i)
    if (idKw) {
      const digitsRel = idKw.index! + idKw[0].length - idKw[1].length
      usage.idValue = Number(idKw[1])
      usage.idRange = { startCol: argsStart + digitsRel + 1, endCol: argsStart + digitsRel + idKw[1].length + 1 }
    } else {
      const idPos = args.match(/^(\s*)(\d+)\s*(?:,|$)/)
      if (idPos) {
        const rel = idPos[1].length
        usage.idValue = Number(idPos[2])
        usage.idRange = { startCol: argsStart + rel + 1, endCol: argsStart + rel + idPos[2].length + 1 }
      }
    }

    // Role kwargs (sda=/scl=/sck=/…): capture the value token + its span.
    for (const [roleKw, expected] of Object.entries(spec.roles)) {
      const kw = new RegExp(`\\b${roleKw}\\s*=\\s*`, 'i').exec(args)
      if (!kw) continue
      const valStart = kw.index + kw[0].length
      const rest = args.slice(valStart)
      const pinM = rest.match(new RegExp(`^(?:machine\\.)?Pin\\(\\s*(${VAL})\\s*\\)`))
      const bareM = rest.match(new RegExp(`^(${VAL})`))
      const full = pinM ? pinM[0] : bareM ? bareM[1] : ''
      const raw = pinM ? pinM[1] : bareM ? bareM[1] : ''
      if (!full) continue
      const token = unquote(raw)
      usage.pins.push({
        roleKw,
        expected,
        token,
        resolved: resolvePinToken(token, varMap),
        startCol: argsStart + valStart + 1,
        endCol: argsStart + valStart + full.length + 1
      })
    }
    if (usage.pins.length > 0 || usage.idValue !== undefined) out.push(usage)
  }
  return out
}

/** Resolve a (possibly variable-derived) pin token to a board pin. Numeric →
 *  gpio; `GP6` → gpio 6; else a label/name match. Undefined when not on the board. */
function findPin(token: string, byGpio: Map<number, BoardPinInfo>, byLabel: Map<string, BoardPinInfo>): BoardPinInfo | undefined {
  const t = token.trim()
  if (/^\d+$/.test(t)) return byGpio.get(Number(t))
  const gp = t.match(/^gp(\d+)$/i)
  if (gp) return byGpio.get(Number(gp[1]))
  return byLabel.get(t.toLowerCase())
}

/**
 * Validate every I2C/SPI/UART constructor in `source` against `pins` (the
 * selected board's pins). Returns [] when the board carries no bus metadata (so
 * we never guess) or nothing is wrong.
 */
export function validateBusPins(source: string, pins: BoardPinInfo[]): BusDiagnostic[] {
  if (!source || pins.length === 0) return []
  // Only validate boards that actually declare bus/signal data for their pins;
  // otherwise we can't tell right from wrong and must stay silent.
  const hasBusData = pins.some((p) => p.signals || p.buses)
  if (!hasBusData) return []

  const byGpio = new Map<number, BoardPinInfo>()
  const byLabel = new Map<string, BoardPinInfo>()
  for (const p of pins) {
    if (typeof p.gpio === 'number') byGpio.set(p.gpio, p)
    if (p.label) byLabel.set(p.label.toLowerCase(), p)
  }

  const out: BusDiagnostic[] = []
  const varMap = buildPinVarMap(source)

  for (const u of findBusUsages(source, varMap)) {
    const spec = BUS_SPECS[u.type]
    const resolvedBuses = new Set<number>()

    for (const rp of u.pins) {
      const pin = findPin(rp.resolved, byGpio, byLabel)
      if (!pin) continue // unknown on this board → can't judge; skip.
      const sig = pin.signals?.[u.busKey]
      const busNo = pin.buses?.[u.busKey]
      const capable = (pin.capabilities?.includes(u.busKey) ?? false) || sig !== undefined || busNo !== undefined
      const gpName = pin.label || `GP${pin.gpio}`

      if (!capable) {
        out.push({
          line: u.line,
          startCol: rp.startCol,
          endCol: rp.endCol,
          severity: 'error',
          message: `${gpName} can't be used as ${spec.label} ${rp.expected} — it has no ${spec.label} capability on this board.`
        })
        continue
      }
      // Role check: the pin's fixed-function signal must match the kwarg's role.
      if (sig !== undefined && sig.toUpperCase() !== rp.expected.toUpperCase()) {
        out.push({
          line: u.line,
          startCol: rp.startCol,
          endCol: rp.endCol,
          severity: 'error',
          message: `${gpName} is ${spec.label}${busNo ?? ''} ${sig} — not ${rp.expected}. Check the ${Object.keys(spec.roles).join('/')} assignment.`
        })
      }
      if (typeof busNo === 'number') resolvedBuses.add(busNo)
    }

    // All role pins must live on the SAME hardware bus.
    if (resolvedBuses.size > 1) {
      const list = [...resolvedBuses].sort((a, b) => a - b).map((n) => `${spec.label}${n}`).join(' vs ')
      out.push({
        line: u.line,
        startCol: u.ctorStartCol,
        endCol: u.ctorEndCol,
        severity: 'error',
        message: `These pins are on different ${spec.label} buses (${list}) — they can't share one ${spec.label}.`
      })
    } else if (resolvedBuses.size === 1 && u.idValue !== undefined && u.idRange) {
      // The id must match the bus the pins actually belong to → offer a fix.
      const bus = [...resolvedBuses][0]
      if (u.idValue !== bus) {
        out.push({
          line: u.line,
          startCol: u.idRange.startCol,
          endCol: u.idRange.endCol,
          severity: 'error',
          message: `${spec.label} id=${u.idValue}, but these pins are ${spec.label}${bus}. Use id=${bus}.`,
          fix: {
            title: `Change ${spec.label} id to ${bus}`,
            line: u.line,
            startCol: u.idRange.startCol,
            endCol: u.idRange.endCol,
            text: String(bus)
          }
        })
      }
    }
  }
  return out
}

/** Project a board part's pins (headers + connectors) into {@link BoardPinInfo}s. */
export function boardPinsFromPart(part: {
  headers?: { pins?: Array<{ gpio?: number; name?: string; label?: string; capabilities?: string[]; signals?: BoardPinInfo['signals']; buses?: BoardPinInfo['buses'] }> }[]
  connectors?: { pins?: Array<{ gpio?: number; name?: string; label?: string; capabilities?: string[]; signals?: BoardPinInfo['signals']; buses?: BoardPinInfo['buses'] }> }[]
} | null | undefined): BoardPinInfo[] {
  if (!part) return []
  const src = [
    ...(part.headers ?? []).flatMap((h) => h.pins ?? []),
    ...(part.connectors ?? []).flatMap((c) => c.pins ?? [])
  ]
  const out: BoardPinInfo[] = []
  for (const p of src) {
    if (typeof p.gpio !== 'number') continue
    out.push({
      gpio: p.gpio,
      label: p.name || p.label || `GP${p.gpio}`,
      capabilities: p.capabilities ?? [],
      signals: p.signals,
      buses: p.buses
    })
  }
  return out
}
