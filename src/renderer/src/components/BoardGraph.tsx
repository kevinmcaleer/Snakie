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
  type BoardDefinition,
  type BoardFeature,
  type BoardPadType
} from './board-defs'
import { boardPartFor, placedPartsNeedingDrivers, resolveBoards } from './part-editor.util'
import { DriverInstallBanner } from './DriverInstallBanner'
import {
  authoredPads,
  boardBox,
  busLabel,
  ledPoint,
  nodeSide,
  padForToken,
  padKey,
  padLabelPlacement,
  padsBounds,
  type BoardBox,
  type PadPoint
} from './board-layout'
import { PartBody, partBodyBox } from './part-body'
import {
  fitTransform,
  labelCounterRotation,
  oneToOneTransform,
  rotateCW,
  zoomAround,
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
import { WiringCanvas, BOARD_BODY_W, BOARD_BODY_H, type WiringRenderMode } from './WiringCanvas'
import { PartsPanel } from './PartsPanel'
import { PartHelpDrawer, type PartHelpItem } from './PartHelpDrawer'
import type { RobotDefinition } from '../../../shared/robot'
import type { PartDefinition, PartLibraryWithParts } from '../../../preload/index.d'
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
  /** Enter the Board Creator. When set, the gold edit knob is shown. */
  onEnterCreator?: () => void
  /** Open the user's boards folder (wired in the floating window). */
  onOpenBoardsFolder?: () => void
  // --- Wiring + Parts (merged into this view, #139/#140). When `robot` +
  // `onChangeRobot` are provided, the Life-like / Schematic view tabs and the
  // right-side library dock appear; otherwise this is a graph-only board view.
  /** The project's robot definition (placed parts + pin wiring). */
  robot?: RobotDefinition
  /** Persist a changed robot definition (writes robot.yml). */
  onChangeRobot?: (next: RobotDefinition) => void
  /** Installed part libraries (to resolve placed parts' pins). */
  libraries?: PartLibraryWithParts[]
  /** Append a library part to the project. When set, the library dock shows. `pos`
   *  (a wiring-canvas world position for the body's top-left) is set when the part
   *  is dragged onto the canvas (#159); omitted for a click-add (auto-layout). */
  onAddToProject?: (libraryId: string, part: PartDefinition, pos?: { x: number; y: number }) => void
}

/** localStorage key shared with {@link BoardView} so board choice persists across both. */
const STORAGE_KEY = 'snakie.board.id'
/** localStorage key remembering the last-used view tab (graph / lifelike / schematic). */
const VIEW_KEY = 'snakie.board.view'

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
const SAG = 26 // downward bezier sag for the drooping noodle

// The board drawing region (to the right of the node column). The physical
// board is fitted inside it from its aspect, with margins for the edge labels.
// Shorter wires (#109): the board sits CLOSE to the node column so each used
// pin's label lands near the board pin, not at the end of a long cable. We keep
// a small left gutter for the left-edge silk labels (now drawn outside, to the
// left of the board) + the wire's gentle droop.
const BOARD_REGION_X = 360 // left of the board area (after the node dots)
const BOARD_REGION_W = 470 // width of the board area
const BOARD_MAX_W = 320 // largest board footprint (keeps room for labels)
const BOARD_MAX_H = 460 // largest board footprint
const BOARD_REGION_CX = BOARD_REGION_X + BOARD_REGION_W / 2 // board centre X
const CANVAS_W = BOARD_REGION_X + BOARD_REGION_W + 90 // canvas / SVG width (920)
const PAD_R = 7 // drawn pad radius
const STAGE_PAD = 48 // vertical breathing room above/below the content

// Right column (#148): connections whose pad sits on the board's RIGHT/BOTTOM
// edge dock to the RIGHT of the board, MIRRORED — the solder dot sits on the
// card's LEFT edge (toward the board) and the wire leaves leftward. Cards extend
// rightward from RIGHT_NODE_LEFT. The canvas only widens to RIGHT_CANVAS_W when
// such a row exists, so the common all-left layout stays byte-for-byte CANVAS_W.
const RIGHT_DOT_X = BOARD_REGION_X + BOARD_REGION_W + 4 // right card's left-edge dot (just past the board area)
const RIGHT_NODE_LEFT = RIGHT_DOT_X + 12 // right card left inset (extends rightward)
const RIGHT_CANVAS_W = RIGHT_NODE_LEFT + NODE_W + 36 // canvas width WHEN right rows exist

/** Centre Y of node row `i`. */
function rowY(i: number): number {
  return FIRST_Y + i * PITCH
}

/**
 * The silver USB-connector nub, placed at the board's REAL connector edge (#109).
 * If the board declares a `usb` feature we centre the nub on it and dock it just
 * outside the nearer short edge (top when the feature sits in the upper half,
 * bottom otherwise — so the ESP32's bottom USB renders correctly). With no `usb`
 * feature we default to the top-centre (the Pico-family convention).
 */
function usbNub(def: BoardDefinition, box: BoardBox): { x: number; y: number; w: number; h: number } {
  const usb = def.features?.find((f) => f.kind === 'usb')
  const w = 56
  const h = 24
  if (usb) {
    const x = box.x + (usb.x + usb.w / 2) * box.w - w / 2
    const bottom = usb.y + usb.h / 2 > 0.5
    const y = bottom ? box.y + box.h - 8 : box.y - 16
    return { x, y, w, h }
  }
  return { x: box.x + box.w / 2 - w / 2, y: box.y - 16, w, h }
}

/** One drawable connection row: its node card + the pad its first pin taps. */
interface GraphRow {
  conn: UsedPins
  /** Source index (for live-value merge). */
  index: number
  /** Which column the card docks in — `right` mirrors toward the board (#148). */
  side: 'left' | 'right'
  /** Node row centre Y (per-column slot). */
  y: number
  color: string
  /** The resolved real pad coordinate for the connection's FIRST pin. */
  pad: PadPoint
  /** Faint extra pads for the rest of a multi-pin bus (drawn as thin links). */
  extraPads: PadPoint[]
}

// --- Instruments (#101 / #102) ----------------------------------------------
// The Oscilloscope + Multimeter are NO LONGER hosted in this (board-view) window.
// They live in the MAIN editor window now (see InstrumentHost.tsx). The PWM/ADC
// node launchers below fire a cross-window `window.api.instruments.open(...)`
// request, which the main process relays to the main window. The board view
// keeps ONLY its own #97 LIVE node readouts (the per-node value placeholders +
// the LIVE LED), which are unrelated to instrument hosting.

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
  onEnterCreator,
  onOpenBoardsFolder,
  robot,
  onChangeRobot,
  libraries,
  onAddToProject
}: BoardGraphProps): JSX.Element {
  // Boards are sourced from the installed parts libraries (microcontroller parts)
  // plus any Board-Creator boards; the built-ins are only a fresh-install fallback.
  const boards = useMemo(() => resolveBoards(libraries ?? [], userBoards), [libraries, userBoards])

  // The view representation (#139/#140): the node-graph (parsed pin usage), or
  // the Life-like / Schematic wiring canvas. Wiring is only available when the
  // host supplies a robot definition + a persist callback (the board window).
  const wiringEnabled = !!(robot && onChangeRobot)
  // Default to the life-like Breadboard view so the full Board View matches the
  // main window's mini board preview (both draw the authored part body); the
  // node-graph + schematic are one tab away. The last-used tab is remembered.
  const [viewType, setViewType] = useState<'graph' | WiringRenderMode>(() => {
    try {
      const saved = window.localStorage.getItem(VIEW_KEY)
      if (saved === 'graph' || saved === 'lifelike' || saved === 'schematic') return saved
    } catch {
      // Ignore storage read failures (disabled / quota).
    }
    return 'lifelike'
  })
  const selectView = useCallback((v: 'graph' | WiringRenderMode): void => {
    setViewType(v)
    try {
      window.localStorage.setItem(VIEW_KEY, v)
    } catch {
      // Ignore storage write failures (disabled / quota).
    }
  }, [])
  const [dockOpen, setDockOpen] = useState(true)
  // If wiring gets disabled (e.g. props change), never strand a wiring view.
  const effectiveView = wiringEnabled ? viewType : 'graph'

  // Board selection. Seed from the project's authored board (robot.yml) when it
  // has one — so persisted `board.<pin>#<index>` wires resolve against the SAME
  // board they were wired on — else the shared BoardView pick / default.
  const [boardId, setBoardId] = useState<string>(() => {
    try {
      return robot?.board ?? window.localStorage.getItem(STORAGE_KEY) ?? DEFAULT_BOARD_ID
    } catch {
      return robot?.board ?? DEFAULT_BOARD_ID
    }
  })
  // robot.yml loads asynchronously (board-main starts from a blank robot), so
  // adopt its board when it arrives/changes. This makes robot.board the source of
  // truth for the wiring views; an explicit picker change still wins (it sets
  // boardId AND robot.board together, so this no-ops). Guarded to a known board.
  useEffect(() => {
    if (robot?.board && robot.board !== boardId && boards.some((b) => b.id === robot.board)) {
      setBoardId(robot.board)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [robot?.board, boards])
  const def = boards.find((b) => b.id === boardId) ?? boards[0] ?? BUILTIN_BOARDS[0]
  // The source part behind the selected board (if any) — so the Breadboard view
  // draws it life-like (image + x/y pins) rather than the edge-laid fallback.
  const boardPart = useMemo(() => boardPartFor(libraries ?? [], def.id), [libraries, def.id])

  // Placed parts that declare MicroPython drivers needing install (#184). Drives
  // the consent-first install banner; empty (so hidden) without a robot/parts.
  const driverNeeds = useMemo(
    () => placedPartsNeedingDrivers(robot, libraries ?? []),
    [robot, libraries]
  )

  // Bundled mini-help for the placed items (the MCU + each unique placed part that
  // ships a help.md), stacked in the Board View help drawer (offline). Deduped so
  // two of the same part show one card; the board's own help leads.
  const helpItems = useMemo<PartHelpItem[]>(() => {
    const out: PartHelpItem[] = []
    const seen = new Set<string>()
    const boardHelp = (boardPart?.helpText ?? '').trim()
    if (boardHelp) {
      out.push({ key: `board:${boardPart!.id}`, name: boardPart!.name || def.name, helpText: boardPart!.helpText! })
      seen.add(`board:${boardPart!.id}`)
    }
    for (const rp of robot?.parts ?? []) {
      const k = `${rp.lib}:${rp.part}`
      if (seen.has(k)) continue
      const pdef = (libraries ?? []).find((l) => l.id === rp.lib)?.parts.find((p) => p.id === rp.part)
      const help = (pdef?.helpText ?? '').trim()
      if (!help) continue
      seen.add(k)
      out.push({ key: k, name: pdef?.name || rp.label || rp.part, helpText: pdef!.helpText! })
    }
    return out
  }, [boardPart, robot?.parts, libraries, def.name])

  // The Board View HELP drawer + the "help available" notification. Adding a part
  // that ships help pops the toast (auto-dismissed); the header Help button + the
  // toast both open the drawer.
  const [helpOpen, setHelpOpen] = useState(false)
  const [helpToast, setHelpToast] = useState<{ name: string } | null>(null)
  useEffect(() => {
    if (!helpToast) return
    const t = window.setTimeout(() => setHelpToast(null), 7000)
    return () => window.clearTimeout(t)
  }, [helpToast])
  const handleAddToProject = useCallback(
    (libraryId: string, part: PartDefinition, pos?: { x: number; y: number }): void => {
      onAddToProject?.(libraryId, part, pos)
      if ((part.helpText ?? '').trim()) setHelpToast({ name: part.name })
    },
    [onAddToProject]
  )

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
    // Tell the other window(s) so the main window's mini board view follows along.
    window.api.board.selectBoard(id)
    // In a wiring-enabled window, record the chosen board in robot.yml too, so the
    // selection takes effect immediately (not only as a side-effect of a later
    // wire edit) and the picker, drawn board and file never diverge.
    if (wiringEnabled && robot && onChangeRobot && robot.board !== id) {
      onChangeRobot({ ...robot, board: id })
    }
  }

  // Re-parse on every source change → live update.
  const conns = useMemo(() => (isPython ? parsePins(source) : []), [source, isPython])

  // Live device values (#97): OFF by default (the LIVE header LED doubles as the
  // on/off toggle). When ON + connected we poll the board; OFF never touches it.
  const [liveOn, setLiveOn] = useState(false)
  const { values: liveValues, connected: liveConnected } = useLiveValues(conns, liveOn)

  // Open an instrument in the MAIN window (cross-window relay). The scope/meter
  // are hosted there now; the board view only LAUNCHES them. We already have the
  // FULL parsed connection in scope (`conn`), so we send it verbatim — the main
  // window renders the instrument straight from it and does NOT re-resolve
  // against its own active file (which may not be the file that declares the
  // pin). This is what makes the scope/meter actually appear in the dock.
  const openInstrument = useCallback(
    (kind: 'scope' | 'meter', conn: UsedPins): void => {
      window.api.instruments.open({ kind, conn })
    },
    []
  )

  // The node column extent: one card per connection, 46px pitch.
  const nodeBottom = conns.length > 0 ? rowY(conns.length - 1) + NODE_H / 2 : FIRST_Y
  const nodeMidY = (FIRST_Y + nodeBottom) / 2

  // The PHYSICAL board: fit the outline from the board's aspect and lay out EVERY
  // pad at its REAL position — the authored part body's pin x/y when the board is
  // an authored Microcontroller part (so the node-graph matches the Part Editor /
  // mini view), else evenly along each header's edge. Reactive to `def`, so
  // switching board in the picker redraws the whole pinout.
  const box = useMemo<BoardBox>(() => {
    // Centre the board vertically on the node column so the wires read.
    const cy = Math.max(FIRST_Y + BOARD_MAX_H / 2 - 10, nodeMidY)
    if (boardPart) {
      // Size the authored body's box EXACTLY like the breadboard view
      // (`partBodyBox` with the SAME footprint constants), then position it in the
      // board region. PartBody draws pads at a fixed pixel size, so matching the
      // box is what makes the castellations identical across the two views.
      const nb = partBodyBox(boardPart, { maxW: BOARD_BODY_W, maxH: BOARD_BODY_H })
      return { x: BOARD_REGION_CX - nb.w / 2, y: cy - nb.h / 2, w: nb.w, h: nb.h }
    }
    return boardBox(def.aspect, { cx: BOARD_REGION_CX, cy, maxW: BOARD_MAX_W, maxH: BOARD_MAX_H })
  }, [def.aspect, boardPart, nodeMidY])
  const pads = useMemo<PadPoint[]>(() => authoredPads(def, box), [def, box])

  // One row per connection: its node card + its FIRST pin's REAL pad coordinate
  // (which may be on any edge). A bus's remaining pins become faint extra pads.
  const rows = useMemo<GraphRow[]>(() => {
    // Each column stacks independently from FIRST_Y; a connection docks right
    // when its first pin's pad is on the board's right/bottom edge (#148).
    let leftN = 0
    let rightN = 0
    return conns.map((conn, i) => {
      const pad = padForToken(conn.pins[0] ?? '', def, pads, box)
      const extraPads = conn.pins.slice(1).map((tok) => padForToken(tok, def, pads, box))
      const side = nodeSide(pad.edge)
      const slot = side === 'left' ? leftN++ : rightN++
      return {
        conn,
        index: i,
        side,
        y: rowY(slot),
        color: PIN_TYPE_COLOR[conn.type],
        pad,
        extraPads
      }
    })
  }, [conns, def, pads, box])

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

  // Combine view (#139/#140): which board pads the parsed code uses, keyed by the
  // canonical pad INDEX (== layoutPads order == the wiring endpoint index), with a
  // colour + a short label (the variable name) — the wiring canvas overlays these.
  const usedByCode = useMemo<Map<number, { color: string; label: string }>>(() => {
    const m = new Map<number, { color: string; label: string }>()
    const mark = (pad: PadPoint, r: GraphRow): void => {
      const idx = pads.indexOf(pad)
      if (idx >= 0 && !m.has(idx)) m.set(idx, { color: r.color, label: r.conn.variable || PIN_TYPE_TAG[r.conn.type] })
    }
    for (const r of rows) {
      mark(r.pad, r)
      for (const ep of r.extraPads) mark(ep, r)
    }
    return m
  }, [rows, pads])

  // Same usage, shaped for PartBody's `pinVariables` (keyed by pad/flat index), so
  // the authored body highlights the code variable on each used pin — exactly like
  // the mini board view.
  const pinVars = useMemo<Map<number, { variable: string; color: string }>>(() => {
    const m = new Map<number, { variable: string; color: string }>()
    for (const [idx, v] of usedByCode) m.set(idx, { variable: v.label, color: v.color })
    return m
  }, [usedByCode])

  // Stage extent spans BOTH the node column and the physical board (with its
  // edge labels + USB nub), so zoom-to-fit always frames the whole drawing.
  // Derived from geometry, NOT the connection count — so large N grows the node
  // column and the board stays put, and an empty board still has a sane size.
  // The node column now splits into two; the TALLER column drives the extent so
  // nothing clips (for the all-left case this equals the old single-column
  // height, keeping that layout identical). #148.
  const leftCount = rows.reduce((n, r) => (r.side === 'left' ? n + 1 : n), 0)
  const rightCount = rows.length - leftCount
  const colCount = Math.max(leftCount, rightCount)
  const colBottom = colCount > 0 ? rowY(colCount - 1) + NODE_H / 2 : FIRST_Y
  const contentTop = Math.min(FIRST_Y - NODE_H / 2, box.y - 24)
  const contentBottom = Math.max(colBottom, box.y + box.h + 28)
  const stageH = Math.max(680, contentBottom - Math.min(0, contentTop) + STAGE_PAD)
  // Widen the canvas only when a right column exists; otherwise stay at CANVAS_W.
  const stageW = rightCount > 0 ? RIGHT_CANVAS_W : CANVAS_W

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
    setView(fitTransform(stageW, stageH, vp.w, vp.h, rotation))
    setIsOneToOne(false)
  }, [hasRows, vp.w, vp.h, stageW, stageH, rotation, def.id])

  // −/+ buttons zoom about the horizontal centre while keeping the current top in
  // view (anchor Y = the stage's current top), so the board stays centred and its
  // top stays on screen instead of the view ballooning out of the top-left corner.
  const onZoomIn = useCallback((): void => {
    touchedRef.current = true
    setView((v) => zoomAround(v, zoomInTransform(v.zoom), vp.w > 0 ? vp.w / 2 : v.panX, v.panY))
    setIsOneToOne(false)
  }, [vp.w])

  const onZoomOut = useCallback((): void => {
    touchedRef.current = true
    setView((v) => zoomAround(v, zoomOutTransform(v.zoom), vp.w > 0 ? vp.w / 2 : v.panX, v.panY))
    setIsOneToOne(false)
  }, [vp.w])

  const onFit = useCallback((): void => {
    touchedRef.current = true
    if (vp.w === 0 || vp.h === 0) return
    setView(fitTransform(stageW, stageH, vp.w, vp.h, rotation))
    setIsOneToOne(false)
  }, [vp.w, vp.h, stageW, stageH, rotation])

  // 100% button: toggles between a centred 1:1 view and zoom-to-fit.
  const onToggleOneToOne = useCallback((): void => {
    touchedRef.current = true
    if (vp.w === 0 || vp.h === 0) return
    if (isOneToOne) {
      setView(fitTransform(stageW, stageH, vp.w, vp.h, rotation))
      setIsOneToOne(false)
    } else {
      setView(oneToOneTransform(stageW, stageH, vp.w, vp.h, rotation))
      setIsOneToOne(true)
    }
  }, [isOneToOne, vp.w, vp.h, stageW, stageH, rotation])

  const onRotate = useCallback((): void => {
    touchedRef.current = true
    const next = rotateCW(rotation)
    setRotation(next)
    // Re-fit for the new rotation so the rotated board stays fully framed.
    if (vp.w !== 0 && vp.h !== 0) {
      setView(fitTransform(stageW, stageH, vp.w, vp.h, next))
      setIsOneToOne(false)
    }
  }, [rotation, vp.w, vp.h, stageW, stageH])

  // Wheel-zoom (inside the fixed viewport) — anchored at the cursor so the spot
  // under the pointer stays put (the natural "zoom where you point").
  const onWheel = useCallback((e: React.WheelEvent): void => {
    touchedRef.current = true
    const rect = canvasRef.current?.getBoundingClientRect()
    const ax = rect ? e.clientX - rect.left : vp.w / 2
    const ay = rect ? e.clientY - rect.top : vp.h / 2
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
    setView((v) => zoomAround(v, v.zoom * factor, ax, ay))
    setIsOneToOne(false)
  }, [vp.w, vp.h])

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
    void exportView(exportFmt, { rows, def, box, pads, usedPadKeys, ledLit, stageW, stageH, rotation })
  }, [exportFmt, rows, def, box, pads, usedPadKeys, ledLit, stageW, stageH, rotation])

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

        {wiringEnabled && (
          <div className="boardgraph__viewtabs" role="tablist" aria-label="Board view type">
            {(
              [
                ['graph', 'Node graph'],
                ['lifelike', 'Breadboard'],
                ['schematic', 'Schematic']
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={effectiveView === id}
                className={`boardgraph__viewtab ${effectiveView === id ? 'is-active' : ''}`}
                onClick={() => selectView(id)}
              >
                {label}
              </button>
            ))}
          </div>
        )}

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
              is connected (green, pulsing), amber while connecting/unreadable.
              Only the node-graph shows per-pin values, so LIVE hides elsewhere. */}
          {effectiveView === 'graph' && (
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
          )}
          {wiringEnabled && effectiveView !== 'graph' && (
            <button
              type="button"
              className={`boardgraph__help-btn${helpOpen ? ' is-active' : ''}`}
              onClick={() => setHelpOpen((o) => !o)}
              aria-pressed={helpOpen}
              title="Show bundled help for the placed parts"
            >
              Help
              {helpItems.length > 0 && <span className="boardgraph__help-count">{helpItems.length}</span>}
            </button>
          )}
          {onEnterCreator && (
            <button
              type="button"
              className="boardgraph__knob"
              onClick={onEnterCreator}
              title="New board (opens the Part Editor)"
              aria-label="Create a new board in the Part Editor"
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
          {/* Close is handled by the native window chrome now (#185); Esc also
              closes via board-main's key handler. */}
        </div>
      </header>

      {wiringEnabled && <DriverInstallBanner needs={driverNeeds} />}

      <div className="boardgraph__body">
      {effectiveView !== 'graph' ? (
        <>
          <div className="boardgraph__wiring">
            <WiringCanvas
              boardDef={def}
              boardPart={boardPart}
              renderMode={effectiveView}
              robot={robot as RobotDefinition}
              onChange={onChangeRobot as (next: RobotDefinition) => void}
              libraries={libraries ?? []}
              usedByCode={usedByCode}
              onDropPart={onAddToProject ? handleAddToProject : undefined}
            />
          </div>
          {onAddToProject &&
            (dockOpen ? (
              <aside className="boardgraph__dock" aria-label="Parts library">
                <div className="boardgraph__dock-head">
                  <span>Library</span>
                  <button
                    type="button"
                    className="boardgraph__dock-toggle"
                    onClick={() => setDockOpen(false)}
                    title="Hide the library panel"
                    aria-label="Hide the library panel"
                  >
                    ›
                  </button>
                </div>
                <div className="boardgraph__dock-body">
                  <PartsPanel onAddToProject={handleAddToProject} />
                </div>
              </aside>
            ) : (
              <button
                type="button"
                className="boardgraph__dock-tab"
                onClick={() => setDockOpen(true)}
                title="Show the library panel"
                aria-label="Show the library panel"
              >
                Library
              </button>
            ))}
        </>
      ) : (
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
                width: stageW,
                height: stageH,
                transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom}) rotate(${rotation}deg)`,
                transformOrigin: '0 0'
              }}
            >
              <svg
                className="boardgraph__svg"
                xmlns="http://www.w3.org/2000/svg"
                width={stageW}
                height={stageH}
                viewBox={`0 0 ${stageW} ${stageH}`}
                role="img"
                aria-label={`${def.name}: ${rows.length} pin connection${
                  rows.length === 1 ? '' : 's'
                }`}
              >
                <BoardDefs def={def} />

                {/* The physical board (full pinout) UNDER the wires + dots so the
                    coloured noodles read on top of it. When the board is an
                    authored Microcontroller part, draw its REAL life-like body
                    (image + shapes + pins) — identical to the mini board view and
                    the Part Editor — so the node-graph no longer shows a stylised
                    pinout. The noodles target `pads` (the authored pin x/y), which
                    coincide with PartBody's pin centres. Built-in boards with no
                    authored body fall back to the stylised <Board>. */}
                {boardPart ? (
                  <PartBody
                    part={boardPart}
                    box={box}
                    boxedPins
                    pinVariables={pinVars}
                    rotation={rotation}
                  />
                ) : (
                  <Board
                    def={def}
                    box={box}
                    pads={pads}
                    usedPadKeys={usedPadKeys}
                    ledLit={ledLit}
                    rotation={rotation}
                  />
                )}

                {/* Bus groups (#147): outline + bus tag + per-pin roles. */}
                <g className="boardgraph__bus">
                  {rows.map((r, i) => (
                    <BusGroup key={`busg-${i}`} row={r} />
                  ))}
                </g>

                {/* Faint bus links (a multi-pin connection's other pins). */}
                <g fill="none" strokeLinecap="round" opacity="0.5">
                  {rows.flatMap((r, i) =>
                    r.extraPads.map((p, j) => (
                      <path
                        key={`bus-${i}-${j}`}
                        d={wirePathFor(r.side, r.y, p)}
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
                      d={wirePathFor(r.side, r.y, r.pad)}
                      stroke={r.color}
                      strokeWidth="2.6"
                    />
                  ))}
                </g>
                {/* Node-side solder dots. */}
                <g>
                  {rows.map((r, i) => (
                    <circle key={`dot-${i}`} cx={dotXFor(r.side)} cy={r.y} r="4.5" fill={r.color} />
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
                    r.conn.type === 'pwm' ? () => openInstrument('scope', r.conn) : undefined
                  }
                  onOpenMeter={
                    r.conn.type === 'adc' ? () => openInstrument('meter', r.conn) : undefined
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
      </div>
      )}
      {/* Board View HELP: a right-side drawer stacking the placed parts' bundled
          mini-help, + a "help available" toast when a part with help is added. */}
      {effectiveView !== 'graph' && helpOpen && (
        <PartHelpDrawer items={helpItems} onClose={() => setHelpOpen(false)} />
      )}
      {effectiveView !== 'graph' && helpToast && (
        <div className="boardgraph__help-toast" role="status">
          <span>
            Help for <strong>{helpToast.name}</strong> is available.
          </span>
          <button
            type="button"
            className="boardgraph__help-toast-btn"
            onClick={() => {
              setHelpOpen(true)
              setHelpToast(null)
            }}
          >
            View help
          </button>
          <button
            type="button"
            className="boardgraph__help-toast-x"
            onClick={() => setHelpToast(null)}
            title="Dismiss"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}
      </div>

      {effectiveView === 'graph' && <PinsInUse conns={conns} fileName={fileName} />}
    </div>
  )
}

// --- SVG drawing ------------------------------------------------------------

/** Stable key for a drawn pad coordinate (matches "used" pads to drawn pads). */
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
  // Control 1 leaves the node horizontally to the right, drooping down. The
  // shorter board gap (#109) means a smaller pull keeps a gentle droop without
  // overshooting the now-nearby board.
  const c1x = sx + Math.max(54, dx * 0.45)
  const c1y = sy + SAG
  // Control 2 approaches the pad along its edge's inward normal.
  let c2x: number
  let c2y: number
  switch (pad.edge) {
    case 'right':
      // Enter from the right of the board, swinging past then back in.
      c2x = pad.x + 64
      c2y = pad.y + SAG
      break
    case 'top':
      c2x = pad.x
      c2y = pad.y - 56
      break
    case 'bottom':
      c2x = pad.x
      c2y = pad.y + 56
      break
    default:
      // left / led: approach horizontally from the left with the droop.
      c2x = pad.x - Math.max(54, dx * 0.45)
      c2y = pad.y + SAG
      break
  }
  return `M${sx} ${sy} C ${c1x} ${c1y} ${c2x} ${c2y} ${pad.x} ${pad.y}`
}

/**
 * Mirror of {@link noodlePath} for a RIGHT-column node (#148): the solder dot
 * `(sx, sy)` sits to the RIGHT of the board, so the wire leaves horizontally to
 * the LEFT and docks into the pad's edge. Right-column cards only target right-
 * or bottom-edge pads.
 */
function noodlePathRight(sx: number, sy: number, pad: PadPoint): string {
  const dx = pad.x - sx // negative: the pad is to the LEFT of the dot
  const c1x = sx + Math.min(-54, dx * 0.45)
  const c1y = sy + SAG
  let c2x: number
  let c2y: number
  switch (pad.edge) {
    case 'bottom':
      c2x = pad.x
      c2y = pad.y + 56
      break
    case 'top':
      c2x = pad.x
      c2y = pad.y - 56
      break
    default:
      // right (and any fallback): approach from just outside the right edge.
      c2x = pad.x + Math.max(54, -dx * 0.45)
      c2y = pad.y + SAG
      break
  }
  return `M${sx} ${sy} C ${c1x} ${c1y} ${c2x} ${c2y} ${pad.x} ${pad.y}`
}

/** The node's solder-dot X (wire start) for its column (#148). */
function dotXFor(side: 'left' | 'right'): number {
  return side === 'right' ? RIGHT_DOT_X : NODE_DOT_X
}

/** The drooping wire from a node's dot to `pad`, routed for the node's column. */
function wirePathFor(side: 'left' | 'right', sy: number, pad: PadPoint): string {
  return side === 'right' ? noodlePathRight(RIGHT_DOT_X, sy, pad) : noodlePath(NODE_DOT_X, sy, pad)
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
export function BoardDefs({ def }: { def: BoardDefinition }): JSX.Element {
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
export function Board({
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

      {/* USB connector nub at the board's REAL connector edge (#109). */}
      {(() => {
        const nub = usbNub(def, box)
        return (
          <rect
            x={nub.x}
            y={nub.y}
            width={nub.w}
            height={nub.h}
            rx="4"
            fill="url(#bg-silver)"
            stroke="#6c727b"
            strokeWidth="1"
          />
        )
      })()}

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
          // Side-correct labels (#109): left labels to the LEFT, right to the
          // RIGHT, top/bottom above/below — see {@link padLabelPlacement}.
          const place = padLabelPlacement(p.edge)
          const lx = p.x + place.dx
          const ly = p.y + place.dy
          const anchor = place.anchor
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

/**
 * Bus group (#147): frame an i2c/spi connection's pads with a dashed rounded
 * rect in the bus colour, tag it with the bus label (I2C0…), and label each pad
 * with its role (SDA/SCL) above the silk label. Nothing for non-bus / single-pad
 * connections. Kept in parity with the SVG export (`busGroupSvg`).
 */
function BusGroup({ row }: { row: GraphRow }): JSX.Element | null {
  const { conn, color } = row
  if (conn.type !== 'i2c' && conn.type !== 'spi') return null
  const groupPads = [row.pad, ...row.extraPads]
  const bounds = padsBounds(groupPads, 12)
  if (!bounds) return null
  const tag = busLabel(conn.type, conn.bus)
  const tagW = 12 + tag.length * 7
  return (
    <g aria-hidden="true">
      <rect
        x={bounds.x}
        y={bounds.y}
        width={bounds.w}
        height={bounds.h}
        rx="9"
        fill={color}
        fillOpacity="0.07"
        stroke={color}
        strokeWidth="1.4"
        strokeDasharray="4 3"
        opacity="0.85"
      />
      <rect x={bounds.x + 6} y={bounds.y - 9} width={tagW} height="16" rx="5" fill={color} />
      <text
        x={bounds.x + 6 + tagW / 2}
        y={bounds.y + 2}
        className="boardgraph__bus-tag"
        textAnchor="middle"
      >
        {tag}
      </text>
      {groupPads.map((p, i) => {
        const role = conn.roles?.[i]
        if (!role) return null
        const place = padLabelPlacement(p.edge)
        return (
          <text
            key={`role-${i}`}
            x={p.x + place.dx}
            y={p.y + place.dy - 9}
            className="boardgraph__bus-role"
            textAnchor={place.anchor}
            style={{ fill: color }}
          >
            {role}
          </text>
        )
      })}
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
  // Right-column cards dock to the RIGHT of the board and mirror their content
  // (dot/wire on their LEFT edge, toward the board) via the `--right` modifier.
  const right = row.side === 'right'
  return (
    <div
      className={`boardgraph__node${right ? ' boardgraph__node--right' : ''}`}
      style={{
        left: right ? RIGHT_NODE_LEFT : NODE_LEFT,
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
          {(conn.type === 'i2c' || conn.type === 'spi') && conn.bus !== undefined ? conn.bus : ''}
        </span>
        <span className="boardgraph__node-var">{conn.variable || conn.constructor}</span>
        {conn.instrument && (
          <span
            className="boardgraph__node-inst"
            title={`Pin used by the ${conn.instrument} instrument`}
          >
            inst
          </span>
        )}
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
              {c.instrument && (
                <span
                  className="boardgraph__pins-inst"
                  title={`Used by the ${c.instrument} instrument library`}
                >
                  {c.instrument} instrument
                </span>
              )}
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
  stageW: number
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
  const { rows, def, box, pads, usedPadKeys, ledLit, stageW, stageH, rotation } = args
  const W = stageW
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
          `<path d="${wirePathFor(r.side, r.y, p)}" stroke="${r.color}" stroke-width="1.4" stroke-dasharray="3 4" fill="none" opacity="0.5"/>`
      )
    )
    .join('')
  const wires = rows
    .map(
      (r) =>
        `<path d="${wirePathFor(r.side, r.y, r.pad)}" stroke="${r.color}" stroke-width="2.6" fill="none"/>`
    )
    .join('')
  const dots = rows
    .map((r) => `<circle cx="${dotXFor(r.side)}" cy="${r.y}" r="4.5" fill="${r.color}"/>`)
    .join('')

  // Bus groups (#147): outline + bus tag + per-pin roles — mirrors <BusGroup/>.
  const busGroups = rows
    .map((r) => {
      if (r.conn.type !== 'i2c' && r.conn.type !== 'spi') return ''
      const groupPads = [r.pad, ...r.extraPads]
      const bounds = padsBounds(groupPads, 12)
      if (!bounds) return ''
      const tag = busLabel(r.conn.type, r.conn.bus)
      const tagW = 12 + tag.length * 7
      const tagX = bounds.x + 6
      const tagCx = tagX + tagW / 2
      const tagTextY = bounds.y + 2
      const roleTexts = groupPads
        .map((p, i) => {
          const role = r.conn.roles?.[i]
          if (!role) return ''
          const place = padLabelPlacement(p.edge)
          const rx = p.x + place.dx
          const ry = p.y + place.dy - 9
          return `<text x="${rx}" y="${ry}" text-anchor="${place.anchor}" font-family="monospace" font-size="8" font-weight="700" fill="${r.color}"${lt(rx, ry)}>${esc(role)}</text>`
        })
        .join('')
      return (
        `<g>` +
        `<rect x="${bounds.x}" y="${bounds.y}" width="${bounds.w}" height="${bounds.h}" rx="9" fill="${r.color}" fill-opacity="0.07" stroke="${r.color}" stroke-width="1.4" stroke-dasharray="4 3" opacity="0.85"/>` +
        `<rect x="${tagX}" y="${bounds.y - 9}" width="${tagW}" height="16" rx="5" fill="${r.color}"/>` +
        `<text x="${tagCx}" y="${tagTextY}" text-anchor="middle" font-family="monospace" font-size="9" font-weight="700" fill="#0c0e10"${lt(tagCx, tagTextY)}>${esc(tag)}</text>` +
        roleTexts +
        `</g>`
      )
    })
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
      // Side-correct labels (#109): see {@link padLabelPlacement}.
      const place = padLabelPlacement(p.edge)
      const px = p.x + place.dx
      const py = p.y + place.dy
      const anchor = place.anchor
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
  const nub = usbNub(def, box)
  const board = [
    `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="18" fill="url(#bg-pcb)" stroke="#0c3a23" stroke-width="1.5"/>`,
    `<rect x="${box.x + 10}" y="${box.y + 10}" width="${box.w - 20}" height="${box.h - 20}" rx="12" fill="none" stroke="rgba(255,255,255,.32)" stroke-width="1" stroke-dasharray="2 5"/>`,
    `<rect x="${nub.x}" y="${nub.y}" width="${nub.w}" height="${nub.h}" rx="4" fill="url(#bg-silver)" stroke="#6c727b" stroke-width="1"/>`,
    featureSvg,
    ledSvg,
    padSvg
  ].join('')

  // Node cards as <foreignObject> HTML so the export matches the live view.
  const nodes = rows
    .map((r) => {
      const c = r.color
      const tag =
        PIN_TYPE_TAG[r.conn.type] +
        ((r.conn.type === 'i2c' || r.conn.type === 'spi') && r.conn.bus !== undefined
          ? String(r.conn.bus)
          : '')
      const label = esc(r.conn.variable || r.conn.constructor)
      const val = r.conn.type === 'input' || r.conn.type === 'output' ? '1' : '—'
      // Right-column cards mirror: row-reversed, value pushed to the OUTER edge,
      // label right-aligned — matching the live `.boardgraph__node--right` (#148).
      const right = r.side === 'right'
      const dir = right ? 'row-reverse' : 'row'
      const valMargin = right ? 'margin-right:auto' : 'margin-left:auto'
      const varAlign = right ? 'text-align:right;' : ''
      const inner =
        `<div style="display:flex;flex-direction:${dir};align-items:center;gap:9px;width:100%;height:100%;box-sizing:border-box;padding:0 12px;transform:rotate(${counter}deg)">` +
        `<span style="font-size:9.5px;font-weight:700;color:#0e2233;border-radius:4px;padding:2px 6px;background:${c}">${esc(tag)}</span>` +
        `<span style="font-size:12.5px;color:#d6dade;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;${varAlign}">${label}</span>` +
        `<span style="${valMargin};display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;color:#6a7079"><span style="width:7px;height:7px;border-radius:50%;background:#3a3f47"></span>${val}</span>` +
        `</div>`
      return (
        `<foreignObject x="${right ? RIGHT_NODE_LEFT : NODE_LEFT}" y="${r.y - NODE_H / 2}" width="${NODE_W}" height="${NODE_H}">` +
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
    `<g>${busGroups}</g>` +
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
  const { stageW, stageH, rotation } = args
  const svg = buildExportSvg(args)
  const swap = rotation === 90 || rotation === 270
  const outW = swap ? stageH : stageW
  const outH = swap ? stageW : stageH
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
