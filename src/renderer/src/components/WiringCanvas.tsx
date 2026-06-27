import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent
} from 'react'
import {
  connectionColor,
  connectionId,
  signalColor,
  type RobotConnection,
  type RobotDefinition,
  type RobotNet,
  type RobotPart
} from '../../../shared/robot'
import type { BoardDefinition } from '../../../shared/board'
import type { PartDefinition, PartLibraryWithParts } from '../../../preload/index.d'
import type { PartPinCapability } from '../../../shared/part'
import { boardBox, layoutPads, mcuSymbolLayout, padKey, padLabelPlacement, type PadPoint } from './board-layout'
import { capabilityBadges, partBodyBox, PartBody } from './part-body'
import { pinPositions, resolvedPins, schematicSymbolLayout, type Box } from './part-editor.util'
import { Board, BoardDefs } from './BoardGraph'
import { McuSymbol, PartSchematicSymbol } from './SchematicSymbols'
import { routeOrthogonal, toRoundedPath, toSvgPath, type RBox, type RSide, type RWire } from './ortho-router'
import './WiringCanvas.css'

/**
 * WIRING STAGE (#139 / #140) — the Board Viewer's Life-like & Schematic views.
 *
 * Lays the selected microcontroller + the project's placed parts onto one canvas
 * and lets you drag **noodle** (bezier) wires between any two pins — node-RED
 * style. Two render modes share ALL the wiring machinery:
 *   - **life-like** — the board's real PCB drawing (pads at their edge positions)
 *     and each part's footprint, every pad a connectable dot.
 *   - **schematic** — every component as a labelled block symbol with pin stubs.
 *
 * Pin identity is index-based (`"<key>.<pin>#<index>"`, the flattened header
 * order) so it is **identical in both modes** — toggling never breaks a wire.
 * Power wires are red, ground white (the mat is dark), signal wires take a
 * palette colour (or one you pick). Everything persists to `robot.yml` via
 * `onChange`, mirrored in the connections table beneath the canvas.
 */

export type WiringRenderMode = 'lifelike' | 'schematic'

const VIEW_W = 1180
const VIEW_H = 720
const DOT_R = 5

// Zoom bounds + per-click step for the viewport (shared by wheel + buttons).
const WC_MIN_ZOOM = 0.35
const WC_MAX_ZOOM = 3
const WC_ZOOM_STEP = 1.2
const clampScale = (s: number): number => Math.min(WC_MAX_ZOOM, Math.max(WC_MIN_ZOOM, s))

// Life-like body footprints (fitted by aspect within these).
const BOARD_BODY_W = 190
const BOARD_BODY_H = 300
const PART_BODY_W = 140

// Real-world scale for the breadboard: parts are drawn at their REAL dimensions
// (mm → px) relative to the board, so e.g. an HC-SR04 reads larger than a small
// sensor. The board anchors the scale (it keeps BOARD_BODY_W and defines px/mm);
// when its real width is unknown we fall back to a Pico-ish default (~51mm → 190px).
const PX_PER_MM_DEFAULT = 3.7
// Parts are rendered at a NATIVE reference size then uniformly scaled, so pads,
// silk text and strokes shrink together (not just positions) — fixing labels that
// looked huge on a small body. Clamp the final size so an odd dimension can't make
// a part vanish or swamp the canvas.
const PART_NATIVE_W = 300
const PART_NATIVE_H = 300
const PART_MIN_W = 48
const PART_MAX_W = 380
const PART_MAX_H = 380
// Pointer travel (screen px) below which a press counts as a click, not a drag.
const DRAG_DEADZONE_PX = 3

/** Snap any angle to the nearest of 0/90/180/270 (#176). */
function normRot(deg?: number): 0 | 90 | 180 | 270 {
  return ((((Math.round((deg ?? 0) / 90) * 90) % 360) + 360) % 360) as 0 | 90 | 180 | 270
}
/** Rotate a point clockwise (SVG y-down) by a 90° multiple about (cx,cy). */
function rotatePoint(x: number, y: number, cx: number, cy: number, deg: 0 | 90 | 180 | 270): { x: number; y: number } {
  const dx = x - cx
  const dy = y - cy
  if (deg === 90) return { x: cx - dy, y: cy + dx }
  if (deg === 180) return { x: cx - dx, y: cy - dy }
  if (deg === 270) return { x: cx + dy, y: cy - dx }
  return { x, y }
}
/** Rotate an outward unit normal clockwise by a 90° multiple. */
function rotateNormal(ox: number, oy: number, deg: 0 | 90 | 180 | 270): { ox: number; oy: number } {
  if (deg === 90) return { ox: -oy, oy: ox }
  if (deg === 180) return { ox: -ox, oy: -oy }
  if (deg === 270) return { ox: oy, oy: -ox }
  return { ox, oy }
}

/** A connection anchor in a subject's LOCAL coordinate space + its outward dir. */
interface Anchor {
  x: number
  y: number
  ox: number
  oy: number
}
/** A pin flattened onto a subject: its net, anchors, and label placement. */
interface PlacedPin {
  name: string
  net: RobotNet
  index: number
  anchors: Anchor[]
  label: { x: number; y: number; anchor: 'start' | 'middle' | 'end' }
  /** False for pads merged into a shared schematic rail terminal (extra GND / same
   *  power rail) — their dot/label is not drawn (but the pin still resolves). */
  primary?: boolean
  /** All pin indices sharing this terminal (a rail) — its dot shows if ANY is wired. */
  railIndices?: number[]
  /** Pin capabilities (for the breadboard hover badges); part pins only. */
  caps?: PartPinCapability[]
}
/** Board pads used by the parsed code, keyed by board pad index (combine view). */
export type UsedByCode = Map<number, { color: string; label: string }>

/** A drawn component (the MCU or a placed part). */
interface Subject {
  key: string // 'board' for the MCU, else the part instance id
  kind: 'board' | 'part'
  title: string
  x: number // canvas placement of the body's local origin
  y: number
  w: number // body size
  h: number
  mode: WiringRenderMode
  pins: PlacedPin[]
  // --- life-like render payload (drawn with the REAL Part/Board renderers) ---
  /** The placed part definition (life-like part body via PartBody). */
  partDef?: PartDefinition
  /** The board definition + its drawn pads (life-like board via Board). */
  boardDef?: BoardDefinition
  /** The local box the life-like body draws into. */
  box?: Box
  /** Uniform scale applied to the life-like part body (so pads/text/strokes scale
   *  together and the body reflects its real dimensions). 1/undefined = as-drawn. */
  scale?: number
  /** Clockwise rotation of the life-like part body, in degrees (0/90/180/270). */
  rotation?: 0 | 90 | 180 | 270
  /** Offset (local coords) of the rotated body's bounding box from the subject
   *  origin — non-zero only for a 90/270° non-square part. Used so the obstacle
   *  box + title/✕ decorations track the visible body. */
  bodyDX?: number
  bodyDY?: number
  pads?: PadPoint[]
  usedPadKeys?: Set<string>
  ledLit?: boolean
  /** Code-used pad highlights to overlay on the board (combine view). */
  codeUsed?: UsedByCode
  /** A placed part whose library isn't installed — drawn as a placeholder. */
  missing?: boolean
  /** Draggable hit region in CANVAS coords (generous; dots are tested first). */
  hit: { x: number; y: number; w: number; h: number }
}

function boardPinNet(type: string | undefined): RobotNet {
  if (type === 'vcc') return 'vcc'
  if (type === 'gnd') return 'gnd'
  return 'signal'
}
function partPinNet(type: string): RobotNet {
  if (type === 'pwr') return 'vcc'
  if (type === 'gnd') return 'gnd'
  return 'signal'
}
/** Outward unit normal for a header edge (wires leave the body this way). */
function edgeNormal(edge: PadPoint['edge']): [number, number] {
  switch (edge) {
    case 'left':
      return [-1, 0]
    case 'right':
      return [1, 0]
    case 'top':
      return [0, -1]
    default:
      return [0, 1] // bottom / led
  }
}

/** Router side from an outward unit normal (for orthogonal schematic routing). */
function sideFromNormal(ox: number, oy: number): RSide {
  if (ox < -0.5) return 'W'
  if (ox > 0.5) return 'E'
  if (oy < -0.5) return 'N'
  return 'S'
}

/** Life-like MCU pins: real pad positions (canvas-local to the board's `box`). */
function boardLifelikePins(pads: PadPoint[]): PlacedPin[] {
  return pads.map((p, i) => {
    const [ox, oy] = edgeNormal(p.edge)
    const pl = padLabelPlacement(p.edge, 11)
    return {
      name: p.pad.label,
      net: boardPinNet(p.pad.type),
      index: i,
      anchors: [{ x: p.x, y: p.y, ox, oy }],
      label: { x: p.x + pl.dx, y: p.y + pl.dy, anchor: pl.anchor }
    }
  })
}

/** Life-like part pins: real pad positions from {@link pinPositions} (== endpoint order). */
function partLifelikePins(def: PartDefinition, box: Box): PlacedPin[] {
  const rps = resolvedPins(def)
  return pinPositions(def, box).map((pp) => ({
    name: pp.name,
    net: partPinNet(pp.type),
    index: pp.index,
    anchors: [{ x: pp.x, y: pp.y, ox: pp.ox, oy: pp.oy }],
    label: { x: pp.x, y: pp.y, anchor: 'middle' as const }, // label drawn by PartBody
    caps: rps[pp.index]?.pin.capabilities
  }))
}

/** Schematic MCU pins: stub-end anchors from the IC-block layout (== pad order).
 *  Merged ground pads share the GND terminal's anchor; only the primary is drawn. */
function boardSchematicPins(def: BoardDefinition): { w: number; h: number; placed: PlacedPin[] } {
  const lay = mcuSymbolLayout(def)
  const placed = lay.terminals.map((t) => {
    const [ox, oy] = edgeNormal(t.side)
    return {
      name: t.pad.label,
      net: boardPinNet(t.pad.type),
      index: t.flatIndex,
      anchors: [{ x: t.outer.x, y: t.outer.y, ox, oy }],
      label: { x: t.label.x, y: t.label.y, anchor: t.label.anchor }, // label drawn by McuSymbol
      primary: t.primary,
      railIndices: t.railIndices
    }
  })
  return { w: lay.box.w, h: lay.box.h, placed }
}

/** Schematic part pins: stub-end anchors from the symbol layout (== endpoint order).
 *  Merged rail pads share the rail terminal's anchor; only the primary is drawn. */
function partSchematicPins(def: PartDefinition): { w: number; h: number; placed: PlacedPin[] } {
  const lay = schematicSymbolLayout(def)
  const placed = lay.terminals.map((t) => {
    const [ox, oy] = edgeNormal(t.side)
    return {
      name: t.pin.name,
      net: partPinNet(t.pin.type),
      index: t.flatIndex,
      anchors: [{ x: t.outer.x, y: t.outer.y, ox, oy }],
      label: { x: t.label.x, y: t.label.y, anchor: t.label.anchor }, // label drawn by the symbol
      primary: t.primary,
      railIndices: t.railIndices
    }
  })
  return { w: lay.box.w, h: lay.box.h, placed }
}

export interface WiringCanvasProps {
  robot: RobotDefinition
  onChange: (next: RobotDefinition) => void
  /** Installed libraries (to resolve a placed part's pins). */
  libraries: PartLibraryWithParts[]
  /** The microcontroller to show as the board (the board view's selection). */
  boardDef: BoardDefinition | null
  /** The board's SOURCE part (when it came from a Parts Library microcontroller
   *  part) — drawn life-like via PartBody so it looks exactly as authored. */
  boardPart?: PartDefinition | null
  /** Which representation to draw — driven by the board view's toggle. */
  renderMode: WiringRenderMode
  /** Board pads used by the parsed code, keyed by board pad index (combine view). */
  usedByCode?: UsedByCode
}

interface Drag {
  kind: 'box' | 'pan' | 'wire'
  /** box drag */
  boxKey?: string
  startX?: number
  startY?: number
  ox?: number
  oy?: number
  liveX?: number
  liveY?: number
  moved?: boolean
  /** pan */
  panX?: number
  panY?: number
  panTX?: number
  panTY?: number
  /** wire drag: originating endpoint + live cursor (world coords) */
  from?: string
  cx?: number
  cy?: number
}

export function WiringCanvas({ robot, onChange, libraries, boardDef, boardPart, renderMode, usedByCode }: WiringCanvasProps): JSX.Element {
  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const [view, setView] = useState({ tx: 0, ty: 0, scale: 1 })
  const [, force] = useState(0) // re-render during a wire/pan/box drag (ref-driven)
  // The pin under the pointer — shows its capability badges (breadboard view).
  const [hover, setHover] = useState<{ key: string; index: number } | null>(null)
  // The selected placed part (#176) — shows a mini-toolbar (rotate/rename/delete).
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  // Inline rename: the draft alias being typed, or null when not renaming.
  const [renameText, setRenameText] = useState<string | null>(null)
  // Whether a rename-input blur should commit (Esc sets it false to cancel cleanly,
  // since closing the input fires a blur we must not treat as a save).
  const renameCommitRef = useRef(true)

  const resolvePart = (lib: string, part: string): PartDefinition | null =>
    libraries.find((l) => l.id === lib)?.parts.find((p) => p.id === part) ?? null

  // --- build the subjects ---------------------------------------------------
  const subjects: Subject[] = []
  if (boardDef) {
    const x = robot.boardX ?? 60
    const y = robot.boardY ?? 90
    if (renderMode === 'lifelike' && boardPart) {
      // The MCU is a Parts-Library microcontroller part — draw it with its REAL part
      // body (background image + accurate x/y pins + castellations), exactly like a
      // placed part. Pin flat-index order matches the board pad enumeration, so the
      // `board.<pin>#<index>` wiring identity is unchanged.
      const box = partBodyBox(boardPart, { maxW: BOARD_BODY_W, maxH: BOARD_BODY_H })
      subjects.push({
        key: 'board',
        kind: 'board',
        title: boardDef.name,
        x,
        y,
        w: box.w,
        h: box.h,
        mode: 'lifelike',
        pins: partLifelikePins(boardPart, box),
        partDef: boardPart,
        boardDef,
        box,
        codeUsed: usedByCode,
        hit: hitRegion('lifelike', x, y, box.w, box.h)
      })
    } else if (renderMode === 'lifelike') {
      // Legacy built-in board (no source part): the node-graph's edge-laid Board.
      const box = boardBox(boardDef.aspect, { cx: BOARD_BODY_W / 2, cy: BOARD_BODY_H / 2, maxW: BOARD_BODY_W, maxH: BOARD_BODY_H })
      const pads = layoutPads(boardDef, box)
      const usedPadKeys = new Set<string>()
      if (usedByCode) usedByCode.forEach((_, idx) => { const pp = pads[idx]; if (pp) usedPadKeys.add(padKey(pp)) })
      subjects.push({
        key: 'board',
        kind: 'board',
        title: boardDef.name,
        x,
        y,
        w: BOARD_BODY_W,
        h: BOARD_BODY_H,
        mode: 'lifelike',
        pins: boardLifelikePins(pads),
        boardDef,
        box,
        pads,
        usedPadKeys,
        ledLit: false,
        codeUsed: usedByCode,
        hit: hitRegion('lifelike', x, y, BOARD_BODY_W, BOARD_BODY_H)
      })
    } else {
      // The MCU as a generic IC block (rectangle + labelled pin stubs).
      const lay = boardSchematicPins(boardDef)
      subjects.push({
        key: 'board',
        kind: 'board',
        title: boardDef.name,
        x,
        y,
        w: lay.w,
        h: lay.h,
        mode: 'schematic',
        pins: lay.placed,
        boardDef,
        codeUsed: usedByCode,
        hit: hitRegion('schematic', x, y, lay.w, lay.h)
      })
    }
  }
  // px-per-mm anchored to the board's ACTUAL drawn width (it may be height-limited
  // for a portrait board, so the raw constant would over-scale): keeps the board's
  // on-canvas size and defines the scale parts are drawn to, so every body reads at
  // its real relative size.
  const boardFitW = boardPart ? partBodyBox(boardPart, { maxW: BOARD_BODY_W, maxH: BOARD_BODY_H }).w : BOARD_BODY_W
  const boardMmW = boardPart?.dimensions?.width
  const pxPerMm = boardMmW && boardMmW > 0 ? boardFitW / boardMmW : PX_PER_MM_DEFAULT
  robot.parts.forEach((rp, i) => {
    const def = resolvePart(rp.lib, rp.part)
    const x = rp.x ?? 420 + (i % 2) * 230
    const y = rp.y ?? 90 + Math.floor(i / 2) * 240
    if (!def) {
      // The part's library isn't installed — a placeholder box, nothing to wire.
      const w = 150
      const h = 60
      subjects.push({
        key: rp.id,
        kind: 'part',
        title: rp.label || rp.part,
        x,
        y,
        w,
        h,
        mode: renderMode,
        pins: [],
        missing: true,
        hit: hitRegion(renderMode, x, y, w, h)
      })
    } else if (renderMode === 'lifelike') {
      // The part drawn with its REAL Part-Editor appearance (image + accurate pins),
      // at a NATIVE reference size then uniformly scaled to its real dimensions so
      // pads, silk text and strokes shrink together (not just positions).
      const nativeBox = partBodyBox(def, { maxW: PART_NATIVE_W, maxH: PART_NATIVE_H })
      const dims = def.dimensions
      // Target on-canvas width: real width × the board's px/mm, else the legacy
      // fixed footprint. Clamped so a stray dimension can't make it tiny/huge.
      const rawW = dims && dims.width > 0 ? dims.width * pxPerMm : PART_BODY_W
      const targetW = Math.max(PART_MIN_W, Math.min(PART_MAX_W, rawW))
      // Scale from width, then also cap by height so a tall/narrow part can't
      // overflow the canvas (aspect is preserved either way).
      let k = targetW / nativeBox.w
      if (nativeBox.h * k > PART_MAX_H) k = PART_MAX_H / nativeBox.h
      // Scaled (pre-rotation) body size + its centre — the rotation pivot (#176).
      const bw = nativeBox.w * k
      const bh = nativeBox.h * k
      const rot = normRot(rp.rotation)
      const cx = bw / 2
      const cy = bh / 2
      // A 90/270° turn swaps the on-canvas footprint; the body stays centred.
      const aabb =
        rot === 90 || rot === 270
          ? { x: cx - bh / 2, y: cy - bw / 2, w: bh, h: bw }
          : { x: 0, y: 0, w: bw, h: bh }
      subjects.push({
        key: rp.id,
        kind: 'part',
        title: rp.label || def.name || rp.id,
        x,
        y,
        w: aabb.w,
        h: aabb.h,
        mode: 'lifelike',
        // Anchors live in CANVAS coords: scale to the body, then rotate about its
        // centre so dots + wires stay attached to the rotated pads.
        pins: partLifelikePins(def, nativeBox).map((p) => ({
          ...p,
          anchors: p.anchors.map((a) => {
            const r = rotatePoint(a.x * k, a.y * k, cx, cy, rot)
            const n = rotateNormal(a.ox, a.oy, rot)
            return { x: r.x, y: r.y, ox: n.ox, oy: n.oy }
          })
        })),
        partDef: def,
        box: nativeBox,
        scale: k,
        rotation: rot,
        bodyDX: aabb.x,
        bodyDY: aabb.y,
        hit: hitRegion('lifelike', x + aabb.x, y + aabb.y, aabb.w, aabb.h)
      })
    } else {
      // The part drawn as its REAL schematic symbol.
      const lay = partSchematicPins(def)
      subjects.push({
        key: rp.id,
        kind: 'part',
        title: rp.label || def.name || rp.id,
        x,
        y,
        w: lay.w,
        h: lay.h,
        mode: 'schematic',
        pins: lay.placed,
        partDef: def,
        hit: hitRegion('schematic', x, y, lay.w, lay.h)
      })
    }
  })
  const subjByKey = new Map(subjects.map((s) => [s.key, s]))

  // Live box-drag override (commit-on-drop): paint the dragged subject at its
  // uncommitted position; only persist on pointer-up so we don't write per move.
  const liveDrag = dragRef.current
  if (liveDrag?.kind === 'box' && liveDrag.boxKey && liveDrag.liveX != null && liveDrag.liveY != null) {
    const s = subjByKey.get(liveDrag.boxKey)
    if (s) {
      const dx = liveDrag.liveX - s.x
      const dy = liveDrag.liveY - s.y
      s.x = liveDrag.liveX
      s.y = liveDrag.liveY
      s.hit = { ...s.hit, x: s.hit.x + dx, y: s.hit.y + dy }
    }
  }

  // --- pin identity ---------------------------------------------------------
  // Endpoints are `"<key>.<pinName>#<index>"` — the flattened-header INDEX is
  // authoritative (pin names repeat; a Pico has eight pads all called GND).
  const endpointOf = (key: string, pinName: string, i: number): string => `${key}.${pinName}#${i}`
  const parseEndpoint = (ep: string): { key: string; index: number } => {
    const hash = ep.lastIndexOf('#')
    const index = hash >= 0 ? parseInt(ep.slice(hash + 1), 10) : -1
    const head = hash >= 0 ? ep.slice(0, hash) : ep
    const dot = head.indexOf('.')
    return { key: dot >= 0 ? head.slice(0, dot) : head, index }
  }
  const pinNet = (ep: string): RobotNet => {
    const { key, index } = parseEndpoint(ep)
    return subjByKey.get(key)?.pins[index]?.net ?? 'signal'
  }

  // Choose the anchor of a pin that best faces a target point (canvas coords).
  const anchorOf = (s: Subject, p: PlacedPin, towardX: number, towardY: number): Anchor & { cx: number; cy: number } => {
    let best = p.anchors[0]
    if (p.anchors.length > 1) {
      let bestScore = -Infinity
      for (const a of p.anchors) {
        const ax = s.x + a.x
        const ay = s.y + a.y
        const score = (towardX - ax) * a.ox + (towardY - ay) * a.oy
        if (score > bestScore) {
          bestScore = score
          best = a
        }
      }
    }
    return { ...best, cx: s.x + best.x, cy: s.y + best.y }
  }

  // --- coordinate helpers ---------------------------------------------------
  const toWorld = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const svg = svgRef.current
    const ctm = svg?.getScreenCTM()
    if (!svg || !ctm) return { x: 0, y: 0 }
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const local = pt.matrixTransform(ctm.inverse())
    return { x: (local.x - view.tx) / view.scale, y: (local.y - view.ty) / view.scale }
  }

  /** Find the pin dot NEAREST a world point (within a screen-constant tolerance).
   *  The tolerance is divided by the zoom so the grab radius stays ~constant on
   *  screen, and we pick the closest dot so dense footprints don't mis-select by
   *  iteration order. */
  const dotAt = (wx: number, wy: number): { endpoint: string } | null => {
    const tol = (DOT_R + 5) / view.scale
    let bestEp: string | null = null
    let bestD = tol
    for (const s of subjects) {
      for (const p of s.pins) {
        for (const a of p.anchors) {
          const d = Math.hypot(wx - (s.x + a.x), wy - (s.y + a.y))
          if (d < bestD) {
            bestD = d
            bestEp = endpointOf(s.key, p.name, p.index)
          }
        }
      }
    }
    return bestEp ? { endpoint: bestEp } : null
  }

  // --- mutations ------------------------------------------------------------
  // Persist, recording which board the wiring is against (self-describing file).
  // Only stamp the board when the project has none yet, or it already matches the
  // shown board — NEVER silently rebind an existing project to a different board
  // (BoardGraph keeps the shown board in sync with robot.board, so a mismatch only
  // exists for the brief window before that effect runs).
  const persist = (next: RobotDefinition): void => {
    if (boardDef && (!next.board || next.board === boardDef.id)) {
      onChange({ ...next, board: boardDef.id })
    } else {
      onChange(next)
    }
  }

  const moveBox = (key: string, x: number, y: number): void => {
    if (key === 'board') persist({ ...robot, boardX: x, boardY: y })
    else persist({ ...robot, parts: robot.parts.map((p) => (p.id === key ? { ...p, x, y } : p)) })
  }
  const addConnection = (from: string, to: string): void => {
    if (from === to) return
    const id = connectionId(from, to)
    if (robot.connections.some((c) => c.id === id || (c.from === to && c.to === from))) return
    const net: RobotNet =
      pinNet(from) === 'vcc' || pinNet(to) === 'vcc'
        ? 'vcc'
        : pinNet(from) === 'gnd' || pinNet(to) === 'gnd'
          ? 'gnd'
          : 'signal'
    const conn: RobotConnection = { id, from, to, net }
    // Index the palette by EXISTING signal wires only (vcc/gnd don't consume a
    // colour), so signal wires stay visually distinct.
    if (net === 'signal') {
      conn.color = signalColor(robot.connections.filter((c) => (c.net ?? 'signal') === 'signal').length)
    }
    persist({ ...robot, connections: [...robot.connections, conn] })
  }
  const removeConnection = (id: string): void =>
    persist({ ...robot, connections: robot.connections.filter((c) => c.id !== id) })
  const setConnectionColor = (id: string, color: string): void =>
    persist({ ...robot, connections: robot.connections.map((c) => (c.id === id ? { ...c, color } : c)) })
  // Remove a placed part AND any wires that reference it (no dangling endpoints).
  const removePart = (key: string): void => {
    setSelectedKey((k) => (k === key ? null : k)) // drop a stale selection
    persist({
      ...robot,
      parts: robot.parts.filter((p) => p.id !== key),
      connections: robot.connections.filter(
        (c) => parseEndpoint(c.from).key !== key && parseEndpoint(c.to).key !== key
      )
    })
  }

  // Rotate a placed part 90° clockwise (#176). Wires follow the rotated pins.
  const rotatePart = (key: string): void =>
    persist({
      ...robot,
      parts: robot.parts.map((p) => (p.id === key ? { ...p, rotation: normRot((p.rotation ?? 0) + 90) } : p))
    })

  // Rename a placed part — a display-only alias; the part's properties are untouched.
  const renamePart = (key: string, label: string): void =>
    persist({
      ...robot,
      parts: robot.parts.map((p) => (p.id === key ? { ...p, label: label.trim() || undefined } : p))
    })

  // Save the project/robot name + description into robot.yml (#179).
  const commitRobotMeta = (patch: { name?: string; description?: string }): void =>
    persist({
      ...robot,
      name: patch.name !== undefined ? patch.name.trim() || undefined : robot.name,
      description: patch.description !== undefined ? patch.description.trim() || undefined : robot.description
    })

  // --- pointer handlers -----------------------------------------------------
  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>): void => {
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    const w = toWorld(e)
    const dot = dotAt(w.x, w.y)
    if (dot) {
      dragRef.current = { kind: 'wire', from: dot.endpoint, cx: w.x, cy: w.y }
      force((n) => n + 1)
      return
    }
    // A subject under the pointer? → drag it (topmost first).
    const hit = [...subjects].reverse().find((s) => w.x >= s.hit.x && w.x <= s.hit.x + s.hit.w && w.y >= s.hit.y && w.y <= s.hit.y + s.hit.h)
    if (hit) {
      dragRef.current = { kind: 'box', boxKey: hit.key, startX: w.x, startY: w.y, ox: hit.x, oy: hit.y }
      return
    }
    // Empty space → pan.
    dragRef.current = { kind: 'pan', panX: e.clientX, panY: e.clientY, panTX: view.tx, panTY: view.ty }
  }

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>): void => {
    const d = dragRef.current
    if (!d) return
    if (d.kind === 'pan') {
      // Only count as a real pan past a small dead-zone, so a jittered click on
      // empty space still deselects rather than being treated as a pan.
      if (Math.hypot(e.clientX - (d.panX ?? 0), e.clientY - (d.panY ?? 0)) > DRAG_DEADZONE_PX) d.moved = true
      const ctm = svgRef.current?.getScreenCTM()
      const s = ctm && ctm.a ? ctm.a : 1
      setView((v) => ({
        ...v,
        tx: (d.panTX ?? 0) + (e.clientX - (d.panX ?? 0)) / s,
        ty: (d.panTY ?? 0) + (e.clientY - (d.panY ?? 0)) / s
      }))
      return
    }
    const w = toWorld(e)
    if (d.kind === 'box') {
      // Dead-zone: a sub-pixel jitter while clicking a part must not flip it to a
      // move (which would skip selection and dirty robot.yml with a no-op shift).
      if (!d.moved && Math.hypot(w.x - (d.startX ?? 0), w.y - (d.startY ?? 0)) * view.scale <= DRAG_DEADZONE_PX) return
      d.moved = true
      d.liveX = (d.ox ?? 0) + (w.x - (d.startX ?? 0))
      d.liveY = (d.oy ?? 0) + (w.y - (d.startY ?? 0))
      force((n) => n + 1)
      return
    }
    if (d.kind === 'wire') {
      d.cx = w.x
      d.cy = w.y
      force((n) => n + 1)
    }
  }

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>): void => {
    const d = dragRef.current
    dragRef.current = null
    if (d?.kind === 'box' && d.moved && d.boxKey && d.liveX != null && d.liveY != null) {
      moveBox(d.boxKey, d.liveX, d.liveY)
      return
    }
    // A click (no drag) on a placed part selects it (boards aren't selectable);
    // a click on empty space clears the selection. Either way, end any rename.
    if (d?.kind === 'box' && !d.moved) {
      const s = d.boxKey ? subjByKey.get(d.boxKey) : undefined
      setSelectedKey(renderMode === 'lifelike' && s?.kind === 'part' ? (d.boxKey ?? null) : null)
      setRenameText(null)
      return
    }
    if (d?.kind === 'pan' && !d.moved) {
      setSelectedKey(null)
      setRenameText(null)
      return
    }
    if (d?.kind === 'wire' && d.from) {
      const w = toWorld(e)
      const target = dotAt(w.x, w.y)
      if (target && target.endpoint !== d.from) addConnection(d.from, target.endpoint)
      force((n) => n + 1)
    }
  }

  const onWheel = (e: WheelEvent<SVGSVGElement>): void => {
    const svg = svgRef.current
    const ctm = svg?.getScreenCTM()
    setView((v) => {
      const scale = clampScale(v.scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1))
      if (!ctm || !svg) return { ...v, scale }
      const pt = svg.createSVGPoint()
      pt.x = e.clientX
      pt.y = e.clientY
      const local = pt.matrixTransform(ctm.inverse())
      const wx = (local.x - v.tx) / v.scale
      const wy = (local.y - v.ty) / v.scale
      return { scale, tx: local.x - wx * scale, ty: local.y - wy * scale }
    })
  }

  // Button zoom (− / +): zoom about the viewBox centre so the framed content stays
  // centred, mirroring the node-graph + Part Editor zoom controls.
  const zoomBy = (factor: number): void => {
    setView((v) => {
      const scale = clampScale(v.scale * factor)
      const cx = VIEW_W / 2
      const cy = VIEW_H / 2
      const wx = (cx - v.tx) / v.scale
      const wy = (cy - v.ty) / v.scale
      return { scale, tx: cx - wx * scale, ty: cy - wy * scale }
    })
  }

  /** Frame all subjects within the viewBox (a "fit" reset). */
  const fitView = (): void => {
    if (subjects.length === 0) {
      setView({ tx: 0, ty: 0, scale: 1 })
      return
    }
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const s of subjects) {
      minX = Math.min(minX, s.hit.x)
      minY = Math.min(minY, s.hit.y)
      maxX = Math.max(maxX, s.hit.x + s.hit.w)
      maxY = Math.max(maxY, s.hit.y + s.hit.h)
    }
    const pad = 60
    const cw = maxX - minX + pad * 2
    const ch = maxY - minY + pad * 2
    const scale = Math.min(3, Math.max(0.35, Math.min(VIEW_W / cw, VIEW_H / ch)))
    setView({
      tx: (VIEW_W - (maxX + minX) * scale) / 2,
      ty: (VIEW_H - (maxY + minY) * scale) / 2,
      scale
    })
  }

  // Auto fit-to-view when the CONTENT changes (view toggle, board change, a part
  // added/removed) — keyed on a signature that excludes positions/pan, so it
  // never yanks the view during a drag, pan or wire pull.
  const fitSig = `${renderMode}|${boardDef?.id ?? ''}|${subjects.map((s) => s.key).join(',')}`
  useEffect(() => {
    fitView()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitSig])

  // --- schematic orthogonal routing -----------------------------------------
  // Route ALL wires together so they avoid components and nudge off each other —
  // orthogonal (sharp) in Schematic, the same routed path rounded into a "noodle"
  // in Breadboard. Memoised on a signature of subject positions + pin anchors +
  // the connection list, so it recomputes only when geometry actually moves (not
  // on pan or a wire pull).
  const routeSig =
    renderMode +
    '|' +
    subjects
      .map(
        (s) =>
          `${s.key}:${Math.round(s.x)}:${Math.round(s.y)}:${s.w}:${s.h}:` +
          s.pins.map((p) => `${p.index}@${Math.round(p.anchors[0].x)},${Math.round(p.anchors[0].y)}`).join('/')
      )
      .join(',') +
    '|' +
    robot.connections.map((c) => `${c.id}:${c.from}>${c.to}`).join(',')
  const wireRoutes = useMemo<Map<string, { x: number; y: number }[]>>(() => {
    const isSchem = renderMode === 'schematic'
    // Obstacles: every symbol box in Schematic; only the PART bodies in Breadboard
    // (the board's pads are inset inside its mat, so treating the board as an
    // obstacle would trap their stubs — wires still route around placed parts).
    const obstacles: RBox[] = subjects
      .filter((s) => isSchem || s.kind === 'part')
      // bodyDX/DY shift the box to the rotated body (non-zero only for a 90/270°
      // non-square part) so wire avoidance tracks what's actually drawn.
      .map((s) => ({ x: s.x + (s.bodyDX ?? 0), y: s.y + (s.bodyDY ?? 0), w: s.w, h: s.h }))
    const wires: RWire[] = []
    for (const c of robot.connections) {
      const f = parseEndpoint(c.from)
      const t = parseEndpoint(c.to)
      const fs = subjByKey.get(f.key)
      const ts = subjByKey.get(t.key)
      const fp = fs?.pins[f.index]
      const tp = ts?.pins[t.index]
      if (!fs || !ts || !fp || !tp) continue
      const fa = fp.anchors[0]
      const ta = tp.anchors[0]
      wires.push({
        id: c.id,
        src: { x: fs.x + fa.x, y: fs.y + fa.y, side: sideFromNormal(fa.ox, fa.oy) },
        dst: { x: ts.x + ta.x, y: ts.y + ta.y, side: sideFromNormal(ta.ox, ta.oy) }
      })
    }
    return routeOrthogonal(obstacles, wires, { margin: isSchem ? 12 : 6 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeSig])

  // --- wire path: orthogonal in Schematic, a rounded "noodle" in Breadboard ----
  const wirePath = (c: RobotConnection): { d: string } | null => {
    const pts = wireRoutes.get(c.id)
    if (!pts || pts.length < 2) return null
    return { d: renderMode === 'schematic' ? toSvgPath(pts) : toRoundedPath(pts) }
  }

  const drag = dragRef.current
  const isDark = true // the wiring mat is dark, so ground wires render light

  // Selected part + the screen position of its mini-toolbar (#176). Only placed
  // parts in the breadboard view are selectable/rotatable.
  const selSubject = renderMode === 'lifelike' && selectedKey ? subjByKey.get(selectedKey) : undefined
  const selPart = selSubject?.kind === 'part' ? selSubject : undefined
  const selToolbar = (() => {
    const svg = svgRef.current
    if (!selPart || !svg) return null
    const ctm = svg.getScreenCTM()
    if (!ctm) return null
    const stage = svg.closest('.wc__stage') as HTMLElement | null
    const rect = (stage ?? svg).getBoundingClientRect()
    const toScreen = (uy: number): DOMPoint => {
      const pt = svg.createSVGPoint()
      pt.x = view.tx + (selPart.hit.x + selPart.hit.w / 2) * view.scale
      pt.y = view.ty + uy * view.scale
      return pt.matrixTransform(ctm)
    }
    const top = toScreen(selPart.hit.y)
    const aboveTop = top.y - rect.top
    // Not enough room above (stage clips overflow) → flip the toolbar below the part.
    const below = aboveTop < 44
    const y = below ? toScreen(selPart.hit.y + selPart.hit.h).y - rect.top : aboveTop
    return { left: top.x - rect.left, top: y, below }
  })()

  return (
    <div className="wc">
      <div className="wc__stage">
        <svg
          ref={svgRef}
          className="wc__svg"
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          width="100%"
          height="100%"
          preserveAspectRatio="xMidYMid meet"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
        >
          {/* The node-graph Board's gradients/filter (bg-pcb/bg-gold/bg-silver/bg-glow)
              must be in scope for the life-like board body to paint. */}
          {boardDef && renderMode === 'lifelike' && <BoardDefs def={boardDef} />}
          <g transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}>
            {/* Committed wires (under the dots so the dots stay grabbable). */}
            {robot.connections.map((c) => {
              const p = wirePath(c)
              if (!p) return null
              return (
                <path key={c.id} d={p.d} fill="none" stroke={connectionColor(c, isDark)} strokeWidth={3} className="wc__wire" />
              )
            })}

            {/* The live wire being dragged. */}
            {drag?.kind === 'wire' && drag.from && (() => {
              const f = parseEndpoint(drag.from)
              const fs = subjByKey.get(f.key)
              const fp = fs?.pins[f.index]
              if (!fs || !fp) return null
              const a = anchorOf(fs, fp, drag.cx ?? fs.x, drag.cy ?? fs.y)
              const cx = drag.cx ?? a.cx
              const cy = drag.cy ?? a.cy
              const dist = Math.max(40, Math.hypot(cx - a.cx, cy - a.cy) * 0.4)
              return (
                <path
                  d={`M ${a.cx} ${a.cy} C ${a.cx + a.ox * dist} ${a.cy + a.oy * dist}, ${cx} ${cy}, ${cx} ${cy}`}
                  fill="none"
                  stroke="#4ea1ff"
                  strokeWidth={2}
                  strokeDasharray="5 4"
                />
              )
            })()}

            {/* Subjects (the MCU + placed parts). */}
            {subjects.map((s) => (
              <SubjectBody
                key={s.key}
                subject={s}
                onRemove={s.kind === 'part' ? () => removePart(s.key) : undefined}
                onHoverPin={(idx) => setHover(idx == null ? null : { key: s.key, index: idx })}
              />
            ))}

            {/* Selection ring around the selected part (#176). */}
            {selPart && (
              <rect
                className="wc__sel-ring"
                x={selPart.hit.x}
                y={selPart.hit.y}
                width={selPart.hit.w}
                height={selPart.hit.h}
                rx={6}
              />
            )}

            {/* Hover capability badges (breadboard) — over everything. */}
            {renderMode === 'lifelike' &&
              hover &&
              !dragRef.current &&
              (() => {
                const s = subjByKey.get(hover.key)
                const p = s?.pins.find((pp) => pp.index === hover.index)
                if (!s || !p || !p.caps?.length) return null
                const a = p.anchors[0]
                return capabilityBadges(s.x + a.x, s.y + a.y, p.caps)
              })()}
          </g>
        </svg>

        {/* Mini-toolbar above the selected part (#176): rotate / rename / delete. */}
        {selPart && selToolbar && (
          <div
            className={`wc__parttb${selToolbar.below ? ' wc__parttb--below' : ''}`}
            style={{ left: `${selToolbar.left}px`, top: `${selToolbar.top}px` }}
            role="toolbar"
            aria-label={`Edit ${selPart.title}`}
          >
            {renameText !== null ? (
              <input
                className="wc__parttb-input"
                autoFocus
                value={renameText}
                placeholder="Label…"
                aria-label="Part label"
                onChange={(e) => setRenameText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.currentTarget.blur() // commits via onBlur
                  } else if (e.key === 'Escape') {
                    renameCommitRef.current = false // cancel: the closing blur won't save
                    e.currentTarget.blur()
                  }
                }}
                onBlur={() => {
                  if (renameCommitRef.current && renameText !== null) renamePart(selPart.key, renameText)
                  renameCommitRef.current = true
                  setRenameText(null)
                }}
              />
            ) : (
              <>
                <button type="button" className="wc__parttb-btn" title="Rotate 90°" aria-label="Rotate 90 degrees" onClick={() => rotatePart(selPart.key)}>
                  <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M12 5V2L8 6l4 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7Z" fill="currentColor" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="wc__parttb-btn"
                  title="Rename (display label only)"
                  aria-label="Rename part"
                  onClick={() => setRenameText(robot.parts.find((p) => p.id === selPart.key)?.label ?? '')}
                >
                  <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                    <path d="M11.1 2.6a1.4 1.4 0 0 1 2 2L5.6 12 3 13l1-2.6 7.1-7.8Z" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinejoin="round" />
                    <path d="M9.6 4.1l2.3 2.3" stroke="currentColor" strokeWidth={1.3} />
                  </svg>
                </button>
                <button
                  type="button"
                  className="wc__parttb-btn wc__parttb-btn--danger"
                  title="Delete from breadboard"
                  aria-label="Delete part"
                  onClick={() => removePart(selPart.key)}
                >
                  <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                    <path d="M3.5 4.5h9M6.5 4.5V3.2A1 1 0 0 1 7.5 2.2h1a1 1 0 0 1 1 1V4.5" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" />
                    <path d="M4.5 4.5 5 13a1 1 0 0 0 1 .9h4a1 1 0 0 0 1-.9l.5-8.5" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </>
            )}
          </div>
        )}

        <div className="wc__controls" role="toolbar" aria-label="Wiring view controls">
          <span className="wc__hint">Drag from a pin to another pin to wire them.</span>
          <div className="wc__zoom">
            <button
              type="button"
              className="wc__zoom-btn"
              onClick={() => zoomBy(1 / WC_ZOOM_STEP)}
              title="Zoom out"
              aria-label="Zoom out"
            >
              −
            </button>
            <span className="wc__zoom-pct" aria-label={`Zoom ${Math.round(view.scale * 100)} percent`}>
              {Math.round(view.scale * 100)}%
            </span>
            <button
              type="button"
              className="wc__zoom-btn"
              onClick={() => zoomBy(WC_ZOOM_STEP)}
              title="Zoom in"
              aria-label="Zoom in"
            >
              +
            </button>
            <span className="wc__zoom-sep" aria-hidden="true" />
            <button type="button" className="wc__zoom-btn" onClick={fitView} title="Zoom to fit" aria-label="Zoom to fit">
              <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>

        {!boardDef && robot.parts.length === 0 && (
          <div className="wc__empty">
            <p>Nothing to wire yet.</p>
            <p className="wc__muted">Pick a board above, then add parts from the library panel.</p>
          </div>
        )}
      </div>

      <RobotHeader name={robot.name ?? ''} description={robot.description ?? ''} onCommit={commitRobotMeta} />
      <div className="wc__bottom">
        <PartsList parts={robot.parts} onRemove={removePart} />
        <ConnectionsTable connections={robot.connections} isDark={isDark} onRemove={removeConnection} onColor={setConnectionColor} />
      </div>
    </div>
  )
}

/**
 * Inline-editable project/robot name + description, saved to robot.yml (#179).
 * Sits above the parts list (where the definition is structured). Ghost
 * placeholder text shows when empty; Enter (name) or blur saves and flashes a
 * "Saved to robot.yml" confirmation; Esc reverts.
 */
function RobotHeader({
  name,
  description,
  onCommit
}: {
  name: string
  description: string
  onCommit: (patch: { name?: string; description?: string }) => void
}): JSX.Element {
  const [nameDraft, setNameDraft] = useState(name)
  const [descDraft, setDescDraft] = useState(description)
  const [saved, setSaved] = useState(false)
  // Esc reverts: the closing blur fires synchronously, so flag it to skip the save.
  const revertRef = useRef(false)
  // Re-sync drafts when the robot loads / changes from elsewhere.
  useEffect(() => setNameDraft(name), [name])
  useEffect(() => setDescDraft(description), [description])
  // Auto-hide the "saved" flash.
  useEffect(() => {
    if (!saved) return
    const t = window.setTimeout(() => setSaved(false), 2200)
    return () => window.clearTimeout(t)
  }, [saved])

  const commitName = (): void => {
    if (revertRef.current) {
      revertRef.current = false
      return
    }
    if (nameDraft !== name) {
      onCommit({ name: nameDraft })
      setSaved(true)
    }
  }
  const commitDesc = (): void => {
    if (revertRef.current) {
      revertRef.current = false
      return
    }
    if (descDraft !== description) {
      onCommit({ description: descDraft })
      setSaved(true)
    }
  }
  // Cancel an edit: skip the commit the closing blur would trigger, restore the
  // draft, and don't let Esc bubble to the board window's global close handler.
  const cancel = (e: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>, restore: () => void): void => {
    revertRef.current = true
    e.stopPropagation()
    restore()
    e.currentTarget.blur()
  }

  return (
    <div className="wc__project">
      <input
        className="wc__project-name"
        value={nameDraft}
        placeholder="Untitled project"
        aria-label="Project name"
        onChange={(e) => setNameDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          else if (e.key === 'Escape') cancel(e, () => setNameDraft(name))
        }}
        onBlur={commitName}
      />
      <textarea
        className="wc__project-desc"
        value={descDraft}
        placeholder="Add a description…"
        aria-label="Project description"
        rows={2}
        onChange={(e) => setDescDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            e.currentTarget.blur()
          } else if (e.key === 'Escape') cancel(e, () => setDescDraft(description))
        }}
        onBlur={commitDesc}
      />
      <span className={`wc__project-saved${saved ? ' is-shown' : ''}`} aria-live="polite">
        {saved ? 'Saved to robot.yml ✓' : ''}
      </span>
    </div>
  )
}

/** The list of parts placed in the project, with a hover-to-reveal delete. */
function PartsList({ parts, onRemove }: { parts: RobotPart[]; onRemove: (id: string) => void }): JSX.Element {
  return (
    <div className="wc__parts">
      <div className="wc__table-head">
        <span>Parts</span>
        <span className="wc__table-count">{parts.length}</span>
      </div>
      {parts.length === 0 ? (
        <p className="wc__muted wc__table-empty">No parts yet — add them from the library panel.</p>
      ) : (
        <ul className="wc__parts-list">
          {parts.map((p) => (
            <li key={p.id} className="wc__parts-item">
              <span className="wc__parts-name">{p.label || p.part}</span>
              <button
                type="button"
                className="wc__parts-del"
                onClick={() => onRemove(p.id)}
                title={`Remove ${p.label || p.part}`}
                aria-label={`Remove ${p.label || p.part}`}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path
                    d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V7m4 4v6m4-6v6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** The draggable hit region (canvas coords) — schematic uses the box; life-like
 *  adds a title band above the body. */
function hitRegion(mode: WiringRenderMode, x: number, y: number, w: number, h: number): { x: number; y: number; w: number; h: number } {
  if (mode === 'lifelike') return { x, y: y - 20, w, h: h + 20 }
  return { x, y, w, h }
}

/** Render one subject (MCU or part) in its own translated group. The body is the
 *  REAL renderer for its mode (Board / PartBody / McuSymbol / PartSchematicSymbol);
 *  the wiring canvas draws the connectable dots + combine labels on top. */
function SubjectBody({
  subject: s,
  onRemove,
  onHoverPin
}: {
  subject: Subject
  onRemove?: () => void
  onHoverPin?: (index: number | null) => void
}): JSX.Element {
  const removeY = s.mode === 'schematic' ? 10 : -7
  // Centre the title + remove ✕ over the VISIBLE body (shifted for a rotated
  // non-square part); 0 for everything else.
  const dx = s.bodyDX ?? 0
  const dy = s.bodyDY ?? 0 // visible (rotated) top, so the title sits above it (#180)
  const highlightIndices = s.codeUsed ? new Set(s.codeUsed.keys()) : undefined
  return (
    <g transform={`translate(${s.x} ${s.y})`}>
      {/* --- The body --- */}
      {s.missing ? (
        <>
          <rect x={0} y={0} width={s.w} height={s.h} rx={6} className="wc__missing" />
          <text x={s.w / 2} y={s.h / 2 - 2} className="wc__missing-text">
            {s.title}
          </text>
          <text x={s.w / 2} y={s.h / 2 + 14} className="wc__missing-sub">
            part library not installed
          </text>
        </>
      ) : s.mode === 'schematic' ? (
        s.kind === 'board' && s.boardDef ? (
          <McuSymbol def={s.boardDef} highlightIndices={highlightIndices} />
        ) : s.partDef ? (
          <PartSchematicSymbol part={s.partDef} />
        ) : null
      ) : (
        <>
          {/* A part-backed board renders via its REAL part body (image + x/y pins),
              so an authored board looks exactly as drawn (#52/issue-1). Legacy
              built-in boards (no source part) fall back to the edge-laid Board. */}
          {s.partDef && s.box ? (
            (() => {
              const k = s.scale ?? 1
              const bw = s.box.w * k
              const bh = s.box.h * k
              const tf = `${s.rotation ? `rotate(${s.rotation} ${bw / 2} ${bh / 2}) ` : ''}${k !== 1 ? `scale(${k})` : ''}`.trim()
              // Tell PartBody the applied rotation/scale so it keeps text upright
              // and pin labels a consistent size (#180).
              const body = <PartBody part={s.partDef} box={s.box} rotation={s.rotation ?? 0} bodyScale={k} />
              return tf ? <g transform={tf}>{body}</g> : body
            })()
          ) : s.kind === 'board' && s.boardDef && s.box && s.pads ? (
            <Board def={s.boardDef} box={s.box} pads={s.pads} usedPadKeys={s.usedPadKeys ?? new Set()} ledLit={!!s.ledLit} rotation={0} />
          ) : null}
          <text x={dx + s.w / 2} y={dy - 7} textAnchor="middle" className="wc__body-title">
            {s.title}
          </text>
        </>
      )}

      {/* --- Combine view: label each board pad the user's code uses. --- */}
      {s.kind === 'board' &&
        s.codeUsed &&
        s.pins.map((p) => {
          if (p.primary === false) return null
          const used = s.codeUsed?.get(p.index)
          if (!used) return null
          const a = p.anchors[0]
          const anchor = a.ox < -0.5 ? 'end' : a.ox > 0.5 ? 'start' : 'middle'
          return (
            <text key={`u${p.index}`} x={a.x + a.ox * 30} y={a.y + a.oy * 30 + 3} textAnchor={anchor} className="wc__code-label" style={{ fill: used.color }}>
              {used.label}
            </text>
          )
        })}

      {/* --- Connection dots. Breadboard shows one on every pad (the connect
          affordance). Schematic draws NONE — per convention a circle on a pin
          means inversion, and connections are just where a wire meets the stub end
          (pins stay grabbable via the hit-test). --- */}
      {s.mode !== 'schematic' &&
        s.pins.map((p) => {
          if (p.primary === false) return null
          const a = p.anchors[0]
          return (
            <circle
              key={p.index}
              cx={a.x}
              cy={a.y}
              r={DOT_R}
              className={`wc__dot wc__dot--${p.net}`}
              onPointerEnter={onHoverPin ? () => onHoverPin(p.index) : undefined}
              onPointerLeave={onHoverPin ? () => onHoverPin(null) : undefined}
            />
          )
        })}

      {onRemove && (
        <g
          className="wc__box-remove"
          onPointerDown={(e) => {
            e.stopPropagation()
            onRemove()
          }}
        >
          <title>Remove part</title>
          <circle cx={dx + s.w - 11} cy={dy + removeY} r={7} />
          <text x={dx + s.w - 11} y={dy + removeY + 3.5}>
            ✕
          </text>
        </g>
      )}
    </g>
  )
}

/** "dist1.SDA#3" → "dist1.SDA" — the #index is internal disambiguation only. */
function fmtEndpoint(ep: string): string {
  const hash = ep.lastIndexOf('#')
  return hash >= 0 ? ep.slice(0, hash) : ep
}

/** The connections table beneath the canvas. */
function ConnectionsTable({
  connections,
  isDark,
  onRemove,
  onColor
}: {
  connections: RobotConnection[]
  isDark: boolean
  onRemove: (id: string) => void
  onColor: (id: string, color: string) => void
}): JSX.Element {
  return (
    <div className="wc__table">
      <div className="wc__table-head">
        <span>Connections</span>
        <span className="wc__table-count">{connections.length}</span>
      </div>
      {connections.length === 0 ? (
        <p className="wc__muted wc__table-empty">No wires yet — drag between two pins to connect them.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>From</th>
              <th>To</th>
              <th>Net</th>
              <th>Colour</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {connections.map((c) => (
              <tr key={c.id}>
                <td className="wc__mono">{fmtEndpoint(c.from)}</td>
                <td className="wc__mono">{fmtEndpoint(c.to)}</td>
                <td>{c.net ?? 'signal'}</td>
                <td>
                  <input
                    type="color"
                    className="wc__swatch"
                    value={/^#[0-9a-f]{6}$/i.test(connectionColor(c, isDark)) ? connectionColor(c, isDark) : '#888888'}
                    onChange={(e) => onColor(c.id, e.target.value)}
                    title="Wire colour"
                  />
                </td>
                <td>
                  <button type="button" className="wc__del" onClick={() => onRemove(c.id)} title="Delete wire" aria-label="Delete wire">
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
