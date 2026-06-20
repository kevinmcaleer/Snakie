import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { parsePins, type UsedPins } from './parse-pins'
import { buildValueProbe, parseProbeOutput, type LiveValue } from './board-values'
import {
  adcFromU16,
  emptyStats,
  foldStat,
  type AdcSample,
  type Stats
} from './instrument-data'
import {
  InstrumentDock,
  InstrumentWindow,
  useFloatPlacement,
  type FloatProps
} from './InstrumentWindow'
import { Oscilloscope } from './Oscilloscope'
import { Multimeter } from './Multimeter'
import { Plotter } from './Plotter'
import { initialOffset } from './instrument-host'
import './InstrumentHost.css'

/**
 * INSTRUMENT HOST (main window) — hosts the Oscilloscope (#101), Multimeter
 * (#102) and Plotter (#103) in the MAIN editor window.
 * =============================================================================
 *
 * The instruments used to live inside the separate board-view window; they now
 * belong to the main window. As of the dock-region rework they live in a
 * dedicated **dock region** (the rightmost panel, to the RIGHT of the chat
 * panel) — not over the code editor — while *undocked* instruments float over
 * the WHOLE window from an app-root float layer.
 *
 * This module is split into three pieces so AppShell can place each surface
 * independently while keeping ONE source of truth:
 *
 *   - {@link useInstruments} — the resolve + live-poll + per-instrument `docked`
 *     state machine. Called once in AppShell; returns the resolved scope/meter
 *     items (split into docked vs floating) plus the render helpers.
 *   - {@link InstrumentDockRegion} — the dock content (header + SCOPE/METER/PLOT
 *     visibility toggle row + the docked windows + the Plotter). Rendered inside
 *     the dock panel (right of chat).
 *   - {@link InstrumentFloatLayer} — the app-root float layer (`position:fixed`,
 *     click-through) hosting the *undocked* scope/meter windows above everything.
 *
 * RESOLUTION: each open instrument is resolved against the MAIN window's OWN
 * active file (the same `source` AppShell streams to the board window). We
 * `parsePins(source)`, find the connection whose `variable` matches, and build the
 * source lists (PWM connections for the scope, ADC for the meter). A scope reads
 * its freq/duty from `fileSource = source`. An instrument whose variable is no
 * longer declared is dropped.
 *
 * LIVE VALUES: while ≥1 scope/meter is open AND a board is connected, we poll the
 * device on a gentle interval (reusing the unit-tested `buildValueProbe` /
 * `parseProbeOutput` from #97). NOTE: this enters the raw REPL and INTERRUPTS a
 * running program on each poll — inherent to REPL reads; we only poll while a
 * scope/meter is open + connected, throttle, and guard re-entrancy. This is
 * SEPARATE from the board window's own #97 node poll (both gate on connected +
 * throttle independently). The Plotter does NOT poll — it passively reads the
 * broadcast serial stream.
 */

/** How often we poll the device for the open instruments' values (ms). */
const POLL_INTERVAL_MS = 800

/** One open instrument: its kind + the connection variable it tracks. */
export interface OpenInstrument {
  kind: 'scope' | 'meter'
  /** The connection's variable (stable id across re-parses). */
  variable: string
}

/** Per-kind visibility flags (dock-header SCOPE/METER/PLOT toggles). Default all on. */
export interface InstrumentVisibility {
  scope: boolean
  meter: boolean
  plotter: boolean
}

/**
 * Poll the connected board for the open instruments' pins while ≥1 is open.
 *
 * Mirrors BoardGraph's #97 `useLiveValues`: `getStatus()` first (cheap, no REPL);
 * only when connected do we run ONE batched `exec` probe for the open
 * instruments' connections. `exec` returns `{stdout,stderr}` and never throws on
 * a device traceback, so a partly-undefined batch still yields readable lines.
 * Re-entrancy-guarded, torn down when nothing is open. Anything that fails →
 * idle (the instruments fall back to their placeholder readings).
 */
function useInstrumentValues(conns: UsedPins[], active: boolean): Map<number, LiveValue> {
  const [values, setValues] = useState<Map<number, LiveValue>>(new Map())
  const connsRef = useRef(conns)
  connsRef.current = conns

  useEffect(() => {
    if (!active || conns.length === 0) {
      setValues(new Map())
      return
    }
    let cancelled = false
    let inFlight = false

    const tick = async (): Promise<void> => {
      if (inFlight) return
      inFlight = true
      try {
        const status = await window.api.device.getStatus()
        if (cancelled) return
        if (status?.state !== 'connected') {
          setValues(new Map())
          return
        }
        const snippet = buildValueProbe(connsRef.current)
        if (!snippet) {
          setValues(new Map())
          return
        }
        const { stdout } = await window.api.device.exec(snippet)
        if (cancelled) return
        setValues(parseProbeOutput(stdout))
      } catch {
        if (!cancelled) setValues(new Map())
      } finally {
        inFlight = false
      }
    }

    void tick()
    const id = window.setInterval(() => void tick(), POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
    // Re-arm only when active flips or the connection COUNT changes; per-edit
    // content changes ride `connsRef` without restarting the interval.
  }, [active, conns.length])

  return values
}

/** A resolved scope/meter instrument: its connection + live reading + placement. */
interface ResolvedInstrument {
  it: OpenInstrument
  conn: UsedPins
  live?: LiveValue
  stats?: Stats
  isDocked: boolean
  cascade: number
}

/**
 * The single source of truth for the main-window instruments. Owns the open
 * scope/meter list (lifted to AppShell so the toolbar sees the count and the
 * dock + float layer share it), the per-instrument `docked` override map, and
 * the live device poll. Returns the resolved items split by placement plus the
 * shared render helpers — consumed by {@link InstrumentDockRegion} and
 * {@link InstrumentFloatLayer}.
 */
export interface UseInstrumentsArgs {
  /** The MAIN window's active-file content (already `.py` when meaningful). */
  source: string
  /** Whether the active file is Python (gates parsing). */
  isPython: boolean
  /** Open scope/meter instruments (lifted to AppShell). */
  instruments: OpenInstrument[]
  /** Replace the open-instrument list (add / close / dedupe). */
  onChange: (next: OpenInstrument[]) => void
}

export interface UseInstrumentsResult {
  /** Docked scope/meter items (those whose dock override is on). */
  dockedItems: ResolvedInstrument[]
  /** Floating scope/meter items (the rest). */
  floatItems: ResolvedInstrument[]
  source: string
  pwmConns: UsedPins[]
  adcConns: UsedPins[]
  toggleDock: (it: OpenInstrument) => void
  closeInstrument: (kind: 'scope' | 'meter', variable: string) => void
  retargetInstrument: (kind: 'scope' | 'meter', fromVar: string, toVar: string) => void
}

export function useInstruments({
  source,
  isPython,
  instruments,
  onChange
}: UseInstrumentsArgs): UseInstrumentsResult {
  // Re-parse the MAIN window's active file → the connections instruments resolve
  // against (same parser the board view uses).
  const conns = useMemo(() => (isPython ? parsePins(source) : []), [source, isPython])
  const pwmConns = useMemo(() => conns.filter((c) => c.type === 'pwm'), [conns])
  const adcConns = useMemo(() => conns.filter((c) => c.type === 'adc'), [conns])

  // Drop any instrument whose variable is no longer declared (renamed/deleted).
  useEffect(() => {
    const live = new Set(conns.map((c) => c.variable))
    const next = instruments.filter((it) => live.has(it.variable))
    if (next.length !== instruments.length) onChange(next)
  }, [conns, instruments, onChange])

  const closeInstrument = useCallback(
    (kind: 'scope' | 'meter', variable: string): void => {
      onChange(instruments.filter((it) => !(it.kind === kind && it.variable === variable)))
    },
    [instruments, onChange]
  )

  const retargetInstrument = useCallback(
    (kind: 'scope' | 'meter', fromVar: string, toVar: string): void => {
      // Switching to a pin that already has this instrument open → drop the old
      // one (avoid a duplicate); else retarget in place.
      if (instruments.some((it) => it.kind === kind && it.variable === toVar)) {
        onChange(instruments.filter((it) => !(it.kind === kind && it.variable === fromVar)))
        return
      }
      onChange(
        instruments.map((it) =>
          it.kind === kind && it.variable === fromVar ? { ...it, variable: toVar } : it
        )
      )
    },
    [instruments, onChange]
  )

  // Per-instrument docked override (the dock-to-side key). Keyed by kind+variable.
  // Default is DOCKED — opening a scope/meter shows it in the INSTRUMENT DOCK
  // (right of chat); the dock-to-side key then floats it above the window.
  const [docked, setDocked] = useState<Record<string, boolean>>({})
  const keyOf = (it: OpenInstrument): string => `${it.kind}:${it.variable}`
  // Toggle against the resolved value (default true) so the very first click
  // flips docked→floating instead of no-opping (`!undefined === true`).
  const toggleDock = useCallback((it: OpenInstrument): void => {
    setDocked((d) => ({ ...d, [keyOf(it)]: !(d[keyOf(it)] ?? true) }))
  }, [])

  // Live device values: poll only while ≥1 scope/meter is open (+ connected).
  const liveValues = useInstrumentValues(conns, instruments.length > 0)

  // Rolling MIN/MAX/AVG per ADC variable (Multimeter stats), folded from the live
  // volts samples; reset when all instruments close (a fresh session).
  const [meterStats, setMeterStats] = useState<Map<string, Stats>>(new Map())
  useEffect(() => {
    if (instruments.length === 0) setMeterStats(new Map())
  }, [instruments.length])
  useEffect(() => {
    if (instruments.length === 0) return
    setMeterStats((prev) => {
      let changed = false
      const next = new Map(prev)
      conns.forEach((c, i) => {
        if (c.type !== 'adc') return
        const live = liveValues.get(i)
        if (!live || live.value === undefined) return
        const { volts } = adcFromU16(live.value)
        next.set(c.variable, foldStat(next.get(c.variable) ?? emptyStats(), volts))
        changed = true
      })
      return changed ? next : prev
    })
  }, [liveValues, conns, instruments.length])

  // Resolve each open instrument → its connection + live reading. The cascade
  // index gives floating windows distinct start offsets. Docked vs floating is
  // decided per-instrument by the override map (default docked).
  const resolved = instruments
    .map((it, i): ResolvedInstrument | null => {
      const idx = conns.findIndex((c) => c.variable === it.variable)
      const conn = idx >= 0 ? conns[idx] : undefined
      if (!conn) return null
      if (it.kind === 'scope' && conn.type !== 'pwm') return null
      if (it.kind === 'meter' && conn.type !== 'adc') return null
      return {
        it,
        conn,
        live: liveValues.get(idx),
        stats: meterStats.get(it.variable),
        isDocked: docked[keyOf(it)] ?? true,
        cascade: i
      }
    })
    .filter((r): r is ResolvedInstrument => r !== null)

  return {
    dockedItems: resolved.filter((r) => r.isDocked),
    floatItems: resolved.filter((r) => !r.isDocked),
    source,
    pwmConns,
    adcConns,
    toggleDock,
    closeInstrument,
    retargetInstrument
  }
}

/** Shared render args for an instrument body in either placement. */
interface RenderArgs {
  source: string
  pwmConns: UsedPins[]
  adcConns: UsedPins[]
  live?: LiveValue
  stats?: Stats
  docked: boolean
  float?: FloatProps
  onToggleDock: () => void
  onClose: () => void
  onRetarget: (toVar: string) => void
}

/** Build the Oscilloscope/Multimeter element for one resolved instrument. */
function renderInstrument(
  it: OpenInstrument,
  conn: UsedPins,
  args: RenderArgs
): JSX.Element {
  if (it.kind === 'scope') {
    // Live duty fraction from the polled duty_u16 (else parsed/static).
    const liveDuty =
      args.live && args.live.value !== undefined ? args.live.value / 65535 : undefined
    return (
      <Oscilloscope
        conn={conn}
        sources={args.pwmConns}
        fileSource={args.source}
        liveDuty={liveDuty}
        docked={args.docked}
        float={args.float}
        onSelectSource={(next) => args.onRetarget(next.variable)}
        onToggleDock={args.onToggleDock}
        onClose={args.onClose}
      />
    )
  }
  const sample: AdcSample | undefined =
    args.live && args.live.value !== undefined ? adcFromU16(args.live.value) : undefined
  return (
    <Multimeter
      conn={conn}
      sources={args.adcConns}
      sample={sample}
      stats={args.stats}
      docked={args.docked}
      float={args.float}
      onSelectSource={(next) => args.onRetarget(next.variable)}
      onToggleDock={args.onToggleDock}
      onClose={args.onClose}
    />
  )
}

/**
 * Render one resolved scope/meter into a placement. Pulled out so the dock and
 * float surfaces share the exact same body wiring.
 */
function renderResolved(r: ResolvedInstrument, host: UseInstrumentsResult, float?: FloatProps): JSX.Element {
  return renderInstrument(r.it, r.conn, {
    source: host.source,
    pwmConns: host.pwmConns,
    adcConns: host.adcConns,
    live: r.live,
    stats: r.stats,
    docked: !float,
    float,
    onToggleDock: () => host.toggleDock(r.it),
    onClose: () => host.closeInstrument(r.it.kind, r.it.variable),
    onRetarget: (toVar) => host.retargetInstrument(r.it.kind, r.it.variable, toVar)
  })
}

/**
 * THE DOCK REGION — the rightmost panel content (right of chat). Renders the
 * `INSTRUMENT DOCK` header with the SCOPE / METER / PLOT visibility toggle row,
 * then the visible docked windows and the Plotter. Visibility (`vis`) is
 * orthogonal to each instrument's docked state: a hidden kind is omitted
 * entirely from the stack so the rest reflow up (no empty gap).
 */
export function InstrumentDockRegion({
  host,
  vis,
  onToggleVisible
}: {
  host: UseInstrumentsResult
  vis: InstrumentVisibility
  onToggleVisible: (kind: keyof InstrumentVisibility) => void
}): JSX.Element {
  const scopeDocked = host.dockedItems.filter((r) => r.it.kind === 'scope')
  const meterDocked = host.dockedItems.filter((r) => r.it.kind === 'meter')
  return (
    <InstrumentDock vis={vis} onToggleVisible={onToggleVisible}>
      {vis.scope && scopeDocked.map((r) => (
        <DockItem key={`scope:${r.it.variable}`}>{renderResolved(r, host)}</DockItem>
      ))}
      {vis.meter && meterDocked.map((r) => (
        <DockItem key={`meter:${r.it.variable}`}>{renderResolved(r, host)}</DockItem>
      ))}
      {vis.plotter && (
        <DockItem>
          <InstrumentWindow
            name="PLOTTER"
            source="serial · live"
            docked
            onClose={() => onToggleVisible('plotter')}
          >
            <Plotter />
          </InstrumentWindow>
        </DockItem>
      )}
    </InstrumentDock>
  )
}

/** A docked instrument fills the dock rail width (the rail is wider than the window). */
function DockItem({ children }: { children: JSX.Element }): JSX.Element {
  return <div className="instr-dock__item">{children}</div>
}

/**
 * THE APP-ROOT FLOAT LAYER — a `position:fixed; inset:0` click-through layer
 * over the WHOLE window (above the panels, below modals). The undocked
 * scope/meter windows float here, draggable by their title bar and clamped to
 * the whole window. `visible` is the toolbar Instruments toggle (it hides the
 * whole layer; positions survive because it's CSS-hidden, kept mounted).
 * Scope/meter floats are gated by their kind visibility (`vis`).
 */
export function InstrumentFloatLayer({
  host,
  vis,
  visible
}: {
  host: UseInstrumentsResult
  vis: InstrumentVisibility
  visible: boolean
}): JSX.Element | null {
  const floats = host.floatItems.filter((r) =>
    r.it.kind === 'scope' ? vis.scope : vis.meter
  )
  if (floats.length === 0) return null
  return (
    <div
      className={`instr-floats ${visible ? '' : 'instr-floats--hidden'}`}
      aria-hidden={!visible}
    >
      {floats.map((r) => (
        <FloatingInstrument key={`${r.it.kind}:${r.it.variable}`} r={r} host={host} />
      ))}
    </div>
  )
}

/**
 * One floating instrument: owns its drag offset via {@link useFloatPlacement}
 * (so each window drags independently) and renders the scope/meter body. Split
 * into its own component because the hook must be called once per window.
 */
function FloatingInstrument({
  r,
  host
}: {
  r: ResolvedInstrument
  host: UseInstrumentsResult
}): JSX.Element {
  // The host box = the WHOLE app window (the `.shell` root), measured live so the
  // drag clamp tracks window resizes and undocked windows can roam over every
  // panel. Read at drag time (not on every render).
  const getHostSize = useCallback((): { w: number; h: number } => {
    const host = document.querySelector('.shell') as HTMLElement | null
    if (!host) return { w: window.innerWidth, h: window.innerHeight }
    return { w: host.clientWidth, h: host.clientHeight }
  }, [])
  const float = useFloatPlacement(initialOffset(r.cascade), getHostSize)
  return renderResolved(r, host, float)
}
