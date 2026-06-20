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
  type BoardDefinition,
  type BoardFeature,
  type BoardPadType
} from './board-defs'
import {
  boardBox,
  layoutPads,
  ledPoint,
  padForToken,
  type BoardBox,
  type PadPoint
} from './board-layout'
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
import {
  buildValueProbe,
  liveValueDisplay,
  parseProbeOutput,
  type LiveValue
} from './board-values'
import {
  InstrumentDock,
  InstrumentOverlay
} from './InstrumentWindow'
import { Oscilloscope } from './Oscilloscope'
import { Multimeter } from './Multimeter'
import {
  adcFromU16,
  emptyStats,
  foldStat,
  type AdcSample,
  type Stats
} from './instrument-data'
import './BoardGraph.css'

/**
 * BOARD GRAPH (node-graph live Board View)
 * ========================================
 *
 * The live, read-only Board View rendered as a **node graph**: one dark node
 * card per parsed connection on the left, each wired by a drooping coloured
 * "noodle" cable to its connection's REAL pad on the **physical board** drawn on
 * the right, and a light "pins in use" table below.
 *
 * The board is a true physical representation of the SELECTED board: the outline
 * is sized from `def.aspect` and EVERY pad of `def.headers` is drawn at its real
 * edge position (left/right/top/bottom) via the shared {@link ./board-layout}
 * helpers (`boardBox`/`layoutPads`/`padForToken`) — the same layout the
 * {@link BoardView} creator preview uses. Used pads (a connection resolves to
 * them) are highlighted; idle pads are still drawn. Switching the board in the
 * picker redraws the whole pinout and re-targets every wire.
 *
 * It re-derives entirely from `{ source, fileName, isPython }` + the persisted
 * board selection (shared with {@link BoardView} via the `snakie.board.id` key),
 * so it updates live as the parent re-streams the active file.
 *
 * VIEWPORT TOOLBAR (#99 / #96): the stage (node cards + wires + board) lives
 * inside a pan/zoom/rotate viewport with a noodleplanner-style floating control
 * cluster (zoom −/+, zoom-to-fit, a 100%↔fit toggle, rotate 90° CW, and an
 * SVG/PNG/PDF export). The "PINS IN USE" table stays a normal table below the
 * transformed stage. See {@link ./board-viewport} for the (unit-tested) math.
 *
 * LIVE VALUES (#97): the node value readout + the header LIVE LED can reflect the
 * REAL board state. Because reading a pin over the REPL enters the **raw REPL**
 * (which interrupts any running user program — confirmed in the device layer) and
 * there is no reliable "program is running" signal to gate on, live polling is an
 * **explicit opt-in toggle** (the LIVE control), default OFF. When OFF the window
 * never touches the device (current idle behaviour). When ON and connected, it
 * polls one batched `device.exec` snippet (see {@link ./board-values}) on a gentle
 * interval, parses it, and merges by source index; every failure (disconnect /
 * busy / undefined var / timeout) silently falls back to the idle placeholder.
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

// --- Node-graph geometry ----------------------------------------------------
// The view has TWO regions in one SVG coordinate space: a vertical column of
// node cards on the LEFT (one per parsed connection), and the **physical board**
// drawn on the RIGHT — its full pinout from `def.headers` laid out by
// {@link layoutPads}, every pad at its real edge position. A drooping "noodle"
// wire runs from each node's solder dot to its connection's REAL pad coordinate
// (which may be on any edge), so switching boards redraws the whole pinout and
// re-targets every wire.
const PITCH = 46 // vertical distance between node rows
const NODE_H = 36 // node card height
const NODE_W = 252 // node card width
const NODE_LEFT = 36 // node card left inset
const FIRST_Y = 149 // centre Y of the first node row
const NODE_DOT_X = 288 // node right-edge solder dot X (wire start)
const SAG = 30 // downward bezier sag for the drooping noodle

// The board drawing region (to the right of the node column). The physical
// board is fitted inside it from its aspect, with margins for the edge labels.
const BOARD_REGION_X = 470 // left of the board area (after the node dots)
const BOARD_REGION_W = 600 // width of the board area
const BOARD_MAX_W = 320 // largest board footprint (keeps room for labels)
const BOARD_MAX_H = 460 // largest board footprint
const BOARD_REGION_CX = BOARD_REGION_X + BOARD_REGION_W / 2 // board centre X
const CANVAS_W = BOARD_REGION_X + BOARD_REGION_W + 60 // canvas / SVG width (1130)
const PAD_R = 7 // drawn pad radius
const STAGE_PAD = 48 // vertical breathing room above/below the content

/** Centre Y of node row `i`. */
function rowY(i: number): number {
  return FIRST_Y + i * PITCH
}

/** One drawable connection row: its node card + the pad its first pin taps. */
interface GraphRow {
  conn: UsedPins
  /** Source index (for live-value merge). */
  index: number
  /** Node row centre Y. */
  y: number
  color: string
  /** The resolved real pad coordinate for the connection's FIRST pin. */
  pad: PadPoint
  /** Faint extra pads for the rest of a multi-pin bus (drawn as thin links). */
  extraPads: PadPoint[]
}

// --- Instruments (#101 / #102) ----------------------------------------------
/** An open instrument window: its kind + the connection variable it tracks. */
interface OpenInstrument {
  kind: 'scope' | 'meter'
  /** The connection's variable (stable id across re-parses); '' for unnamed. */
  variable: string
}

/**
 * Minimum board-window width (px) to DOCK instruments in the side rail rather
 * than float them as an overlay. The dock rail is 436px wide; below this the
 * canvas would be squeezed too far, so we overlay instead (per the handoff's
 * responsive rule). Measured on the whole board window.
 */
const DOCK_MIN_WIDTH = 980

// --- Live values (#97) ------------------------------------------------------
/** How often we poll the device for live values while LIVE is ON (ms). */
const POLL_INTERVAL_MS = 800

/** State the {@link useLiveValues} hook hands back to the view. */
interface LiveState {
  /** Live readings by connection source index (empty until a poll succeeds). */
  values: Map<number, LiveValue>
  /** True while polling AND a board is connected (drives the LIVE LED). */
  connected: boolean
}

/**
 * Poll the connected board for each connection's live value while `enabled`.
 *
 * SAFETY (issue #97 — "must not disrupt Run/Stop or the REPL"): reading a pin
 * runs `device.exec`, which enters the raw REPL and INTERRUPTS a running user
 * program. There is no reliable "is a program running" signal to gate on, so
 * this is gated entirely on the explicit LIVE toggle (`enabled`) — when OFF we
 * never touch the device. When ON we still keep the cadence gentle and never
 * overlap two probes (a re-entrancy guard), so the port stays mostly free.
 *
 * Each tick: `getStatus()` first (cheap, no REPL); only if `connected` do we run
 * ONE batched `exec` probe for all connections. We use `exec` (not `eval`)
 * because `exec` returns `{stdout, stderr}` and never throws on a device
 * traceback — so a partly-undefined batch still yields the readable lines.
 * Anything that fails leaves `values` as-is for the next merge and the affected
 * node falls back to idle. No thrown errors, no console spam.
 */
function useLiveValues(conns: UsedPins[], enabled: boolean): LiveState {
  const [values, setValues] = useState<Map<number, LiveValue>>(new Map())
  const [connected, setConnected] = useState(false)
  // Latest connections, read inside the interval without re-arming it each edit.
  const connsRef = useRef(conns)
  connsRef.current = conns

  useEffect(() => {
    // OFF, or nothing to read → never touch the device; show idle placeholders.
    if (!enabled || conns.length === 0) {
      setValues(new Map())
      setConnected(false)
      return
    }

    let cancelled = false
    let inFlight = false // re-entrancy guard: never overlap two probes.

    const tick = async (): Promise<void> => {
      if (inFlight) return
      inFlight = true
      try {
        const status = await window.api.device.getStatus()
        if (cancelled) return
        const isConnected = status?.state === 'connected'
        setConnected(isConnected)
        if (!isConnected) {
          setValues(new Map())
          return
        }
        const snippet = buildValueProbe(connsRef.current)
        if (!snippet) {
          setValues(new Map())
          return
        }
        // `exec` never throws on a device traceback; it returns {stdout,stderr}.
        const { stdout } = await window.api.device.exec(snippet)
        if (cancelled) return
        setValues(parseProbeOutput(stdout))
      } catch {
        // Disconnect / busy / timeout / any device error → tolerate silently and
        // drop to idle; the LED follows connection on the next successful tick.
        if (!cancelled) {
          setConnected(false)
          setValues(new Map())
        }
      } finally {
        inFlight = false
      }
    }

    void tick() // immediate first read so LIVE feels responsive.
    const id = window.setInterval(() => void tick(), POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
    // Re-arm only when the toggle flips or the connection COUNT changes (so the
    // empty/non-empty branch is correct); per-edit content changes ride
    // `connsRef` without restarting the interval.
  }, [enabled, conns.length])

  return { values, connected }
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

  // Live device values (#97): OFF by default (the LIVE header LED doubles as the
  // on/off toggle). When ON + connected we poll the board; OFF never touches it.
  const [liveOn, setLiveOn] = useState(false)
  const { values: liveValues, connected: liveConnected } = useLiveValues(conns, liveOn)

  // --- Open instruments (#101/#102) -----------------------------------------
  // Keyed by the connection variable so a window survives source edits as long
  // as its variable stays declared. Opening the same kind for the same pin again
  // is a no-op (it just stays open / focused).
  const [instruments, setInstruments] = useState<OpenInstrument[]>([])
  const openInstrument = useCallback((kind: 'scope' | 'meter', variable: string): void => {
    setInstruments((cur) =>
      cur.some((it) => it.kind === kind && it.variable === variable)
        ? cur
        : [...cur, { kind, variable }]
    )
  }, [])
  const closeInstrument = useCallback((kind: 'scope' | 'meter', variable: string): void => {
    setInstruments((cur) => cur.filter((it) => !(it.kind === kind && it.variable === variable)))
  }, [])
  const retargetInstrument = useCallback(
    (kind: 'scope' | 'meter', fromVar: string, toVar: string): void => {
      setInstruments((cur) => {
        // Switching to a pin that already has this instrument open → just drop
        // the old one (avoid a duplicate); else retarget in place.
        if (cur.some((it) => it.kind === kind && it.variable === toVar)) {
          return cur.filter((it) => !(it.kind === kind && it.variable === fromVar))
        }
        return cur.map((it) =>
          it.kind === kind && it.variable === fromVar ? { ...it, variable: toVar } : it
        )
      })
    },
    []
  )

  // Drop any instrument whose connection variable is no longer present (the user
  // deleted/renamed the pin), so stale windows don't linger.
  useEffect(() => {
    setInstruments((cur) => {
      const live = new Set(conns.map((c) => c.variable))
      const next = cur.filter((it) => live.has(it.variable))
      return next.length === cur.length ? cur : next
    })
  }, [conns])

  // Rolling MIN/MAX/AVG per ADC variable (Multimeter stats), accumulated from the
  // live volts samples. Reset when LIVE turns off (a fresh session).
  const [meterStats, setMeterStats] = useState<Map<string, Stats>>(new Map())
  useEffect(() => {
    if (!liveOn) setMeterStats(new Map())
  }, [liveOn])

  // Fold each new live ADC reading into its variable's running stats.
  useEffect(() => {
    if (!liveOn) return
    setMeterStats((prev) => {
      let changed = false
      const next = new Map(prev)
      conns.forEach((c, i) => {
        if (c.type !== 'adc') return
        const live = liveValues.get(i)
        if (!live || live.value === undefined) return
        const { volts } = adcFromU16(live.value)
        const folded = foldStat(next.get(c.variable) ?? emptyStats(), volts)
        next.set(c.variable, folded)
        changed = true
      })
      return changed ? next : prev
    })
  }, [liveValues, conns, liveOn])

  // Dock vs. overlay: measure the whole board window. Wide enough → dock the
  // instruments in the side rail; otherwise float them as an overlay (handoff).
  // The dock-to-side key sets an explicit override (null = follow the width).
  const [winW, setWinW] = useState<number>(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1180
  )
  useEffect(() => {
    const onResize = (): void => setWinW(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const [dockOverride, setDockOverride] = useState<boolean | null>(null)
  const dockInstruments = dockOverride ?? winW >= DOCK_MIN_WIDTH
  const toggleDock = useCallback(() => setDockOverride((d) => !(d ?? winW >= DOCK_MIN_WIDTH)), [winW])

  // The node column extent: one card per connection, 46px pitch.
  const nodeBottom = conns.length > 0 ? rowY(conns.length - 1) + NODE_H / 2 : FIRST_Y
  const nodeMidY = (FIRST_Y + nodeBottom) / 2

  // The PHYSICAL board: fit the outline from the board's aspect and lay out
  // EVERY pad of every header (left/right/top/bottom) at its real edge position.
  // Reactive to `def`, so switching board in the picker redraws the whole pinout.
  const box = useMemo<BoardBox>(
    () =>
      boardBox(def.aspect, {
        cx: BOARD_REGION_CX,
        // Centre the board vertically on the node column so the wires read.
        cy: Math.max(FIRST_Y + BOARD_MAX_H / 2 - 10, nodeMidY),
        maxW: BOARD_MAX_W,
        maxH: BOARD_MAX_H
      }),
    [def.aspect, nodeMidY]
  )
  const pads = useMemo<PadPoint[]>(() => layoutPads(def, box), [def, box])

  // One row per connection: its node card + its FIRST pin's REAL pad coordinate
  // (which may be on any edge). A bus's remaining pins become faint extra pads.
  const rows = useMemo<GraphRow[]>(
    () =>
      conns.map((conn, i) => {
        const pad = padForToken(conn.pins[0] ?? '', def, pads, box)
        const extraPads = conn.pins
          .slice(1)
          .map((tok) => padForToken(tok, def, pads, box))
        return {
          conn,
          index: i,
          y: rowY(i),
          color: PIN_TYPE_COLOR[conn.type],
          pad,
          extraPads
        }
      }),
    [conns, def, pads, box]
  )

  // The set of drawn pad coordinates that a connection resolves to → "used".
  const usedPadKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const r of rows) {
      keys.add(padKey(r.pad))
      for (const p of r.extraPads) keys.add(padKey(p))
    }
    return keys
  }, [rows])
  const ledLit = useMemo(() => rows.some((r) => r.pad.edge === 'led'), [rows])

  // Stage extent spans BOTH the node column and the physical board (with its
  // edge labels + USB nub), so zoom-to-fit always frames the whole drawing.
  // Derived from geometry, NOT the connection count — so large N grows the node
  // column and the board stays put, and an empty board still has a sane size.
  const contentTop = Math.min(FIRST_Y - NODE_H / 2, box.y - 24)
  const contentBottom = Math.max(nodeBottom, box.y + box.h + 28)
  const stageH = Math.max(680, contentBottom - Math.min(0, contentTop) + STAGE_PAD)

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

  // Auto-fit until the user interacts (re-fit on rotation / board change while
  // untouched, so switching board in the picker reframes the whole new pinout).
  useEffect(() => {
    if (touchedRef.current) return
    if (!hasRows || vp.w === 0 || vp.h === 0) return
    setView(fitTransform(CANVAS_W, stageH, vp.w, vp.h, rotation))
    setIsOneToOne(false)
  }, [hasRows, vp.w, vp.h, stageH, rotation, def.id])

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
    void exportView(exportFmt, { rows, def, box, pads, usedPadKeys, ledLit, stageH, rotation })
  }, [exportFmt, rows, def, box, pads, usedPadKeys, ledLit, stageH, rotation])

  // --- Render the open instruments -------------------------------------------
  // The PWM/ADC connections (sources for the scope/meter selectors).
  const pwmConns = useMemo(() => conns.filter((c) => c.type === 'pwm'), [conns])
  const adcConns = useMemo(() => conns.filter((c) => c.type === 'adc'), [conns])

  // Resolve each open instrument to its current connection + live reading and
  // build the JSX. An instrument whose variable no longer resolves is skipped
  // (the cleanup effect removes it shortly after).
  const instrumentEls = instruments
    .map((it) => {
      const idx = conns.findIndex((c) => c.variable === it.variable)
      const conn = idx >= 0 ? conns[idx] : undefined
      if (!conn) return null
      const live = liveValues.get(idx)
      const docked = dockInstruments
      const onToggleDock = toggleDock
      if (it.kind === 'scope' && conn.type === 'pwm') {
        // Live duty fraction from the polled duty_u16 (else parsed/static).
        const liveDuty = live && live.value !== undefined ? live.value / 65535 : undefined
        return (
          <Oscilloscope
            key={`scope-${it.variable}`}
            conn={conn}
            sources={pwmConns}
            fileSource={source}
            liveDuty={liveDuty}
            docked={docked}
            onSelectSource={(next) => retargetInstrument('scope', it.variable, next.variable)}
            onToggleDock={onToggleDock}
            onClose={() => closeInstrument('scope', it.variable)}
          />
        )
      }
      if (it.kind === 'meter' && conn.type === 'adc') {
        const sample: AdcSample | undefined =
          live && live.value !== undefined ? adcFromU16(live.value) : undefined
        return (
          <Multimeter
            key={`meter-${it.variable}`}
            conn={conn}
            sources={adcConns}
            sample={sample}
            stats={meterStats.get(it.variable)}
            docked={docked}
            onSelectSource={(next) => retargetInstrument('meter', it.variable, next.variable)}
            onToggleDock={onToggleDock}
            onClose={() => closeInstrument('meter', it.variable)}
          />
        )
      }
      return null
    })
    .filter((el): el is JSX.Element => el !== null)
  const hasInstruments = instrumentEls.length > 0

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
          {/* LIVE doubles as the on/off control for device polling (#97). OFF:
              dim LED, idle placeholders, device untouched. ON: lit when a board
              is connected (green, pulsing), amber while connecting/unreadable. */}
          <button
            type="button"
            className={`boardgraph__live ${liveOn ? 'is-on' : 'is-off'} ${
              liveOn && liveConnected ? 'is-connected' : ''
            }`}
            onClick={() => setLiveOn((on) => !on)}
            aria-pressed={liveOn}
            title={
              liveOn
                ? liveConnected
                  ? 'Live: reading the connected board — click to stop'
                  : 'Live: waiting for a connected board — click to stop'
                : 'Show live pin values from the board (polls the device — interrupts a running program). Click to start.'
            }
          >
            <span className="boardgraph__led" aria-hidden="true" />
            LIVE
          </button>
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

      <div className="boardgraph__body">
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

                {/* The physical board (full pinout) UNDER the wires + dots so the
                    coloured noodles read on top of the green PCB. */}
                <Board
                  def={def}
                  box={box}
                  pads={pads}
                  usedPadKeys={usedPadKeys}
                  ledLit={ledLit}
                  rotation={rotation}
                />

                {/* Faint bus links (a multi-pin connection's other pins). */}
                <g fill="none" strokeLinecap="round" opacity="0.5">
                  {rows.flatMap((r, i) =>
                    r.extraPads.map((p, j) => (
                      <path
                        key={`bus-${i}-${j}`}
                        d={noodlePath(NODE_DOT_X, r.y, p)}
                        stroke={r.color}
                        strokeWidth="1.4"
                        strokeDasharray="3 4"
                      />
                    ))
                  )}
                </g>

                {/* Drooping noodle wires from each node dot to its REAL pad. */}
                <g fill="none" strokeLinecap="round" filter="url(#bg-glow)" opacity="0.92">
                  {rows.map((r, i) => (
                    <path
                      key={`wire-${i}`}
                      d={noodlePath(NODE_DOT_X, r.y, r.pad)}
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
              </svg>

              {/* Node cards (HTML, over the SVG) — one per connection. PWM/ADC
                  nodes carry a scope/meter launcher after the value (#101/#102). */}
              {rows.map((r, i) => (
                <NodeCard
                  key={`node-${i}`}
                  row={r}
                  rotation={rotation}
                  live={liveValues.get(i)}
                  onOpenScope={
                    r.conn.type === 'pwm'
                      ? () => openInstrument('scope', r.conn.variable)
                      : undefined
                  }
                  onOpenMeter={
                    r.conn.type === 'adc'
                      ? () => openInstrument('meter', r.conn.variable)
                      : undefined
                  }
                />
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

        {/* Instruments as an OVERLAY when the window is too narrow to dock. */}
        {hasInstruments && !dockInstruments && (
          <InstrumentOverlay onScrim={() => setInstruments([])}>{instrumentEls}</InstrumentOverlay>
        )}
      </div>

      {/* Instruments DOCKED in the side rail on a wide window. */}
      {hasInstruments && dockInstruments && <InstrumentDock>{instrumentEls}</InstrumentDock>}
      </div>

      <PinsInUse conns={conns} fileName={fileName} />
    </div>
  )
}

// --- SVG drawing ------------------------------------------------------------

/** Stable key for a drawn pad coordinate (matches "used" pads to drawn pads). */
function padKey(p: { x: number; y: number }): string {
  return `${p.x.toFixed(1)},${p.y.toFixed(1)}`
}

/**
 * A drooping cubic bezier from a node solder dot `(sx, sy)` to a target pad on
 * the physical board — wherever it sits (left / right / top / bottom / led).
 *
 * The wire leaves the node horizontally to the right and arrives at the pad with
 * an edge-aware tangent (so it docks INTO the pad's edge), keeping the signature
 * downward droop. Left-edge pads read as the classic flat noodle; right/top/
 * bottom pads route around with a deeper control pull so the cable still reads.
 */
function noodlePath(sx: number, sy: number, pad: PadPoint): string {
  const dx = pad.x - sx
  // Control 1 leaves the node horizontally to the right, drooping down.
  const c1x = sx + Math.max(80, dx * 0.45)
  const c1y = sy + SAG
  // Control 2 approaches the pad along its edge's inward normal.
  let c2x: number
  let c2y: number
  switch (pad.edge) {
    case 'right':
      // Enter from the right of the board, swinging past then back in.
      c2x = pad.x + 90
      c2y = pad.y + SAG
      break
    case 'top':
      c2x = pad.x
      c2y = pad.y - 70
      break
    case 'bottom':
      c2x = pad.x
      c2y = pad.y + 70
      break
    default:
      // left / led: approach horizontally from the left with the droop.
      c2x = pad.x - Math.max(80, dx * 0.45)
      c2y = pad.y + SAG
      break
  }
  return `M${sx} ${sy} C ${c1x} ${c1y} ${c2x} ${c2y} ${pad.x} ${pad.y}`
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

/** Style table for the feature kinds (mirrors BoardView's FEATURE_STYLE). */
const FEATURE_STYLE: Record<BoardFeature['kind'], { fill: string; stroke: string; text: string }> = {
  mcu: { fill: '#15171b', stroke: '#2a2d33', text: '#b9bdc6' },
  wifi: { fill: '#c2c7cf', stroke: '#8d929b', text: '#3a3d44' },
  usb: { fill: '#d7dbe1', stroke: '#7b8088', text: '#3a3d44' },
  chip: { fill: '#23262c', stroke: '#454a52', text: '#c8ccd3' },
  led: { fill: '#2c3a30', stroke: '#46e06a', text: '#cfe9d6' }
}

/** Pad fill by electrical role (gnd dark, vcc red, other grey, gpio gold). */
function padFill(type: BoardPadType | undefined): string {
  switch (type) {
    case 'gnd':
      return '#2b2f36'
    case 'vcc':
      return '#c0392b'
    case 'other':
      return '#8a9099'
    default:
      return 'url(#bg-gold)'
  }
}

/**
 * The PHYSICAL board: PCB outline (sized from `box`), dashed silkscreen inset,
 * USB nub, the declared features (MCU / wifi / chips), the onboard LED, and
 * EVERY pad from `def.headers` (laid out by {@link layoutPads}) at its real edge
 * position with its silk label. Pads a connection resolves to (`usedPadKeys`)
 * are highlighted; idle pads are still drawn so the full header reads.
 */
function Board({
  def,
  box,
  pads,
  usedPadKeys,
  ledLit,
  rotation
}: {
  def: BoardDefinition
  box: BoardBox
  pads: PadPoint[]
  usedPadKeys: Set<string>
  ledLit: boolean
  rotation: 0 | 90 | 180 | 270
}): JSX.Element {
  const cx = box.x + box.w / 2 // board centre X
  const led = ledPoint(box)
  // Legibility (#96): the in-stage counter-rotation keeps every label at a net
  // 0° / 90°-CW on screen (never upside down) for the current stage rotation.
  const { counter } = labelCounterRotation(rotation)
  return (
    <g>
      {/* PCB + dashed silkscreen inset. */}
      <rect
        x={box.x}
        y={box.y}
        width={box.w}
        height={box.h}
        rx="18"
        fill="url(#bg-pcb)"
        stroke="#0c3a23"
        strokeWidth="1.5"
      />
      <rect
        x={box.x + 10}
        y={box.y + 10}
        width={box.w - 20}
        height={box.h - 20}
        rx="12"
        fill="none"
        stroke="rgba(255,255,255,.32)"
        strokeWidth="1"
        strokeDasharray="2 5"
      />

      {/* USB connector nub on top. */}
      <rect
        x={cx - 28}
        y={box.y - 16}
        width="56"
        height="24"
        rx="4"
        fill="url(#bg-silver)"
        stroke="#6c727b"
        strokeWidth="1"
      />

      {/* Declared features (MCU / wifi / chips). When a board defines none we
          still draw an MCU block so the centre never reads empty. */}
      {def.features && def.features.length > 0 ? (
        def.features.map((f, i) => (
          <Feature key={`feat-${i}`} feature={f} box={box} counter={counter} />
        ))
      ) : (
        <g>
          <rect
            x={cx - 58}
            y={box.y + box.h / 2 - 58}
            width="116"
            height="116"
            rx="7"
            fill="#1c1d20"
            stroke="#0c0d0f"
            strokeWidth="1"
          />
          <text
            x={cx}
            y={box.y + box.h / 2 + 4}
            textAnchor="middle"
            className="boardgraph__svg-mcu"
            fill="#cfd3d8"
            transform={labelTransform(counter, cx, box.y + box.h / 2 + 4)}
          >
            {def.mcu}
          </text>
        </g>
      )}

      {/* Onboard LED dot (lit when a connection taps the ledLabel). */}
      {def.ledLabel && (
        <g className="boardgraph__svg-pad-text">
          {ledLit && <circle cx={led.x} cy={led.y} r="11" fill="#46e06a" opacity="0.3" />}
          <circle
            cx={led.x}
            cy={led.y}
            r="6.5"
            fill={ledLit ? '#46e06a' : '#e23b2b'}
            stroke="rgba(0,0,0,0.5)"
            strokeWidth="1"
          />
          <text
            x={led.x}
            y={led.y + 19}
            textAnchor="middle"
            fill="#cfe8d4"
            transform={labelTransform(counter, led.x, led.y + 19)}
          >
            {def.ledLabel}
          </text>
        </g>
      )}

      {/* EVERY header pad at its real edge position + silk label. Used GPIO pads
          are ringed white; idle pads are drawn dimmer so the full header reads. */}
      <g className="boardgraph__svg-pad-text">
        {pads.map((p, i) => {
          const isGpio = (p.pad.type ?? 'gpio') === 'gpio'
          const used = isGpio && usedPadKeys.has(padKey(p))
          const vertical = p.edge === 'left' || p.edge === 'right'
          const lx = p.edge === 'left' ? p.x + 14 : p.edge === 'right' ? p.x - 14 : p.x
          const ly = vertical ? p.y + 4 : p.edge === 'top' ? p.y - 12 : p.y + 18
          const anchor: 'start' | 'middle' | 'end' =
            p.edge === 'left' ? 'start' : p.edge === 'right' ? 'end' : 'middle'
          return (
            <g key={`pad-${i}`} opacity={used || !isGpio ? 1 : 0.82}>
              <circle
                cx={p.x}
                cy={p.y}
                r={PAD_R}
                fill={padFill(p.pad.type)}
                stroke={used ? '#fff' : isGpio ? '#9a7a1e' : 'rgba(0,0,0,0.5)'}
                strokeWidth={used ? 2.4 : 0.8}
              />
              {isGpio && <circle cx={p.x} cy={p.y} r="2.6" fill="#5a4a1a" />}
              <text
                x={lx}
                y={ly}
                textAnchor={anchor}
                fill={used ? '#fff' : '#cfe8d4'}
                transform={labelTransform(counter, lx, ly)}
              >
                {p.pad.label}
              </text>
            </g>
          )
        })}
      </g>
    </g>
  )
}

/** One decorative feature as a labelled rounded rect (normalised 0..1 coords). */
function Feature({
  feature,
  box,
  counter
}: {
  feature: BoardFeature
  box: BoardBox
  counter: 0 | 180
}): JSX.Element {
  const x = box.x + feature.x * box.w
  const y = box.y + feature.y * box.h
  const w = feature.w * box.w
  const h = feature.h * box.h
  const s = FEATURE_STYLE[feature.kind] ?? FEATURE_STYLE.chip
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="4" fill={s.fill} stroke={s.stroke} strokeWidth="1.2" />
      <text
        x={x + w / 2}
        y={y + h / 2 + 4}
        textAnchor="middle"
        className="boardgraph__svg-sub"
        fill={s.text}
        transform={labelTransform(counter, x + w / 2, y + h / 2 + 4)}
      >
        {feature.label}
      </text>
    </g>
  )
}

/** One node card: type tag inline beside the variable + its value readout. */
function NodeCard({
  row,
  rotation,
  live,
  onOpenScope,
  onOpenMeter
}: {
  row: GraphRow
  rotation: 0 | 90 | 180 | 270
  /** Live reading for this row's connection, or undefined → idle placeholder. */
  live?: LiveValue
  /** Open the oscilloscope (PWM nodes only). */
  onOpenScope?: () => void
  /** Open the multimeter (ADC nodes only). */
  onOpenMeter?: () => void
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
        <NodeValue type={conn.type} live={live} />
        {onOpenScope && <ScopeLauncher onClick={onOpenScope} />}
        {onOpenMeter && <MeterLauncher onClick={onOpenMeter} />}
      </span>
    </div>
  )
}

/** PWM node's scope launcher — a green square-wave glyph button (#101). */
function ScopeLauncher({ onClick }: { onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      className="boardgraph__launch boardgraph__launch--scope"
      onClick={onClick}
      title="Open oscilloscope"
      aria-label="Open oscilloscope for this PWM pin"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          d="M3 15 L3 9 L8 9 L8 15 L13 15 L13 9 L18 9 L18 15 L21 15"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    </button>
  )
}

/** ADC node's meter launcher — a teal dial-gauge glyph button (#102). */
function MeterLauncher({ onClick }: { onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      className="boardgraph__launch boardgraph__launch--meter"
      onClick={onClick}
      title="Open multimeter"
      aria-label="Open multimeter for this ADC pin"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M4 18 A9 9 0 0 1 20 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <line x1="12" y1="18" x2="16.6" y2="12.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="12" cy="18" r="1.7" fill="currentColor" />
      </svg>
    </button>
  )
}

/**
 * The right-hand value on a node card. When a live reading is present it shows
 * the real value with an **asserted** (green + glowing dot) or **rest** (dim
 * grey) state per {@link liveValueDisplay}'s per-type rule; with no reading it
 * shows the original idle placeholder (`1` for boolean input/output, `—` for
 * bus/pwm types) — so disconnected / LIVE-off / unreadable looks like before.
 */
function NodeValue({ type, live }: { type: PinType; live?: LiveValue }): JSX.Element {
  const { text, asserted } = liveValueDisplay(type, live)
  return (
    <span className={`boardgraph__node-val ${asserted ? 'is-asserted' : ''}`}>
      <span className={`boardgraph__node-dot ${asserted ? 'is-asserted' : ''}`} />
      {text}
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

/** Everything {@link buildExportSvg}/{@link exportView} need to serialise. */
interface ExportArgs {
  rows: GraphRow[]
  def: BoardDefinition
  box: BoardBox
  pads: PadPoint[]
  usedPadKeys: Set<string>
  ledLit: boolean
  stageH: number
  rotation: 0 | 90 | 180 | 270
}

/**
 * Serialise the WHOLE board view (at 1:1 in stage pixels, honouring the current
 * rotation) to a standalone `<svg>` string. The wires + physical board are SVG
 * already; the HTML node cards are embedded via `<foreignObject>` so the file is
 * fully self-contained (no external CSS / fonts beyond inline styles).
 *
 * Export captures the full board at actual size — NOT the current zoom/pan — so
 * the saved image is always the complete, framed view; the rotation IS applied
 * (the whole drawing rotates via a group transform; labels keep the legibility
 * counter-rotation so they're never upside-down). It mirrors the live `<Board/>`
 * drawing: the full pinout from `pads`, used pads highlighted, plus the wires.
 */
export function buildExportSvg(args: ExportArgs): string {
  const { rows, def, box, pads, usedPadKeys, ledLit, stageH, rotation } = args
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

  const { counter } = labelCounterRotation(rotation)
  const lt = (ax: number, ay: number): string =>
    counter === 0 ? '' : ` transform="rotate(${counter} ${ax} ${ay})"`

  // Faint bus links + the main wires + node-side dots.
  const buses = rows
    .flatMap((r) =>
      r.extraPads.map(
        (p) =>
          `<path d="${noodlePath(NODE_DOT_X, r.y, p)}" stroke="${r.color}" stroke-width="1.4" stroke-dasharray="3 4" fill="none" opacity="0.5"/>`
      )
    )
    .join('')
  const wires = rows
    .map(
      (r) =>
        `<path d="${noodlePath(NODE_DOT_X, r.y, r.pad)}" stroke="${r.color}" stroke-width="2.6" fill="none"/>`
    )
    .join('')
  const dots = rows
    .map((r) => `<circle cx="${NODE_DOT_X}" cy="${r.y}" r="4.5" fill="${r.color}"/>`)
    .join('')

  // Board pieces (mirrors <Board/> but as a string): PCB, USB, features, LED,
  // then EVERY pad of the physical pinout at its real edge position.
  const cx = box.x + box.w / 2
  const led = ledPoint(box)
  const featureSvg =
    def.features && def.features.length > 0
      ? def.features
          .map((f) => {
            const fx = box.x + f.x * box.w
            const fy = box.y + f.y * box.h
            const fw = f.w * box.w
            const fh = f.h * box.h
            const s = FEATURE_STYLE[f.kind] ?? FEATURE_STYLE.chip
            return (
              `<rect x="${fx}" y="${fy}" width="${fw}" height="${fh}" rx="4" fill="${s.fill}" stroke="${s.stroke}" stroke-width="1.2"/>` +
              `<text x="${fx + fw / 2}" y="${fy + fh / 2 + 4}" text-anchor="middle" font-family="monospace" font-size="9" fill="${s.text}"${lt(fx + fw / 2, fy + fh / 2 + 4)}>${esc(f.label)}</text>`
            )
          })
          .join('')
      : `<rect x="${cx - 58}" y="${box.y + box.h / 2 - 58}" width="116" height="116" rx="7" fill="#1c1d20" stroke="#0c0d0f" stroke-width="1"/>` +
        `<text x="${cx}" y="${box.y + box.h / 2 + 4}" text-anchor="middle" font-family="monospace" font-size="13" font-weight="700" fill="#cfd3d8"${lt(cx, box.y + box.h / 2 + 4)}>${esc(def.mcu)}</text>`
  const ledSvg = def.ledLabel
    ? (ledLit ? `<circle cx="${led.x}" cy="${led.y}" r="11" fill="#46e06a" opacity="0.3"/>` : '') +
      `<circle cx="${led.x}" cy="${led.y}" r="6.5" fill="${ledLit ? '#46e06a' : '#e23b2b'}" stroke="rgba(0,0,0,0.5)" stroke-width="1"/>` +
      `<text x="${led.x}" y="${led.y + 19}" text-anchor="middle" font-family="monospace" font-size="12" fill="#cfe8d4"${lt(led.x, led.y + 19)}>${esc(def.ledLabel)}</text>`
    : ''
  const padSvg = pads
    .map((p) => {
      const isGpio = (p.pad.type ?? 'gpio') === 'gpio'
      const used = isGpio && usedPadKeys.has(padKey(p))
      const vertical = p.edge === 'left' || p.edge === 'right'
      const px = p.edge === 'left' ? p.x + 14 : p.edge === 'right' ? p.x - 14 : p.x
      const py = vertical ? p.y + 4 : p.edge === 'top' ? p.y - 12 : p.y + 18
      const anchor = p.edge === 'left' ? 'start' : p.edge === 'right' ? 'end' : 'middle'
      const stroke = used ? '#fff' : isGpio ? '#9a7a1e' : 'rgba(0,0,0,0.5)'
      return (
        `<g opacity="${used || !isGpio ? 1 : 0.82}">` +
        `<circle cx="${p.x}" cy="${p.y}" r="${PAD_R}" fill="${esc(padFill(p.pad.type))}" stroke="${stroke}" stroke-width="${used ? 2.4 : 0.8}"/>` +
        (isGpio ? `<circle cx="${p.x}" cy="${p.y}" r="2.6" fill="#5a4a1a"/>` : '') +
        `<text x="${px}" y="${py}" text-anchor="${anchor}" font-family="monospace" font-size="12" fill="${used ? '#fff' : '#cfe8d4'}"${lt(px, py)}>${esc(p.pad.label)}</text>` +
        `</g>`
      )
    })
    .join('')
  const board = [
    `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="18" fill="url(#bg-pcb)" stroke="#0c3a23" stroke-width="1.5"/>`,
    `<rect x="${box.x + 10}" y="${box.y + 10}" width="${box.w - 20}" height="${box.h - 20}" rx="12" fill="none" stroke="rgba(255,255,255,.32)" stroke-width="1" stroke-dasharray="2 5"/>`,
    `<rect x="${cx - 28}" y="${box.y - 16}" width="56" height="24" rx="4" fill="url(#bg-silver)" stroke="#6c727b" stroke-width="1"/>`,
    featureSvg,
    ledSvg,
    padSvg
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
    `<g>${board}</g>` +
    `<g fill="none" stroke-linecap="round">${buses}</g>` +
    `<g fill="none" stroke-linecap="round" opacity="0.92">${wires}</g>` +
    `<g>${dots}</g>` +
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
async function exportView(fmt: ExportFmt, args: ExportArgs): Promise<void> {
  const { stageH, rotation } = args
  const svg = buildExportSvg(args)
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
