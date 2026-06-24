import { useCallback, useRef, useState, type CSSProperties } from 'react'
import { InstrumentWindow, PhosphorScreen } from './InstrumentWindow'
import { type InstrumentDef } from './instruments-registry'
import { useTelemetryStream } from './instrument-telemetry-subscribe'
import {
  DISPLAY_GEOMETRIES,
  blankGrid,
  buildScreenPayload,
  fpsFromIntervalMs,
  geometryById,
  layoutText,
  readingToView,
  type PixelGrid,
  type ScreenView
} from './display-logic'
import './DisplayInstrument.css'

/**
 * I²C DISPLAY — mirror & output panel (#118)
 * =============================================================================
 *
 * A self-contained dock window for an I²C OLED/LCD module. Two modes, both driven
 * through the existing instrument plumbing (NO shared file touched):
 *
 *  - MIRROR (read): subscribes to the broadcast serial stream via
 *    {@link useTelemetryStream}; a `SNK SCR …` reading (`{kind:'scr'}`) is reduced
 *    by {@link readingToView} into either a decoded pixel grid (framebuffer) or
 *    text rows, rendered live inside a skeuomorphic OLED/LCD bezel.
 *  - PUSH (write): the user types rows (or picks a tiny layout) and pushes them to
 *    the real display via `window.api.device.sendControl('screen', payload)`, the
 *    payload built by {@link buildScreenPayload} in the device `Screen.text`
 *    grammar.
 *
 * Chrome comes from the shared {@link InstrumentWindow} + {@link PhosphorScreen};
 * the accent/border come from the registry def via CSS custom properties, exactly
 * like {@link PlaceholderInstrument}. Same prop shape as the placeholder so the
 * host can swap it in with no wiring change.
 */

export interface DisplayInstrumentProps {
  /** The registry def driving the name, accent and source pill. */
  def: InstrumentDef
  /** Close (hide) this instrument — same close→hide model as the other windows. */
  onClose?: () => void
  /** Whether the window is docked (always true in the dock today). */
  docked?: boolean
}

/** The two panel modes. */
type Mode = 'mirror' | 'push'

/** A reasonable starting OLED address label (the common SSD1306). */
const DEFAULT_ADDR = '0x3C'

export function DisplayInstrument({
  def,
  onClose,
  docked = true
}: DisplayInstrumentProps): JSX.Element {
  const [mode, setMode] = useState<Mode>('mirror')
  const [geoId, setGeoId] = useState<string>(DISPLAY_GEOMETRIES[0].id)
  const geo = geometryById(geoId)

  // The latest mirrored screen + a rolling FPS estimate (time between readings).
  const [view, setView] = useState<ScreenView | null>(null)
  const [fps, setFps] = useState<string>('——')
  const lastTsRef = useRef<number | null>(null)
  // The address last seen on the wire (overrides the configured default label).
  const [liveAddr, setLiveAddr] = useState<string | null>(null)

  // Push-mode editable rows (one line per textarea row).
  const [draft, setDraft] = useState<string>('Hello, Snakie!\nLine 2')
  const [pushState, setPushState] = useState<'' | 'sending' | 'sent' | 'error'>('')

  useTelemetryStream(
    useCallback((r) => {
      if (r.kind !== 'scr') return
      const next = readingToView(r)
      if (!next) return
      const now = Date.now()
      const prev = lastTsRef.current
      lastTsRef.current = now
      if (prev !== null) setFps(fpsFromIntervalMs(now - prev))
      setLiveAddr(r.addr)
      setView(next)
    }, [])
  )

  const onPush = useCallback(async (): Promise<void> => {
    const rows = draft.split('\n')
    const cols = geo.type === 'char' ? geo.cols : undefined
    const payload = buildScreenPayload(rows, { cols })
    setPushState('sending')
    try {
      await window.api.device.sendControl('screen', payload)
      setPushState('sent')
      window.setTimeout(() => setPushState(''), 1400)
    } catch {
      setPushState('error')
      window.setTimeout(() => setPushState(''), 2200)
    }
  }, [draft, geo])

  const addr = liveAddr ?? DEFAULT_ADDR
  const sizeLabel = geo.label.replace(/^(OLED|LCD)\s/, '')

  return (
    <InstrumentWindow
      name={def.name.toUpperCase()}
      source={`${addr} · SDA/SCL`}
      docked={docked}
      onClose={onClose}
    >
      <div
        className="i2cd"
        style={
          {
            '--accent': def.accent,
            '--accent-border': def.border
          } as CSSProperties
        }
      >
        {/* Mode switch: MIRROR (read live) vs PUSH (write to the display). */}
        <div className="i2cd__modes" role="tablist" aria-label="Display mode">
          <ModeTab label="Mirror" active={mode === 'mirror'} onClick={() => setMode('mirror')} />
          <ModeTab label="Push" active={mode === 'push'} onClick={() => setMode('push')} />
          <span className="i2cd__spacer" />
          <label className="i2cd__size">
            <span className="i2cd__size-lbl">SIZE</span>
            <select
              className="i2cd__select"
              value={geoId}
              onChange={(e) => setGeoId(e.target.value)}
              aria-label="Display size"
            >
              {DISPLAY_GEOMETRIES.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* The skeuomorphic module: a green-phosphor bezel rendering the screen. */}
        <PhosphorScreen className="i2cd__screen">
          <ScreenBody mode={mode} geo={geo} view={view} draft={draft} />
        </PhosphorScreen>

        {/* PUSH controls (only in push mode): a small editor + a send key. */}
        {mode === 'push' && (
          <div className="i2cd__push">
            <textarea
              className="i2cd__editor"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
              rows={Math.min(geo.type === 'char' ? (geo.charRows ?? 2) : 4, 4)}
              aria-label="Text to push to the display"
              placeholder="Type display rows…"
            />
            <button
              type="button"
              className={`i2cd__push-key i2cd__push-key--${pushState || 'idle'}`}
              onClick={onPush}
              title="Push these rows to the real display"
            >
              {pushState === 'sending'
                ? 'Pushing…'
                : pushState === 'sent'
                  ? 'Pushed ✓'
                  : pushState === 'error'
                    ? 'Failed'
                    : 'Push →'}
            </button>
          </div>
        )}

        {/* Bottom 3-column readout strip: ADDR / SIZE / FPS. */}
        <div className="i2cd__readout">
          <Cell label="ADDR" value={addr} />
          <span className="i2cd__div" aria-hidden="true" />
          <Cell label="SIZE" value={sizeLabel} />
          <span className="i2cd__div" aria-hidden="true" />
          <Cell label="FPS" value={mode === 'mirror' ? fps : '——'} />
        </div>
      </div>
    </InstrumentWindow>
  )
}

/** One mode tab (MIRROR / PUSH). */
function ModeTab({
  label,
  active,
  onClick
}: {
  label: string
  active: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`i2cd__mode${active ? ' i2cd__mode--on' : ''}`}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

/**
 * The screen body — picks what to draw inside the bezel:
 *  - PUSH mode previews the draft rows as the live character grid.
 *  - MIRROR mode draws the latest `fb` pixel grid or `text` rows; a blank/standby
 *    grid before the first reading.
 */
function ScreenBody({
  mode,
  geo,
  view,
  draft
}: {
  mode: Mode
  geo: ReturnType<typeof geometryById>
  view: ScreenView | null
  draft: string
}): JSX.Element {
  if (mode === 'push') {
    const cols = geo.type === 'char' ? (geo.cols ?? 16) : 21
    const rows = geo.type === 'char' ? (geo.charRows ?? 2) : 4
    const grid = layoutText(draft.split('\n'), cols, rows)
    return <CharScreen lines={grid.lines} cols={grid.cols} />
  }

  if (view?.mode === 'pixels') {
    return <PixelScreen grid={view.grid} />
  }
  if (view?.mode === 'text') {
    const cols = geo.type === 'char' ? (geo.cols ?? 16) : 21
    const rows = geo.type === 'char' ? (geo.charRows ?? 2) : 4
    const grid = layoutText(view.rows, cols, rows)
    return <CharScreen lines={grid.lines} cols={grid.cols} />
  }

  // Standby: a blank grid + a faint caption until the first reading arrives.
  if (geo.type === 'pixel') {
    return <PixelScreen grid={blankGrid(geo.w ?? 128, geo.h ?? 64)} standby />
  }
  const grid = layoutText([], geo.cols ?? 16, geo.charRows ?? 2)
  return <CharScreen lines={grid.lines} cols={grid.cols} standby />
}

/**
 * Render a decoded monochrome pixel grid as an SVG (lit pixels are accent rects
 * over a faint pixel-grid lattice — the phosphor "glow"). Scales to fit the
 * bezel; large 128×64 frames render as crisp 1-unit rects in a viewBox.
 */
function PixelScreen({ grid, standby }: { grid: PixelGrid; standby?: boolean }): JSX.Element {
  const { w, h, pixels } = grid
  const on: { x: number; y: number }[] = []
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (pixels[y]?.[x]) on.push({ x, y })
    }
  }
  return (
    <div className="i2cd__panel i2cd__panel--px">
      <svg
        className="i2cd__px-svg"
        viewBox={`0 0 ${Math.max(1, w)} ${Math.max(1, h)}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`${w} by ${h} pixel display`}
      >
        <rect className="i2cd__px-bg" x="0" y="0" width={Math.max(1, w)} height={Math.max(1, h)} />
        {on.map((p) => (
          <rect
            key={`${p.x},${p.y}`}
            className="i2cd__px"
            x={p.x}
            y={p.y}
            width="1"
            height="1"
          />
        ))}
      </svg>
      {standby && <span className="i2cd__standby">awaiting framebuffer…</span>}
    </div>
  )
}

/** Render a fixed character grid as monospace rows (the LCD / text view). */
function CharScreen({
  lines,
  cols,
  standby
}: {
  lines: string[]
  cols: number
  standby?: boolean
}): JSX.Element {
  return (
    <div className="i2cd__panel i2cd__panel--char" style={{ '--cols': cols } as CSSProperties}>
      {lines.map((line, i) => (
        <pre className="i2cd__char-row" key={i}>
          {line.length ? line : ' '}
        </pre>
      ))}
      {standby && <span className="i2cd__standby i2cd__standby--char">awaiting text…</span>}
    </div>
  )
}

/** One labelled readout cell (mirrors the scope/meter readout strips). */
function Cell({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="i2cd__cell">
      <span className="i2cd__cell-lbl">{label}</span>
      <span className="i2cd__cell-val">{value}</span>
    </div>
  )
}
