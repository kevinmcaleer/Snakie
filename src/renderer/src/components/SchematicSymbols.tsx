import type { JSX } from 'react'
import type { PartDefinition } from '../../../shared/part'
import type { BoardDefinition } from '../../../shared/board'
import { schematicSymbolLayout } from './part-editor.util'
import { mcuSymbolLayout } from './board-layout'

/**
 * PLACEABLE SCHEMATIC SYMBOLS (#140)
 * ==================================
 *
 * `<g>`-based (no `<svg>`) schematic symbols that draw at a caller-supplied
 * origin, so the same symbol the Parts Library shows can be embedded on the
 * wiring canvas at an arbitrary position. {@link PartSchematicSymbol} renders a
 * part; {@link McuSymbol} renders the microcontroller as a generic IC block. Both
 * share {@link SymbolBody}; the wiring canvas draws connectable dots over each
 * terminal's stub end. Layout (and the flattened pin index) comes from the pure
 * `schematicSymbolLayout` / `mcuSymbolLayout`, so a wire never re-targets.
 */

/** A terminal for the shared renderer (local coords). */
interface GTerm {
  key: string
  label: string
  inner: { x: number; y: number }
  outer: { x: number; y: number }
  labelPos: { x: number; y: number; anchor: 'start' | 'middle' | 'end' }
  highlighted?: boolean
}

function SymbolBody({
  w,
  h,
  title,
  subtitle,
  terminals
}: {
  w: number
  h: number
  title: string
  subtitle?: string
  terminals: GTerm[]
}): JSX.Element {
  return (
    <g>
      <rect x={0} y={0} width={w} height={h} rx={6} fill="var(--sc-fill, #11161a)" stroke="var(--sc-line, #cfd6dd)" strokeWidth={2} />
      <text x={w / 2} y={h / 2} className="sc__title">
        {title}
      </text>
      {subtitle && (
        <text x={w / 2} y={h / 2 + 20} className="sc__sub">
          {subtitle}
        </text>
      )}
      {/* Pins are plain line stubs. A circle/bubble on a pin means logical
          inversion (active-low) in schematic convention, and a filled dot means a
          wire junction — so terminals draw neither; the wiring canvas adds a
          junction dot only where a wire actually connects. */}
      {terminals.map((t) => (
        <g key={t.key}>
          <line
            x1={t.inner.x}
            y1={t.inner.y}
            x2={t.outer.x}
            y2={t.outer.y}
            stroke={t.highlighted ? '#fff' : 'var(--sc-line, #cfd6dd)'}
            strokeWidth={t.highlighted ? 2.5 : 1.6}
          />
          <text x={t.labelPos.x} y={t.labelPos.y} className="sc__pin-label" textAnchor={t.labelPos.anchor}>
            {t.label}
          </text>
        </g>
      ))}
    </g>
  )
}

export function PartSchematicSymbol({
  part,
  x = 0,
  y = 0,
  highlight
}: {
  part: PartDefinition
  x?: number
  y?: number
  /** Highlight the terminal whose pin name matches (e.g. a hovered pin). */
  highlight?: string
}): JSX.Element {
  const lay = schematicSymbolLayout(part)
  // Merged rail pads (primary === false) share one terminal — draw each once.
  const terminals: GTerm[] = lay.terminals
    .filter((t) => t.primary)
    .map((t) => ({
      key: String(t.flatIndex),
      label: `${t.pin.name}${t.pin.number != null ? ` (${t.pin.number})` : ''}`,
      inner: t.inner,
      outer: t.outer,
      labelPos: t.label,
      highlighted: !!highlight && t.pin.name === highlight
    }))
  return (
    <g transform={`translate(${x} ${y})`}>
      <SymbolBody w={lay.box.w} h={lay.box.h} title={part.name} subtitle={part.manufacturer} terminals={terminals} />
    </g>
  )
}

export function McuSymbol({
  def,
  x = 0,
  y = 0,
  highlightIndices
}: {
  def: BoardDefinition
  x?: number
  y?: number
  /** Flattened pad indices to highlight (the pins the user's code uses). */
  highlightIndices?: Set<number>
}): JSX.Element {
  const lay = mcuSymbolLayout(def)
  // Merged ground pads (primary === false) share the single GND terminal — draw
  // each visible terminal once.
  const terminals: GTerm[] = lay.terminals
    .filter((t) => t.primary)
    .map((t) => ({
      key: String(t.flatIndex),
      label: t.pad.label,
      inner: t.inner,
      outer: t.outer,
      labelPos: t.label,
      highlighted: !!highlightIndices?.has(t.flatIndex)
    }))
  return (
    <g transform={`translate(${x} ${y})`}>
      <SymbolBody w={lay.box.w} h={lay.box.h} title={def.name} subtitle={def.mcu} terminals={terminals} />
    </g>
  )
}
