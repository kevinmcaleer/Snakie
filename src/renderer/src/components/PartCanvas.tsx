import {
  useEffect,
  useRef,
  useState,
  type JSX,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent
} from 'react'
import {
  derivePinPosition,
  resolvedPins,
  type ResolvedPin
} from './part-editor.util'
import type { PartDefinition, PartPinType } from '../../../shared/part'
import './PartCanvas.css'

/**
 * PART CANVAS (#130, redesign)
 * ============================
 *
 * The interactive, **layered** drawing surface for the Part Editor's Breadboard
 * view. Layers, bottom → top:
 *
 *   1. board shape    — a rectangle (with optional corner radius) or a polygon
 *   2. image layer    — the board photo, placed as its OWN movable/resizable
 *                       layer (NOT stretched to the outline). Hidden in the
 *                       "footprint" rendering (`showImage={false}`).
 *   3. components     — features, mounting holes, buttons, pins (free-placed by
 *                       absolute x/y) and text labels.
 *
 * It is **pure free placement**: every pin/hole/label/button carries an absolute
 * normalised position and is dragged directly. A `tool` selects the interaction
 * (select / move-pan / shape / text / pin / hole); `readOnly` renders the same
 * scene non-interactively (the Parts panel's part detail reuses it).
 *
 * The same component renders the life-like view (image on) and the footprint
 * (image off) — "the footprint mirrors the life-like, just without the image".
 */

const VIEW_W = 460
const VIEW_H = 460
const MAX_W = 300
const MAX_H = 340

/** Pad fill by electrical role (kept close to the Board View's palette). */
const PAD_FILL: Record<PartPinType, string> = {
  io: '#d6a531',
  pwr: '#c0392b',
  gnd: '#3a3f44',
  other: '#8a8f96'
}

/** The toolbar tools, in display order. */
export type CanvasTool = 'select' | 'move' | 'shape' | 'text' | 'pin' | 'hole'

export const CANVAS_TOOLS: { id: CanvasTool; label: string; hint: string }[] = [
  { id: 'select', label: 'Select', hint: 'Select & move objects (and the image)' },
  { id: 'move', label: 'Pan', hint: 'Drag to pan the canvas; scroll to zoom' },
  { id: 'shape', label: 'Shape', hint: 'Edit the board polygon vertices' },
  { id: 'pin', label: 'Pin', hint: 'Click the board to add a pin' },
  { id: 'hole', label: 'Hole', hint: 'Click the board to add a mounting hole' },
  { id: 'text', label: 'Text', hint: 'Click the board to add a label' }
]

/** What is currently selected (drives the editor's contextual inspector). */
export type CanvasSelection =
  | { type: 'pin'; hi: number; pi: number }
  | { type: 'hole'; index: number }
  | { type: 'button'; index: number }
  | { type: 'label'; index: number }
  | { type: 'vertex'; index: number }
  | { type: 'image' }
  | null

export interface PartCanvasProps {
  part: PartDefinition
  /** Show the image layer (life-like). False = footprint (pads/holes only). */
  showImage?: boolean
  /** Draw the pin-spacing grid behind the board. */
  showGrid?: boolean
  /** Non-interactive render (the Parts panel detail). */
  readOnly?: boolean
  /** Active tool (interactive only). */
  tool?: CanvasTool
  /** Current selection (interactive only). */
  selection?: CanvasSelection
  /** Snap placed/moved positions to the pin-spacing grid. */
  snap?: boolean
  /** Mutate the part (interactive only). */
  onChange?: (next: PartDefinition) => void
  /** Selection changed. */
  onSelect?: (sel: CanvasSelection) => void
  /** Bump this number to reset pan/zoom to the default (a "Fit" button). */
  resetSignal?: number
}

interface Box {
  x: number
  y: number
  w: number
  h: number
}

function boardAspect(part: PartDefinition): number {
  if (typeof part.aspect === 'number' && part.aspect > 0) return part.aspect
  if (part.dimensions && part.dimensions.height > 0) return part.dimensions.width / part.dimensions.height
  return 0.6
}

/** Fit a board of the given aspect centred within the SVG mat. */
function fitBox(aspect: number): Box {
  let w = MAX_W
  let h = w / aspect
  if (h > MAX_H) {
    h = MAX_H
    w = h * aspect
  }
  return { x: (VIEW_W - w) / 2, y: (VIEW_H - h) / 2, w, h }
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

/** Drag state while a pointer is down. */
interface Drag {
  kind: 'move-obj' | 'pan' | 'resize-image' | 'move-vertex'
  sel: CanvasSelection
  /** resize corner (0=tl,1=tr,2=br,3=bl). */
  corner?: number
  /** pointer start in normalised board coords. */
  startNX: number
  startNY: number
  /** object's original position/size. */
  ox: number
  oy: number
  ow?: number
  oh?: number
  /** pan start in screen-view coords. */
  panX?: number
  panY?: number
  panTX?: number
  panTY?: number
  moved?: boolean
}

export function PartCanvas({
  part,
  showImage = true,
  showGrid = false,
  readOnly = false,
  tool = 'select',
  selection = null,
  snap = false,
  onChange,
  onSelect,
  resetSignal
}: PartCanvasProps): JSX.Element {
  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const [view, setView] = useState({ tx: 0, ty: 0, scale: 1 })

  // Reset pan/zoom when the editor's "Fit" button bumps the signal.
  useEffect(() => {
    if (resetSignal !== undefined) setView({ tx: 0, ty: 0, scale: 1 })
  }, [resetSignal])

  const box = fitBox(boardAspect(part))
  const pins = resolvedPins(part)
  const spacing = part.pinSpacing && part.pinSpacing > 0 ? part.pinSpacing : 2.54
  const interactive = !readOnly && !!onChange

  // The image layer placement (defaults to covering the whole board box).
  const layer = part.imageLayer ?? { x: 0, y: 0, w: 1, h: 1 }

  // --- coordinate helpers ---------------------------------------------------
  const toWorld = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const ctm = svg.getScreenCTM()
    if (!ctm) return { x: 0, y: 0 }
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const local = pt.matrixTransform(ctm.inverse()) // viewBox-space
    return { x: (local.x - view.tx) / view.scale, y: (local.y - view.ty) / view.scale }
  }
  const toNorm = (e: { clientX: number; clientY: number }): { nx: number; ny: number } => {
    const w = toWorld(e)
    return { nx: (w.x - box.x) / box.w, ny: (w.y - box.y) / box.h }
  }
  const snapVal = (v: number, axis: 'x' | 'y'): number => {
    if (!snap) return clamp01(v)
    // Snap to the pin-spacing grid across the board's physical extent on THIS
    // axis (width for x, height for y) so non-square boards snap correctly.
    const sizeMm = axis === 'x' ? part.dimensions?.width : part.dimensions?.height
    const steps = sizeMm && sizeMm > 0 ? Math.max(1, Math.round(sizeMm / spacing)) : 20
    return clamp01(Math.round(v * steps) / steps)
  }
  const snapX = (v: number): number => snapVal(v, 'x')
  const snapY = (v: number): number => snapVal(v, 'y')

  // Project a normalised point into world coords for drawing.
  const px = (nx: number): number => box.x + nx * box.w
  const py = (ny: number): number => box.y + ny * box.h

  // --- mutation helpers -----------------------------------------------------
  const commit = (next: PartDefinition): void => onChange?.(next)

  const movePinTo = (hi: number, pi: number, nx: number, ny: number): void => {
    commit({
      ...part,
      headers: part.headers.map((h, i) =>
        i === hi
          ? { ...h, pins: h.pins.map((p, j) => (j === pi ? { ...p, x: snapX(nx), y: snapY(ny) } : p)) }
          : h
      )
    })
  }
  const moveHoleTo = (index: number, nx: number, ny: number): void => {
    commit({
      ...part,
      mountingHoles: (part.mountingHoles ?? []).map((h, i) =>
        i === index ? { ...h, x: snapX(nx), y: snapY(ny) } : h
      )
    })
  }
  const moveButtonTo = (index: number, nx: number, ny: number): void => {
    commit({
      ...part,
      buttons: (part.buttons ?? []).map((b, i) =>
        i === index ? { ...b, x: snapX(nx), y: snapY(ny) } : b
      )
    })
  }
  const moveLabelTo = (index: number, nx: number, ny: number): void => {
    commit({
      ...part,
      labels: (part.labels ?? []).map((l, i) =>
        i === index ? { ...l, x: snapX(nx), y: snapY(ny) } : l
      )
    })
  }
  const moveVertexTo = (index: number, nx: number, ny: number): void => {
    commit({
      ...part,
      polygon: (part.polygon ?? []).map((p, i) =>
        i === index ? { x: clamp01(nx), y: clamp01(ny) } : p
      )
    })
  }
  const moveImage = (nx: number, ny: number): void => {
    commit({ ...part, imageLayer: { ...layer, x: nx, y: ny } })
  }
  const resizeImage = (x: number, y: number, w: number, h: number): void => {
    commit({ ...part, imageLayer: { ...layer, x, y, w, h } })
  }

  const addPin = (nx: number, ny: number): void => {
    const n = pins.length
    const newPin = {
      name: `P${n}`,
      type: 'io' as const,
      gpio: n,
      capabilities: ['digital' as const],
      x: snapX(nx),
      y: snapY(ny)
    }
    const headers = part.headers.length ? part.headers : [{ edge: 'left' as const, pins: [] }]
    const next = {
      ...part,
      headers: headers.map((h, i) => (i === 0 ? { ...h, pins: [...h.pins, newPin] } : h))
    }
    commit(next)
    onSelect?.({ type: 'pin', hi: 0, pi: headers[0].pins.length })
  }
  const addHole = (nx: number, ny: number): void => {
    const holes = [...(part.mountingHoles ?? []), { x: snapX(nx), y: snapY(ny), diameter: 2.5 }]
    commit({ ...part, mountingHoles: holes })
    onSelect?.({ type: 'hole', index: holes.length - 1 })
  }
  const addLabel = (nx: number, ny: number): void => {
    const labels = [...(part.labels ?? []), { text: 'Label', x: clamp01(nx), y: clamp01(ny), fontSize: 12 }]
    commit({ ...part, labels })
    onSelect?.({ type: 'label', index: labels.length - 1 })
  }
  const addVertex = (nx: number, ny: number): void => {
    const poly = part.polygon ?? [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 }
    ]
    commit({ ...part, polygon: [...poly, { x: clamp01(nx), y: clamp01(ny) }], shape: { kind: 'polygon' } })
  }

  // --- hit testing (topmost selectable object at a normalised point) --------
  // dist() returns VIEWBOX units (normalised deltas scaled by the board box), so
  // the tolerance is in viewBox units too (~14 ≈ a comfortable click target).
  const hitRadius = 14
  const dist = (ax: number, ay: number, bx: number, by: number): number =>
    Math.hypot((ax - bx) * box.w, (ay - by) * box.h)

  const hitTest = (nx: number, ny: number): CanvasSelection => {
    // labels
    const labels = part.labels ?? []
    for (let i = labels.length - 1; i >= 0; i--) {
      if (dist(nx, ny, labels[i].x, labels[i].y) < hitRadius * 1.4) return { type: 'label', index: i }
    }
    // pins
    for (let i = pins.length - 1; i >= 0; i--) {
      if (dist(nx, ny, pins[i].x, pins[i].y) < hitRadius) return { type: 'pin', hi: pins[i].hi, pi: pins[i].pi }
    }
    // buttons
    const buttons = part.buttons ?? []
    for (let i = buttons.length - 1; i >= 0; i--) {
      if (dist(nx, ny, buttons[i].x, buttons[i].y) < hitRadius * 1.2) return { type: 'button', index: i }
    }
    // holes
    const holes = part.mountingHoles ?? []
    for (let i = holes.length - 1; i >= 0; i--) {
      if (dist(nx, ny, holes[i].x, holes[i].y) < hitRadius) return { type: 'hole', index: i }
    }
    // image (if shown + present): inside its layer box
    if (showImage && part.imageData && nx >= layer.x && nx <= layer.x + layer.w && ny >= layer.y && ny <= layer.y + layer.h) {
      return { type: 'image' }
    }
    return null
  }

  // --- pointer handlers -----------------------------------------------------
  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>): void => {
    if (!interactive) return
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    const { nx, ny } = toNorm(e)

    if (tool === 'move') {
      dragRef.current = {
        kind: 'pan',
        sel: null,
        startNX: nx,
        startNY: ny,
        ox: 0,
        oy: 0,
        panX: e.clientX,
        panY: e.clientY,
        panTX: view.tx,
        panTY: view.ty
      }
      return
    }
    if (tool === 'pin') return addPin(nx, ny)
    if (tool === 'hole') return addHole(nx, ny)
    if (tool === 'text') return addLabel(nx, ny)
    if (tool === 'shape') {
      // Edit polygon vertices: grab the nearest, else add one.
      const poly = part.polygon ?? []
      for (let i = poly.length - 1; i >= 0; i--) {
        if (dist(nx, ny, poly[i].x, poly[i].y) < hitRadius) {
          onSelect?.({ type: 'vertex', index: i })
          dragRef.current = { kind: 'move-vertex', sel: { type: 'vertex', index: i }, startNX: nx, startNY: ny, ox: poly[i].x, oy: poly[i].y }
          return
        }
      }
      addVertex(nx, ny)
      return
    }

    // select tool
    // First: image resize handles (when the image is selected).
    if (selection?.type === 'image' && showImage && part.imageData) {
      const corners = [
        [layer.x, layer.y],
        [layer.x + layer.w, layer.y],
        [layer.x + layer.w, layer.y + layer.h],
        [layer.x, layer.y + layer.h]
      ]
      for (let c = 0; c < 4; c++) {
        if (dist(nx, ny, corners[c][0], corners[c][1]) < hitRadius) {
          dragRef.current = {
            kind: 'resize-image',
            sel: { type: 'image' },
            corner: c,
            startNX: nx,
            startNY: ny,
            ox: layer.x,
            oy: layer.y,
            ow: layer.w,
            oh: layer.h
          }
          return
        }
      }
    }

    const hit = hitTest(nx, ny)
    onSelect?.(hit)
    if (!hit) return
    // Start moving the hit object.
    let ox = 0
    let oy = 0
    if (hit.type === 'pin') {
      const rp = pins.find((p) => p.hi === hit.hi && p.pi === hit.pi)
      ox = rp?.x ?? nx
      oy = rp?.y ?? ny
    } else if (hit.type === 'hole') {
      ox = (part.mountingHoles ?? [])[hit.index]?.x ?? nx
      oy = (part.mountingHoles ?? [])[hit.index]?.y ?? ny
    } else if (hit.type === 'button') {
      ox = (part.buttons ?? [])[hit.index]?.x ?? nx
      oy = (part.buttons ?? [])[hit.index]?.y ?? ny
    } else if (hit.type === 'label') {
      ox = (part.labels ?? [])[hit.index]?.x ?? nx
      oy = (part.labels ?? [])[hit.index]?.y ?? ny
    } else if (hit.type === 'image') {
      ox = layer.x
      oy = layer.y
    }
    dragRef.current = { kind: 'move-obj', sel: hit, startNX: nx, startNY: ny, ox, oy }
  }

  /** CSS-px → viewBox-unit scale (the SVG renders at ~100%, not 460px wide). */
  const viewBoxScale = (): number => {
    const ctm = svgRef.current?.getScreenCTM()
    return ctm && ctm.a ? ctm.a : 1
  }

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>): void => {
    const d = dragRef.current
    if (!d || !interactive) return
    if (d.kind === 'pan') {
      // Convert the client-pixel delta to viewBox units so the content tracks
      // the cursor 1:1 regardless of the SVG's rendered size.
      const s = viewBoxScale()
      setView((v) => ({
        ...v,
        tx: (d.panTX ?? 0) + (e.clientX - (d.panX ?? 0)) / s,
        ty: (d.panTY ?? 0) + (e.clientY - (d.panY ?? 0)) / s
      }))
      return
    }
    const { nx, ny } = toNorm(e)
    const dx = nx - d.startNX
    const dy = ny - d.startNY
    d.moved = true
    if (d.kind === 'resize-image' && d.ow !== undefined && d.oh !== undefined) {
      // Resize from the dragged corner; keep the opposite corner anchored.
      let x = d.ox
      let y = d.oy
      let w = d.ow
      let h = d.oh
      const right = d.ox + d.ow
      const bottom = d.oy + d.oh
      if (d.corner === 0) {
        x = d.ox + dx
        y = d.oy + dy
        w = right - x
        h = bottom - y
      } else if (d.corner === 1) {
        y = d.oy + dy
        w = d.ow + dx
        h = bottom - y
      } else if (d.corner === 2) {
        w = d.ow + dx
        h = d.oh + dy
      } else if (d.corner === 3) {
        x = d.ox + dx
        w = right - x
        h = d.oh + dy
      }
      if (w > 0.05 && h > 0.05) resizeImage(x, y, w, h)
      return
    }
    if (d.kind === 'move-vertex' && d.sel?.type === 'vertex') {
      moveVertexTo(d.sel.index, d.ox + dx, d.oy + dy)
      return
    }
    if (d.kind === 'move-obj' && d.sel) {
      const x = d.ox + dx
      const y = d.oy + dy
      if (d.sel.type === 'pin') movePinTo(d.sel.hi, d.sel.pi, x, y)
      else if (d.sel.type === 'hole') moveHoleTo(d.sel.index, x, y)
      else if (d.sel.type === 'button') moveButtonTo(d.sel.index, x, y)
      else if (d.sel.type === 'label') moveLabelTo(d.sel.index, x, y)
      else if (d.sel.type === 'image') moveImage(x, y)
    }
  }

  const onPointerUp = (): void => {
    dragRef.current = null
  }

  const onWheel = (e: WheelEvent<SVGSVGElement>): void => {
    if (!interactive) return
    // Cursor-anchored zoom: keep the viewBox point under the pointer fixed.
    const svg = svgRef.current
    const ctm = svg?.getScreenCTM()
    setView((v) => {
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
      const scale = Math.min(4, Math.max(0.4, v.scale * factor))
      if (!ctm) return { ...v, scale }
      const pt = svg!.createSVGPoint()
      pt.x = e.clientX
      pt.y = e.clientY
      const local = pt.matrixTransform(ctm.inverse()) // viewBox-space point
      // world point under the cursor (transform-independent), kept fixed:
      const wx = (local.x - v.tx) / v.scale
      const wy = (local.y - v.ty) / v.scale
      return { scale, tx: local.x - wx * scale, ty: local.y - wy * scale }
    })
  }

  // --- board outline path ---------------------------------------------------
  const usePolygon = part.shape?.kind === 'polygon' && (part.polygon?.length ?? 0) >= 3
  const cornerR = part.shape?.cornerRadius ? part.shape.cornerRadius * Math.min(box.w, box.h) : 8

  const boardEl = usePolygon ? (
    <polygon
      points={(part.polygon ?? []).map((p) => `${px(p.x)},${py(p.y)}`).join(' ')}
      fill={part.pcbColor || '#0f5a2e'}
      stroke="#0008"
      strokeWidth={2}
    />
  ) : (
    <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={cornerR} fill={part.pcbColor || '#0f5a2e'} stroke="#0008" strokeWidth={2} />
  )

  // Grid dots at the pin pitch (authoring aid).
  const gridDots: JSX.Element[] = []
  if (showGrid) {
    const cols = part.dimensions ? Math.min(24, Math.max(2, Math.round(part.dimensions.width / spacing))) : 8
    const rows = part.dimensions ? Math.min(30, Math.max(2, Math.round(part.dimensions.height / spacing))) : 16
    for (let c = 1; c < cols; c++)
      for (let r = 1; r < rows; r++)
        gridDots.push(<circle key={`g${c}-${r}`} cx={px(c / cols)} cy={py(r / rows)} r={0.8} fill="#ffffff22" />)
  }

  const isSel = (s: CanvasSelection): boolean =>
    !!selection && JSON.stringify(selection) === JSON.stringify(s)

  return (
    <svg
      ref={svgRef}
      className={`pcv__svg${interactive ? ' pcv__svg--interactive' : ''} pcv__tool-${tool}`}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      width="100%"
      height="100%"
      role="img"
      aria-label={`${showImage ? 'Life-like' : 'Footprint'} view of ${part.name}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
    >
      <g transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}>
        {/* Layer 1: board shape */}
        {boardEl}
        {showGrid && <g aria-hidden="true">{gridDots}</g>}

        {/* Layer 2: image */}
        {showImage && part.imageData && (
          <image
            href={part.imageData}
            x={px(layer.x)}
            y={py(layer.y)}
            width={layer.w * box.w}
            height={layer.h * box.h}
            opacity={layer.opacity ?? 1}
            preserveAspectRatio="none"
            style={{ pointerEvents: 'none' }}
          />
        )}

        {/* Layer 3a: features (faint) */}
        {(part.features ?? []).map((f, i) => (
          <g key={`f${i}`} opacity={0.85} style={{ pointerEvents: 'none' }}>
            <rect x={px(f.x)} y={py(f.y)} width={f.w * box.w} height={f.h * box.h} rx={3} fill="#1c2227" stroke="#0006" />
            <text x={px(f.x) + (f.w * box.w) / 2} y={py(f.y) + (f.h * box.h) / 2} className="pcv__feat-label">
              {f.label}
            </text>
          </g>
        ))}

        {/* Layer 3b: mounting holes */}
        {(part.mountingHoles ?? []).map((h, i) => {
          const r = part.dimensions && part.dimensions.width > 0 ? Math.max(3, (h.diameter / part.dimensions.width) * box.w) : 6
          return (
            <g key={`h${i}`}>
              <circle cx={px(h.x)} cy={py(h.y)} r={r} fill="var(--bc-mat, #0c0f12)" stroke={isSel({ type: 'hole', index: i }) ? '#fff' : '#cfd6dd'} strokeWidth={isSel({ type: 'hole', index: i }) ? 3 : 2} />
              <circle cx={px(h.x)} cy={py(h.y)} r={Math.max(1.5, r * 0.45)} fill="#cfd6dd" />
            </g>
          )
        })}

        {/* Layer 3c: buttons */}
        {(part.buttons ?? []).map((b, i) => (
          <g key={`b${i}`}>
            <rect x={px(b.x) - 10} y={py(b.y) - 8} width={20} height={16} rx={3} fill="#cfd6dd" stroke={isSel({ type: 'button', index: i }) ? '#fff' : '#0007'} strokeWidth={isSel({ type: 'button', index: i }) ? 2.5 : 1} />
            <text x={px(b.x)} y={py(b.y) + 20} className="pcv__btn-label">
              {b.label}
            </text>
          </g>
        ))}

        {/* Layer 3d: pins */}
        {pins.map((rp: ResolvedPin, i) => {
          const fill = PAD_FILL[rp.pin.type] ?? PAD_FILL.other
          const sel = isSel({ type: 'pin', hi: rp.hi, pi: rp.pi })
          const size = 12
          // Label anchored away from the nearer board edge.
          const anchor = rp.x < 0.5 ? 'start' : 'end'
          const ldx = rp.x < 0.5 ? size : -size
          return (
            <g key={`p${i}`}>
              {rp.pin.castellated ? (
                <rect x={px(rp.x) - size / 2} y={py(rp.y) - size / 2} width={size} height={size} rx={size / 2} fill={fill} stroke={sel ? '#fff' : '#0008'} strokeWidth={sel ? 3 : 1} />
              ) : (
                <>
                  <rect x={px(rp.x) - size / 2} y={py(rp.y) - size / 2} width={size} height={size} rx={2} fill={fill} stroke={sel ? '#fff' : '#0008'} strokeWidth={sel ? 3 : 1} />
                  <circle cx={px(rp.x)} cy={py(rp.y)} r={2.3} fill="var(--bc-mat, #0c0f12)" />
                </>
              )}
              <text x={px(rp.x) + ldx} y={py(rp.y) + 4} className="pcv__pin-label" textAnchor={anchor}>
                {rp.pin.number != null ? `${rp.pin.number} ` : ''}
                {rp.pin.label || rp.pin.name}
              </text>
            </g>
          )
        })}

        {/* Layer 3e: labels */}
        {(part.labels ?? []).map((l, i) => (
          <text key={`l${i}`} x={px(l.x)} y={py(l.y)} className="pcv__label" fontSize={l.fontSize ?? 12} fill={isSel({ type: 'label', index: i }) ? '#fff' : 'var(--text, #e9edf1)'} textAnchor="middle">
            {l.text}
          </text>
        ))}

        {/* Selection chrome: image box + corner handles */}
        {interactive && selection?.type === 'image' && showImage && part.imageData && (
          <g>
            <rect x={px(layer.x)} y={py(layer.y)} width={layer.w * box.w} height={layer.h * box.h} fill="none" stroke="#4ea1ff" strokeDasharray="4 3" strokeWidth={1.5} />
            {[
              [layer.x, layer.y],
              [layer.x + layer.w, layer.y],
              [layer.x + layer.w, layer.y + layer.h],
              [layer.x, layer.y + layer.h]
            ].map(([hx, hy], c) => (
              <rect key={c} x={px(hx) - 5} y={py(hy) - 5} width={10} height={10} fill="#4ea1ff" stroke="#fff" />
            ))}
          </g>
        )}

        {/* Polygon vertex handles (shape tool) */}
        {interactive && tool === 'shape' && usePolygon && (part.polygon ?? []).map((p, i) => (
          <rect key={`v${i}`} x={px(p.x) - 5} y={py(p.y) - 5} width={10} height={10} fill={isSel({ type: 'vertex', index: i }) ? '#fff' : '#4ea1ff'} stroke="#0008" />
        ))}
      </g>
    </svg>
  )
}

/** Re-export so callers can derive default positions without importing the util. */
export { derivePinPosition }
