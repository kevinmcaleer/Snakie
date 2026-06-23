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
  AddInstrumentButton,
  InstrumentDock,
  InstrumentToggle,
  InstrumentToggleGroup,
  InstrumentWindow,
  useFloatPlacement,
  type FloatProps
} from './InstrumentWindow'
import { Oscilloscope } from './Oscilloscope'
import { Multimeter } from './Multimeter'
import { Plotter } from './Plotter'
import { PlaceholderInstrument } from './PlaceholderInstrument'
import {
  SINGLETON_IDS,
  filterPalette,
  groupInstruments,
  instrumentById,
  isVisible,
  normaliseVisibility,
  type InstrumentDef,
  type InstrumentVisibility
} from './instruments-registry'

// Re-export the visibility migration helper + type so AppShell (and anything
// wiring the dock) can import them from this host module alongside the dock
// components, as it always has.
export { normaliseVisibility }
export type { InstrumentVisibility }
import {
  initialOffset,
  instrumentKey,
  redockKind as redockKindMap,
  redockOne,
  unionByVariable
} from './instrument-host'
import { parseTelemetry } from './instrument-telemetry'
import {
  emptyFeed,
  foldTelemetry,
  meterReadingFor,
  scopeSamplesFor,
  type MeterReading,
  type TelemetryFeed
} from './instrument-telemetry-feed'
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
 * RESOLUTION: each open instrument is SELF-CONTAINED — it carries the full parsed
 * connection (`conn`) captured by the board node that launched it. We render the
 * scope/meter straight from that stored `conn` (its type/pins/variable/
 * constructor); we do NOT require the pin to be present in the MAIN window's
 * active file. (The bug this fixes: instruments used to be re-resolved against —
 * and silently wiped by — the main file's parse, so a scope/meter never appeared
 * when the editor wasn't showing the exact `.py` that declared the pin.)
 *
 * The MAIN window's active file is still parsed, but ONLY to enrich the source
 * SELECTORS (the "switch this scope to another PWM pin" dropdown) — an
 * instrument's existence never depends on it. When the active file has no
 * matching pins we fall back to offering the currently-open instruments of that
 * kind as the selector options.
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

/**
 * One open instrument: its kind + the FULL parsed connection it renders from.
 *
 * `conn` is captured (verbatim) from the board node that launched the instrument
 * and travels in the `instruments:open` payload, so the instrument is
 * self-contained — it renders from `conn` regardless of what the MAIN editor's
 * active file currently shows. `conn.variable` remains the stable id for
 * deduping / keying (with the kind).
 */
export interface OpenInstrument {
  kind: 'scope' | 'meter'
  /** The full parsed connection (type/pins/variable/constructor) to render from. */
  conn: UsedPins
}


/** The open instruments' OWN connections for one kind (the selector fallback). */
function openConns(instruments: OpenInstrument[], kind: 'scope' | 'meter'): UsedPins[] {
  return instruments.filter((it) => it.kind === kind).map((it) => it.conn)
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

/** How often the passive telemetry feed publishes a snapshot to React (ms). */
const TELEMETRY_FLUSH_MS = 100

const telemetryDecoder = new TextDecoder()

/**
 * The PASSIVE, always-on telemetry source (issue #107). Subscribes to the same
 * broadcast `device.onData` serial stream the Plotter/Terminal use, buffers
 * partial lines, parses each completed line with {@link parseTelemetry}, and
 * folds SCOPE/METER readings into a rolling per-channel {@link TelemetryFeed}.
 *
 * Crucially this NEVER touches the raw REPL, so — unlike {@link useInstrumentValues}
 * — it does not interrupt a running program: it works during a `while True:`
 * loop on the board that simply prints telemetry. To keep a fast stream from
 * thrashing React, samples accumulate in a ref and we publish a snapshot on a
 * gentle interval only when something changed.
 */
function useTelemetryFeed(): TelemetryFeed {
  const [snapshot, setSnapshot] = useState<TelemetryFeed>(emptyFeed)
  const feedRef = useRef<TelemetryFeed>(emptyFeed())
  const lineBuf = useRef('')
  const dirty = useRef(false)

  useEffect(() => {
    const unsubscribe = window.api.device.onData((chunk) => {
      lineBuf.current += telemetryDecoder.decode(chunk, { stream: true })
      const normalised = lineBuf.current.replace(/\r\n?/g, '\n')
      const parts = normalised.split('\n')
      lineBuf.current = parts.pop() ?? ''
      for (const line of parts) {
        const next = foldTelemetry(feedRef.current, parseTelemetry(line))
        if (next !== feedRef.current) {
          feedRef.current = next
          dirty.current = true
        }
      }
    })
    const id = window.setInterval(() => {
      if (dirty.current) {
        dirty.current = false
        setSnapshot(feedRef.current)
      }
    }, TELEMETRY_FLUSH_MS)
    return () => {
      unsubscribe()
      window.clearInterval(id)
    }
  }, [])

  return snapshot
}

/** A resolved scope/meter instrument: its connection + live reading + placement. */
interface ResolvedInstrument {
  it: OpenInstrument
  conn: UsedPins
  live?: LiveValue
  stats?: Stats
  /** Passive telemetry scope samples for this channel (issue #107), if any. */
  telemetrySamples?: number[]
  /** Passive telemetry meter reading for this channel (issue #107), if any. */
  telemetryReading?: MeterReading
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
  /**
   * The MAIN window's active-file content (already `.py` when meaningful). Used
   * ONLY to enrich the source-SELECTOR lists; instruments render from their own
   * stored `conn`, so this never gates an instrument's existence.
   */
  source: string
  /** Whether the active file is Python (gates the selector-only parse). */
  isPython: boolean
  /** Open scope/meter instruments (lifted to AppShell). */
  instruments: OpenInstrument[]
  /** Replace the open-instrument list (add / close / dedupe). */
  onChange: (next: OpenInstrument[]) => void
  /**
   * The GLOBAL live-poll switch (lifted to AppShell, default OFF). Gates the
   * device poll: with LIVE off there is NO polling → no raw-REPL probe → no
   * interruption of a running program; instruments show their static/parsed
   * readings. With LIVE on the poll runs as before (still internally gated on a
   * connected board). One switch for all instruments because the poll is a
   * single batched probe shared across every open scope/meter.
   */
  live: boolean
  /** Flip the global live-poll (surfaced as a LIVE toggle on each instrument). */
  onToggleLive: () => void
  /**
   * Hide a kind in the dock header (set `visibility[kind] = false`). Lives in
   * AppShell (which owns the persisted `visibility`); routed in so closing (✕) a
   * scope/meter can both re-dock it (here, the `docked` map) AND hide its kind —
   * the close→hide→restore-via-panel-button model. The instrument stays in
   * `openInstruments` (remembered), just hidden.
   */
  onHideKind: (kind: 'scope' | 'meter') => void
}

export interface UseInstrumentsResult {
  /** Docked scope/meter items (those whose dock override is on). */
  dockedItems: ResolvedInstrument[]
  /** Floating scope/meter items (the rest). */
  floatItems: ResolvedInstrument[]
  source: string
  pwmConns: UsedPins[]
  adcConns: UsedPins[]
  /** Global live-poll state (mirrored on each instrument's LIVE toggle). */
  live: boolean
  /** Flip the global live-poll. */
  onToggleLive: () => void
  toggleDock: (it: OpenInstrument) => void
  closeInstrument: (kind: 'scope' | 'meter', variable: string) => void
  retargetInstrument: (kind: 'scope' | 'meter', fromVar: string, to: UsedPins) => void
  /**
   * Re-dock every open instrument of one kind (its `docked` overrides → true).
   * AppShell calls this when a SCOPE/METER dock button turns its kind's
   * visibility ON, so a previously-undocked/closed instrument reappears DOCKED.
   */
  redockKind: (kind: 'scope' | 'meter') => void
}

export function useInstruments({
  source,
  isPython,
  instruments,
  onChange,
  live,
  onToggleLive,
  onHideKind
}: UseInstrumentsArgs): UseInstrumentsResult {
  // Parse the MAIN window's active file ONLY to enrich the source SELECTOR lists
  // (the "switch this scope to another PWM pin" dropdown). Instruments DO NOT
  // resolve against this — they render from their own stored `conn` — so an
  // empty/non-`.py`/mismatched active file no longer wipes them. We union the
  // in-file connections with the open instruments' own conns (deduped by
  // variable) so the dropdown always at least lists the open instruments, and a
  // scope/meter renders even when the active file has zero matching pins.
  const fileConns = useMemo(() => (isPython ? parsePins(source) : []), [source, isPython])
  const pwmConns = useMemo(
    () => unionByVariable(fileConns.filter((c) => c.type === 'pwm'), openConns(instruments, 'scope')),
    [fileConns, instruments]
  )
  const adcConns = useMemo(
    () => unionByVariable(fileConns.filter((c) => c.type === 'adc'), openConns(instruments, 'meter')),
    [fileConns, instruments]
  )

  // NOTE: there is deliberately NO "drop instruments whose variable isn't in the
  // active file" effect any more. Instruments persist (carrying their own `conn`)
  // until the user closes/hides them via the close→hide→re-dock model. Tying
  // existence to the main-file parse is exactly the bug that kept the scope/meter
  // out of the dock.

  // Per-instrument docked override (the dock-to-side key). Keyed by kind+variable.
  // Default is DOCKED — opening a scope/meter shows it in the INSTRUMENT DOCK
  // (right of chat); the dock-to-side key then floats it above the window.
  // Declared up here so closeInstrument can re-dock against it.
  const [docked, setDocked] = useState<Record<string, boolean>>({})

  // Closing (✕) a scope/meter does NOT remove it from `openInstruments`; instead
  // it HIDES the instrument and RETURNS it to the dock, so the SCOPE/METER button
  // can bring it back. Two coordinated state changes: re-dock THIS instrument
  // (its `docked` override → true, here) and turn its KIND's visibility OFF
  // (`onHideKind`, in AppShell). The instrument STAYS in `openInstruments`
  // (carrying its `conn`) so the panel button can restore it. This matches the
  // Plotter ✕, which already hides via its kind visibility.
  const closeInstrument = useCallback(
    (kind: 'scope' | 'meter', variable: string): void => {
      setDocked((d) => redockOne(d, kind, variable))
      onHideKind(kind)
    },
    [onHideKind]
  )

  // Retarget a scope/meter to a different pin chosen in its source selector. The
  // new `conn` comes straight from the picked selector option, so the instrument
  // keeps rendering from a real connection (no re-parse needed).
  const retargetInstrument = useCallback(
    (kind: 'scope' | 'meter', fromVar: string, to: UsedPins): void => {
      // Switching to a pin that already has this instrument open → drop the old
      // one (avoid a duplicate); else retarget in place (swap its stored conn).
      if (instruments.some((it) => it.kind === kind && it.conn.variable === to.variable)) {
        onChange(instruments.filter((it) => !(it.kind === kind && it.conn.variable === fromVar)))
        return
      }
      onChange(
        instruments.map((it) =>
          it.kind === kind && it.conn.variable === fromVar ? { ...it, conn: to } : it
        )
      )
    },
    [instruments, onChange]
  )

  const keyOf = (it: OpenInstrument): string => instrumentKey(it.kind, it.conn.variable)
  // Toggle against the resolved value (default true) so the very first click
  // flips docked→floating instead of no-opping (`!undefined === true`).
  const toggleDock = useCallback((it: OpenInstrument): void => {
    setDocked((d) => ({ ...d, [keyOf(it)]: !(d[keyOf(it)] ?? true) }))
  }, [])

  // Re-dock every open instrument of one kind — AppShell calls this when a
  // SCOPE/METER dock button turns that kind's visibility ON, so a
  // previously-undocked/closed instrument of that kind reappears DOCKED (not
  // floating off-screen). Reads the live `instruments` list for the kind's vars.
  const instrumentsRef = useRef(instruments)
  instrumentsRef.current = instruments
  const redockKind = useCallback((kind: 'scope' | 'meter'): void => {
    const vars = instrumentsRef.current
      .filter((it) => it.kind === kind)
      .map((it) => it.conn.variable)
    setDocked((d) => redockKindMap(d, kind, vars))
  }, [])

  // Live device values: build the probe from the OPEN INSTRUMENTS' OWN conns (not
  // the main-file parse) so live readings work regardless of the active file. The
  // values are keyed by instrument index (the same order we resolve below). Poll
  // ONLY when LIVE is on AND ≥1 scope/meter is open (the poll still checks
  // `connected` internally). With LIVE off — the default — `active` is false, so
  // there is no interval, no raw-REPL probe, and a running program on the board is
  // never interrupted; instruments fall back to their static/parsed readings.
  const instrumentConns = useMemo(() => instruments.map((it) => it.conn), [instruments])
  const liveValues = useInstrumentValues(instrumentConns, live && instruments.length > 0)

  // The PASSIVE telemetry feed (issue #107): always-on, REPL-free, fed by the
  // board PRINTING `SNK …` lines. Preferred over the REPL poll for any channel
  // that's reporting telemetry, so a running loop drives the scope/meter live
  // without being interrupted.
  const telemetry = useTelemetryFeed()

  // Rolling MIN/MAX/AVG per ADC variable (Multimeter stats). Folded from whichever
  // source feeds that meter — the passive telemetry reading when present, else the
  // live REPL-poll volts. Reset when all instruments close (a fresh session).
  const [meterStats, setMeterStats] = useState<Map<string, Stats>>(new Map())
  useEffect(() => {
    if (instruments.length === 0) setMeterStats(new Map())
  }, [instruments.length])
  useEffect(() => {
    if (instruments.length === 0) return
    setMeterStats((prev) => {
      let changed = false
      const next = new Map(prev)
      instruments.forEach((it, i) => {
        if (it.kind !== 'meter' || it.conn.type !== 'adc') return
        // Prefer telemetry (the value is already in volts/native units); else the
        // REPL-poll u16 → volts. Either way we fold ONE new sample per tick.
        const reading = meterReadingFor(telemetry, it.conn.variable)
        let volts: number | undefined
        if (reading) {
          volts = reading.value
        } else {
          const live = liveValues.get(i)
          if (live && live.value !== undefined) volts = adcFromU16(live.value).volts
        }
        if (volts === undefined) return
        next.set(it.conn.variable, foldStat(next.get(it.conn.variable) ?? emptyStats(), volts))
        changed = true
      })
      return changed ? next : prev
    })
  }, [liveValues, telemetry, instruments])

  // Resolve each open instrument → its STORED connection + live reading. No
  // main-file lookup: the conn travels with the instrument. The cascade index
  // gives floating windows distinct start offsets; docked vs floating is decided
  // per-instrument by the override map (default docked). We still drop a
  // mis-kinded conn defensively (a scope must be PWM, a meter ADC).
  const resolved = instruments
    .map((it, i): ResolvedInstrument | null => {
      const conn = it.conn
      if (it.kind === 'scope' && conn.type !== 'pwm') return null
      if (it.kind === 'meter' && conn.type !== 'adc') return null
      // Passive telemetry (#107) for this channel, if the board is printing it.
      const telemetrySamples =
        it.kind === 'scope' ? scopeSamplesFor(telemetry, conn.variable) : undefined
      const telemetryReading =
        it.kind === 'meter' ? meterReadingFor(telemetry, conn.variable) : undefined
      return {
        it,
        conn,
        live: liveValues.get(i),
        stats: meterStats.get(conn.variable),
        telemetrySamples: telemetrySamples && telemetrySamples.length > 0 ? telemetrySamples : undefined,
        telemetryReading,
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
    live,
    onToggleLive,
    toggleDock,
    closeInstrument,
    retargetInstrument,
    redockKind
  }
}

/** Shared render args for an instrument body in either placement. */
interface RenderArgs {
  source: string
  pwmConns: UsedPins[]
  adcConns: UsedPins[]
  live?: LiveValue
  stats?: Stats
  /** Passive telemetry scope samples for this channel (#107), if any. */
  telemetrySamples?: number[]
  /** Passive telemetry meter reading for this channel (#107), if any. */
  telemetryReading?: MeterReading
  /** Global live-poll state + toggler for the instrument's LIVE control. */
  liveOn: boolean
  onToggleLive: () => void
  docked: boolean
  float?: FloatProps
  onToggleDock: () => void
  onClose: () => void
  onRetarget: (to: UsedPins) => void
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
        samples={args.telemetrySamples}
        live={args.liveOn}
        onToggleLive={args.onToggleLive}
        docked={args.docked}
        float={args.float}
        onSelectSource={(next) => args.onRetarget(next)}
        onToggleDock={args.onToggleDock}
        onClose={args.onClose}
      />
    )
  }
  // The REPL-poll ADC sample (raw u16 → volts), or undefined. The passive
  // telemetry reading (already in volts, no raw u16) is passed separately as
  // `liveValue`; the Multimeter prefers it when present.
  const sample: AdcSample | undefined =
    args.live && args.live.value !== undefined ? adcFromU16(args.live.value) : undefined
  return (
    <Multimeter
      conn={conn}
      sources={args.adcConns}
      sample={sample}
      liveValue={args.telemetryReading}
      stats={args.stats}
      live={args.liveOn}
      onToggleLive={args.onToggleLive}
      docked={args.docked}
      float={args.float}
      onSelectSource={(next) => args.onRetarget(next)}
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
    telemetrySamples: r.telemetrySamples,
    telemetryReading: r.telemetryReading,
    liveOn: host.live,
    onToggleLive: host.onToggleLive,
    docked: !float,
    float,
    onToggleDock: () => host.toggleDock(r.it),
    onClose: () => host.closeInstrument(r.it.kind, r.it.conn.variable),
    onRetarget: (to) => host.retargetInstrument(r.it.kind, r.it.conn.variable, to)
  })
}

/**
 * The grouped header rows + the `+ Add` palette trigger, built off the instrument
 * registry (#119). Two engraved groups (`INPUTS` / `OUTPUTS`) of icon-only
 * toggles, so the always-visible row stays readable at 13+ instruments; the
 * `both`-group I²C display lands in INPUTS (sensible default — it reads a bus).
 * In-use instruments (declared by the active file) carry an accent dot.
 */
function DockHeader({
  vis,
  inUse,
  onToggleVisible,
  paletteOpen,
  onTogglePalette
}: {
  vis: InstrumentVisibility
  inUse: Set<string>
  onToggleVisible: (id: string) => void
  paletteOpen: boolean
  onTogglePalette: () => void
}): JSX.Element {
  const { input, output } = groupInstruments()
  const renderToggle = (def: InstrumentDef): JSX.Element => (
    <InstrumentToggle
      key={def.id}
      id={def.id}
      name={def.name}
      accent={def.accent}
      border={def.border}
      icon={def.icon}
      active={isVisible(vis, def.id)}
      inUse={inUse.has(def.id)}
      onToggle={() => onToggleVisible(def.id)}
    />
  )
  return (
    <div className="instr-dock__header">
      <InstrumentToggleGroup label="INPUTS">{input.map(renderToggle)}</InstrumentToggleGroup>
      <InstrumentToggleGroup label="OUTPUTS">{output.map(renderToggle)}</InstrumentToggleGroup>
      <AddInstrumentButton open={paletteOpen} onClick={onTogglePalette} />
    </div>
  )
}

/**
 * The `+ Add instrument` palette: a grouped catalogue (icon + name + one-line
 * description + in/out group) so EVERY instrument is reachable in ≤2 clicks even
 * though the always-visible toggle row stays uncluttered. A search box filters
 * by name/description ({@link filterPalette}); clicking an entry toggles its
 * visibility and closes the palette. Already-visible entries read as active.
 */
function AddInstrumentPalette({
  vis,
  inUse,
  onToggleVisible,
  onClose
}: {
  vis: InstrumentVisibility
  inUse: Set<string>
  onToggleVisible: (id: string) => void
  onClose: () => void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const matches = filterPalette(query)
  const { input, output } = groupInstruments(matches)
  const renderRow = (def: InstrumentDef): JSX.Element => {
    const active = isVisible(vis, def.id)
    return (
      <li key={def.id}>
        <button
          type="button"
          className={`instr-palette__row${active ? ' instr-palette__row--active' : ''}`}
          style={{ '--toggle-accent': def.accent } as React.CSSProperties}
          onClick={() => {
            onToggleVisible(def.id)
            onClose()
          }}
        >
          <span className="instr-palette__icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" focusable="false">
              <path
                d={def.icon}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <span className="instr-palette__text">
            <span className="instr-palette__name">
              {def.name}
              {inUse.has(def.id) && <span className="instr-palette__inuse">in use</span>}
              {active && <span className="instr-palette__shown">shown</span>}
            </span>
            <span className="instr-palette__desc">{def.description}</span>
          </span>
        </button>
      </li>
    )
  }
  return (
    <div className="instr-palette" role="dialog" aria-label="Add instrument">
      <input
        type="text"
        className="instr-palette__search"
        placeholder="Search instruments…"
        value={query}
        autoFocus
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search instruments"
      />
      <div className="instr-palette__groups">
        {input.length > 0 && (
          <div className="instr-palette__group">
            <span className="instr-palette__group-label">INPUTS</span>
            <ul className="instr-palette__list">{input.map(renderRow)}</ul>
          </div>
        )}
        {output.length > 0 && (
          <div className="instr-palette__group">
            <span className="instr-palette__group-label">OUTPUTS</span>
            <ul className="instr-palette__list">{output.map(renderRow)}</ul>
          </div>
        )}
        {matches.length === 0 && <p className="instr-palette__empty">No instruments match.</p>}
      </div>
    </div>
  )
}

/**
 * THE DOCK REGION — the rightmost panel content (right of chat). Renders the
 * `INSTRUMENT DOCK` header (grouped Inputs/Outputs toggle rows + the `+ Add`
 * palette, all driven by the registry #119), then the visible docked windows:
 * the per-pin scope/meter, the real Plotter, and a {@link PlaceholderInstrument}
 * for every other visible singleton (the #110–#121 panels replace those bodies).
 *
 * Visibility (`vis`) is orthogonal to each instrument's docked state: a hidden
 * id is omitted entirely from the stack so the rest reflow up (no empty gap).
 */
export function InstrumentDockRegion({
  host,
  vis,
  inUse,
  onToggleVisible
}: {
  host: UseInstrumentsResult
  vis: InstrumentVisibility
  /** Instrument ids the active file declares in-use (prominent in the header). */
  inUse: Set<string>
  onToggleVisible: (id: string) => void
}): JSX.Element {
  const [paletteOpen, setPaletteOpen] = useState(false)
  const scopeDocked = host.dockedItems.filter((r) => r.it.kind === 'scope')
  const meterDocked = host.dockedItems.filter((r) => r.it.kind === 'meter')
  // Singleton placeholders to render: every VISIBLE singleton id that isn't the
  // real Plotter (and exists in the registry). Order follows registry order so
  // the dock stack is stable.
  const placeholderDefs = SINGLETON_IDS.filter(
    (id) => id !== 'plotter' && isVisible(vis, id)
  )
    .map((id) => instrumentById(id))
    .filter((d): d is InstrumentDef => d !== undefined)
  return (
    <InstrumentDock
      header={
        <DockHeader
          vis={vis}
          inUse={inUse}
          onToggleVisible={onToggleVisible}
          paletteOpen={paletteOpen}
          onTogglePalette={() => setPaletteOpen((o) => !o)}
        />
      }
    >
      {paletteOpen && (
        <AddInstrumentPalette
          vis={vis}
          inUse={inUse}
          onToggleVisible={onToggleVisible}
          onClose={() => setPaletteOpen(false)}
        />
      )}
      {isVisible(vis, 'scope') &&
        scopeDocked.map((r) => (
          <DockItem key={`scope:${r.it.conn.variable}`}>{renderResolved(r, host)}</DockItem>
        ))}
      {isVisible(vis, 'meter') &&
        meterDocked.map((r) => (
          <DockItem key={`meter:${r.it.conn.variable}`}>{renderResolved(r, host)}</DockItem>
        ))}
      {isVisible(vis, 'plotter') && (
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
      {placeholderDefs.map((def) => (
        <DockItem key={def.id}>
          <PlaceholderInstrument def={def} onClose={() => onToggleVisible(def.id)} />
        </DockItem>
      ))}
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
    isVisible(vis, r.it.kind === 'scope' ? 'scope' : 'meter')
  )
  if (floats.length === 0) return null
  return (
    <div
      className={`instr-floats ${visible ? '' : 'instr-floats--hidden'}`}
      aria-hidden={!visible}
    >
      {floats.map((r) => (
        <FloatingInstrument key={`${r.it.kind}:${r.it.conn.variable}`} r={r} host={host} />
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
