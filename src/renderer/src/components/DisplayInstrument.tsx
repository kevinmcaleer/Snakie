import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { reporter } from '../lib/report-error'
import { InstrumentWindow, PhosphorScreen, type FloatProps } from './InstrumentWindow'
import { type InstrumentDef } from './instruments-registry'
import { useTelemetryStream } from './instrument-telemetry-subscribe'
import { useSnakiePresence } from './snakie-presence'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
import { useInstrumentWorkspace } from '../store/workspace'
import { displayDemo, DISPLAY_DEMO_NAME, displaySpiDemo, DISPLAY_SPI_DEMO_NAME } from './display-demo'
import {
  DISPLAY_GEOMETRIES,
  blankGrid,
  buildScreenPayload,
  findScreenPinsInCode,
  fpsFromIntervalMs,
  geometryById,
  i2cBlockForPins,
  i2cPinsValid,
  layoutText,
  readingToView,
  screenAddrPayload,
  screenPinsPayload,
  screenSpiPayload,
  setScreenPinsInCode,
  spiBlockForPins,
  spiPinsValid,
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
  /** Float ⟷ dock toggle (the dock-to-side key) + drag placement when floating. */
  onToggleDock?: () => void
  float?: FloatProps
}

/** The two panel modes. */
type Mode = 'mirror' | 'push'

/** A reasonable starting OLED address label (the common SSD1306). */
const DEFAULT_ADDR = '0x3C'

/** GPIO numbers the SDA / SCL selectors offer (GP0–GP28, the Pico range). */
const GP_PINS = Array.from({ length: 29 }, (_, i) => i)

/** A short list of common SSD1306/SH1106 I²C addresses for the ADDR picker. */
const ADDR_PRESETS = ['0x3C', '0x3D']

/** Fire-and-forget a `screen` control line; swallow errors so the UI never throws. */
function sendScreen(payload: string): void {
  try {
    void window.api?.device?.sendControl?.('screen', payload)?.catch(reporter('screen send'))
  } catch {
    /* offline / no device — the panel still renders any telemetry it has. */
  }
}

export function DisplayInstrument({
  def,
  onClose,
  docked = true,
  onToggleDock,
  float
}: DisplayInstrumentProps): JSX.Element {
  const [mode, setMode] = useState<Mode>('mirror')
  const [geoId, setGeoId] = useState<string>(DISPLAY_GEOMETRIES[0].id)
  const geo = geometryById(geoId)

  const deviceStatus = useDeviceStatus()
  const connected = deviceStatus.state === 'connected'
  const { present } = useSnakiePresence()
  const { openBuffer, openFiles, activeId, updateContent } = useInstrumentWorkspace()

  // The active editor buffer (if any) — the target for the code-sync update + the
  // source we scan for declared SCREEN_SDA / SCREEN_SCL pins to warn on a mismatch.
  const activeFile = useMemo(
    () => openFiles.find((f) => f.id === activeId) ?? null,
    [openFiles, activeId]
  )

  // Sticky "a Snakie program has serviced control this session" flag (mirrors the
  // Range/Buzzer panels): presence is detected from the `SNK READY` heartbeat,
  // which can briefly lapse — and a hard `present` gate would then silently DROP a
  // retarget even though the program is running. So once we've seen a program, we
  // keep sending; a board that has NEVER run one (a bare REPL) still gets nothing
  // (a SNKCMD there just SyntaxErrors). Reset on disconnect.
  const everPresent = useRef(false)
  useEffect(() => {
    if (present) everPresent.current = true
  }, [present])
  useEffect(() => {
    if (!connected) everPresent.current = false
  }, [connected])

  // Only WRITE to the board when connected AND a Snakie program has serviced the
  // control channel (now, or earlier this session).
  const txScreen = useCallback(
    (payload: string): void => {
      if (connected && (present || everPresent.current)) sendScreen(payload)
    },
    [connected, present]
  )

  // --- pin + address selectors ----------------------------------------------
  // The SSD1306 SDA/SCL pins + I²C address the panel drives. Defaults match the
  // demo's SCREEN_SDA / SCREEN_SCL / SCREEN_ADDR so "Run display demo" lines up.
  const [sda, setSda] = useState<number>(0)
  const [scl, setScl] = useState<number>(1)
  const [addr, setAddr] = useState<string>(DEFAULT_ADDR)
  // SPI (ST7789) wiring — used when the selected geometry is `bus: 'spi'`. Defaults
  // are a valid RP2040 SPI0 set (SCK GP18 / MOSI GP19) + common DC/RST/CS pins.
  const [sck, setSck] = useState<number>(18)
  const [mosi, setMosi] = useState<number>(19)
  const [dc, setDc] = useState<number>(16)
  const [rst, setRst] = useState<number>(20)
  const [cs, setCs] = useState<number>(17) // -1 = tied (no CS pin driven)
  const isSpi = geo.bus === 'spi'
  // Shown when a retarget can't reach a live program (offer to run the demo).
  const [prompt, setPrompt] = useState(false)
  // True while opening + running the demo (disables the prompt buttons).
  const [busy, setBusy] = useState(false)

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

  // --- pin / address retarget: send `screen pins …` / `screen addr …` live ----
  // Both pin selectors share one send (the receiver takes the pair atomically); a
  // retarget that can't reach a live program surfaces the demo prompt.
  const retargetPins = useCallback(
    (s: number, c: number): void => {
      txScreen(screenPinsPayload(s, c))
      setPrompt(connected && !present && !everPresent.current)
    },
    [txScreen, connected, present]
  )

  const onSdaChange = useCallback(
    (next: number): void => {
      setSda(next)
      retargetPins(next, scl)
    },
    [scl, retargetPins]
  )

  const onSclChange = useCallback(
    (next: number): void => {
      setScl(next)
      retargetPins(sda, next)
    },
    [sda, retargetPins]
  )

  const onAddrChange = useCallback(
    (next: string): void => {
      setAddr(next)
      txScreen(screenAddrPayload(next))
      setPrompt(connected && !present && !everPresent.current)
    },
    [txScreen, connected, present]
  )

  // --- SPI (ST7789) retarget: send `screen spi <sck> <mosi> <dc> <rst> <cs> <w> <h>`.
  // Every SPI pin selector merges its new value over the current wiring and pushes
  // the full config atomically (the on-device receiver rebuilds the panel each time).
  const retargetSpi = useCallback(
    (next: Partial<{ sck: number; mosi: number; dc: number; rst: number; cs: number }>): void => {
      const v = { sck, mosi, dc, rst, cs, ...next }
      txScreen(screenSpiPayload(v.sck, v.mosi, v.dc, v.rst, v.cs, geo.w ?? 240, geo.h ?? 240))
      setPrompt(connected && !present && !everPresent.current)
    },
    [sck, mosi, dc, rst, cs, geo, txScreen, connected, present]
  )

  // Switch display size: for an ST7789 (SPI) target, the new W×H is part of its
  // config, so push a fresh `spi …` retarget; I²C sizes carry no wire change.
  const onGeoChange = useCallback(
    (id: string): void => {
      setGeoId(id)
      const g = geometryById(id)
      if (g.bus === 'spi') {
        txScreen(screenSpiPayload(sck, mosi, dc, rst, cs, g.w ?? 240, g.h ?? 240))
        setPrompt(connected && !present && !everPresent.current)
      }
    },
    [sck, mosi, dc, rst, cs, txScreen, connected, present]
  )

  // --- demo fallback (mirror RangeInstrument.runDemo) ------------------------
  // Open the display demo in a new tab and run it: interrupt any running program
  // (back to a REPL prompt), drop the demo in the editor, then paste-run it. The
  // demo's inst.start(screen_sda=…, screen_scl=…) brings the control service up
  // (→ READY → present) so the panel's selectors retarget the live display.
  const runDemo = useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      // Wire the demo to the panel's pins — the ST7789 (SPI) demo for a SPI
      // geometry, else the SSD1306 (I²C) demo.
      const [name, src] = isSpi
        ? [DISPLAY_SPI_DEMO_NAME, displaySpiDemo(sck, mosi, dc, rst, cs, geo.w ?? 240, geo.h ?? 240)]
        : [DISPLAY_DEMO_NAME, displayDemo(sda, scl, addr)]
      await window.api.device.interrupt().catch(() => undefined)
      openBuffer(name, src)
      await new Promise((resolve) => setTimeout(resolve, 200))
      await window.api.device.sendData(`\x05${src}\x04`)
      setPrompt(false)
    } catch {
      /* offline — the prompt stays dismissable; the mirror still renders. */
    } finally {
      setBusy(false)
    }
  }, [openBuffer, isSpi, sda, scl, addr, sck, mosi, dc, rst, cs, geo])

  // --- invalid-pin warning (the RP2040 I²C mux) ------------------------------
  // The block the SDA/SCL pair selects (null when invalid → the warning strip).
  const block = i2cBlockForPins(sda, scl)
  const pinsValid = i2cPinsValid(sda, scl)
  // The RP2040 SPI block the SCK/MOSI pair selects (null → the ST7789 pin warning).
  const spiBlock = spiBlockForPins(sck, mosi)
  const spiValid = spiPinsValid(sck, mosi)

  // --- pin mismatch: warn when the open code targets different SDA/SCL pins ---
  // The numeric SCREEN_SDA / SCREEN_SCL declared in the active editor buffer, or
  // null when the code declares none. When either differs from the panel's pin we
  // surface a one-click sync.
  const codePins = useMemo(
    () => (activeFile ? findScreenPinsInCode(activeFile.content) : { sda: null, scl: null }),
    [activeFile]
  )
  const sdaMismatch = codePins.sda !== null && codePins.sda !== sda
  const sclMismatch = codePins.scl !== null && codePins.scl !== scl
  const pinsMismatch = sdaMismatch || sclMismatch

  /** Rewrite the active buffer's SCREEN_SDA / SCREEN_SCL to the panel's pins. */
  const onUpdateCodePins = useCallback((): void => {
    if (!activeFile) return
    updateContent(activeFile.id, setScreenPinsInCode(activeFile.content, sda, scl))
  }, [activeFile, sda, scl, updateContent])

  const onPush = useCallback(async (): Promise<void> => {
    // Push needs a LIVE Snakie program to read the control channel via
    // inst.control.poll(); with the board at a bare REPL the raw
    // `SNKCMD screen …` line is fed to the prompt and fails with
    // `SyntaxError: invalid syntax`. Gate exactly like txScreen and surface the
    // "run the demo" prompt instead of blindly transmitting.
    if (!(connected && (present || everPresent.current))) {
      setPrompt(true)
      return
    }
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
  }, [draft, geo, connected, present])

  // The address shown in the readout / source pill: the live wire address wins,
  // else the panel's configured address (I²C) or the driver name (SPI).
  const shownAddr = liveAddr ?? (isSpi ? 'ST7789' : addr)
  const sizeLabel = geo.label.replace(/^(OLED|LCD|TFT)\s/, '')
  // The title-bar source pill: SPI shows the driver + clock/data pins; I²C the
  // address + SDA/SCL pins.
  const sourcePill = isSpi
    ? `ST7789 · SCK GP${sck}/SDA GP${mosi}`
    : `${shownAddr} · SDA GP${sda}/SCL GP${scl}`

  return (
    <InstrumentWindow
      name={def.name.toUpperCase()}
      helpId={`inst-${def.id}`}
      source={sourcePill}
      docked={docked}
      onClose={onClose}
      onToggleDock={onToggleDock}
      {...float}
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
              onChange={(e) => onGeoChange(e.target.value)}
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

        {/* Demo prompt — shown when an SDA/SCL/addr retarget can't reach a program. */}
        {prompt && (
          <div className="i2cd__prompt" role="alert">
            {connected ? (
              <>
                <p className="i2cd__prompt-msg">No Snakie program is running to drive the display.</p>
                <div className="i2cd__prompt-actions">
                  <button
                    type="button"
                    className="i2cd__btn i2cd__btn--play"
                    onClick={() => void runDemo()}
                    disabled={busy}
                  >
                    {busy ? 'STARTING…' : isSpi ? '▶ Run ST7789 demo' : '▶ Run display demo'}
                  </button>
                  <button
                    type="button"
                    className="i2cd__btn"
                    onClick={() => setPrompt(false)}
                    disabled={busy}
                  >
                    Dismiss
                  </button>
                </div>
                <p className="i2cd__prompt-hint">
                  The mirror reads any board printing <code>SNK SCR</code>; to retarget the
                  display&apos;s pins, open the demo (or run your own program calling{' '}
                  <code>
                    {isSpi
                      ? `inst.start(screen_sck=${sck}, screen_mosi=${mosi})`
                      : `inst.start(screen_sda=${sda}, screen_scl=${scl})`}
                  </code>{' '}
                  + <code>inst.control.poll()</code>).
                </p>
              </>
            ) : (
              <>
                <p className="i2cd__prompt-msg">Connect a board to drive the display.</p>
                <div className="i2cd__prompt-actions">
                  <button type="button" className="i2cd__btn" onClick={() => setPrompt(false)}>
                    Dismiss
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Display wiring: an ST7789 (SPI) SCK/MOSI/DC/RST/CS set or an SSD1306 (I²C)
            SDA/SCL + address, plus a live pill. The selectors send
            `SNKCMD screen spi …` (SPI) or `… pins …` / `… addr …` (I²C). */}
        <div className="i2cd__wiring">
          <div className="i2cd__wiring-head">
            <span className="i2cd__wiring-title">{isSpi ? 'ST7789 · SPI' : 'SSD1306 · I²C'}</span>
            <span
              className={`i2cd__live ${
                !connected ? 'i2cd__live--off' : present ? 'i2cd__live--on' : 'i2cd__live--idle'
              }`}
              title={
                !connected
                  ? 'No board connected — the mirror shows only telemetry it has received.'
                  : present
                    ? 'A Snakie program is running and servicing the display — the selectors retarget the board.'
                    : isSpi
                      ? 'No Snakie program detected. Run the ST7789 demo (or a program that calls inst.start(screen_sck=…, screen_mosi=…) + inst.control.poll()).'
                      : 'No Snakie program detected. Run the display demo (or a program that calls inst.start(screen_sda=…, screen_scl=…) + inst.control.poll()).'
              }
            >
              <span className="i2cd__live-dot" aria-hidden="true" />
              {!connected ? 'no board' : present ? 'program live' : 'no program'}
            </span>
          </div>

          {isSpi ? (
            <>
              <div className="i2cd__pins i2cd__pins--spi">
                <PinField
                  label="SCK"
                  ariaLabel="SPI SCK (clock) pin"
                  value={sck}
                  onChange={(n) => {
                    setSck(n)
                    retargetSpi({ sck: n })
                  }}
                />
                <PinField
                  label="SDA"
                  ariaLabel="SPI MOSI/SDA (data) pin"
                  value={mosi}
                  onChange={(n) => {
                    setMosi(n)
                    retargetSpi({ mosi: n })
                  }}
                />
                <PinField
                  label="DC"
                  ariaLabel="SPI DC (data/command) pin"
                  value={dc}
                  onChange={(n) => {
                    setDc(n)
                    retargetSpi({ dc: n })
                  }}
                />
                <label className="i2cd__field">
                  <span className="i2cd__field-lbl">RST</span>
                  <select
                    className="i2cd__select i2cd__select--pin"
                    value={rst}
                    onChange={(e) => {
                      const n = Number(e.currentTarget.value)
                      setRst(n)
                      retargetSpi({ rst: n })
                    }}
                    aria-label="SPI RST (reset) pin"
                  >
                    <option value={-1}>— tied</option>
                    {GP_PINS.map((p) => (
                      <option key={p} value={p}>
                        GP{p}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="i2cd__field">
                  <span className="i2cd__field-lbl">CS</span>
                  <select
                    className="i2cd__select i2cd__select--pin"
                    value={cs}
                    onChange={(e) => {
                      const n = Number(e.currentTarget.value)
                      setCs(n)
                      retargetSpi({ cs: n })
                    }}
                    aria-label="SPI CS (chip select) pin"
                  >
                    <option value={-1}>— tied</option>
                    {GP_PINS.map((p) => (
                      <option key={p} value={p}>
                        GP{p}
                      </option>
                    ))}
                  </select>
                </label>
                {spiValid && (
                  <span className="i2cd__bus" title={`Valid SPI${spiBlock} SCK/MOSI pair`}>
                    SPI{spiBlock}
                  </span>
                )}
              </div>

              {/* Invalid-pin warning: SCK/MOSI aren't a valid RP2040 SPI pair. */}
              {!spiValid && (
                <div className="i2cd__pinwarn i2cd__pinwarn--bad" role="alert">
                  <span className="i2cd__pinwarn-msg">
                    GP{sck}/GP{mosi} aren&apos;t a valid SPI SCK/MOSI pair — try GP18/GP19 (SPI0) or
                    GP10/GP11 (SPI1).
                  </span>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="i2cd__pins">
                <PinField
                  label="SDA"
                  ariaLabel="I²C SDA pin"
                  value={sda}
                  onChange={(n) => onSdaChange(n)}
                />
                <PinField
                  label="SCL"
                  ariaLabel="I²C SCL pin"
                  value={scl}
                  onChange={(n) => onSclChange(n)}
                />
                <label className="i2cd__field">
                  <span className="i2cd__field-lbl">ADDR</span>
                  <select
                    className="i2cd__select i2cd__select--pin"
                    value={addr}
                    onChange={(e) => onAddrChange(e.target.value)}
                    aria-label="I²C address"
                  >
                    {ADDR_PRESETS.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                </label>
                {pinsValid && (
                  <span className="i2cd__bus" title={`Valid I²C${block} pair`}>
                    I²C{block}
                  </span>
                )}
              </div>

              {/* Invalid-pin warning: the SDA/SCL pair isn't a valid RP2040 I²C pair. */}
              {!pinsValid && (
                <div className="i2cd__pinwarn i2cd__pinwarn--bad" role="alert">
                  <span className="i2cd__pinwarn-msg">
                    GP{sda}/GP{scl} aren&apos;t a valid I²C pair — try GP0/GP1 (I2C0) or GP2/GP3 (I2C1).
                  </span>
                </div>
              )}

              {/* Pin-mismatch strip: the panel retargets the board live, but the open
                  code may still declare different SCREEN_SDA / SCREEN_SCL. Offer a sync. */}
              {pinsMismatch && (
                <div className="i2cd__pinwarn" role="status">
                  <span className="i2cd__pinwarn-msg">
                    Panel pins (SDA GP{sda} · SCL GP{scl}) differ from your code
                    {sdaMismatch ? ` (SDA GP${codePins.sda})` : ''}
                    {sclMismatch ? ` (SCL GP${codePins.scl})` : ''}
                  </span>
                  <button
                    type="button"
                    className="i2cd__btn i2cd__pinwarn-btn"
                    onClick={onUpdateCodePins}
                    title={`Rewrite SCREEN_SDA / SCREEN_SCL in your code to GP${sda} / GP${scl}`}
                  >
                    Update code
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Bottom 3-column readout strip: ADDR/BUS · SIZE · FPS. */}
        <div className="i2cd__readout">
          {isSpi ? <Cell label="BUS" value="SPI" /> : <Cell label="ADDR" value={shownAddr} />}
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
        <defs>
          {/* OLED bloom on lit pixels — an IN-SVG filter (the CSS-filter-on-svg
              equivalent mis-composites to the window's top-left in Chromium). */}
          <filter id="i2cd-px-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="0.4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <rect className="i2cd__px-bg" x="0" y="0" width={Math.max(1, w)} height={Math.max(1, h)} />
        <g filter="url(#i2cd-px-glow)">
          {on.map((p) => (
            <rect key={`${p.x},${p.y}`} className="i2cd__px" x={p.x} y={p.y} width="1" height="1" />
          ))}
        </g>
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

/** A labelled GP-pin selector (GP0–GP28) — shared by the I²C + SPI wiring rows. */
function PinField({
  label,
  ariaLabel,
  value,
  onChange
}: {
  label: string
  ariaLabel: string
  value: number
  onChange: (n: number) => void
}): JSX.Element {
  return (
    <label className="i2cd__field">
      <span className="i2cd__field-lbl">{label}</span>
      <select
        className="i2cd__select i2cd__select--pin"
        value={value}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
        aria-label={ariaLabel}
      >
        {GP_PINS.map((p) => (
          <option key={p} value={p}>
            GP{p}
          </option>
        ))}
      </select>
    </label>
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
