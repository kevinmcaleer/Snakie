/**
 * ROTATING A PART A QUARTER TURN (#749).
 *
 * Not a view transform — this re-authors the part, so a board photographed
 * portrait can be turned landscape and stay that way. Everything positioned has
 * to move together: pads, holes, connectors, components, labels, the outline and
 * the photo.
 *
 * ## The coordinate space does half the work
 *
 * Item coordinates are normalised 0..1 *within the board outline*, so a point at
 * `(x, y)` on a W×H board is physically at `(x·W, y·H)`. Turn the board
 * clockwise and it becomes H×W; the point that was `(x·W, y·H)` from the
 * top-left is now `(H − y·H, x·W)`, which re-normalises to `(1 − y, x)`. The
 * board's own dimensions cancel — the map needs no aspect ratio at all:
 *
 *   clockwise      (x, y) → (1 − y, x)
 *   anticlockwise  (x, y) → (y, 1 − x)
 *
 * ## …which is also why most `rotation` fields must NOT change
 *
 * Normalised space is anisotropic: `w` is a fraction of the board width and `h`
 * a fraction of its height, and those scales SWAP when the board turns. So for
 * anything sized in normalised units (component rects, the image layer), mapping
 * the box is the whole rotation — its rendered pixel extent comes out turned on
 * its own. Adding 90° to its `rotation` as well would turn it twice.
 *
 * Anything drawn at a PHYSICAL size is the opposite case. A QWIIC housing is
 * millimetres wide however the board is scaled, so nothing about the board's
 * aspect turns it: those need the explicit ±90°. That's connectors, group
 * housings, pin pads and silk labels.
 *
 * ## The rear face turns the other way
 *
 * Items carrying `side: 'rear'` are stored in the REAR view's own space (the
 * renderer draws them unmirrored — see `part-body`'s `faces`), which is the
 * front mirrored in x. A board turned clockwise as seen from the front is turned
 * anticlockwise as seen from the back, so those items take the opposite map.
 * Side-less geometry — a mounting hole goes through the board — lives in front
 * space and is mirrored at render time, so it takes the front map.
 *
 * Pure and DOM-free. The board PHOTO is pixels, not geometry, so rotating those
 * is the caller's job ({@link rotateImage90} in `image-rotate`).
 */
import type {
  ComponentShape,
  ImageLayer,
  PartDefinition,
  PartEdge,
  PartLabel,
  PartPin,
  PolygonPoint
} from '../../../shared/part'

export type RotateDir = 'cw' | 'ccw'

/** Normalised coordinates are repeatedly fed back through `1 − v`, which is not
 *  exact in binary — four turns landed 0.1 on 0.09999999999999998 and the part
 *  file churned on every rotate. Twelve places is finer than any board feature
 *  and makes the round trip exact. */
const snap = (v: number): number => Math.round(v * 1e12) / 1e12

/** The opposite turn — what the rear face of the board sees. */
export const opposite = (dir: RotateDir): RotateDir => (dir === 'cw' ? 'ccw' : 'cw')

/** A normalised point, turned with the board. */
export function rotatePoint(x: number, y: number, dir: RotateDir): { x: number; y: number } {
  return dir === 'cw' ? { x: snap(1 - y), y: snap(x) } : { x: snap(y), y: snap(1 - x) }
}

/**
 * A top-left-anchored normalised box. The corner that ends up top-left is a
 * DIFFERENT corner of the original, which is why this isn't just `rotatePoint`
 * on `(x, y)` — doing that puts the box a width or a height out of place.
 */
export function rotateBox(
  b: { x: number; y: number; w: number; h: number },
  dir: RotateDir
): { x: number; y: number; w: number; h: number } {
  return dir === 'cw'
    ? { x: snap(1 - b.y - b.h), y: snap(b.x), w: snap(b.h), h: snap(b.w) }
    : { x: snap(b.y), y: snap(1 - b.x - b.w), w: snap(b.h), h: snap(b.w) }
}

/** Which edge an edge becomes. Clockwise, the left edge ends up on top. */
export function rotateEdge(edge: PartEdge, dir: RotateDir): PartEdge {
  const cw: Record<PartEdge, PartEdge> = { left: 'top', top: 'right', right: 'bottom', bottom: 'left' }
  const ccw: Record<PartEdge, PartEdge> = { left: 'bottom', bottom: 'right', right: 'top', top: 'left' }
  return (dir === 'cw' ? cw : ccw)[edge]
}

/** A quarter turn on a physically-sized item's angle, normalised to 0..359. */
export function rotateAngle(deg: number | undefined, dir: RotateDir): number {
  const next = (deg ?? 0) + (dir === 'cw' ? 90 : -90)
  return ((next % 360) + 360) % 360
}

/** Turn an angle, and DROP the field when it comes back to zero. Absent already
 *  means zero, so keeping an explicit `rotation: 0` would only add a line to
 *  every item's YAML the first time a part was turned full circle. */
function withAngle<T extends { rotation?: number }>(item: T, dir: RotateDir): T {
  const deg = rotateAngle(item.rotation, dir)
  const out: T = { ...item, rotation: deg }
  if (deg === 0) delete (out as { rotation?: number }).rotation
  return out
}

const mapPoint = <T extends { x: number; y: number }>(item: T, dir: RotateDir): T => ({
  ...item,
  ...rotatePoint(item.x, item.y, dir)
})

const mapPoints = (pts: PolygonPoint[] | undefined, dir: RotateDir): PolygonPoint[] | undefined =>
  pts?.map((p) => rotatePoint(p.x, p.y, dir))

/** The direction an item turns in ITS OWN stored space. */
const dirFor = (item: { side?: string }, dir: RotateDir): RotateDir =>
  item.side === 'rear' ? opposite(dir) : dir

/**
 * A component shape. Rects are box-anchored so the box map is the whole turn;
 * circles are centre-anchored with a radius given as a fraction of the board
 * WIDTH — and the width becomes the old height, so that fraction has to be
 * rescaled by the aspect or the circle changes size on every rotate.
 */
function rotateShape(s: ComponentShape, dir: RotateDir, aspect: number): ComponentShape {
  const d = dirFor(s, dir)
  if (s.kind === 'circle') {
    const out = mapPoint(s, d)
    // `r · aspect · (1/aspect)` lands a few ulps off `r`, so snap it too.
    return s.r === undefined ? out : { ...out, r: snap(s.r * aspect) }
  }
  if (s.kind === 'polygon') return { ...mapPoint(s, d), points: mapPoints(s.points, d) }
  const box = rotateBox({ x: s.x, y: s.y, w: s.w ?? 0, h: s.h ?? 0 }, d)
  const out: ComponentShape = { ...s, x: box.x, y: box.y }
  if (s.w !== undefined) out.w = box.w
  if (s.h !== undefined) out.h = box.h
  return out
}

/** A silk label: text is drawn at a font size in viewBox units, not scaled by
 *  the board box, so it needs the explicit quarter turn. */
const rotateLabel = (l: PartLabel, dir: RotateDir): PartLabel =>
  withAngle(mapPoint(l, dirFor(l, dir)), dirFor(l, dir))

/** The photo's placement. Normalised, so the box map alone turns it; the pixels
 *  are rotated separately by the caller. */
const rotateLayer = (layer: ImageLayer | undefined, dir: RotateDir): ImageLayer | undefined =>
  layer && { ...layer, ...rotateBox(layer, dir) }

/**
 * The part, turned a quarter of a turn. Everything positioned moves; the
 * schematic symbol does not — that's an abstract drawing of the same component,
 * not a view of the board, and turning it on its side would only make it harder
 * to read.
 *
 * NOTE: a 3-D `mesh` cannot be turned, because the schema has nowhere to record
 * a mesh rotation (#741). Rotating a part that has one leaves the 2-D and 3-D
 * views disagreeing — the caller should say so.
 */
export function rotatePart(part: PartDefinition, dir: RotateDir): PartDefinition {
  // Width over height, before the turn — what a circle's radius is measured
  // against. Falls back to the declared aspect, then to square.
  const aspect =
    part.dimensions && part.dimensions.height > 0
      ? part.dimensions.width / part.dimensions.height
      : (part.aspect ?? 1)

  const next: PartDefinition = { ...part }

  if (part.dimensions) {
    next.dimensions = { width: part.dimensions.height, height: part.dimensions.width }
  }
  if (part.aspect !== undefined && part.aspect !== 0) next.aspect = 1 / part.aspect
  if (part.polygon) next.polygon = mapPoints(part.polygon, dir)

  // Headers: the edge label turns, and each pad is a physical thing on the board.
  next.headers = part.headers.map((h) => ({
    ...h,
    edge: rotateEdge(h.edge, dir),
    pins: h.pins.map((p) => {
      const d = dirFor(p, dir)
      // A pin may be auto-laid-out along its edge, with no coordinates of its
      // own — then the edge turn above is what moves it.
      const moved: PartPin =
        p.x === undefined || p.y === undefined ? { ...p } : { ...p, ...rotatePoint(p.x, p.y, d) }
      // A pin's `rotation` is NOT like every other item's, and this is the trap:
      // absent doesn't mean 0°, it means "work the label direction out from the
      // nearest board edge" (see `pinOutwardDir`). So an unset pin needs nothing
      // done to it — its position has just moved, and the direction follows for
      // free. Assigning it an angle here would nail it to whichever edge 0°
      // happens to name, which is rarely the one it was inferring.
      if (p.rotation === undefined) return moved
      // …and by the same rule an EXPLICIT angle keeps its zero rather than being
      // dropped like the others: 0 means "right", not "work it out", so removing
      // the field on a full circle would silently hand the pin back to inference.
      return { ...moved, rotation: rotateAngle(p.rotation, d) }
    })
  }))

  if (part.mountingHoles) next.mountingHoles = part.mountingHoles.map((h) => mapPoint(h, dir))
  if (part.buttons) next.buttons = part.buttons.map((b) => mapPoint(b, dirFor(b, dir)))
  if (part.onboardLeds) next.onboardLeds = part.onboardLeds.map((l) => mapPoint(l, dirFor(l, dir)))
  if (part.features) next.features = part.features.map((f) => ({ ...f, ...rotateBox(f, dir) }))
  if (part.shapes) next.shapes = part.shapes.map((s) => rotateShape(s, dir, aspect))
  if (part.labels) next.labels = part.labels.map((l) => rotateLabel(l, dir))
  // Connectors and mounts are drawn life-size in millimetres, so the board's
  // aspect flip does nothing for them — they take the explicit quarter turn.
  if (part.connectors) {
    next.connectors = part.connectors.map((c) => {
      const d = dirFor(c, dir)
      return withAngle(mapPoint(c, d), d)
    })
  }
  if (part.mounts) next.mounts = part.mounts.map((m) => withAngle(mapPoint(m, dir), dir))
  if (part.groups) {
    next.groups = part.groups.map((g) =>
      g.housing ? { ...g, housing: withAngle(mapPoint(g.housing, dir), dir) } : g
    )
  }

  const front = rotateLayer(part.imageLayer, dir)
  if (front) next.imageLayer = front
  if (part.rear?.imageLayer) {
    next.rear = { ...part.rear, imageLayer: rotateLayer(part.rear.imageLayer, opposite(dir)) }
  }

  return next
}

/** Does turning this part leave its 3-D model out of step with its outline? */
export const rotateBreaksMesh = (part: PartDefinition): boolean => Boolean(part.mesh)
