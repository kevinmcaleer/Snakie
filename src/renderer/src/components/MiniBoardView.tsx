import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type PointerEvent as ReactPointerEvent
} from 'react'
import { parsePins, PIN_TYPE_COLOR, PIN_TYPE_TAG } from './parse-pins'
import { BUILTIN_BOARDS, DEFAULT_BOARD_ID, boardIdFromReplText } from './board-defs'
import {
  authoredPads,
  boardBox,
  ledPoint,
  padForToken,
  padKey,
  type PadPoint
} from './board-layout'
import { PartBody, padPinNumber, partBodyBox } from './part-body'
import { boardPartFor } from './part-editor.util'
import { useBoards } from './use-boards'
import { useConsole } from '../store/console'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
import { isVirtualPort } from '../../../shared/virtual-device'
import './MiniBoardView.css'

/** Shared with BoardView/BoardGraph so the full viewer adopts the same board. */
const STORAGE_KEY = 'snakie.board.id'
/** Virtual canvas the board is laid out within; the SVG viewBox crops to fit. */
const VW = 520
const VH = 320
const PAD_R = 6

// Pin annotation layout, ordered OUTWARD from a used pad: [number box][label]
// [variable]. A fixed-size grey square holds the GPIO number (right-aligned);
// the label then the code variable follow, mirrored per pin facing.
const NUM_BOX = 13 // square side
const STUB = 7 // pad → first element gap
const SLOT_GAP = 3 // gap between number box / label / variable
const CHAR_W = 6 // ~width of one mono glyph at the label size (extent estimate)
const LINE_H = 13 // vertical step for top/bottom-facing pins

/** A pad the code uses + how to annotate it (node-graph style). */
interface UsedPad {
  p: PadPoint
  /** Connection colour (by pin type). */
  color: string
  /** Variable the pin is assigned to (e.g. `led`), `''` if none. */
  variable: string
  /** Short pin-type tag (PWM / I²C / ADC …), matching the main board view. */
  tag: string
  /** Bus role (SDA / SCL / SCK …) for an i2c/spi pin, else undefined. */
  role?: string
}

/** Normalise a pad edge ('led' renders like a bottom pin). */
function pinEdge(e: PadPoint['edge']): 'left' | 'right' | 'top' | 'bottom' {
  return e === 'led' ? 'bottom' : e
}


/**
 * The [number box][label][variable] annotation for a used pad, laid out OUTWARD
 * from the pin: the grey GPIO box sits next to the pad, then the silk label, then
 * the code variable — mirrored for each facing (#…).
 */
function PinAnnotation({ u }: { u: UsedPad }): JSX.Element {
  const px = u.p.x
  const py = u.p.y
  // Prefer the physical board pin number; fall back to GPIO for built-in boards
  // that don't carry pin numbers (so the box is never blank).
  // Zero-pad single-digit numbers (1 → "01") so the pin column + capability
  // badges line up (matches boxedPinLabel on the breadboard/board view).
  const num = padPinNumber(String(u.p.pad.number ?? u.p.pad.gpio ?? ''))
  const label = u.p.pad.label
  const variable = u.variable
  const labelW = label.length * CHAR_W
  const edge = pinEdge(u.p.edge)

  const box = (bx: number, by: number): JSX.Element => (
    <>
      <rect x={bx} y={by} width={NUM_BOX} height={NUM_BOX} rx={2} className="mini-board__numbox" />
      {num && (
        <text x={bx + NUM_BOX - 2.5} y={by + NUM_BOX - 3.5} textAnchor="end" className="mini-board__num">
          {num}
        </text>
      )}
    </>
  )

  let body: JSX.Element
  if (edge === 'left') {
    const bx = px - STUB - NUM_BOX
    const labelX = bx - SLOT_GAP
    const varX = labelX - labelW - SLOT_GAP
    body = (
      <>
        <line x1={px} y1={py} x2={bx + NUM_BOX} y2={py} stroke={u.color} strokeWidth="1.2" opacity="0.65" />
        {box(bx, py - NUM_BOX / 2)}
        <text x={labelX} y={py + 3.5} textAnchor="end" className="mini-board__label">{label}</text>
        {variable && <text x={varX} y={py + 3.5} textAnchor="end" className="mini-board__var" fill={u.color}>{variable}</text>}
      </>
    )
  } else if (edge === 'right') {
    const bx = px + STUB
    const labelX = bx + NUM_BOX + SLOT_GAP
    const varX = labelX + labelW + SLOT_GAP
    body = (
      <>
        <line x1={px} y1={py} x2={bx} y2={py} stroke={u.color} strokeWidth="1.2" opacity="0.65" />
        {box(bx, py - NUM_BOX / 2)}
        <text x={labelX} y={py + 3.5} textAnchor="start" className="mini-board__label">{label}</text>
        {variable && <text x={varX} y={py + 3.5} textAnchor="start" className="mini-board__var" fill={u.color}>{variable}</text>}
      </>
    )
  } else if (edge === 'top') {
    const bx = px - NUM_BOX / 2
    const by = py - STUB - NUM_BOX
    const labelY = by - SLOT_GAP
    body = (
      <>
        <line x1={px} y1={py} x2={px} y2={by + NUM_BOX} stroke={u.color} strokeWidth="1.2" opacity="0.65" />
        {box(bx, by)}
        <text x={px} y={labelY} textAnchor="middle" className="mini-board__label">{label}</text>
        {variable && <text x={px} y={labelY - LINE_H} textAnchor="middle" className="mini-board__var" fill={u.color}>{variable}</text>}
      </>
    )
  } else {
    const bx = px - NUM_BOX / 2
    const by = py + STUB
    const labelY = by + NUM_BOX + LINE_H - 4
    body = (
      <>
        <line x1={px} y1={py} x2={px} y2={by} stroke={u.color} strokeWidth="1.2" opacity="0.65" />
        {box(bx, by)}
        <text x={px} y={labelY} textAnchor="middle" className="mini-board__label">{label}</text>
        {variable && <text x={px} y={labelY + LINE_H} textAnchor="middle" className="mini-board__var" fill={u.color}>{variable}</text>}
      </>
    )
  }

  return (
    <>
      {body}
      <circle cx={px} cy={py} r={PAD_R} fill={u.color} stroke="#fff" strokeWidth="1.8" />
    </>
  )
}

/**
 * The mini board viewport height (px). `DEFAULT` is the current size and the size
 * every launch opens at — the drag handle below the board resizes the split with
 * the instrument deck for the session only, and is intentionally NOT persisted.
 */
const DEFAULT_MINI_SCROLL_H = 190
const MIN_MINI_SCROLL_H = 90
const MAX_MINI_SCROLL_H = 640

/**
 * MINI BOARD VIEW (#168) — a compact node-graph board atop the instruments panel.
 *
 * Shows ONLY the microcontroller + the pads the active file's code uses (no pin
 * table / node cards / toolbar — that's the full Board Viewer, one click away via
 * the expand button). Auto-swaps the board type when the REPL banner names a known
 * board. Self-contained (no BoardGraph import) so it doesn't pull the board-window
 * subsystem into the main-window bundle.
 */
export function MiniBoardView({ source, isPython }: { source: string; isPython: boolean }): JSX.Element {
  const consoleStore = useConsole()
  // Connected to the built-in simulator rather than real hardware (#135)? Surface
  // it here so the board's pins/values are clearly understood as simulated.
  const deviceStatus = useDeviceStatus()
  const simulated = deviceStatus.state === 'connected' && isVirtualPort(deviceStatus.path)
  // Boards from the installed parts libraries (microcontroller parts), built-ins
  // as a fallback — the same source the full Board Viewer uses (#52).
  const boards = useBoards()
  const [boardId, setBoardId] = useState<string>(() => {
    try {
      return window.localStorage.getItem(STORAGE_KEY) ?? DEFAULT_BOARD_ID
    } catch {
      return DEFAULT_BOARD_ID
    }
  })

  // Adopt a board inferred from REPL text, persisting it so the full Board Viewer
  // picks it up too. Guarded to KNOWN boards + only when it actually changes.
  const adopt = useRef<(text: string) => void>(() => {})
  adopt.current = (text: string): void => {
    const id = boardIdFromReplText(text, boards)
    if (id && id !== boardId && boards.some((b) => b.id === id)) {
      setBoardId(id)
      try {
        window.localStorage.setItem(STORAGE_KEY, id)
      } catch {
        // ignore storage failures
      }
    }
  }

  // Follow the full Board Viewer: when the user picks a different board there, it
  // broadcasts the id (via main) so this mini view switches to the same board.
  // The same broadcast makes useBoards() re-read the library list, so a board that
  // was just created/duplicated (and so wasn't in `boards` yet) resolves on the
  // next render rather than falling back to the first board.
  useEffect(() => {
    const off = window.api.board.onSelectBoard((id) => {
      setBoardId(id)
      try {
        window.localStorage.setItem(STORAGE_KEY, id)
      } catch {
        // ignore storage failures
      }
    })
    return off
  }, [])

  // Seed from whatever the console already holds (the board may have connected
  // before this mounted), then watch new device output for a boot banner.
  useEffect(() => {
    adopt.current(consoleStore.getAll())
    const decoder = new TextDecoder()
    let tail = ''
    const unsub = window.api.device.onData((chunk) => {
      tail = (tail + decoder.decode(chunk, { stream: true })).slice(-8192)
      // The banner always contains "MicroPython"; skip the regex on ordinary output.
      if (/micropython/i.test(tail)) adopt.current(tail)
    })
    return unsub
  }, [consoleStore])

  const def = boards.find((b) => b.id === boardId) ?? boards[0] ?? BUILTIN_BOARDS[0]

  // User picked a microcontroller from the header dropdown: adopt it, persist it,
  // and broadcast (via main) so the full Board Viewer + other consumers follow.
  const selectBoard = (id: string): void => {
    setBoardId(id)
    try {
      window.localStorage.setItem(STORAGE_KEY, id)
    } catch {
      // ignore storage failures
    }
    window.api.board.selectBoard?.(id)
  }

  // The installed libraries, so we can resolve the board's SOURCE part and draw it
  // with its REAL authored body (image + shapes + pins) — exactly like the Part
  // Editor / full Board Viewer — instead of the stylised PCB. Reloads on a board
  // broadcast (a freshly-created board may not be loaded yet).
  const [libraries, setLibraries] = useState<Parameters<typeof boardPartFor>[0]>([])
  useEffect(() => {
    let alive = true
    const load = (): void => {
      void window.api.parts
        .listLibraries()
        .then((libs) => {
          if (alive) setLibraries(libs)
        })
        .catch(() => undefined)
    }
    load()
    const off = window.api.board.onSelectBoard(() => load())
    return () => {
      alive = false
      off()
    }
  }, [])
  const boardPart = useMemo(() => boardPartFor(libraries, def.id), [libraries, def.id])

  // Size the board box. A part-backed board draws its REAL authored body (image +
  // pins) via PartBody with `preserveAspectRatio="none"`, so the box MUST take the
  // PART's real aspect — identical to the full Board Viewer (WiringCanvas). Using
  // the board-definition aspect here stretched the image + pins vertically whenever
  // the two aspects differed (visible as overlapping pins on image-backed boards).
  const box = useMemo(
    () =>
      boardPart
        ? partBodyBox(boardPart, { maxW: VW - 150, maxH: VH - 80, viewW: VW, viewH: VH })
        : boardBox(def.aspect, { cx: VW / 2, cy: VH / 2, maxW: VW - 150, maxH: VH - 80 }),
    [boardPart, def.aspect]
  )
  // When the source part placed its pins freely (real x/y on the pads), draw them
  // at those positions — same distribution as the full board view (shared
  // `authoredPads`) — instead of stacking them along their header's edge.
  const pads = useMemo<PadPoint[]>(() => authoredPads(def, box), [def, box])

  // Pads the parsed code resolves to, keyed by pad for an O(1) lookup while
  // drawing every pad (idle pads stay visible but dimmed).
  const { usedByKey, usedList, ledLit } = useMemo(() => {
    const conns = isPython ? parsePins(source) : []
    const map = new Map<string, UsedPad>()
    let led = false
    for (const conn of conns) {
      const color = PIN_TYPE_COLOR[conn.type]
      const tag = PIN_TYPE_TAG[conn.type]
      conn.pins.forEach((tok, i) => {
        const p = padForToken(tok, def, pads, box)
        if (p.edge === 'led') led = true
        const key = padKey(p)
        if (!map.has(key)) map.set(key, { p, color, variable: conn.variable, tag, role: conn.roles?.[i] })
      })
    }
    return { usedByKey: map, usedList: [...map.values()], ledLit: led }
  }, [source, isPython, def, pads, box])

  // Used pins → PartBody's pinVariables (keyed by pin flat-index == pad index), so
  // the authored body shows the code variable on the pins the program uses.
  const pinVars = useMemo(() => {
    const m = new Map<number, { variable: string; color: string }>()
    pads.forEach((p, i) => {
      const u = usedByKey.get(padKey(p))
      if (u?.variable) m.set(i, { variable: u.variable, color: u.color })
    })
    return m
  }, [pads, usedByKey])

  // Frame whatever is actually drawn — measured from the live content's bounding
  // box (so the authored body's image/shapes + every boxed pin label is included
  // and nothing clips), then scaled to fill the dock (CSS). Falls back to the
  // board box before the first measure.
  const contentRef = useRef<SVGGElement>(null)
  const [frame, setFrame] = useState(() => ({ x: box.x, y: box.y, w: box.w, h: box.h }))
  useLayoutEffect(() => {
    const g = contentRef.current
    if (!g) return
    try {
      const b = g.getBBox()
      if (b.width > 0 && b.height > 0) setFrame({ x: b.x, y: b.y, w: b.width, h: b.height })
    } catch {
      // getBBox can throw if the content isn't laid out yet — keep the fallback.
    }
  }, [boardPart, def, source, isPython, pinVars, box])
  const M = 12
  const viewBox = {
    str: `${frame.x - M} ${frame.y - M} ${frame.w + M * 2} ${frame.h + M * 2}`,
    w: frame.w + M * 2,
    h: frame.h + M * 2
  }

  const led = ledPoint(box)
  const gradId = `mini-pcb-${def.id}`

  // Hover-revealed zoom + a measured width so the board fills the dock at 1× and
  // can be zoomed in and scrolled. Aspect is always preserved (no distortion):
  // the SVG is sized in px to the viewBox ratio, so it scales, never stretches.
  const scrollRef = useRef<HTMLDivElement>(null)
  const [wrapW, setWrapW] = useState(240)
  const [zoom, setZoom] = useState(1)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w && w > 0) setWrapW(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const aspect = viewBox.h / viewBox.w
  const svgW = Math.max(1, Math.round(wrapW * zoom))
  const svgH = Math.max(1, Math.round(svgW * aspect))
  const setZoomClamped = (z: number): void => setZoom(Math.min(5, Math.max(0.5, z)))

  // Resizable split between the mini board and the instrument deck below it. The
  // handle drags the board viewport's height; kept in component state only (never
  // persisted) so every launch opens at DEFAULT_MINI_SCROLL_H — the current size.
  const [scrollH, setScrollH] = useState(DEFAULT_MINI_SCROLL_H)
  const resizeRef = useRef<{ startY: number; startH: number } | null>(null)
  const onResizeDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    resizeRef.current = { startY: e.clientY, startH: scrollH }
  }
  const onResizeMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = resizeRef.current
    if (!drag) return
    const next = drag.startH + (e.clientY - drag.startY)
    setScrollH(Math.min(MAX_MINI_SCROLL_H, Math.max(MIN_MINI_SCROLL_H, next)))
  }
  const onResizeUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    resizeRef.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }
  const resetSize = (): void => setScrollH(DEFAULT_MINI_SCROLL_H)

  return (
    <section className="mini-board" aria-label="Board pins in use">
      <div className="mini-board__head">
        {/* Pick the microcontroller right where its name shows. Broadcasts the
            choice (via main) so the full Board Viewer follows, and persists it. */}
        <select
          className="mini-board__name mini-board__board-select"
          value={def.id}
          onChange={(e) => selectBoard(e.target.value)}
          title={`${def.name} · ${def.mcu} — change the microcontroller`}
          aria-label="Select microcontroller"
        >
          {boards.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        {simulated && (
          <span
            className="mini-board__sim"
            title="Connected to the simulated device — no hardware connected (offline mode)"
          >
            SIMULATION
          </span>
        )}
        <button
          type="button"
          className="mini-board__open"
          title="Open the full Board Viewer"
          aria-label="Open the full Board Viewer"
          onClick={() => void window.api.board.open()}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path
              d="M14 4h6v6M20 4l-8 8M10 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      <div className="mini-board__scroll" ref={scrollRef} style={{ height: scrollH }}>
      <svg
        className="mini-board__svg"
        viewBox={viewBox.str}
        width={svgW}
        height={svgH}
        role="img"
        aria-label={`${def.name} with ${usedList.length} pins in use`}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={def.pcbColor || '#1f7a44'} />
            <stop offset="1" stopColor="#13592f" />
          </linearGradient>
        </defs>

        <g ref={contentRef}>
          {boardPart ? (
            /* Part-backed board → draw its REAL authored body (image + shapes +
               pins), identical to the Part Editor / full Board Viewer. Box ONLY the
               pins the code USES (pinVars keys) so a dense board's number boxes don't
               overlap — the mini board is a used-pin summary. */
            <PartBody part={boardPart} box={box} boxedPins={new Set(pinVars.keys())} pinVariables={pinVars} />
          ) : (
            /* Built-in board (no source part) → the stylised PCB fallback. */
            <>
              <rect x={box.x} y={box.y} width={box.w} height={box.h} rx="14" fill={`url(#${gradId})`} stroke="#0c3a23" strokeWidth="1.5" />
              <rect
                x={box.x + 8}
                y={box.y + 8}
                width={box.w - 16}
                height={box.h - 16}
                rx="10"
                fill="none"
                stroke="rgba(255,255,255,.28)"
                strokeWidth="1"
                strokeDasharray="2 5"
              />
              <rect x={box.x + box.w / 2 - 34} y={box.y + box.h / 2 - 22} width="68" height="44" rx="5" fill="#15171b" stroke="#2a2d33" strokeWidth="1" />
              <text x={box.x + box.w / 2} y={box.y + box.h / 2 + 4} textAnchor="middle" className="mini-board__mcu">
                {def.mcu}
              </text>
              {ledLit && <circle cx={led.x} cy={led.y} r="5" fill="#46e06a" stroke="rgba(0,0,0,.5)" strokeWidth="1" />}
              {pads.map((p, i) => {
                const u = usedByKey.get(padKey(p))
                if (!u) {
                  return <circle key={`p${i}`} cx={p.x} cy={p.y} r={2.6} className="mini-board__hole" />
                }
                return <PinAnnotation key={`p${i}`} u={u} />
              })}
            </>
          )}
        </g>
      </svg>
      </div>
      {/* Zoom controls — hidden until the user hovers the mini board (keeps it clean). */}
      <div className="mini-board__zoom" aria-label="Zoom controls">
        <button
          type="button"
          className="mini-board__zoom-btn"
          title="Zoom out"
          aria-label="Zoom out"
          onClick={() => setZoomClamped(zoom / 1.25)}
        >
          −
        </button>
        <button
          type="button"
          className="mini-board__zoom-btn"
          title="Fit width"
          aria-label="Fit width"
          onClick={() => setZoom(1)}
        >
          ⤢
        </button>
        <button
          type="button"
          className="mini-board__zoom-btn"
          title="Zoom in"
          aria-label="Zoom in"
          onClick={() => setZoomClamped(zoom * 1.25)}
        >
          +
        </button>
      </div>
      {usedList.length === 0 && (
        <p className="mini-board__hint">{isPython ? 'No pins used in this file yet.' : 'Open a MicroPython (.py) file to see its pins.'}</p>
      )}
      {/* Drag the split between the board and the instrument deck. Double-click to
          reset to the default size. Per-session only (never persisted). */}
      <div
        className="mini-board__resize"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize the board view — drag, or double-click to reset"
        title="Drag to resize · double-click to reset"
        onPointerDown={onResizeDown}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeUp}
        onDoubleClick={resetSize}
      >
        <span className="mini-board__resize-grip" aria-hidden="true" />
      </div>
    </section>
  )
}
