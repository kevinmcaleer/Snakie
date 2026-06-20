import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  parsePins,
  PIN_TYPE_COLOR,
  PIN_TYPE_LABEL,
  PIN_TYPE_TAG,
  type PinType,
  type UsedPins
} from './parse-pins'
import {
  BUILTIN_BOARDS,
  DEFAULT_BOARD_ID,
  mergeBoards,
  type BoardDefinition
} from './board-defs'
import {
  clampZoom,
  fitTransform,
  labelCounterRotation,
  oneToOneTransform,
  rotateCW,
  zoomIn as zoomInTransform,
  zoomOut as zoomOutTransform,
  zoomPercent,
  type ViewTransform
} from './board-viewport'
import './BoardGraph.css'

/**
 * BOARD GRAPH (node-graph live Board View)
 * ========================================
 *
 * The live, read-only Board View rendered as a **node graph**: one dark node
 * card per parsed connection on the left, each wired by a drooping blue/coloured
 * "noodle" cable to a gold castellated GPIO pad on the board's left edge, the
 * board drawn on the right, and a light "pins in use" table below.
 *
 * It re-derives entirely from `{ source, fileName, isPython }` + the persisted
 * board selection (shared with {@link BoardView} via the `snakie.board.id` key),
 * so it updates live as the parent re-streams the active file. It draws the
 * board itself (PCB / MCU / LED / pads) directly here — the generic
 * {@link BoardView} drawer is kept for the Board Creator's preview and is NOT
 * reused for this layout.
 *
 * VIEWPORT TOOLBAR (#99 / #96): the stage (node cards + wires + board) lives
 * inside a pan/zoom/rotate viewport with a noodleplanner-style floating control
 * cluster (zoom −/+, zoom-to-fit, a 100%↔fit toggle, rotate 90° CW, and an
 * SVG/PNG/PDF export). The "PINS IN USE" table stays a normal table below the
 * transformed stage. See {@link ./board-viewport} for the (unit-tested) math.
 *
 * NOTE: node values are **idle placeholders** (a dim dot + `1` for boolean
 * input/output, `—` for bus types). Live device values are a follow-up: it would
 * need the main process to stream the board's actual pin state into this window
 * (device polling) — intentionally not implemented here.
 */

export interface BoardGraphProps {
  /** The active file's content (already a `.py` file when meaningful). */
  source: string
  /** The active file's base name, shown in the pins table header. */
  fileName?: string
  /** Whether the active file is a Python file (gates the empty states). */
  isPython: boolean
  /** User-authored board definitions to merge with the built-ins (optional). */
  userBoards?: BoardDefinition[]
  /** When true, render the window title-bar chrome (drag region + selector). */
  asWindow?: boolean
  /** Close the view. When set, a ✕ key is shown in the header. */
  onClose?: () => void
  /** Enter the Board Creator. When set, the gold edit knob is shown. */
  onEnterCreator?: () => void
  /** Open the user's boards folder (wired in the floating window). */
  onOpenBoardsFolder?: () => void
}

/** localStorage key shared with {@link BoardView} so board choice persists across both. */
const STORAGE_KEY = 'snakie.board.id'

// --- Node-graph geometry (mirrors the design mockup) ------------------------
// Everything is laid out in a single SVG coordinate space so the noodle wires,
// the gold pads and the HTML node cards all line up on the same row Y.
const PITCH = 46 // vertical distance between node rows
const NODE_H = 36 // node card height
const NODE_W = 252 // node card width
const NODE_LEFT = 36 // node card left inset
const FIRST_Y = 149 // centre Y of the first row (and its pad / wire ends)
const NODE_DOT_X = 288 // node right-edge solder dot X (wire start)
const PAD_X = 742 // gold GPIO pad X (wire end + board left edge)
const SAG = 32 // downward bezier sag for the drooping noodle
const CANVAS_W = 1180 // canvas / SVG width
const BOARD_X = 720 // PCB rect left
const BOARD_W = 300 // PCB rect width
const BOARD_TOP_PAD = 31 // PCB top above the first pad row
const BOARD_BOT_PAD = 33 // PCB bottom below the last pad row

/** Centre Y of row `i` (node card, pad and wire all share it). */
function rowY(i: number): number {
  return FIRST_Y + i * PITCH
}

/**
 * Resolve a parsed pin token to the label drawn on its gold pad. Numeric tokens
 * become `GP<n>` (the RP2040/RP2350 convention); a board's `ledLabel` and any
 * other non-numeric label pass through unchanged (mirrors BoardView's matching).
 */
function padLabelForToken(token: string, def: BoardDefinition): string {
  const t = token.trim()
  if (/^\d+$/.test(t)) return `GP${t}`
  if (def.ledLabel && def.ledLabel.toLowerCase() === t.toLowerCase()) return def.ledLabel
  return t
}

/** One drawable connection row: its node, its pad and the wire between them. */
interface GraphRow {
  conn: UsedPins
  y: number
  color: string
  /** The pad label (e.g. `GP2`) — a connection's FIRST pin owns the row. */
  padLabel: string
}

export function BoardGraph({
  source,
  fileName,
  isPython,
  userBoards,
  asWindow = false,
  onClose,
  onEnterCreator,
  onOpenBoardsFolder
}: BoardGraphProps): JSX.Element {
  const boards = useMemo(() => mergeBoards(userBoards ?? []), [userBoards])

  // Persisted board selection (shared with BoardView); default when stale.
  const [boardId, setBoardId] = useState<string>(() => {
    try {
      return window.localStorage.getItem(STORAGE_KEY) ?? DEFAULT_BOARD_ID
    } catch {
      return DEFAULT_BOARD_ID
    }
  })
  const def = boards.find((b) => b.id === boardId) ?? boards[0] ?? BUILTIN_BOARDS[0]

  // Custom dropdown open state — a native <select> popup is unreliable inside a
  // frameless, always-on-top window with a drag region (same as BoardView).
  const [pickerOpen, setPickerOpen] = useState(false)
  const selectBoard = (id: string): void => {
    setBoardId(id)
    setPickerOpen(false)
    try {
      window.localStorage.setItem(STORAGE_KEY, id)
    } catch {
      // Ignore write failures (storage disabled / quota).
    }
  }

  // Re-parse on every source change → live update.
  const conns = useMemo(() => (isPython ? parsePins(source) : []), [source, isPython])

  // One row per connection, evenly spaced from the 46px pitch — the first pin of
  // each connection owns the row (a bus's other pins ride the same node card).
  const rows = useMemo<GraphRow[]>(
    () =>
      conns.map((conn, i) => ({
        conn,
        y: rowY(i),
        color: PIN_TYPE_COLOR[conn.type],
        padLabel: padLabelForToken(conn.pins[0] ?? '', def)
      })),
    [conns, def]
  )

  // Synthesise the board + stage height to span every pad row so a large N never
  // clips: the stage grows and the viewport zoom-to-fit keeps it framed.
  const lastY = rows.length > 0 ? rowY(rows.length - 1) : FIRST_Y
  const boardYTop = FIRST_Y - BOARD_TOP_PAD
  const boardH = lastY - boardYTop + BOARD_BOT_PAD
  // Stage is at least the mockup height; grows for large N.
  const stageH = Math.max(680, boardYTop + boardH + 40)

  const hasRows = rows.length > 0

  // --- Viewport (pan / zoom / rotate) ---------------------------------------
  const canvasRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<ViewTransform>({ panX: 0, panY: 0, zoom: 1 })
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0)
  // Which the 100% button toggles to next: true = a 1:1 view is showing (next
  // click fits), false = a fitted view is showing (next click goes 1:1).
  const [isOneToOne, setIsOneToOne] = useState(false)
  // Live viewport size (CSS px) so fit/centre math uses the real canvas box.
  const [vp, setVp] = useState<{ w: number; h: number }>({ w: 0, h: 0 })
  // Has the user touched the view yet? Until then we keep auto-fitting on resize /
  // row-count changes so the board always opens nicely framed.
  const touchedRef = useRef(false)

  // Measure the canvas (clip) box and keep it current on resize.
  useLayoutEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const measure = (): void => {
      setVp({ w: el.clientWidth, h: el.clientHeight })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [hasRows])

  // Auto-fit until the user interacts (and re-fit on rotation while untouched).
  useEffect(() => {
    if (touchedRef.current) return
    if (!hasRows || vp.w === 0 || vp.h === 0) return
    setView(fitTransform(CANVAS_W, stageH, vp.w, vp.h, rotation))
    setIsOneToOne(false)
  }, [hasRows, vp.w, vp.h, stageH, rotation])

  const onZoomIn = useCallback((): void => {
    touchedRef.current = true
    setView((v) => ({ ...v, zoom: zoomInTransform(v.zoom) }))
    setIsOneToOne(false)
  }, [])

  const onZoomOut = useCallback((): void => {
    touchedRef.current = true
    setView((v) => ({ ...v, zoom: zoomOutTransform(v.zoom) }))
    setIsOneToOne(false)
  }, [])

  const onFit = useCallback((): void => {
    touchedRef.current = true
    if (vp.w === 0 || vp.h === 0) return
    setView(fitTransform(CANVAS_W, stageH, vp.w, vp.h, rotation))
    setIsOneToOne(false)
  }, [vp.w, vp.h, stageH, rotation])

  // 100% button: toggles between a centred 1:1 view and zoom-to-fit.
  const onToggleOneToOne = useCallback((): void => {
    touchedRef.current = true
    if (vp.w === 0 || vp.h === 0) return
    if (isOneToOne) {
      setView(fitTransform(CANVAS_W, stageH, vp.w, vp.h, rotation))
      setIsOneToOne(false)
    } else {
      setView(oneToOneTransform(CANVAS_W, stageH, vp.w, vp.h, rotation))
      setIsOneToOne(true)
    }
  }, [isOneToOne, vp.w, vp.h, stageH, rotation])

  const onRotate = useCallback((): void => {
    touchedRef.current = true
    const next = rotateCW(rotation)
    setRotation(next)
    // Re-fit for the new rotation so the rotated board stays fully framed.
    if (vp.w !== 0 && vp.h !== 0) {
      setView(fitTransform(CANVAS_W, stageH, vp.w, vp.h, next))
      setIsOneToOne(false)
    }
  }, [rotation, vp.w, vp.h, stageH])

  // Wheel-zoom (inside the fixed viewport) — a nice-to-have on top of the buttons.
  const onWheel = useCallback((e: React.WheelEvent): void => {
    touchedRef.current = true
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
    setView((v) => ({ ...v, zoom: clampZoom(v.zoom * factor) }))
    setIsOneToOne(false)
  }, [])

  // Drag-to-pan on empty canvas (pointer drag). Clicks on node cards / the
  // control cluster don't start a pan (their elements are excluded below).
  const panRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)
  const onPointerDown = useCallback(
    (e: React.PointerEvent): void => {
      const target = e.target as HTMLElement
      if (target.closest('.boardgraph__node') || target.closest('.boardgraph__viewport-ctl')) {
        return
      }
      touchedRef.current = true
      panRef.current = { x: e.clientX, y: e.clientY, panX: view.panX, panY: view.panY }
      ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    },
    [view.panX, view.panY]
  )
  const onPointerMove = useCallback((e: React.PointerEvent): void => {
    const p = panRef.current
    if (!p) return
    setView((v) => ({ ...v, panX: p.panX + (e.clientX - p.x), panY: p.panY + (e.clientY - p.y) }))
  }, [])
  const endPan = useCallback((e: React.PointerEvent): void => {
    if (panRef.current) {
      ;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
      panRef.current = null
    }
  }, [])

  // --- Export (SVG / PNG / PDF) ---------------------------------------------
  // A <select> picks the format; the button triggers a download in that format.
  const [exportFmt, setExportFmt] = useState<ExportFmt>('svg')
  const onExport = useCallback((): void => {
    void exportView(exportFmt, rows, def, stageH, rotation)
  }, [exportFmt, rows, def, stageH, rotation])

  return (
    <div className={`boardgraph ${asWindow ? 'boardgraph--window' : ''}`} aria-label="Board View">
      <header className={`boardgraph__bar ${asWindow ? 'boardgraph__bar--drag' : ''}`}>
        <span className="boardgraph__grip" aria-hidden="true">
          {/* 6-dot drag grip (2×3). */}
          {Array.from({ length: 6 }).map((_, i) => (
            <span key={i} className="boardgraph__grip-dot" />
          ))}
        </span>
        <span className="boardgraph__title">BOARD&nbsp;VIEW</span>

        <div className="boardgraph__picker">
          <button
            type="button"
            className="boardgraph__picker-btn"
            onClick={() => setPickerOpen((o) => !o)}
            aria-haspopup="listbox"
            aria-expanded={pickerOpen}
            title="Select board"
          >
            <span className="boardgraph__picker-name">{def.name}</span>
            <span className="boardgraph__picker-caret" aria-hidden="true">
              ▾
            </span>
          </button>
          {pickerOpen && (
            <>
              <button
                type="button"
                className="boardgraph__picker-backdrop"
                aria-hidden="true"
                tabIndex={-1}
                onClick={() => setPickerOpen(false)}
              />
              <ul className="boardgraph__picker-menu" role="listbox" aria-label="Select board">
                {boards.map((b) => (
                  <li key={b.id} role="option" aria-selected={b.id === def.id}>
                    <button
                      type="button"
                      className={`boardgraph__picker-item ${b.id === def.id ? 'is-active' : ''}`}
                      onClick={() => selectBoard(b.id)}
                    >
                      <span className="boardgraph__picker-item-name">{b.name}</span>
                      <span className="boardgraph__picker-item-mcu">{b.mcu}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <span className="boardgraph__chip">{def.mcu}</span>

        <div className="boardgraph__actions">
          <span className="boardgraph__live" title="Updates live as you edit">
            <span className="boardgraph__led" aria-hidden="true" />
            LIVE
          </span>
          {onEnterCreator && (
            <button
              type="button"
              className="boardgraph__knob"
              onClick={onEnterCreator}
              title="Create or edit a custom board"
              aria-label="Open the Board Creator"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path
                  d="M4 20l4-1 11-11-3-3L5 16l-1 4z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
          {onOpenBoardsFolder && (
            <button
              type="button"
              className="boardgraph__key"
              onClick={onOpenBoardsFolder}
              title="Open the boards folder (add your own board JSON here)"
              aria-label="Open boards folder"
            >
              📁
            </button>
          )}
          {onClose && (
            <button
              type="button"
              className="boardgraph__key boardgraph__key--close"
              onClick={onClose}
              title="Close board view (Esc)"
              aria-label="Close board view"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.9" />
              </svg>
            </button>
          )}
        </div>
      </header>

      <div
        className="boardgraph__canvas"
        ref={canvasRef}
        onWheel={hasRows ? onWheel : undefined}
        onPointerDown={hasRows ? onPointerDown : undefined}
        onPointerMove={hasRows ? onPointerMove : undefined}
        onPointerUp={hasRows ? endPan : undefined}
        onPointerCancel={hasRows ? endPan : undefined}
      >
        {!hasRows ? (
          <div className="boardgraph__empty">
            {isPython
              ? 'No pins detected — wire up a Pin/PWM/I2C/SPI/StateMachine to see it here.'
              : 'Open a Python (.py) file to visualise its pin wiring.'}
          </div>
        ) : (
          <>
            <div
              className="boardgraph__stage"
              style={{
                width: CANVAS_W,
                height: stageH,
                transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom}) rotate(${rotation}deg)`,
                transformOrigin: '0 0'
              }}
            >
              <svg
                className="boardgraph__svg"
                xmlns="http://www.w3.org/2000/svg"
                width={CANVAS_W}
                height={stageH}
                viewBox={`0 0 ${CANVAS_W} ${stageH}`}
                role="img"
                aria-label={`${def.name}: ${rows.length} pin connection${
                  rows.length === 1 ? '' : 's'
                }`}
              >
                <BoardDefs def={def} />

                {/* Drooping noodle wires (under the board), coloured by type. */}
                <g fill="none" strokeLinecap="round" filter="url(#bg-glow)" opacity="0.92">
                  {rows.map((r, i) => (
                    <path
                      key={`wire-${i}`}
                      d={noodlePath(r.y)}
                      stroke={r.color}
                      strokeWidth="2.6"
                    />
                  ))}
                </g>
                {/* Node-side solder dots. */}
                <g>
                  {rows.map((r, i) => (
                    <circle key={`dot-${i}`} cx={NODE_DOT_X} cy={r.y} r="4.5" fill={r.color} />
                  ))}
                </g>

                <Board def={def} yTop={boardYTop} height={boardH} rows={rows} rotation={rotation} />
              </svg>

              {/* Node cards (HTML, over the SVG) — one per connection. */}
              {rows.map((r, i) => (
                <NodeCard key={`node-${i}`} row={r} rotation={rotation} />
              ))}
            </div>

            {/* noodleplanner-style floating viewport control cluster. */}
            <div
              className="boardgraph__viewport-ctl"
              role="toolbar"
              aria-label="Board view controls"
            >
              <button
                type="button"
                className="boardgraph__vbtn"
                onClick={onZoomOut}
                title="Zoom out"
                aria-label="Zoom out"
              >
                −
              </button>
              <button
                type="button"
                className="boardgraph__vbtn boardgraph__vbtn--pct"
                onClick={onToggleOneToOne}
                title={isOneToOne ? 'Zoom to fit' : 'Actual size (100%)'}
                aria-label={isOneToOne ? 'Zoom to fit' : 'Actual size, 100 percent'}
              >
                {isOneToOne ? zoomPercent(view.zoom) : '100%'}
              </button>
              <button
                type="button"
                className="boardgraph__vbtn"
                onClick={onZoomIn}
                title="Zoom in"
                aria-label="Zoom in"
              >
                +
              </button>
              <span className="boardgraph__vsep" aria-hidden="true" />
              <button
                type="button"
                className="boardgraph__vbtn"
                onClick={onFit}
                title="Zoom to fit"
                aria-label="Zoom to fit"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <button
                type="button"
                className="boardgraph__vbtn"
                onClick={onRotate}
                title={`Rotate 90° clockwise (now ${rotation}°)`}
                aria-label={`Rotate 90 degrees clockwise, currently ${rotation} degrees`}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M20 11a8 8 0 1 0-2.3 5.6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                  <path
                    d="M20 4v5h-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <span className="boardgraph__vsep" aria-hidden="true" />
              <div className="boardgraph__export">
                <button
                  type="button"
                  className="boardgraph__vbtn boardgraph__vbtn--export"
                  onClick={onExport}
                  title={`Export the board view as ${exportFmt.toUpperCase()}`}
                  aria-label={`Export as ${exportFmt.toUpperCase()}`}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M12 3v11m0 0l-4-4m4 4l4-4M5 19h14"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span className="boardgraph__export-fmt">{exportFmt.toUpperCase()}</span>
                </button>
                <select
                  className="boardgraph__export-sel"
                  value={exportFmt}
                  onChange={(e) => setExportFmt(e.target.value as ExportFmt)}
                  aria-label="Choose export format"
                  title="Choose export format"
                >
                  <option value="svg">SVG</option>
                  <option value="png">PNG</option>
                  <option value="pdf">PDF</option>
                </select>
              </div>
            </div>
          </>
        )}
      </div>

      <PinsInUse conns={conns} fileName={fileName} />
    </div>
  )
}

// --- SVG drawing ------------------------------------------------------------

/**
 * A drooping cubic bezier from the node solder dot to its aligned gold pad —
 * horizontal tangents and a ~32px downward sag (matches the mockup's
 * `M288 y C 462 y+32 568 y+32 742 y`). Same Y at both ends so the pad row is
 * exactly aligned to its node row.
 */
function noodlePath(y: number): string {
  const c1x = NODE_DOT_X + 174 // 462
  const c2x = PAD_X - 174 // 568
  const cy = y + SAG
  return `M${NODE_DOT_X} ${y} C ${c1x} ${cy} ${c2x} ${cy} ${PAD_X} ${y}`
}

/**
 * SVG transform that applies the in-stage label counter-rotation about its own
 * anchor (0 or 180; see {@link labelCounterRotation}) so the text never renders
 * upside-down. Returns `undefined` when no transform is needed (counter 0).
 */
function labelTransform(counter: 0 | 180, ax: number, ay: number): string | undefined {
  return counter === 0 ? undefined : `rotate(${counter} ${ax} ${ay})`
}

/** Shared SVG <defs> (gradients + glow) — reused by the live view. */
function BoardDefs({ def }: { def: BoardDefinition }): JSX.Element {
  return (
    <defs>
      <linearGradient id="bg-pcb" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={def.pcbColor || '#1f7a44'} />
        <stop offset="1" stopColor="#13592f" />
      </linearGradient>
      <linearGradient id="bg-gold" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#f6dd92" />
        <stop offset="1" stopColor="#caa23e" />
      </linearGradient>
      <linearGradient id="bg-silver" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#e9ecf0" />
        <stop offset="0.5" stopColor="#b7bcc4" />
        <stop offset="1" stopColor="#8d939c" />
      </linearGradient>
      <filter id="bg-glow" x="-40%" y="-300%" width="180%" height="700%">
        <feGaussianBlur stdDeviation="2" result="b" />
        <feMerge>
          <feMergeNode in="b" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
  )
}

/** The green PCB, USB nub, MCU block, onboard LED, decorative + GPIO pads. */
function Board({
  def,
  yTop,
  height,
  rows,
  rotation
}: {
  def: BoardDefinition
  yTop: number
  height: number
  rows: GraphRow[]
  rotation: 0 | 90 | 180 | 270
}): JSX.Element {
  const cx = BOARD_X + BOARD_W / 2 // board centre X
  const mcuY = yTop + height / 2 - 58
  const ledY = yTop + 50
  const firstY = rows[0]?.y ?? FIRST_Y
  const lastY = rows[rows.length - 1]?.y ?? FIRST_Y
  // Legibility (#96): the in-stage counter-rotation keeps every label at a net
  // 0° / 90°-CW on screen (never upside down) for the current stage rotation.
  const { counter } = labelCounterRotation(rotation)
  return (
    <g>
      {/* PCB + dashed silkscreen inset. */}
      <rect
        x={BOARD_X}
        y={yTop}
        width={BOARD_W}
        height={height}
        rx="18"
        fill="url(#bg-pcb)"
        stroke="#0c3a23"
        strokeWidth="1.5"
      />
      <rect
        x={BOARD_X + 10}
        y={yTop + 10}
        width={BOARD_W - 20}
        height={height - 20}
        rx="12"
        fill="none"
        stroke="rgba(255,255,255,.32)"
        strokeWidth="1"
        strokeDasharray="2 5"
      />

      {/* USB connector nub on top. */}
      <rect
        x={cx - 28}
        y={yTop - 16}
        width="56"
        height="24"
        rx="4"
        fill="url(#bg-silver)"
        stroke="#6c727b"
        strokeWidth="1"
      />

      {/* Onboard LED dot + 3V3 / LED labels. */}
      <circle cx={cx + 42} cy={ledY} r="7" fill="#e23b2b" />
      <text
        x={cx + 20}
        y={ledY + 4}
        textAnchor="end"
        className="boardgraph__svg-label"
        fill="#cfe8d4"
        transform={labelTransform(counter, cx + 20, ledY + 4)}
      >
        3V3
      </text>
      <text
        x={cx + 42}
        y={ledY + 28}
        textAnchor="middle"
        className="boardgraph__svg-label"
        fill="#bcd9c4"
        transform={labelTransform(counter, cx + 42, ledY + 28)}
      >
        {def.ledLabel ?? 'LED'}
      </text>

      {/* MCU block. */}
      <rect
        x={cx - 58}
        y={mcuY}
        width="116"
        height="116"
        rx="7"
        fill="#1c1d20"
        stroke="#0c0d0f"
        strokeWidth="1"
      />
      <rect x={cx - 50} y={mcuY + 8} width="100" height="100" rx="4" fill="#26282c" />
      <text
        x={cx}
        y={mcuY + 62}
        textAnchor="middle"
        className="boardgraph__svg-mcu"
        fill="#cfd3d8"
        transform={labelTransform(counter, cx, mcuY + 62)}
      >
        {def.mcu}
      </text>
      <text
        x={cx}
        y={mcuY + 80}
        textAnchor="middle"
        className="boardgraph__svg-sub"
        fill="#8a8f98"
        transform={labelTransform(counter, cx, mcuY + 80)}
      >
        MCU
      </text>

      {/* A few decorative right-edge pads. */}
      {[firstY, (firstY + lastY) / 2, lastY].map((y, i) => (
        <circle
          key={`deco-${i}`}
          cx={BOARD_X + BOARD_W - 22}
          cy={y}
          r="6.5"
          fill="url(#bg-gold)"
          stroke="#9a7a1e"
          strokeWidth="0.7"
        />
      ))}

      {/* Left-edge GPIO pads — one per connection row, aligned to its node Y. */}
      <g className="boardgraph__svg-pad-text">
        {rows.map((r, i) => (
          <g key={`pad-${i}`}>
            <circle
              cx={PAD_X}
              cy={r.y}
              r="7"
              fill="url(#bg-gold)"
              stroke="#9a7a1e"
              strokeWidth="0.8"
            />
            <circle cx={PAD_X} cy={r.y} r="2.6" fill="#5a4a1a" />
            <text
              x={PAD_X + 16}
              y={r.y + 4}
              fill="#cfe8d4"
              transform={labelTransform(counter, PAD_X + 16, r.y + 4)}
            >
              {r.padLabel}
            </text>
          </g>
        ))}
      </g>
    </g>
  )
}

/** One node card: type tag inline beside the variable + an idle value. */
function NodeCard({
  row,
  rotation
}: {
  row: GraphRow
  rotation: 0 | 90 | 180 | 270
}): JSX.Element {
  const { conn, color } = row
  // Counter-rotate the card's TEXT so it's never upside-down: at 180°/270° the
  // inner content flips 180° back to an upright (0°/90° net) reading.
  const { counter } = labelCounterRotation(rotation)
  return (
    <div
      className="boardgraph__node"
      style={{
        left: NODE_LEFT,
        top: row.y - NODE_H / 2,
        width: NODE_W,
        height: NODE_H,
        borderColor: color
      }}
    >
      <span
        className="boardgraph__node-inner"
        style={{ transform: counter === 0 ? undefined : `rotate(${counter}deg)` }}
      >
        <span className="boardgraph__node-tag" style={{ background: color }}>
          {PIN_TYPE_TAG[conn.type]}
        </span>
        <span className="boardgraph__node-var">{conn.variable || conn.constructor}</span>
        <NodeValue type={conn.type} />
      </span>
    </div>
  )
}

/**
 * The right-hand value on a node card. These are **idle placeholders**: we don't
 * have live device pin state yet (a follow-up — it would need the main process to
 * stream the board's actual values into this window). Boolean input/output show a
 * dim dot + `1`; bus types (pwm/i2c/spi/pio) show a dim dot + `—`.
 */
function NodeValue({ type }: { type: PinType }): JSX.Element {
  const boolean = type === 'input' || type === 'output'
  return (
    <span className="boardgraph__node-val">
      <span className="boardgraph__node-dot" />
      {boolean ? '1' : '—'}
    </span>
  )
}

/** The light "pins in use" table at the bottom (one row per connection). */
function PinsInUse({ conns, fileName }: { conns: UsedPins[]; fileName?: string }): JSX.Element {
  return (
    <section className="boardgraph__pins" aria-label="Pins in use">
      <header className="boardgraph__pins-head">
        <span>
          PINS IN USE — {conns.length} CONNECTION{conns.length === 1 ? '' : 'S'}
        </span>
        {fileName && <span className="boardgraph__pins-file">{fileName}</span>}
      </header>
      {conns.length === 0 ? (
        <p className="boardgraph__pins-empty">No pins detected.</p>
      ) : (
        <ul className="boardgraph__pins-list">
          {conns.map((c, i) => (
            <li className="boardgraph__pins-row" key={`${c.variable}-${i}`}>
              <span
                className="boardgraph__swatch"
                style={{ background: PIN_TYPE_COLOR[c.type] }}
                aria-hidden="true"
              />
              <span className="boardgraph__pins-type">{PIN_TYPE_LABEL[c.type]}</span>
              <span className="boardgraph__pins-num">{c.pins.join(', ')}</span>
              <span
                className="boardgraph__pins-src"
                title={`${c.variable ? `${c.variable} = ` : ''}${c.constructor}`}
              >
                {c.variable ? `${c.variable} = ` : ''}
                {c.constructor}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// --- Export (SVG / PNG / PDF) ----------------------------------------------

type ExportFmt = 'svg' | 'png' | 'pdf'

/** XML-escape a string for use inside SVG text / attributes. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Serialise the WHOLE board view (at 1:1 in stage pixels, honouring the current
 * rotation) to a standalone `<svg>` string. The wires + board are SVG already;
 * the HTML node cards are embedded via `<foreignObject>` so the file is fully
 * self-contained (no external CSS / fonts beyond inline styles).
 *
 * Export captures the full board at actual size — NOT the current zoom/pan — so
 * the saved image is always the complete, framed view; the rotation IS applied
 * (the whole drawing rotates via a group transform; labels keep the legibility
 * counter-rotation so they're never upside-down).
 */
export function buildExportSvg(
  rows: GraphRow[],
  def: BoardDefinition,
  stageH: number,
  rotation: 0 | 90 | 180 | 270
): string {
  const W = CANVAS_W
  const H = stageH
  // Rotated canvas dimensions (90/270 swap W/H).
  const swap = rotation === 90 || rotation === 270
  const outW = swap ? H : W
  const outH = swap ? W : H
  // The group rotation that maps the W×H stage into the outW×outH frame, about
  // the origin, then translated back into view (mirrors the live CSS transform).
  let groupTransform = ''
  if (rotation === 90) groupTransform = `translate(${H},0) rotate(90)`
  else if (rotation === 180) groupTransform = `translate(${W},${H}) rotate(180)`
  else if (rotation === 270) groupTransform = `translate(0,${W}) rotate(270)`

  const boardYTop = FIRST_Y - BOARD_TOP_PAD
  const lastY = rows.length > 0 ? rows[rows.length - 1].y : FIRST_Y
  const boardH = lastY - boardYTop + BOARD_BOT_PAD
  const { counter } = labelCounterRotation(rotation)

  // Wires + dots.
  const wires = rows
    .map(
      (r) => `<path d="${noodlePath(r.y)}" stroke="${r.color}" stroke-width="2.6" fill="none"/>`
    )
    .join('')
  const dots = rows
    .map((r) => `<circle cx="${NODE_DOT_X}" cy="${r.y}" r="4.5" fill="${r.color}"/>`)
    .join('')

  // Board pieces (mirrors <Board/> but as a string).
  const cx = BOARD_X + BOARD_W / 2
  const mcuY = boardYTop + boardH / 2 - 58
  const ledY = boardYTop + 50
  const firstY = rows[0]?.y ?? FIRST_Y
  const lY = rows[rows.length - 1]?.y ?? FIRST_Y
  const lt = (ax: number, ay: number): string =>
    counter === 0 ? '' : ` transform="rotate(${counter} ${ax} ${ay})"`
  const board = [
    `<rect x="${BOARD_X}" y="${boardYTop}" width="${BOARD_W}" height="${boardH}" rx="18" fill="url(#bg-pcb)" stroke="#0c3a23" stroke-width="1.5"/>`,
    `<rect x="${BOARD_X + 10}" y="${boardYTop + 10}" width="${BOARD_W - 20}" height="${boardH - 20}" rx="12" fill="none" stroke="rgba(255,255,255,.32)" stroke-width="1" stroke-dasharray="2 5"/>`,
    `<rect x="${cx - 28}" y="${boardYTop - 16}" width="56" height="24" rx="4" fill="url(#bg-silver)" stroke="#6c727b" stroke-width="1"/>`,
    `<circle cx="${cx + 42}" cy="${ledY}" r="7" fill="#e23b2b"/>`,
    `<text x="${cx + 20}" y="${ledY + 4}" text-anchor="end" font-family="monospace" font-size="11" fill="#cfe8d4"${lt(cx + 20, ledY + 4)}>3V3</text>`,
    `<text x="${cx + 42}" y="${ledY + 28}" text-anchor="middle" font-family="monospace" font-size="11" fill="#bcd9c4"${lt(cx + 42, ledY + 28)}>${esc(def.ledLabel ?? 'LED')}</text>`,
    `<rect x="${cx - 58}" y="${mcuY}" width="116" height="116" rx="7" fill="#1c1d20" stroke="#0c0d0f" stroke-width="1"/>`,
    `<rect x="${cx - 50}" y="${mcuY + 8}" width="100" height="100" rx="4" fill="#26282c"/>`,
    `<text x="${cx}" y="${mcuY + 62}" text-anchor="middle" font-family="monospace" font-size="13" font-weight="700" fill="#cfd3d8"${lt(cx, mcuY + 62)}>${esc(def.mcu)}</text>`,
    `<text x="${cx}" y="${mcuY + 80}" text-anchor="middle" font-family="monospace" font-size="9" fill="#8a8f98"${lt(cx, mcuY + 80)}>MCU</text>`,
    [firstY, (firstY + lY) / 2, lY]
      .map(
        (y) =>
          `<circle cx="${BOARD_X + BOARD_W - 22}" cy="${y}" r="6.5" fill="url(#bg-gold)" stroke="#9a7a1e" stroke-width="0.7"/>`
      )
      .join(''),
    rows
      .map(
        (r) =>
          `<circle cx="${PAD_X}" cy="${r.y}" r="7" fill="url(#bg-gold)" stroke="#9a7a1e" stroke-width="0.8"/>` +
          `<circle cx="${PAD_X}" cy="${r.y}" r="2.6" fill="#5a4a1a"/>` +
          `<text x="${PAD_X + 16}" y="${r.y + 4}" font-family="monospace" font-size="12" fill="#cfe8d4"${lt(PAD_X + 16, r.y + 4)}>${esc(r.padLabel)}</text>`
      )
      .join('')
  ].join('')

  // Node cards as <foreignObject> HTML so the export matches the live view.
  const nodes = rows
    .map((r) => {
      const c = r.color
      const tag = PIN_TYPE_TAG[r.conn.type]
      const label = esc(r.conn.variable || r.conn.constructor)
      const val = r.conn.type === 'input' || r.conn.type === 'output' ? '1' : '—'
      const inner =
        `<div style="display:flex;align-items:center;gap:9px;width:100%;height:100%;box-sizing:border-box;padding:0 12px;transform:rotate(${counter}deg)">` +
        `<span style="font-size:9.5px;font-weight:700;color:#0e2233;border-radius:4px;padding:2px 6px;background:${c}">${esc(tag)}</span>` +
        `<span style="font-size:12.5px;color:#d6dade;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${label}</span>` +
        `<span style="margin-left:auto;display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;color:#6a7079"><span style="width:7px;height:7px;border-radius:50%;background:#3a3f47"></span>${val}</span>` +
        `</div>`
      return (
        `<foreignObject x="${NODE_LEFT}" y="${r.y - NODE_H / 2}" width="${NODE_W}" height="${NODE_H}">` +
        `<div xmlns="http://www.w3.org/1999/xhtml" style="box-sizing:border-box;width:${NODE_W}px;height:${NODE_H}px;border-radius:9px;background:#1e2127;border:1px solid ${c};font-family:monospace">${inner}</div>` +
        `</foreignObject>`
      )
    })
    .join('')

  const defs =
    `<defs>` +
    `<linearGradient id="bg-pcb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${def.pcbColor || '#1f7a44'}"/><stop offset="1" stop-color="#13592f"/></linearGradient>` +
    `<linearGradient id="bg-gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6dd92"/><stop offset="1" stop-color="#caa23e"/></linearGradient>` +
    `<linearGradient id="bg-silver" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9ecf0"/><stop offset="0.5" stop-color="#b7bcc4"/><stop offset="1" stop-color="#8d939c"/></linearGradient>` +
    `</defs>`

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${outW}" height="${outH}" viewBox="0 0 ${outW} ${outH}">` +
    defs +
    `<rect x="0" y="0" width="${outW}" height="${outH}" fill="#161719"/>` +
    `<g${groupTransform ? ` transform="${groupTransform}"` : ''}>` +
    `<g fill="none" stroke-linecap="round" opacity="0.92">${wires}</g>` +
    `<g>${dots}</g>` +
    `<g>${board}</g>` +
    nodes +
    `</g>` +
    `</svg>`
  )
}

/** Trigger a browser download of a Blob under `filename`. */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke after the click has had a chance to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

/** Load an SVG string as an <img> and draw it onto a fresh 2D canvas at `dpr`. */
async function rasterise(
  svg: string,
  outW: number,
  outH: number,
  dpr: number,
  background?: string
): Promise<HTMLCanvasElement> {
  const img = new Image()
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('SVG image failed to load'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(outW * dpr))
    canvas.height = Math.max(1, Math.round(outH * dpr))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('No 2D canvas context')
    if (background) {
      ctx.fillStyle = background
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }
    ctx.scale(dpr, dpr)
    ctx.drawImage(img, 0, 0, outW, outH)
    return canvas
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Read a canvas as a Blob of the given MIME (+ quality). */
function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), mime, quality)
  })
}

/**
 * Build a minimal single-page PDF embedding a JPEG (the rasterised view) at
 * `outW`×`outH` points. No dependency: we hand-assemble a tiny PDF (5 objects +
 * xref) with a single `/DCTDecode` (JPEG) image XObject. This is intentionally
 * the WEAKEST export — an image-only page, vector-less — but it is a real,
 * openable PDF and keeps the build dependency-free.
 */
function buildImagePdf(jpeg: Uint8Array, outW: number, outH: number): Blob {
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  const offsets: number[] = []
  let length = 0
  const push = (chunk: Uint8Array | string): void => {
    const u = typeof chunk === 'string' ? enc.encode(chunk) : chunk
    parts.push(u)
    length += u.length
  }
  const startObj = (): void => {
    offsets.push(length)
  }
  const w = Math.round(outW)
  const h = Math.round(outH)

  push('%PDF-1.4\n%ÿÿÿÿ\n')
  startObj()
  push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
  startObj()
  push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n')
  startObj()
  push(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] ` +
      `/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`
  )
  startObj()
  push(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`
  )
  push(jpeg)
  push('\nendstream\nendobj\n')
  const content = `q\n${w} 0 0 ${h} 0 0 cm\n/Im0 Do\nQ\n`
  startObj()
  push(`5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`)
  const xrefOffset = length
  let xref = `xref\n0 6\n0000000000 65535 f \n`
  for (const off of offsets) {
    xref += `${off.toString().padStart(10, '0')} 00000 n \n`
  }
  push(xref)
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`)

  const total = new Uint8Array(length)
  let pos = 0
  for (const p of parts) {
    total.set(p, pos)
    pos += p.length
  }
  return new Blob([total], { type: 'application/pdf' })
}

/** Export the current board view in `fmt`, triggering a download. */
async function exportView(
  fmt: ExportFmt,
  rows: GraphRow[],
  def: BoardDefinition,
  stageH: number,
  rotation: 0 | 90 | 180 | 270
): Promise<void> {
  const svg = buildExportSvg(rows, def, stageH, rotation)
  const swap = rotation === 90 || rotation === 270
  const outW = swap ? stageH : CANVAS_W
  const outH = swap ? CANVAS_W : stageH
  try {
    if (fmt === 'svg') {
      downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), 'board-view.svg')
    } else if (fmt === 'png') {
      const dpr = Math.min(window.devicePixelRatio || 1, 3)
      const canvas = await rasterise(svg, outW, outH, dpr)
      downloadBlob(await canvasToBlob(canvas, 'image/png'), 'board-view.png')
    } else {
      // PDF: image-only single page (JPEG stream) — see buildImagePdf docstring.
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const canvas = await rasterise(svg, outW, outH, dpr, '#161719')
      const jpeg = new Uint8Array(await (await canvasToBlob(canvas, 'image/jpeg', 0.92)).arrayBuffer())
      downloadBlob(buildImagePdf(jpeg, outW, outH), 'board-view.pdf')
    }
  } catch (err) {
    // Surface failures without crashing the view; the GUI can't run headlessly so
    // this path is best-effort.
    console.error('[BoardGraph] export failed', err)
  }
}
