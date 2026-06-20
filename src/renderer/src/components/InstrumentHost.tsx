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
  useFloatPlacement,
  type FloatProps
} from './InstrumentWindow'
import { Oscilloscope } from './Oscilloscope'
import { Multimeter } from './Multimeter'
import { initialOffset } from './instrument-host'
import './InstrumentHost.css'

/**
 * INSTRUMENT HOST (main window) — hosts the Oscilloscope (#101) + Multimeter
 * (#102) ABOVE the code editor in the MAIN editor window.
 * =============================================================================
 *
 * The instruments used to live inside the separate board-view window; they now
 * belong to the main window so they float over / dock beside the actual code the
 * user is editing. The board-view window's node launchers fire a cross-window
 * `instruments.open({kind, variable, pin})` request (relayed by the main process,
 * see `src/main/board.ts`); this host subscribes to `window.api.instruments.onOpen`
 * and mounts/reveals the instrument here.
 *
 * RESOLUTION: each open instrument is resolved against the MAIN window's OWN
 * active file (the same `source` AppShell streams to the board window). We
 * `parsePins(source)`, find the connection whose `variable` matches, and build the
 * source lists (PWM connections for the scope, ADC for the meter). A scope reads
 * its freq/duty from `fileSource = source`. An instrument whose variable is no
 * longer declared is dropped.
 *
 * LIVE VALUES: while ≥1 instrument is open AND a board is connected, we poll the
 * device on a gentle interval (reusing the unit-tested `buildValueProbe` /
 * `parseProbeOutput` from #97). NOTE: this enters the raw REPL and INTERRUPTS a
 * running program on each poll — inherent to REPL reads; we only poll while an
 * instrument is open + connected, throttle, and guard re-entrancy. This is
 * SEPARATE from the board window's own #97 node poll (both gate on connected +
 * throttle independently).
 *
 * PLACEMENT: each instrument floats over the editor as a draggable
 * {@link InstrumentWindow} (dragged by its title-bar grip, pointer-capture,
 * clamped on-screen) with a cascade start offset. The dock-to-side key snaps it
 * into a side rail ({@link InstrumentDock}) hosted here. The ✕ closes it in both
 * modes. `visible` hides everything (kept mounted so positions survive) for the
 * toolbar's Instruments toggle.
 */

/** How often we poll the device for the open instruments' values (ms). */
const POLL_INTERVAL_MS = 800

/** One open instrument: its kind + the connection variable it tracks. */
export interface OpenInstrument {
  kind: 'scope' | 'meter'
  /** The connection's variable (stable id across re-parses). */
  variable: string
}

export interface InstrumentHostProps {
  /** The MAIN window's active-file content (already `.py` when meaningful). */
  source: string
  /** Whether the active file is Python (gates parsing). */
  isPython: boolean
  /** When false, the instruments are hidden (kept mounted so state survives). */
  visible: boolean
  /** Open instruments + their state (lifted to AppShell so the toolbar sees the count). */
  instruments: OpenInstrument[]
  /** Replace the open-instrument list (add / close / dedupe handled by AppShell). */
  onChange: (next: OpenInstrument[]) => void
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

export function InstrumentHost({
  source,
  isPython,
  visible,
  instruments,
  onChange
}: InstrumentHostProps): JSX.Element | null {
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
  // Default is floating (the primary mode the user asked for).
  const [docked, setDocked] = useState<Record<string, boolean>>({})
  const keyOf = (it: OpenInstrument): string => `${it.kind}:${it.variable}`
  const toggleDock = useCallback((it: OpenInstrument): void => {
    setDocked((d) => ({ ...d, [keyOf(it)]: !d[keyOf(it)] }))
  }, [])

  // Live device values: poll only while ≥1 instrument is open (+ connected).
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
  // decided per-instrument by the override map (default floating).
  const resolved = instruments
    .map((it, i) => {
      const idx = conns.findIndex((c) => c.variable === it.variable)
      const conn = idx >= 0 ? conns[idx] : undefined
      if (!conn) return null
      if (it.kind === 'scope' && conn.type !== 'pwm') return null
      if (it.kind === 'meter' && conn.type !== 'adc') return null
      return {
        it,
        conn,
        live: liveValues.get(idx),
        isDocked: docked[keyOf(it)] ?? false,
        cascade: i
      }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)

  const dockedItems = resolved.filter((r) => r.isDocked)
  const floatItems = resolved.filter((r) => !r.isDocked)

  // Nothing open → render nothing (don't even mount the layer).
  if (resolved.length === 0) return null

  return (
    <div className={`instr-host ${visible ? '' : 'instr-host--hidden'}`} aria-hidden={!visible}>
      {/* Floating instruments, draggable over the editor. */}
      <div className="instr-host__floats">
        {floatItems.map((r) => (
          <FloatingInstrument
            key={keyOf(r.it)}
            cascade={r.cascade}
            it={r.it}
            conn={r.conn}
            live={r.live}
            source={source}
            pwmConns={pwmConns}
            adcConns={adcConns}
            stats={meterStats.get(r.it.variable)}
            onToggleDock={() => toggleDock(r.it)}
            onClose={() => closeInstrument(r.it.kind, r.it.variable)}
            onRetarget={(toVar) => retargetInstrument(r.it.kind, r.it.variable, toVar)}
          />
        ))}
      </div>

      {/* Docked instruments in the side rail (hosted in the MAIN window now). */}
      {dockedItems.length > 0 && (
        <InstrumentDock>
          {dockedItems.map((r) =>
            renderInstrument(r.it, r.conn, {
              source,
              pwmConns,
              adcConns,
              live: r.live,
              stats: meterStats.get(r.it.variable),
              docked: true,
              onToggleDock: () => toggleDock(r.it),
              onClose: () => closeInstrument(r.it.kind, r.it.variable),
              onRetarget: (toVar) => retargetInstrument(r.it.kind, r.it.variable, toVar)
            })
          )}
        </InstrumentDock>
      )}
    </div>
  )
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
 * One floating instrument: owns its drag offset via {@link useFloatPlacement}
 * (so each window drags independently) and renders the scope/meter body. Split
 * into its own component because the hook must be called once per window.
 */
function FloatingInstrument({
  cascade,
  it,
  conn,
  live,
  source,
  pwmConns,
  adcConns,
  stats,
  onToggleDock,
  onClose,
  onRetarget
}: {
  cascade: number
  it: OpenInstrument
  conn: UsedPins
  live?: LiveValue
  source: string
  pwmConns: UsedPins[]
  adcConns: UsedPins[]
  stats?: Stats
  onToggleDock: () => void
  onClose: () => void
  onRetarget: (toVar: string) => void
}): JSX.Element {
  // The host box = this float layer's parent, measured live so the drag clamp
  // tracks editor resizes. Read at drag time (not on every render).
  const getHostSize = useCallback((): { w: number; h: number } => {
    const host = document.querySelector('.instr-host__floats') as HTMLElement | null
    if (!host) return { w: window.innerWidth, h: window.innerHeight }
    return { w: host.clientWidth, h: host.clientHeight }
  }, [])
  const float = useFloatPlacement(initialOffset(cascade), getHostSize)

  return renderInstrument(it, conn, {
    source,
    pwmConns,
    adcConns,
    live,
    stats,
    docked: false,
    float,
    onToggleDock,
    onClose,
    onRetarget
  })
}
