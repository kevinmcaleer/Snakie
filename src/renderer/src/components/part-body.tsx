import { useId, type JSX } from 'react'
import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
  DEFAULT_SHAPE_STROKE_WIDTH,
  orderedComponents,
  pinShapeOf,
  resolvedPins,
  type Box,
  type ResolvedPin
} from './part-editor.util'
import type {
  OnboardLed,
  PartConnector,
  PartDefinition,
  PartPinBuses,
  PartPinCapability,
  PartPinShape,
  PartPinSignals,
  PartPinType,
  TextAlign
} from '../../../shared/part'
import './PartCanvas.css'

/** Capability → hover-badge text + pastel colour (#…). Shared by the Part Editor
 *  and the Board Viewer breadboard. */
export const CAP_BADGE: Record<PartPinCapability, { text: string; color: string }> = {
  digital: { text: 'GPIO', color: '#d9dee4' },
  pwm: { text: 'PWM', color: '#cfe8a9' },
  adc: { text: 'ADC', color: '#a9f0ec' },
  i2c: { text: 'I2C', color: '#a9d3f5' },
  spi: { text: 'SPI', color: '#f7b6d2' },
  uart: { text: 'UART', color: '#cdb4f0' }
}

/** Fixed display order for the persistent pin-capability chips. `digital`/GPIO is
 *  the implied default for an io pin, so it isn't chipped. */
export const CAP_CHIP_ORDER: PartPinCapability[] = ['pwm', 'adc', 'spi', 'i2c', 'uart']

/** The chip text for a capability — refined to its designated signal and bus/
 *  channel when set: `SDA` / `I2C0 SDA` / `SPI1 SCK` / `UART0 TX` / `ADC2` /
 *  `PWM A`. The peripheral+bus prefix appears only once a bus number is set, so
 *  bus-less parts keep the compact signal chip. */
function signalChipText(cap: PartPinCapability, signals?: PartPinSignals, buses?: PartPinBuses): string {
  const withBus = (periph: string, bus: number | undefined, sig: string | undefined): string =>
    bus != null ? `${periph}${bus}${sig ? ` ${sig}` : ''}` : (sig ?? periph)
  switch (cap) {
    case 'pwm':
      return signals?.pwm ? `PWM ${signals.pwm}` : 'PWM'
    case 'adc':
      return buses?.adc != null ? `ADC${buses.adc}` : 'ADC'
    case 'spi':
      return withBus('SPI', buses?.spi, signals?.spi)
    case 'i2c':
      return withBus('I2C', buses?.i2c, signals?.i2c)
    case 'uart':
      return withBus('UART', buses?.uart, signals?.uart)
    default:
      return CAP_BADGE[cap].text
  }
}

/**
 * A compact row of capability chips drawn NEXT TO a pin's label (persistent, not
 * hover-only), in the fixed {@link CAP_CHIP_ORDER} using the shared
 * {@link CAP_BADGE} colours. The strip is a horizontal run of chips that's
 * positioned — and, for top/bottom pins, rotated — to continue OUTWARD from the
 * label, mirroring {@link boxedPinLabel}'s per-direction geometry. Returns null
 * when the pin has none of the chipped capabilities.
 */
export function capabilityChips(
  box: { x: number; y: number; w: number; h: number },
  cx: number,
  cy: number,
  dir: 'left' | 'right' | 'top' | 'bottom',
  label: string,
  caps: PartPinCapability[] | undefined,
  signals?: PartPinSignals,
  /** Text drawn beyond the label (e.g. the GP## variable); chips clear past it. */
  variable?: string,
  buses?: PartPinBuses
): JSX.Element | null {
  const chips = CAP_CHIP_ORDER.filter((c) => caps?.includes(c)).map((c) => ({
    color: CAP_BADGE[c].color,
    text: signalChipText(c, signals, buses)
  }))
  if (chips.length === 0) return null
  const B = 14 // pin-number box (matches boxedPinLabel)
  const G = 3 // gap (matches boxedPinLabel)
  const C = 3.5 // re-centre for rotated top/bottom glyphs (matches boxedPinLabel)
  const h = 12
  const fs = 8.5
  const cg = 2 // gap between chips
  const labelW = label.length * 6.2
  // Space already consumed beyond the label by the variable (GP##), so the chips
  // sit past it instead of on top of it.
  const varW = variable ? variable.length * 6.2 + G : 0
  const widths = chips.map((b) => b.text.length * 5.4 + 7)
  const stripW = widths.reduce((a, w) => a + w, 0) + cg * Math.max(0, chips.length - 1)

  // The chips as a horizontal strip from local (0,0), vertically centred on y=0.
  let acc = 0
  const strip = chips.map((b, i) => {
    const x = acc
    acc += widths[i] + cg
    return (
      <g key={i}>
        <rect x={x} y={-h / 2} width={widths[i]} height={h} rx={2.5} fill={b.color} />
        <text x={x + widths[i] / 2} y={3} textAnchor="middle" fontSize={fs} fontWeight={700} fill="#1a1d20" fontFamily="var(--font-mono)">
          {b.text}
        </text>
      </g>
    )
  })

  // Position/orient the strip so its first chip sits just past the label end.
  let transform: string
  if (dir === 'right') {
    const lx = box.x + box.w + G + B + G // label start (left-anchored), extends right
    transform = `translate(${lx + labelW + G + varW}, ${cy})`
  } else if (dir === 'left') {
    const lx = box.x - G - B - G // label end (right-anchored), extends left
    transform = `translate(${lx - labelW - G - varW - stripW}, ${cy})`
  } else if (dir === 'top') {
    const labelY = box.y - G - B - G // label baseline; rotated -90 it runs upward
    transform = `translate(${cx + C}, ${labelY - labelW - G - varW}) rotate(-90)`
  } else {
    const labelY = box.y + box.h + G + B + G // rotated +90 it runs downward
    transform = `translate(${cx - C}, ${labelY + labelW + G + varW}) rotate(90)`
  }
  return (
    <g className="pcv__caps" style={{ pointerEvents: 'none' }} aria-hidden="true" transform={transform}>
      {strip}
    </g>
  )
}

/**
 * Like {@link capabilityChips} but anchored directly AT a pin (cx, cy) rather than
 * relative to a part-editor box — used by the breadboard/board view, where each
 * placed pin already sits in canvas space. The chip strip starts just outside the
 * pin and runs OUTWARD in `dir`, refined to the pin's signal + bus.
 */
export function capabilityChipsAt(
  cx: number,
  cy: number,
  dir: 'left' | 'right' | 'top' | 'bottom',
  caps: PartPinCapability[] | undefined,
  signals?: PartPinSignals,
  buses?: PartPinBuses,
  /** The pin's name/label — chips clear PAST it so they don't overlap it. */
  label = '',
  /** True for boxed MCU pins (a number box sits between the pad and the label). */
  boxed = false
): JSX.Element | null {
  const chips = CAP_CHIP_ORDER.filter((c) => caps?.includes(c)).map((c) => ({
    color: CAP_BADGE[c].color,
    text: signalChipText(c, signals, buses)
  }))
  if (chips.length === 0) return null
  const h = 12
  const fs = 8.5
  const cg = 2
  const B = 14 // pin-number box width (matches boxedPinLabel)
  const Gp = 3 // internal gap (matches boxedPinLabel)
  // Distance from the pad out to the first chip: clear the number box (boxed pins)
  // + the name label so the chips never sit on top of the pin name.
  const G = (boxed ? 2 * Gp + B : Gp) + label.length * 6.2 + 6
  const widths = chips.map((b) => b.text.length * 5.4 + 7)
  const stripW = widths.reduce((a, w) => a + w, 0) + cg * Math.max(0, chips.length - 1)
  let acc = 0
  const strip = chips.map((b, i) => {
    const x = acc
    acc += widths[i] + cg
    return (
      <g key={i}>
        <rect x={x} y={-h / 2} width={widths[i]} height={h} rx={2.5} fill={b.color} />
        <text x={x + widths[i] / 2} y={3} textAnchor="middle" fontSize={fs} fontWeight={700} fill="#1a1d20" fontFamily="var(--font-mono)">
          {b.text}
        </text>
      </g>
    )
  })
  const transform =
    dir === 'right'
      ? `translate(${cx + G}, ${cy})`
      : dir === 'left'
        ? `translate(${cx - G - stripW}, ${cy})`
        : dir === 'top'
          ? `translate(${cx}, ${cy - G}) rotate(-90)`
          : `translate(${cx}, ${cy + G}) rotate(90)`
  return (
    <g style={{ pointerEvents: 'none' }} aria-hidden="true" transform={transform}>
      {strip}
    </g>
  )
}

/** A row of pastel capability badges centred above (cx, cy), sized to the pin
 *  labels. Returns null when there are no capabilities to show. */
export function capabilityBadges(cx: number, cy: number, caps: PartPinCapability[] | undefined): JSX.Element | null {
  const badges = (caps ?? []).map((c) => CAP_BADGE[c]).filter(Boolean)
  if (badges.length === 0) return null
  const fs = 11
  const h = 16
  const gap = 3
  const widths = badges.map((b) => b.text.length * 6.2 + 8)
  const total = widths.reduce((a, w) => a + w, 0) + gap * Math.max(0, badges.length - 1)
  const by = cy - 13 - h
  let acc = cx - total / 2
  return (
    <g className="pcv__badges" style={{ pointerEvents: 'none' }} aria-hidden="true">
      {badges.map((b, i) => {
        const x = acc
        acc += widths[i] + gap
        return (
          <g key={i}>
            <rect x={x} y={by} width={widths[i]} height={h} rx={3} fill={b.color} />
            <text x={x + widths[i] / 2} y={by + h - 5} textAnchor="middle" fontSize={fs} fontWeight={700} fill="#1a1d20" fontFamily="var(--font-mono)">
              {b.text}
            </text>
          </g>
        )
      })}
    </g>
  )
}

/**
 * PART BODY (#130/#139) — the static, layered life-like scene of a part.
 * =====================================================================
 *
 * Extracted from {@link PartCanvas} so the SAME drawing (PCB outline + image
 * clipped to it + holes masked through + pads by shape + component shapes +
 * labels) can be rendered BOTH by the interactive Part Editor and, read-only, at
 * an arbitrary `box` inside the wiring canvas — so a placed part looks identical
 * to how it was authored (accurate pin positions + background image).
 *
 * It is a pure `<g>` (defs + the four layers) in `box` coordinates: no `<svg>`,
 * no pan/zoom transform, no pointer handlers. Per-object SELECTION styling is
 * driven by the optional `selection` prop (null ⇒ no highlights, for embeds); the
 * interactive selection CHROME (resize/vertex handles) stays in {@link PartCanvas}.
 */

export type { Box } from './part-editor.util'

/** Pad fill by electrical role (kept close to the Board View's palette). */
export const PAD_FILL: Record<PartPinType, string> = {
  io: '#d6a531',
  pwr: '#c0392b',
  gnd: '#3a3f44',
  other: '#8a8f96'
}

/**
 * A Raspberry-Pi-style castellated pad: a GOLD pad with the **main hole centred on
 * the pin** and a plated **half-hole** facing the board edge. Ground pads are
 * square; signal/power pads are rounded (a stadium from the main hole to the edge).
 * The half-hole faces `rotationDeg` (0=right, 90=down, 180=left, 270=up); when
 * absent it defaults to the nearer horizontal edge (`nx`), since castellations
 * normally run along the left/right edges.
 */
/** A castellated pad's geometry (hole radius + outward direction + edge half-hole
 *  centre), shared by the pad renderer and the layer-cut mask (#171). */
export function castellationGeom(
  cx: number,
  cy: number,
  size: number,
  nx: number,
  rotationDeg?: number
): { hR: number; half: number; ox: number; oy: number; ex: number; ey: number } {
  // Chunkier than a header pad — a real castellation is ≈2.5mm (run) × 1.7mm
  // (along the edge); these keep that ~1.47 aspect while reading a bit larger.
  const hR = size * 0.26 // hole radius
  const half = hR + 3.6 // pad half-thickness (perpendicular to the run) → ~2·half tall
  const ext = size * 1.06 // distance from the main hole out to the edge half-hole
  let ox: number
  let oy: number
  if (rotationDeg !== undefined) {
    const r = (((Math.round(rotationDeg / 90) * 90) % 360) + 360) % 360
    ox = r === 0 ? 1 : r === 180 ? -1 : 0
    oy = r === 90 ? 1 : r === 270 ? -1 : 0
  } else {
    ox = nx < 0.5 ? -1 : 1
    oy = 0
  }
  // The half-hole centre sits ON the pad's outer edge (so it reads as bisected).
  const ex = ox !== 0 ? cx + ox * ext : cx
  const ey = ox !== 0 ? cy : cy + oy * ext
  return { hR, half, ox, oy, ex, ey }
}

export function castellatedPad(
  cx: number,
  cy: number,
  size: number,
  nx: number,
  isGnd: boolean,
  stroke: string,
  sw: number,
  rotationDeg?: number
): JSX.Element {
  const GOLD = '#f0ce5c'
  const { hR, half, ox, oy, ex, ey } = castellationGeom(cx, cy, size, nx, rotationDeg)
  const holes = (
    <>
      <circle cx={cx} cy={cy} r={hR} fill="var(--bc-mat, #0c0f12)" />
      <circle cx={ex} cy={ey} r={hR} fill="var(--bc-mat, #0c0f12)" />
    </>
  )
  if (isGnd) {
    // GND: a square pad — sharp corners all round.
    let rx2: number
    let ry2: number
    let rw: number
    let rh: number
    if (ox !== 0) {
      const inner = cx - ox * half
      rx2 = Math.min(inner, ex)
      rw = Math.abs(ex - inner)
      ry2 = cy - half
      rh = 2 * half
    } else {
      const inner = cy - oy * half
      ry2 = Math.min(inner, ey)
      rh = Math.abs(ey - inner)
      rx2 = cx - half
      rw = 2 * half
    }
    return (
      <>
        <rect x={rx2} y={ry2} width={rw} height={rh} fill={GOLD} stroke={stroke} strokeWidth={sw} />
        {holes}
      </>
    )
  }
  // Signal/power: a half-stadium — rounded on the INNER end (around the main hole),
  // FLAT with SHARP corners on the castellated (board-edge) end. `n` is the pad's
  // perpendicular (the run direction rotated +90°); the inner semicircle bulges
  // inward (−d) with a consistent sweep of 0.
  const nX = -oy
  const nY = ox
  const oT = `${ex - half * nX} ${ey - half * nY}`
  const iT = `${cx - half * nX} ${cy - half * nY}`
  const iB = `${cx + half * nX} ${cy + half * nY}`
  const oB = `${ex + half * nX} ${ey + half * nY}`
  const d = `M ${oT} L ${iT} A ${half} ${half} 0 0 0 ${iB} L ${oB} Z`
  return (
    <>
      <path d={d} fill={GOLD} stroke={stroke} strokeWidth={sw} />
      {holes}
    </>
  )
}

/** The drilled through-hole(s) of a pin pad — the bits that should cut through the
 *  PCB + image (NOT the copper) for a realistic board (#171). Empty for a solid
 *  SMD (round) pad. Mirrors the dark hole circles each pad shape draws. */
export function pinThroughHoles(
  shape: PartPinShape,
  cx: number,
  cy: number,
  size: number,
  nx: number,
  rotationDeg?: number
): { cx: number; cy: number; r: number }[] {
  if (shape === 'round') return []
  if (shape === 'header') return [{ cx, cy, r: size / 2 - 3.5 }]
  if (shape === 'castellated') {
    const { hR, ex, ey } = castellationGeom(cx, cy, size, nx, rotationDeg)
    return [
      { cx, cy, r: hR },
      { cx: ex, cy: ey, r: hR }
    ]
  }
  return [{ cx, cy, r: 2.3 }] // square / default
}

/** The board edge a pin sits on (= the direction its silk label is pushed). Taken
 *  from the castellation `rotation` (0=right, 90=bottom, 180=left, 270=top) when set,
 *  else inferred from the nearest board border. */
export function pinOutwardDir(
  rotationDeg: number | undefined,
  nx: number,
  ny: number
): 'left' | 'right' | 'top' | 'bottom' {
  if (rotationDeg !== undefined) {
    const r = (((Math.round(rotationDeg / 90) * 90) % 360) + 360) % 360
    return r === 0 ? 'right' : r === 90 ? 'bottom' : r === 180 ? 'left' : 'top'
  }
  const dl = nx
  const dr = 1 - nx
  const dt = ny
  const db = 1 - ny
  const m = Math.min(dl, dr, dt, db)
  if (m === dt) return 'top'
  if (m === db) return 'bottom'
  if (m === dl) return 'left'
  return 'right'
}

/** Placement for a pin's silk label, node-graph style: pushed OUTWARD to the
 *  board edge the pin's rotation points to — so labels always sit in the margin
 *  *outside* the part, even for pins set in from the edge (never over the
 *  artwork). The perpendicular coordinate stays at the pin so the label lines up
 *  with its row/column. Left/right labels stay horizontal; top/bottom labels are
 *  turned 90° (never 180°/upside-down) so dense rows don't overlap. */
export interface PinLabelLayout {
  lx: number
  ly: number
  anchor: 'start' | 'middle' | 'end'
  /** Degrees to rotate the text about (lx, ly); 0 = horizontal (right-side-up). */
  rotate: number
}
export function pinLabelLayout(
  cx: number,
  cy: number,
  rotationDeg: number | undefined,
  nx: number,
  ny: number,
  gap: number,
  box: { x: number; y: number; w: number; h: number }
): PinLabelLayout {
  // Clearance beyond the board edge — past a pad straddling that edge.
  const m = gap / 2 + 4
  switch (pinOutwardDir(rotationDeg, nx, ny)) {
    case 'right':
      return { lx: box.x + box.w + m, ly: cy + 4, anchor: 'start', rotate: 0 }
    case 'left':
      return { lx: box.x - m, ly: cy + 4, anchor: 'end', rotate: 0 }
    case 'top':
      return { lx: cx, ly: box.y - m, anchor: 'start', rotate: -90 }
    default: // bottom
      return { lx: cx, ly: box.y + box.h + m, anchor: 'start', rotate: 90 }
  }
}

/**
 * The boxed pin annotation: a grey board-pin-number box at the board edge, then
 * the silk label, then (optionally) the code variable — ordered OUTWARD per pin
 * facing and mirrored for each edge. Shared by the breadboard MCU, the mini board
 * view and the Part Editor so they all render pins the same way. Assumes an
 * unrotated, unscaled body.
 */
/** Zero-pad a single-digit pin number ("1" → "01") so a column of board pins
 *  reads uniformly and their capability chips line up. Multi-digit / non-numeric
 *  / empty values are left unchanged. */
export function padPinNumber(num: string): string {
  return /^\d$/.test(num) ? `0${num}` : num
}

export function boxedPinLabel(
  box: { x: number; y: number; w: number; h: number },
  cx: number,
  cy: number,
  dir: 'left' | 'right' | 'top' | 'bottom',
  num: string,
  label: string,
  variable: string | undefined,
  color: string
): JSX.Element {
  const B = 14
  const G = 3
  const labelW = label.length * 6.2
  const shownNum = padPinNumber(num)
  const numBox = (bx: number, by: number): JSX.Element => (
    <>
      <rect x={bx} y={by} width={B} height={B} rx={2} className="pcv__pin-numbox" />
      {shownNum && (
        <text x={bx + B - 2.5} y={by + B - 3.7} textAnchor="end" className="pcv__pin-num">
          {shownNum}
        </text>
      )}
    </>
  )
  if (dir === 'left') {
    const bx = box.x - G - B
    const lx = bx - G
    return (
      <>
        {numBox(bx, cy - B / 2)}
        <text x={lx} y={cy + 3.5} textAnchor="end" className="pcv__pin-label">{label}</text>
        {variable && <text x={lx - labelW - G} y={cy + 3.5} textAnchor="end" className="pcv__pin-var" fill={color}>{variable}</text>}
      </>
    )
  }
  if (dir === 'right') {
    const bx = box.x + box.w + G
    const lx = bx + B + G
    return (
      <>
        {numBox(bx, cy - B / 2)}
        <text x={lx} y={cy + 3.5} textAnchor="start" className="pcv__pin-label">{label}</text>
        {variable && <text x={lx + labelW + G} y={cy + 3.5} textAnchor="start" className="pcv__pin-var" fill={color}>{variable}</text>}
      </>
    )
  }
  // Top/bottom pins read VERTICALLY (rotated ±90° away from the board) so a dense
  // column of pins doesn't collide — the box stays upright, the label/variable run
  // outward along the pin. `C` re-centres the rotated glyphs on the pin line.
  const C = 3.5
  if (dir === 'top') {
    const by = box.y - G - B
    const lx = cx + C
    const labelY = by - G
    const varY = labelY - labelW - G
    return (
      <>
        {numBox(cx - B / 2, by)}
        <text x={lx} y={labelY} textAnchor="start" transform={`rotate(-90 ${lx} ${labelY})`} className="pcv__pin-label">{label}</text>
        {variable && <text x={lx} y={varY} textAnchor="start" transform={`rotate(-90 ${lx} ${varY})`} className="pcv__pin-var" fill={color}>{variable}</text>}
      </>
    )
  }
  const by = box.y + box.h + G
  const lx = cx - C
  const labelY = by + B + G
  const varY = labelY + labelW + G
  return (
    <>
      {numBox(cx - B / 2, by)}
      <text x={lx} y={labelY} textAnchor="start" transform={`rotate(90 ${lx} ${labelY})`} className="pcv__pin-label">{label}</text>
      {variable && <text x={lx} y={varY} textAnchor="start" transform={`rotate(90 ${lx} ${varY})`} className="pcv__pin-var" fill={color}>{variable}</text>}
    </>
  )
}

/** Greedy word-wrap into lines that fit `maxWidthPx` at `fontSize` (the mono font
 *  is ≈0.6·size per glyph). Honours explicit newlines and hard-breaks an
 *  over-long word. Pure + exported for unit testing. */
export function wrapTextLines(text: string, maxWidthPx: number, fontSize: number): string[] {
  const charW = 0.6 * fontSize
  const maxChars = Math.max(1, Math.floor(maxWidthPx / charW))
  const out: string[] = []
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter((w) => w.length > 0)
    if (words.length === 0) {
      out.push('')
      continue
    }
    let line = ''
    for (let word of words) {
      while (word.length > maxChars) {
        if (line) {
          out.push(line)
          line = ''
        }
        out.push(word.slice(0, maxChars))
        word = word.slice(maxChars)
      }
      if (!line) line = word
      else if (line.length + 1 + word.length <= maxChars) line += ` ${word}`
      else {
        out.push(line)
        line = word
      }
    }
    if (line) out.push(line)
  }
  return out
}

/**
 * Render a styled text block as a single `<text>` with one `<tspan>` per line —
 * shared by free labels and shape captions so they style identically. Supports
 * bold / italic / underline, horizontal `align`, and (with `wrapWidth`) wrapping
 * to a shape's width; otherwise it splits on explicit newlines. Vertically
 * centred on `cy`. Pure SVG (no foreignObject) so it survives PNG/PDF export.
 */
export function styledText(opts: {
  text: string
  cx: number
  cy: number
  fontSize: number
  bold?: boolean
  italic?: boolean
  underline?: boolean
  align?: TextAlign
  /** When set, wrap to this width (px) and left/right-align within it. */
  wrapWidth?: number
  fill?: string
  transform?: string
  /** Weight when NOT bold (e.g. 600 for free labels, which were semibold). */
  baseWeight?: number
}): JSX.Element {
  const align: TextAlign = opts.align ?? 'center'
  const lines = opts.wrapWidth ? wrapTextLines(opts.text, opts.wrapWidth, opts.fontSize) : opts.text.split('\n')
  const lineH = opts.fontSize * 1.25
  const anchor = align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle'
  const half = (opts.wrapWidth ?? 0) / 2
  const pad = opts.wrapWidth ? 3 : 0
  const lineX = align === 'left' ? opts.cx - half + pad : align === 'right' ? opts.cx + half - pad : opts.cx
  const top = opts.cy - ((lines.length - 1) * lineH) / 2
  return (
    <text
      style={{ fontFamily: 'var(--font-mono)' }}
      fontSize={opts.fontSize}
      fontWeight={opts.bold ? 700 : opts.baseWeight}
      fontStyle={opts.italic ? 'italic' : undefined}
      textDecoration={opts.underline ? 'underline' : undefined}
      textAnchor={anchor}
      fill={opts.fill}
      transform={opts.transform}
    >
      {lines.map((ln, i) => (
        <tspan key={i} x={lineX} y={top + i * lineH + opts.fontSize * 0.34}>
          {ln === '' ? '​' : ln}
        </tspan>
      ))}
    </text>
  )
}

/** Which layers are currently shown (driven by the Layers panel). */
export interface LayerVisibility {
  /** The PCB body (outline + fill) — separate from the photo (board-less parts). */
  pcb: boolean
  image: boolean
  holes: boolean
  pins: boolean
  components: boolean
}

export const DEFAULT_LAYERS: LayerVisibility = { pcb: true, image: true, holes: true, pins: true, components: true }

/** What is currently selected (drives the editor's contextual inspector). */
export type CanvasSelection =
  | { type: 'pin'; hi: number; pi: number }
  | { type: 'hole'; index: number }
  | { type: 'button'; index: number }
  | { type: 'led'; index: number }
  | { type: 'connector'; index: number }
  | { type: 'shape'; index: number }
  | { type: 'shape-vertex'; index: number; vi: number }
  | { type: 'label'; index: number }
  | { type: 'vertex'; index: number }
  | { type: 'image' }
  | null

/** The part's outline aspect (w/h): physical dimensions win, else `aspect`. */
export function boardAspect(part: PartDefinition): number {
  if (part.dimensions && part.dimensions.width > 0 && part.dimensions.height > 0) {
    return part.dimensions.width / part.dimensions.height
  }
  if (typeof part.aspect === 'number' && part.aspect > 0) return part.aspect
  return 0.6
}

/**
 * Fit a board of the part's aspect into a `maxW`×`maxH` footprint. When `viewW`/
 * `viewH` are given the box is CENTRED within that mat (the Part Editor's 460×460);
 * otherwise it sits at the origin (the wiring canvas, where the caller translates).
 */
export function partBodyBox(
  part: PartDefinition,
  opts: { maxW: number; maxH: number; viewW?: number; viewH?: number }
): Box {
  const aspect = boardAspect(part)
  let w = opts.maxW
  let h = w / aspect
  if (h > opts.maxH) {
    h = opts.maxH
    w = h * aspect
  }
  const vw = opts.viewW ?? w
  const vh = opts.viewH ?? h
  return { x: (vw - w) / 2, y: (vh - h) / 2, w, h }
}

export interface PartBodyProps {
  part: PartDefinition
  /** Where to draw the board outline (the pads/image scale to this). */
  box: Box
  /** Per-layer visibility. Defaults to all visible. */
  visible?: LayerVisibility
  /** Draw the pin-spacing grid behind the board. */
  showGrid?: boolean
  /** Current selection — per-object highlights. Null/omitted ⇒ none (embeds). */
  selection?: CanvasSelection
  /** Override the clip/mask id prefix (defaults to a per-instance useId). */
  idPrefix?: string
  /** The clockwise rotation (deg) the CALLER applies around this body's centre
   *  (e.g. a rotated part on the breadboard). Text is counter-rotated so it never
   *  ends up upside down (#180). 0 in the Part Editor. */
  rotation?: number
  /** The uniform scale the caller applies to the body. Pin labels are counter-
   *  scaled by 1/bodyScale so they stay a consistent on-screen size across parts
   *  regardless of each part's real-world size (#180). 1 in the Part Editor. */
  bodyScale?: number
  /** Render pins with the boxed annotation (grey GPIO number box → label →
   *  variable, ordered outward) instead of the single silk label — used for the
   *  microcontroller on the breadboard. Assumes an unrotated, unscaled body. */
  boxedPins?: boolean
  /** Per pin flat-index, the code variable + colour to show (boxed mode only;
   *  used pins only — others show just the number box + label). */
  pinVariables?: Map<number, { variable: string; color: string }>
}

/** On-board push-button size (viewBox units) — the tactile-switch cap + base. */
export const PART_BUTTON_SIZE = 18

/**
 * A push-button (tactile switch) glyph centred at (cx, cy): a metal base with two
 * faint solder shoulders and a round pressable cap. `selected` outlines it white
 * for the Part Editor's selection highlight (read-only everywhere else).
 */
export function partButtonGlyph(cx: number, cy: number, size: number, selected = false): JSX.Element {
  const half = size / 2
  const capR = size * 0.28
  const stroke = selected ? '#fff' : '#0b0d10'
  const sw = selected ? 2.5 : 1
  return (
    <g style={{ pointerEvents: 'none' }}>
      <rect x={cx - half} y={cy - half} width={size} height={size} rx={size * 0.18} fill="#20262d" stroke={stroke} strokeWidth={sw} />
      {/* faint solder shoulders top + bottom */}
      <rect x={cx - half} y={cy - half} width={size} height={size * 0.16} fill="#12161a" opacity={0.55} />
      <rect x={cx - half} y={cy + half - size * 0.16} width={size} height={size * 0.16} fill="#12161a" opacity={0.55} />
      {/* pressable cap + specular highlight */}
      <circle cx={cx} cy={cy} r={capR} fill="#3a424b" stroke="#12161a" strokeWidth={1} />
      <circle cx={cx - capR * 0.3} cy={cy - capR * 0.32} r={capR * 0.34} fill="#525c66" />
    </g>
  )
}

/**
 * An onboard indicator LED glyph at (cx, cy): a soft glowing disc (single) or a
 * red/green/blue cluster (RGB), with a selection ring in the editor. Read-only
 * everywhere else. `selected` drives the Part Editor highlight.
 */
export function onboardLedGlyph(cx: number, cy: number, led: OnboardLed, selected = false): JSX.Element {
  const ring = selected ? <circle cx={cx} cy={cy} r={11} fill="none" stroke="#fff" strokeWidth={2} /> : null
  if (led.kind === 'neopixel') {
    // A 5050 addressable pixel: a white package with a glowing RGB centre.
    const s = 7
    return (
      <g style={{ pointerEvents: 'none' }}>
        <circle cx={cx} cy={cy} r={10} fill="#fff" opacity={0.16} />
        <rect x={cx - s} y={cy - s} width={s * 2} height={s * 2} rx={2} fill="#f2f2f2" stroke="#b9bec6" strokeWidth={0.8} />
        <circle cx={cx} cy={cy - 2} r={2.1} fill="#ff5555" />
        <circle cx={cx - 2.2} cy={cy + 1.6} r={2.1} fill="#54e08a" />
        <circle cx={cx + 2.2} cy={cy + 1.6} r={2.1} fill="#5aa0ff" />
        {ring}
      </g>
    )
  }
  if (led.kind === 'rgb') {
    const rr = 3.6
    const off = 3.4
    return (
      <g style={{ pointerEvents: 'none' }}>
        <circle cx={cx} cy={cy} r={9} fill="#fff" opacity={0.14} />
        <circle cx={cx} cy={cy - off} r={rr} fill="#ff5555" />
        <circle cx={cx - off} cy={cy + off * 0.72} r={rr} fill="#54e08a" />
        <circle cx={cx + off} cy={cy + off * 0.72} r={rr} fill="#5aa0ff" />
        {ring}
      </g>
    )
  }
  const color = led.color || '#39d353'
  return (
    <g style={{ pointerEvents: 'none' }}>
      <circle cx={cx} cy={cy} r={9} fill={color} opacity={0.3} />
      <circle cx={cx} cy={cy} r={5} fill={color} stroke="#0006" strokeWidth={0.8} />
      <circle cx={cx - 1.6} cy={cy - 1.6} r={1.5} fill="#fff" opacity={0.85} />
      {ring}
    </g>
  )
}

/** The silk label for an onboard LED: its name + GPIO(s) — e.g. `LED · GP25`,
 *  `RGB · GP18 GP19 GP20`, `NeoPixel · GP22 · PWR GP23`. */
export function onboardLedLabel(led: OnboardLed): string {
  const name = led.label || (led.kind === 'rgb' ? 'RGB' : led.kind === 'neopixel' ? 'NeoPixel' : 'LED')
  let gps = ''
  if (led.kind === 'rgb') {
    gps = [led.rgb?.r, led.rgb?.g, led.rgb?.b]
      .filter((g): g is number => g != null)
      .map((g) => `GP${g}`)
      .join(' ')
  } else {
    if (led.gpio != null) gps = `GP${led.gpio}`
    if (led.kind === 'neopixel' && led.power != null) gps += `${gps ? ' · ' : ''}PWR GP${led.power}`
  }
  return gps ? `${name} · ${gps}` : name
}

/** A connector glyph at (cx, cy): a dark JST-SH housing with gold contacts (a
 *  QWIIC / STEMMA QT / JST socket). `selected` drives the Part Editor highlight. */
export function connectorGlyph(cx: number, cy: number, conn: PartConnector, selected = false): JSX.Element {
  const n = Math.max(2, conn.pins.length || 4)
  const w = Math.max(18, n * 5 + 6)
  const h = 11
  const x0 = cx - w / 2
  const y0 = cy - h / 2
  return (
    <g style={{ pointerEvents: 'none' }}>
      <rect x={x0} y={y0} width={w} height={h} rx={2} fill="#1c1f24" stroke={selected ? '#fff' : '#3a3f46'} strokeWidth={selected ? 2 : 1} />
      {Array.from({ length: n }, (_, i) => {
        const cxp = x0 + (w / (n + 1)) * (i + 1)
        return <rect key={i} x={cxp - 1} y={y0 + 2} width={2} height={h - 5} rx={0.5} fill="#e6c34a" />
      })}
    </g>
  )
}

/** The silk label for a connector: its name + the GPIOs of its signal pins —
 *  e.g. `QWIIC · SDA GP4 · SCL GP5`. */
export function connectorLabel(conn: PartConnector): string {
  const name = conn.label || (conn.kind === 'qwiic' ? 'QWIIC' : 'JST')
  const sig = conn.pins
    .filter((p) => p.type === 'io' && p.gpio != null)
    .map((p) => `${p.name} GP${p.gpio}`)
    .join(' · ')
  return sig ? `${name} · ${sig}` : name
}

/** The static life-like scene of a part, drawn into `box`. */
export function PartBody({
  part,
  box,
  visible: visibleProp,
  showGrid = false,
  selection = null,
  idPrefix,
  rotation = 0,
  bodyScale = 1,
  boxedPins = false,
  pinVariables
}: PartBodyProps): JSX.Element {
  // Text-orientation/size correction for a rotated/scaled body (#180): counter the
  // caller's rotation so text is never upside down, and (pin labels only) counter
  // the scale so they read at a consistent size across parts. No-ops in the editor.
  const textRot = (((rotation % 360) + 360) % 360) || 0
  const uprightRotate = (x: number, y: number, localRotate = 0): string | undefined => {
    const r = localRotate - textRot
    return r ? `rotate(${r} ${x} ${y})` : undefined
  }
  const pinLabelTransform = (x: number, y: number, localRotate: number): string | undefined => {
    const r = localRotate - textRot
    const s = bodyScale > 0 ? 1 / bodyScale : 1
    if (!r && s === 1) return undefined
    return `translate(${x} ${y}) rotate(${r}) scale(${s}) translate(${-x} ${-y})`
  }
  // Honour the part's own saved layer visibility (so the Board View / library
  // preview hide what the author hid, e.g. a traced PCB image) unless the caller
  // overrides it.
  const visible: LayerVisibility = visibleProp ?? { ...DEFAULT_LAYERS, ...(part.layerVisibility ?? {}) }
  const rawId = useId()
  const uid = idPrefix ?? rawId.replace(/:/g, '') // colons are awkward in funcIRI refs
  const clipId = `pcb-clip-${uid}`
  const maskId = `pcb-holes-${uid}`

  const pins = resolvedPins(part)
  const holes = part.mountingHoles ?? []
  const features = part.features ?? [] // legacy chips (read-only; migrated on edit)
  const shapes = part.shapes ?? []
  const labels = part.labels ?? []
  const buttons = part.buttons ?? []
  const onboardLeds = part.onboardLeds ?? []
  const connectors = part.connectors ?? []
  const spacing = part.pinSpacing && part.pinSpacing > 0 ? part.pinSpacing : 2.54
  const layer = part.imageLayer ?? { x: 0, y: 0, w: 1, h: 1 }

  const px = (nx: number): number => box.x + nx * box.w
  const py = (ny: number): number => box.y + ny * box.h
  const holeR = (diameter: number): number =>
    part.dimensions && part.dimensions.width > 0
      ? Math.max(3, (diameter / part.dimensions.width) * box.w)
      : 6
  const gridSteps = (axis: 'x' | 'y'): number => {
    const sizeMm = axis === 'x' ? part.dimensions?.width : part.dimensions?.height
    const n = sizeMm && sizeMm > 0 ? Math.round(sizeMm / spacing) : axis === 'x' ? 8 : 16
    return Math.min(axis === 'x' ? 60 : 80, Math.max(2, n))
  }

  const usePolygon = part.shape?.kind === 'polygon' && (part.polygon?.length ?? 0) >= 3
  const cornerR = part.shape?.cornerRadius != null ? part.shape.cornerRadius * Math.min(box.w, box.h) : 8
  const polyPoints = (part.polygon ?? []).map((p) => `${px(p.x)},${py(p.y)}`).join(' ')

  const shapeEl = (props: Record<string, unknown>): JSX.Element =>
    usePolygon ? (
      <polygon points={polyPoints} {...props} />
    ) : (
      <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={cornerR} {...props} />
    )

  const cutHoles = visible.holes && holes.length > 0
  // Pin/castellation through-holes to cut through the PCB + image + copper (#171),
  // so a realistic board shows the real background through its holes.
  const pinHoleList = visible.pins
    ? pins.flatMap((rp) => pinThroughHoles(pinShapeOf(rp.pin), px(rp.x), py(rp.y), 12, rp.x, rp.pin.rotation))
    : []
  const hasCuts = cutHoles || pinHoleList.length > 0

  const gridLines: JSX.Element[] = []
  if (showGrid) {
    const cols = gridSteps('x')
    const rows = gridSteps('y')
    for (let c = 1; c < cols; c++)
      gridLines.push(<line key={`gc${c}`} x1={px(c / cols)} y1={box.y} x2={px(c / cols)} y2={box.y + box.h} stroke="var(--bc-grid, #ffffff30)" strokeWidth={0.5} />)
    for (let r = 1; r < rows; r++)
      gridLines.push(<line key={`gr${r}`} x1={box.x} y1={py(r / rows)} x2={box.x + box.w} y2={py(r / rows)} stroke="var(--bc-grid, #ffffff30)" strokeWidth={0.5} />)
  }

  const isSel = (s: CanvasSelection): boolean => !!selection && JSON.stringify(selection) === JSON.stringify(s)

  return (
    <g>
      <defs>
        {/* Clip the image to the board outline (image sits ON the PCB). */}
        <clipPath id={clipId}>{shapeEl({})}</clipPath>
        {/* Punch mounting holes + pin/castellation through-holes through the PCB +
            image (and, where applied, the copper pads). The white field is a
            generous rect — not the board outline — so masking a castellation pad
            that straddles the edge doesn't clip its outer half (#171). */}
        {hasCuts && (
          <mask id={maskId}>
            <rect x={box.x - 40} y={box.y - 40} width={box.w + 80} height={box.h + 80} fill="white" />
            {cutHoles &&
              holes.map((h, i) => (
                <circle key={`mh${i}`} cx={px(h.x)} cy={py(h.y)} r={holeR(h.diameter)} fill="black" />
              ))}
            {pinHoleList.map((h, i) => (
              <circle key={`ph${i}`} cx={h.cx} cy={h.cy} r={h.r} fill="black" />
            ))}
          </mask>
        )}
      </defs>

      {/* Layer 1: PCB (outline + image), with holes cut through via the mask */}
      <g mask={hasCuts ? `url(#${maskId})` : undefined}>
        {visible.pcb && shapeEl({ fill: part.pcbColor || '#0f5a2e', stroke: '#0008', strokeWidth: 2 })}
        {visible.image && part.imageData && (
          <image
            href={part.imageData}
            x={px(layer.x)}
            y={py(layer.y)}
            width={layer.w * box.w}
            height={layer.h * box.h}
            opacity={layer.opacity ?? 1}
            preserveAspectRatio="none"
            clipPath={`url(#${clipId})`}
            style={{ pointerEvents: 'none' }}
          />
        )}
      </g>

      {/* The pin-pitch grid, on top of the image so you can align to it. */}
      {showGrid && (
        <g aria-hidden="true" clipPath={`url(#${clipId})`} style={{ pointerEvents: 'none' }}>
          {gridLines}
        </g>
      )}

      {/* Layer 2: hole plating rings (on top of the cutout) */}
      {visible.holes &&
        holes.map((h, i) => (
          <circle
            key={`h${i}`}
            cx={px(h.x)}
            cy={py(h.y)}
            r={holeR(h.diameter)}
            fill="none"
            stroke={isSel({ type: 'hole', index: i }) ? '#fff' : '#cfd6dd'}
            strokeWidth={isSel({ type: 'hole', index: i }) ? 3 : 2}
          />
        ))}

      {/* Layer 3: pins (square / round / castellated / header) */}
      {visible.pins &&
        pins.map((rp: ResolvedPin, i) => {
          const fill = PAD_FILL[rp.pin.type] ?? PAD_FILL.other
          const sel = isSel({ type: 'pin', hi: rp.hi, pi: rp.pi })
          const size = 12
          const cx = px(rp.x)
          const cy = py(rp.y)
          const stroke = sel ? '#fff' : '#0008'
          const sw = sel ? 3 : 1
          const shape = pinShapeOf(rp.pin)
          let pad: JSX.Element
          if (shape === 'round') {
            pad = <circle cx={cx} cy={cy} r={size / 2} fill={fill} stroke={stroke} strokeWidth={sw} />
          } else if (shape === 'castellated') {
            pad = castellatedPad(cx, cy, size, rp.x, rp.pin.type === 'gnd', stroke, sw, rp.pin.rotation)
          } else if (shape === 'header') {
            pad = (
              <>
                <circle cx={cx} cy={cy} r={size / 2} fill="#c79a4e" stroke={stroke} strokeWidth={sw} />
                <circle cx={cx} cy={cy} r={size / 2 - 3.5} fill="var(--bc-mat, #0c0f12)" />
              </>
            )
          } else {
            pad = (
              <>
                <rect x={cx - size / 2} y={cy - size / 2} width={size} height={size} rx={2} fill={fill} stroke={stroke} strokeWidth={sw} />
                <circle cx={cx} cy={cy} r={2.3} fill="var(--bc-mat, #0c0f12)" />
              </>
            )
          }
          const text = `${rp.pin.number != null ? `${rp.pin.number} ` : ''}${rp.pin.label || rp.pin.name}`
          // Node-graph style: grey label pushed OUTWARD from the pin's edge, turned
          // 90° on the top/bottom edges so dense rows don't collide.
          const ll = pinLabelLayout(cx, cy, rp.pin.rotation, rp.x, rp.y, size, box)
          return (
            <g key={`p${i}`}>
              {/* Mask the pad (not its label) so the through-hole shows the real
                  background, not a painted dot (#171). */}
              {hasCuts ? <g mask={`url(#${maskId})`}>{pad}</g> : pad}
              {boxedPins
                ? boxedPinLabel(
                    box,
                    cx,
                    cy,
                    pinOutwardDir(rp.pin.rotation, rp.x, rp.y),
                    String(rp.pin.number ?? rp.pin.gpio ?? ''),
                    rp.pin.label || rp.pin.name,
                    pinVariables?.get(i)?.variable,
                    pinVariables?.get(i)?.color ?? '#cfd6dd'
                  )
                : text && (
                    <text
                      x={ll.lx}
                      y={ll.ly}
                      className="pcv__pin-label"
                      textAnchor={ll.anchor}
                      transform={pinLabelTransform(ll.lx, ll.ly, ll.rotate)}
                    >
                      {text}
                    </text>
                  )}
            </g>
          )
        })}

      {/* Layer 4a: legacy feature chips (read-only; migrated to shapes on edit) */}
      {visible.components &&
        features.map((f, i) => (
          <g key={`f${i}`} style={{ pointerEvents: 'none' }}>
            <rect x={px(f.x)} y={py(f.y)} width={f.w * box.w} height={f.h * box.h} rx={3} fill="#1c2227" stroke="#0006" />
            <text
              x={px(f.x) + (f.w * box.w) / 2}
              y={py(f.y) + (f.h * box.h) / 2}
              className="pcv__feat-label"
              transform={uprightRotate(px(f.x) + (f.w * box.w) / 2, py(f.y) + (f.h * box.h) / 2)}
            >
              {f.label}
            </text>
          </g>
        ))}

      {/* Layer 4b/4c: shapes + text labels in one unified z-order (so they stack). */}
      {visible.components &&
        orderedComponents(part).map((c) => {
          if (c.kind === 'label') {
            const i = c.index
            const l = labels[i]
            return (
              <g key={`l${i}`}>
                {styledText({
                  text: l.text,
                  cx: px(l.x),
                  cy: py(l.y),
                  fontSize: l.fontSize ?? 12,
                  bold: l.bold,
                  italic: l.italic,
                  underline: l.underline,
                  align: l.align,
                  fill: isSel({ type: 'label', index: i }) ? '#fff' : (l.color ?? 'var(--text, #e9edf1)'),
                  baseWeight: 600,
                  transform: uprightRotate(px(l.x), py(l.y), l.rotation ?? 0)
                })}
              </g>
            )
          }
          const i = c.index
          const s = shapes[i]
          const sel = isSel({ type: 'shape', index: i }) || selection?.type === 'shape-vertex'
          const fill = s.fill ?? DEFAULT_SHAPE_FILL
          const stroke = sel && isSel({ type: 'shape', index: i }) ? '#4ea1ff' : (s.stroke ?? DEFAULT_SHAPE_STROKE)
          const sw = (s.strokeWidth ?? DEFAULT_SHAPE_STROKE_WIDTH) + (isSel({ type: 'shape', index: i }) ? 1.5 : 0)
          let el: JSX.Element
          let lcx: number
          let lcy: number
          let labelW: number
          if (s.kind === 'circle') {
            const r = (s.r ?? 0.08) * box.w
            el = <circle cx={px(s.x)} cy={py(s.y)} r={r} fill={fill} stroke={stroke} strokeWidth={sw} />
            lcx = px(s.x)
            lcy = py(s.y)
            labelW = 2 * r
          } else if (s.kind === 'polygon') {
            const pts = s.points ?? []
            el = <polygon points={pts.map((p) => `${px(p.x)},${py(p.y)}`).join(' ')} fill={fill} stroke={stroke} strokeWidth={sw} />
            const xs = pts.map((p) => px(p.x))
            lcx = pts.length ? px(pts.reduce((a, p) => a + p.x, 0) / pts.length) : px(s.x)
            lcy = pts.length ? py(pts.reduce((a, p) => a + p.y, 0) / pts.length) : py(s.y)
            labelW = xs.length ? Math.max(...xs) - Math.min(...xs) : 80
          } else {
            const w = (s.w ?? 0.2) * box.w
            const h = (s.h ?? 0.15) * box.h
            el = <rect x={px(s.x)} y={py(s.y)} width={w} height={h} rx={s.cornerRadius ?? 3} fill={fill} stroke={stroke} strokeWidth={sw} />
            lcx = px(s.x) + w / 2
            lcy = py(s.y) + h / 2
            labelW = w
          }
          const rot = s.rotation ?? 0
          return (
            <g key={`s${i}`} transform={rot ? `rotate(${rot} ${lcx} ${lcy})` : undefined}>
              {el}
              {s.label &&
                styledText({
                  text: s.label,
                  cx: lcx,
                  cy: lcy,
                  fontSize: s.labelFontSize ?? 10,
                  bold: s.labelBold,
                  italic: s.labelItalic,
                  underline: s.labelUnderline,
                  align: s.labelAlign,
                  wrapWidth: s.labelWrap ? labelW : undefined,
                  fill: s.labelColor ?? '#cfd6dd',
                  transform: uprightRotate(lcx, lcy)
                })}
            </g>
          )
        })}

      {/* Layer 4d: on-board push-buttons (#130) — a tactile-switch glyph + silk label. */}
      {visible.components &&
        buttons.map((b, i) => {
          const cx = px(b.x)
          const cy = py(b.y)
          const labelY = cy + PART_BUTTON_SIZE * 0.5 + 9
          return (
            <g key={`btn${i}`}>
              {partButtonGlyph(cx, cy, PART_BUTTON_SIZE, isSel({ type: 'button', index: i }))}
              {b.label &&
                styledText({
                  text: b.label,
                  cx,
                  cy: labelY,
                  fontSize: 9,
                  fill: isSel({ type: 'button', index: i }) ? '#fff' : '#cfd6dd',
                  transform: uprightRotate(cx, labelY)
                })}
            </g>
          )
        })}

      {/* Layer 4e: onboard indicator LEDs (single / RGB) — a glowing glyph + a
          "LED · GP25" / "RGB · GP18 GP19 GP20" silk label. */}
      {visible.components &&
        onboardLeds.map((led, i) => {
          const cx = px(led.x)
          const cy = py(led.y)
          const labelY = cy + 18
          const sel = isSel({ type: 'led', index: i })
          return (
            <g key={`led${i}`}>
              {onboardLedGlyph(cx, cy, led, sel)}
              {styledText({
                text: onboardLedLabel(led),
                cx,
                cy: labelY,
                fontSize: 9,
                fill: sel ? '#fff' : '#cfd6dd',
                transform: uprightRotate(cx, labelY)
              })}
            </g>
          )
        })}

      {/* Layer 4f: connectors (QWIIC / STEMMA QT / JST) — a JST housing + label. */}
      {visible.components &&
        connectors.map((conn, i) => {
          const cx = px(conn.x)
          const cy = py(conn.y)
          const labelY = cy + 16
          const sel = isSel({ type: 'connector', index: i })
          return (
            <g key={`conn${i}`}>
              {connectorGlyph(cx, cy, conn, sel)}
              {styledText({
                text: connectorLabel(conn),
                cx,
                cy: labelY,
                fontSize: 9,
                fill: sel ? '#fff' : '#cfd6dd',
                transform: uprightRotate(cx, labelY)
              })}
            </g>
          )
        })}
    </g>
  )
}
