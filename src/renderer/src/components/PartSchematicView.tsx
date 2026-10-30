import type { JSX } from 'react'
import type { PartDefinition } from '../../../shared/part'
import { schematicSymbolLayout } from './part-editor.util'
import { PartSchematicSymbol } from './SchematicSymbols'

/**
 * PART SCHEMATIC SYMBOL (#130) — standalone view.
 * ===============================================
 *
 * A simple line-drawing schematic symbol of a {@link PartDefinition}: a labelled
 * box with pin terminals projecting from its four sides — the schematic-view
 * counterpart to the breadboard {@link PartCanvas}, used by the Part Editor and
 * the Parts Library preview. The placeable symbol itself now lives in
 * {@link PartSchematicSymbol} (shared with the wiring canvas); this is a thin
 * `<svg>` shell that centres it on a fixed mat. Pure presentational SVG.
 */

const VIEW_W = 460
const VIEW_H = 420
// Room kept around the block for its stubs and the labels past them.
const MARGIN_X = 90
const MARGIN_Y = 70

export interface PartSchematicViewProps {
  part: PartDefinition
  highlightPin?: string
}

export function PartSchematicView({ part, highlightPin }: PartSchematicViewProps): JSX.Element {
  const lay = schematicSymbolLayout(part)
  // A big part (a 40-pin board) outgrows the mat: widen the view to fit its
  // block plus the stubs and pin-name labels around it, so nothing is cropped.
  const w = Math.max(VIEW_W, lay.box.w + 2 * MARGIN_X)
  const h = Math.max(VIEW_H, lay.box.h + 2 * MARGIN_Y)
  const x = (w - lay.box.w) / 2
  const y = (h - lay.box.h) / 2
  return (
    <svg
      className="sc__svg"
      viewBox={`0 0 ${w} ${h}`}
      width="100%"
      height="100%"
      role="img"
      aria-label={`Schematic symbol of ${part.name}`}
    >
      <PartSchematicSymbol part={part} x={x} y={y} highlight={highlightPin} />
    </svg>
  )
}
