import { useCallback, useState, type CSSProperties } from 'react'
import { InstrumentWindow, PhosphorScreen, type FloatProps } from './InstrumentWindow'
import { type InstrumentDef } from './instruments-registry'
import {
  LED_TARGET,
  digitalPayload,
  pwmPayload,
  rgbPayload,
  stripPayload,
  animPayload,
  hexToRgb,
  rgbToHex,
  formatLevel,
  type LedMode
} from './led-logic'
import './LedInstrument.css'

/**
 * LED INSTRUMENT (#114) — the WRITE panel for digital / PWM / RGB / strip outputs.
 * =============================================================================
 *
 * Drives an LED output from the UI by WRITING IDE→board control lines
 * (`SNKCMD led <payload>\n`, issue #115) through
 * `window.api.device.sendControl('led', payload)`. The payload strings are built
 * by the pure {@link ./led-logic} module so they MATCH the on-device `Led`
 * receiver grammar (`on`/`off`, `pwm <0..1>`, `rgb <r> <g> <b>`), with a
 * forward-compatible `strip …` / `anim …` extension for a NeoPixel/WS2812 strip.
 *
 * Four modes (the `MODE` readout): a **digital** on/off rocker, a **PWM**
 * brightness slider, an **RGB** colour picker, and a **NeoPixel strip** of
 * per-pixel swatches with a couple of simple animations. Output state is
 * reflected locally (optimistic) — the screen glows the current colour/level —
 * since the board doesn't echo its LED state back.
 *
 * Renders through the shared {@link InstrumentWindow} chrome + a
 * {@link PhosphorScreen}, themed to the registry's `led` accent (`#ff6b5e`) via
 * the `--accent` / `--accent-border` custom properties, and closes with the same
 * close→hide model. Bottom strip: **MODE / VALUE / PIXELS**.
 *
 * Sends are fire-and-forget (a control write never enters the raw REPL, so it
 * doesn't interrupt a running program); a rejected send is swallowed (the board
 * may simply not be connected — the optimistic UI still updates).
 */

export interface LedInstrumentProps {
  /** The registry def driving the name, accent and source pill. */
  def: InstrumentDef
  /** Close (hide) this instrument — same close→hide model as the other dock windows. */
  onClose?: () => void
  /** Whether the window is docked (always true in the dock today). */
  docked?: boolean
  /** Float ⟷ dock toggle (the dock-to-side key) + drag placement when floating. */
  onToggleDock?: () => void
  float?: FloatProps
}

/** Number of pixels in the demo NeoPixel strip. */
const STRIP_LEN = 8
/** The default per-pixel colour for a fresh strip. */
const STRIP_DEFAULT = '#1a1d22'

export function LedInstrument({
  def,
  onClose,
  docked = true,
  onToggleDock,
  float
}: LedInstrumentProps): JSX.Element {
  const [mode, setMode] = useState<LedMode>('digital')
  // Optimistic output state, one slice per mode.
  const [on, setOn] = useState(false)
  const [level, setLevel] = useState(0.5)
  const [color, setColor] = useState('#ff6b5e')
  const [pixels, setPixels] = useState<string[]>(() =>
    Array.from({ length: STRIP_LEN }, () => STRIP_DEFAULT)
  )
  const [selPixel, setSelPixel] = useState(0)
  const [anim, setAnim] = useState<string | null>(null)

  /** Send a `led` payload; swallow a rejection (board may be disconnected). */
  const send = useCallback((payload: string): void => {
    void window.api.device.sendControl(LED_TARGET, payload).catch(() => {})
  }, [])

  // --- Mode actions (each updates optimistic state AND writes the payload) ---

  const toggleDigital = useCallback((): void => {
    setOn((prev) => {
      const next = !prev
      send(digitalPayload(next))
      return next
    })
  }, [send])

  const onLevel = useCallback(
    (v: number): void => {
      setLevel(v)
      send(pwmPayload(v))
    },
    [send]
  )

  const onColor = useCallback(
    (hex: string): void => {
      setColor(hex)
      send(rgbPayload(hexToRgb(hex)))
    },
    [send]
  )

  const paintPixel = useCallback(
    (idx: number, hex: string): void => {
      setPixels((prev) => {
        const next = prev.slice()
        next[idx] = hex
        send(stripPayload(next))
        return next
      })
      setAnim(null)
    },
    [send]
  )

  const runAnim = useCallback(
    (name: string): void => {
      setAnim(name)
      send(animPayload(name))
    },
    [send]
  )

  // --- Derived readout + screen glow ----------------------------------------

  const glow =
    mode === 'rgb'
      ? color
      : mode === 'strip'
        ? (pixels[selPixel] ?? STRIP_DEFAULT)
        : mode === 'pwm'
          ? rgbToHex({
              r: Math.round(level * 255),
              g: Math.round(level * 70),
              b: Math.round(level * 50)
            })
          : on
            ? def.accent
            : '#15171a'

  const valueText =
    mode === 'digital'
      ? on
        ? 'ON'
        : 'OFF'
      : mode === 'pwm'
        ? `${Math.round(level * 100)}%`
        : mode === 'rgb'
          ? color.toUpperCase()
          : anim
            ? anim.toUpperCase()
            : 'custom'

  const pixelsText = mode === 'strip' ? `${STRIP_LEN}` : '——'

  return (
    <InstrumentWindow
      name={def.name.toUpperCase()}
      helpId={`inst-${def.id}`}
      source="DIGITAL · PWM · RGB"
      docked={docked}
      onClose={onClose}
      onToggleDock={onToggleDock}
      {...float}
    >
      <div
        className="ledpanel"
        style={
          {
            '--accent': def.accent,
            '--accent-border': def.border,
            '--glow': glow
          } as CSSProperties
        }
      >
        {/* Mode tabs. */}
        <div className="ledpanel__modes" role="tablist" aria-label="LED output mode">
          {(['digital', 'pwm', 'rgb', 'strip'] as LedMode[]).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              className={`ledpanel__mode ${mode === m ? 'ledpanel__mode--active' : ''}`}
              onClick={() => setMode(m)}
            >
              {m === 'pwm' ? 'PWM' : m === 'rgb' ? 'RGB' : m.toUpperCase()}
            </button>
          ))}
        </div>

        {/* The glowing "bulb" screen reflects the current optimistic output. */}
        <PhosphorScreen className="ledpanel__screen">
          <div className="ledpanel__bulb-wrap">
            <span className="ledpanel__bulb" aria-hidden="true" />
            <span className="ledpanel__bulb-label">{valueText}</span>
          </div>
        </PhosphorScreen>

        {/* Per-mode controls. */}
        <div className="ledpanel__controls">
          {mode === 'digital' && (
            <button
              type="button"
              className={`ledpanel__rocker ${on ? 'ledpanel__rocker--on' : ''}`}
              aria-pressed={on}
              onClick={toggleDigital}
            >
              <span className="ledpanel__rocker-track" aria-hidden="true">
                <span className="ledpanel__rocker-knob" />
              </span>
              <span className="ledpanel__rocker-lbl">{on ? 'ON' : 'OFF'}</span>
            </button>
          )}

          {mode === 'pwm' && (
            <label className="ledpanel__slider">
              <span className="ledpanel__slider-lbl">BRIGHTNESS</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={level}
                onChange={(e) => onLevel(Number(e.currentTarget.value))}
                aria-label="PWM brightness"
              />
              <span className="ledpanel__slider-val">{formatLevel(level)}</span>
            </label>
          )}

          {mode === 'rgb' && (
            <label className="ledpanel__color">
              <span className="ledpanel__color-lbl">COLOUR</span>
              <input
                type="color"
                value={color}
                onChange={(e) => onColor(e.currentTarget.value)}
                aria-label="RGB colour"
              />
              <span className="ledpanel__color-val">{color.toUpperCase()}</span>
            </label>
          )}

          {mode === 'strip' && (
            <div className="ledpanel__strip">
              <div className="ledpanel__pixels" role="group" aria-label="NeoPixel strip">
                {pixels.map((px, i) => (
                  <button
                    key={i}
                    type="button"
                    className={`ledpanel__px ${i === selPixel ? 'ledpanel__px--sel' : ''}`}
                    style={{ '--px': px } as CSSProperties}
                    aria-label={`Pixel ${i + 1}`}
                    aria-pressed={i === selPixel}
                    onClick={() => setSelPixel(i)}
                  />
                ))}
              </div>
              <div className="ledpanel__strip-row">
                <label className="ledpanel__color ledpanel__color--inline">
                  <span className="ledpanel__color-lbl">PIXEL {selPixel + 1}</span>
                  <input
                    type="color"
                    value={pixels[selPixel] ?? STRIP_DEFAULT}
                    onChange={(e) => paintPixel(selPixel, e.currentTarget.value)}
                    aria-label={`Pixel ${selPixel + 1} colour`}
                  />
                </label>
                <div className="ledpanel__anims" role="group" aria-label="Strip animations">
                  <button
                    type="button"
                    className={`ledpanel__anim ${anim === 'rainbow' ? 'ledpanel__anim--on' : ''}`}
                    onClick={() => runAnim('rainbow')}
                  >
                    rainbow
                  </button>
                  <button
                    type="button"
                    className={`ledpanel__anim ${anim === 'chase' ? 'ledpanel__anim--on' : ''}`}
                    onClick={() => runAnim('chase')}
                  >
                    chase
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Standard bottom 3-column readout strip: MODE / VALUE / PIXELS. */}
        <div className="ledpanel__readout">
          <Cell
            label="MODE"
            value={mode === 'pwm' ? 'PWM' : mode === 'rgb' ? 'RGB' : mode.toUpperCase()}
          />
          <span className="ledpanel__div" aria-hidden="true" />
          <Cell label="VALUE" value={valueText} />
          <span className="ledpanel__div" aria-hidden="true" />
          <Cell label="PIXELS" value={pixelsText} />
        </div>
      </div>
    </InstrumentWindow>
  )
}

/** One labelled readout cell, mirroring the scope/meter readout strips. */
function Cell({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="ledpanel__cell">
      <span className="ledpanel__cell-lbl">{label}</span>
      <span className="ledpanel__cell-val">{value}</span>
    </div>
  )
}
