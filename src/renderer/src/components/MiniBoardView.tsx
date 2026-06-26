import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { parsePins, PIN_TYPE_COLOR, PIN_TYPE_TAG } from './parse-pins'
import {
  BUILTIN_BOARDS,
  DEFAULT_BOARD_ID,
  boardIdFromReplText,
  mergeBoards,
  type BoardDefinition
} from './board-defs'
import {
  boardBox,
  layoutPads,
  ledPoint,
  padForToken,
  padKey,
  padLabelPlacement,
  type PadPoint
} from './board-layout'
import { useConsole } from '../store/console'
import './MiniBoardView.css'

/** Shared with BoardView/BoardGraph so the full viewer adopts the same board. */
const STORAGE_KEY = 'snakie.board.id'
/** Virtual canvas the board is laid out within; the SVG viewBox crops to fit. */
const VW = 520
const VH = 320
const PAD_R = 6

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

/** The coloured node label for a used pin: `[role] variable · TAG`. */
function annotation(u: UsedPad): string {
  const base = [u.role, u.variable].filter(Boolean).join(' ')
  return u.tag ? (base ? `${base} · ${u.tag}` : u.tag) : base
}

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
  const [userBoards, setUserBoards] = useState<BoardDefinition[]>([])
  const [boardId, setBoardId] = useState<string>(() => {
    try {
      return window.localStorage.getItem(STORAGE_KEY) ?? DEFAULT_BOARD_ID
    } catch {
      return DEFAULT_BOARD_ID
    }
  })

  // Load user-authored boards so a custom selection resolves (best-effort).
  useEffect(() => {
    let alive = true
    window.api.board
      .listUserBoards()
      .then((b) => {
        if (alive) setUserBoards(b ?? [])
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const boards = useMemo(() => mergeBoards(userBoards), [userBoards])

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

  const box = useMemo(
    () => boardBox(def.aspect, { cx: VW / 2, cy: VH / 2, maxW: VW - 150, maxH: VH - 80 }),
    [def.aspect]
  )
  const pads = useMemo<PadPoint[]>(() => layoutPads(def, box), [def, box])

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

  // Frame the WHOLE board (so every idle hole stays visible) plus the used pins'
  // node labels (so nothing clips).
  const viewBox = useMemo(() => {
    let minX = box.x
    let minY = box.y
    let maxX = box.x + box.w
    let maxY = box.y + box.h
    for (const u of usedList) {
      const place = padLabelPlacement(u.p.edge)
      const lx = u.p.x + place.dx
      const ly = u.p.y + place.dy
      const w = (u.p.pad.label.length + 1 + annotation(u).length) * 6
      const x0 = place.anchor === 'end' ? lx - w : place.anchor === 'middle' ? lx - w / 2 : lx
      const x1 = place.anchor === 'end' ? lx : place.anchor === 'middle' ? lx + w / 2 : lx + w
      minX = Math.min(minX, x0)
      maxX = Math.max(maxX, x1)
      minY = Math.min(minY, ly - 9)
      maxY = Math.max(maxY, ly + 5)
    }
    const m = 12
    return `${minX - m} ${minY - m} ${maxX - minX + m * 2} ${maxY - minY + m * 2}`
  }, [box, usedList])

  const led = ledPoint(box)
  const gradId = `mini-pcb-${def.id}`

  return (
    <section className="mini-board" aria-label="Board pins in use">
      <div className="mini-board__head">
        <span className="mini-board__name" title={`${def.name} · ${def.mcu}`}>
          {def.name}
        </span>
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
      <svg className="mini-board__svg" viewBox={viewBox} role="img" aria-label={`${def.name} with ${usedList.length} pins in use`}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={def.pcbColor || '#1f7a44'} />
            <stop offset="1" stopColor="#13592f" />
          </linearGradient>
        </defs>

        {/* PCB + dashed silkscreen inset. */}
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

        {/* A central MCU block so the board reads as "the microcontroller". */}
        <rect x={box.x + box.w / 2 - 34} y={box.y + box.h / 2 - 22} width="68" height="44" rx="5" fill="#15171b" stroke="#2a2d33" strokeWidth="1" />
        <text x={box.x + box.w / 2} y={box.y + box.h / 2 + 4} textAnchor="middle" className="mini-board__mcu">
          {def.mcu}
        </text>

        {/* Onboard-LED dot when a connection taps it. */}
        {ledLit && <circle cx={led.x} cy={led.y} r="5" fill="#46e06a" stroke="rgba(0,0,0,.5)" strokeWidth="1" />}

        {/* EVERY pad: idle ones are a dim hole (no label), used ones get a coloured
            node label showing the variable + pin type — like the main board view. */}
        {pads.map((p, i) => {
          const u = usedByKey.get(padKey(p))
          if (!u) {
            return <circle key={`p${i}`} cx={p.x} cy={p.y} r={2.6} className="mini-board__hole" />
          }
          const place = padLabelPlacement(u.p.edge)
          const lx = u.p.x + place.dx
          const ly = u.p.y + place.dy
          const annot = annotation(u)
          return (
            <g key={`p${i}`}>
              {/* short "noodle" stub from the pad to its node label */}
              <line x1={u.p.x} y1={u.p.y} x2={lx} y2={ly - 3} stroke={u.color} strokeWidth="1.2" opacity="0.65" />
              <circle cx={u.p.x} cy={u.p.y} r={PAD_R} fill={u.color} stroke="#fff" strokeWidth="1.8" />
              <text x={lx} y={ly} textAnchor={place.anchor}>
                <tspan className="mini-board__label">
                  {u.p.pad.label}
                  {annot ? ' ' : ''}
                </tspan>
                {annot && (
                  <tspan className="mini-board__var" fill={u.color}>
                    {annot}
                  </tspan>
                )}
              </text>
            </g>
          )
        })}
      </svg>
      {usedList.length === 0 && (
        <p className="mini-board__hint">{isPython ? 'No pins used in this file yet.' : 'Open a MicroPython (.py) file to see its pins.'}</p>
      )}
    </section>
  )
}
