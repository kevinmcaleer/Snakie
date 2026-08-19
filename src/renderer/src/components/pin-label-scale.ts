/**
 * How big a pin's annotation is drawn (#778).
 *
 * A pin annotation — the grey number box, the silk label, the code variable and
 * the capability chips — is a fixed-pixel design: a 14px box and CSS font sizes,
 * tuned for a comfortable pin pitch. On a board whose pins are drawn closer than
 * that, the annotations have to shrink or they collide, so every drawn annotation
 * carries a scale factor.
 *
 * That factor used to be derived from the tightest centre-to-centre pin gap
 * measured **inside the part's own body box**, over *every* pair of pins. Two
 * flaws followed:
 *
 *  - The body box is a fit-to-footprint rectangle, so its pixels mean something
 *    different on every part. The same 2.54mm header measured 20px on a 18mm
 *    board and 12px on a 62mm one, and the two got different-sized type despite
 *    being the same hardware. That is the reported bug.
 *  - One tight cluster shrank the whole board. The Tiny 2350's QWIIC contacts sit
 *    1.2mm apart, so its 2.54mm castellations — on the opposite edges, nowhere
 *    near them — were typeset at 62% while a Modulino's identical header stayed
 *    at 100%.
 *
 * This module fixes both by measuring the room a pin actually has, **physically
 * and where the collision would happen**:
 *
 *  - *Physically*: a gap of `g` body pixels on a part drawn at `bodyScale` is
 *    `g × bodyScale` pixels on screen — and, because the body box is the part's
 *    real width in millimetres times `connPxPerMm`, that product is exactly the
 *    pin's real millimetre spacing at the canvas' px-per-mm. It is the same
 *    quantity `physicalPad` uses (mm × `connPxPerMm`), measured between pins
 *    instead of across a pad. Identical hardware at the same canvas scale
 *    therefore gets identical type, whatever outline it sits on.
 *  - *Where the collision would happen*: annotations are anchored to the board
 *    EDGE their pin faces, so all the labels on one edge share a single line and
 *    only collide with each other, along that line. Pins facing other edges, and
 *    pins that draw no annotation at all, cannot collide with them and so do not
 *    shrink them.
 *
 * Pure and DOM-free on purpose — this is the rule the Part Editor, the mini board
 * and the breadboard all size their pin labels by, and it is unit-tested.
 */

/** The board edge a pin's annotation is anchored to (see `pinOutwardDir`). */
export type PinLabelEdge = 'left' | 'right' | 'top' | 'bottom'

/**
 * The on-screen centre-to-centre room a FULL-SIZE annotation wants: the 14px
 * number box plus enough air either side to read as separate chips. Keep this in
 * step with `boxedPinLabel`'s `B`.
 */
export const PIN_LABEL_REF_PX = 18

/**
 * The floor. Very dense boards (the Servo 2040's 18 servo headers on a 62mm body)
 * need an aggressive shrink to keep their number boxes apart; below this the text
 * is unreadable anyway and the view's zoom is the answer instead.
 */
export const PIN_LABEL_MIN_SCALE = 0.25

/** Annotations nearer than this along their line are the same point, not
 *  neighbours — two pins stacked at one spot can't be helped by shrinking. */
const COINCIDENT_PX = 0.5

/** One pin, as the sizing rule sees it. */
export interface LabelledPin {
  /** The board edge its annotation is anchored to. */
  edge: PinLabelEdge
  /**
   * Where it sits ALONG that edge's annotation line, in body-box pixels — the
   * pin's `cy` on the left/right edges, its `cx` on the top/bottom ones. That is
   * the only axis on which two annotations on the same edge can collide.
   */
  along: number
}

export interface PinLabelScaleInput {
  /** Every pin that actually DRAWS an annotation. Pins whose label is hidden (a
   *  servo header's V+/GND rows) must be left out: they draw nothing, so nothing
   *  of theirs can be collided with. */
  pins: readonly LabelledPin[]
  /** The part's nominal pin pitch in body pixels (`pinSpacing` mm × px-per-mm).
   *  Used for an edge carrying fewer than two annotations, where there is no gap
   *  to measure but the part's real pitch still says how big it is. 0 when the
   *  part has no mm dimensions — then a lone label just stays full size. */
  nominalPitchPx?: number
  /** The uniform scale the caller applies to the drawn body (1 = as measured).
   *  Annotations are counter-scaled by it, so this is what turns a body-box gap
   *  into the on-screen gap the annotation has to fit into. */
  bodyScale?: number
}

/** The scale to draw each edge's annotations at, 1 = full size. */
export type PinLabelScales = Record<PinLabelEdge, number>

const EDGES: readonly PinLabelEdge[] = ['left', 'right', 'top', 'bottom']

/** The tightest gap between neighbours along one line, or Infinity when there
 *  aren't two distinct ones. */
function tightestGap(along: readonly number[]): number {
  const sorted = [...along].sort((a, b) => a - b)
  let room = Infinity
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1]
    if (gap > COINCIDENT_PX && gap < room) room = gap
  }
  return room
}

/**
 * The annotation scale for each board edge.
 *
 * `room × bodyScale` is the on-screen pixels an annotation has; the scale is that
 * over {@link PIN_LABEL_REF_PX}, never above 1 (the design's full size, which the
 * fixed-pixel artwork can't exceed) and never below {@link PIN_LABEL_MIN_SCALE}.
 */
export function pinLabelScales({
  pins,
  nominalPitchPx = 0,
  bodyScale = 1
}: PinLabelScaleInput): PinLabelScales {
  const k = bodyScale > 0 ? bodyScale : 1
  const out: PinLabelScales = { left: 1, right: 1, top: 1, bottom: 1 }
  for (const edge of EDGES) {
    const along = pins.filter((p) => p.edge === edge).map((p) => p.along)
    if (along.length === 0) continue // nothing drawn on this edge — nothing to size
    const measured = tightestGap(along)
    const room = Number.isFinite(measured) ? measured : nominalPitchPx > 0 ? nominalPitchPx : Infinity
    out[edge] = Number.isFinite(room)
      ? Math.max(PIN_LABEL_MIN_SCALE, Math.min(1, (room * k) / PIN_LABEL_REF_PX))
      : 1
  }
  return out
}
