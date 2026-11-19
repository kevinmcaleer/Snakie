/**
 * THE EMBED'S BOARD STRIP (#1318) — the board beside the code, with every pin
 * the program uses lit and named.
 *
 * Deliberately not the app's `MiniBoardView`: that one follows the connected
 * device, the open project's robot.yml and the parts libraries, none of which
 * an embed has. This draws a built-in board from the same definitions and the
 * same pad layout, and nothing else.
 */
import { useMemo, type JSX } from 'react'
import { PIN_TYPE_COLOR } from '../components/parse-pins'
import { boardBox, layoutPads, ledPoint, type BoardBox, type PadPoint } from '../components/board-layout'
import type { BoardDefinition, BoardFeature } from '../../../shared/board'
import { pinStateLabel, type EmbedPin, type PinEvent } from './embed-pins'

export type PinLive = Pick<PinEvent, 'kind' | 'value'>

export interface EmbedBoardProps {
  def: BoardDefinition
  boards: readonly BoardDefinition[]
  onBoardChange: (id: string) => void
  pins: readonly EmbedPin[]
  /** Pin id → what the simulator last said it is doing. */
  live: ReadonlyMap<string, PinLive>
  /** Pins to spotlight: the hovered one, or those of the line being pointed at. */
  active: ReadonlySet<string>
  onHover: (id: string | null) => void
  /** A pin was clicked or tapped: show its line. */
  onPick: (id: string) => void
  /** `side`: the board and a list beside the code. `chips`: one row of pins under it. */
  mode: 'side' | 'chips'
}

const VW = 192
const VH = 270
const PAD_R = 4.2

const FEATURE_FILL: Record<BoardFeature['kind'], string> = {
  mcu: '#15171b',
  chip: '#15171b',
  wifi: '#c5c9cf',
  usb: '#c5c9cf',
  led: '#e9edf0'
}

/** A used pad's label sits just outside the board, level with its pad. */
function labelProps(p: PadPoint, box: BoardBox): { x: number; y: number; anchor: 'start' | 'middle' | 'end' } {
  switch (p.edge) {
    case 'left':
      return { x: box.x - 5, y: p.y + 3.2, anchor: 'end' }
    case 'right':
      return { x: box.x + box.w + 5, y: p.y + 3.2, anchor: 'start' }
    case 'top':
      return { x: p.x, y: box.y - 5, anchor: 'middle' }
    default:
      return { x: p.x, y: box.y + box.h + 12, anchor: 'middle' }
  }
}

function stateOf(pin: EmbedPin, live: ReadonlyMap<string, PinLive>): { text: string; level: number } | null {
  const state = live.get(pin.id)
  if (!state) return null
  const level = state.kind === 'p' ? (state.value ? 1 : 0) : Math.max(0, Math.min(65535, state.value)) / 65535
  return { text: pinStateLabel(state), level }
}

function WarningIcon(): JSX.Element {
  return (
    <svg className="snk-board__warn" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
      <path d="M6 1.2l5 9.3H1z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M6 5v2.6M6 9.1v.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

export function EmbedBoard({
  def,
  boards,
  onBoardChange,
  pins,
  live,
  active,
  onHover,
  onPick,
  mode
}: EmbedBoardProps): JSX.Element {
  const box = useMemo(() => boardBox(def.aspect, { cx: VW / 2, cy: VH / 2, maxW: 110, maxH: 250 }), [def])
  const pads = useMemo(() => layoutPads(def, box), [def, box])
  const led = ledPoint(box)
  const byPad = new Map<number, EmbedPin>()
  let ledPin: EmbedPin | null = null
  for (const pin of pins) {
    if (pin.led) ledPin = pin
    else if (pin.padIndex !== null) byPad.set(pin.padIndex, pin)
  }

  const used = (pin: EmbedPin, x: number, y: number, key: string): JSX.Element => {
    const state = stateOf(pin, live)
    const on = active.has(pin.id)
    return (
      <g
        key={key}
        className={`snk-board__pad${on ? ' is-active' : ''}`}
        onPointerEnter={() => onHover(pin.id)}
        onPointerLeave={() => onHover(null)}
        onClick={() => onPick(pin.id)}
      >
        {on && <circle cx={x} cy={y} r={PAD_R + 5.5} className="snk-board__halo" />}
        {state && state.level > 0 && (
          <circle cx={x} cy={y} r={PAD_R + 2.6} className="snk-board__lit" style={{ opacity: 0.35 + 0.65 * state.level }} />
        )}
        <circle cx={x} cy={y} r={PAD_R} fill={PIN_TYPE_COLOR[pin.type]} stroke="#fff" strokeWidth="1.4" />
        {/* A bigger target than the 8px pad, for a finger. */}
        <circle cx={x} cy={y} r={10} fill="transparent" />
      </g>
    )
  }

  const list = (
    <ul className="snk-board__pins">
      {pins.map((pin) => {
        const state = stateOf(pin, live)
        const problem = !pin.onBoard ? `Not on this board` : pin.shared ? 'Set up twice' : null
        return (
          <li key={pin.id}>
            <button
              type="button"
              className={`snk-board__pin${active.has(pin.id) ? ' is-active' : ''}${problem ? ' has-problem' : ''}`}
              onPointerEnter={() => onHover(pin.id)}
              onPointerLeave={() => onHover(null)}
              onFocus={() => onHover(pin.id)}
              onBlur={() => onHover(null)}
              onClick={() => onPick(pin.id)}
              title={
                pin.setupLines.length > 0
                  ? `${pin.id}: line ${pin.setupLines.join(', ')}${pin.variable ? ` (${pin.variable})` : ''}`
                  : pin.id
              }
            >
              {pin.onBoard ? (
                <span className="snk-board__dot" style={{ background: PIN_TYPE_COLOR[pin.type] }} aria-hidden="true" />
              ) : (
                <WarningIcon />
              )}
              <span className="snk-board__id">{pin.id}</span>
              <span className="snk-board__kind">{problem ?? pin.kind}</span>
              {state && !problem && (
                <span className={`snk-board__state${state.level > 0 ? ' is-on' : ''}`}>{state.text}</span>
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )

  if (mode === 'chips') {
    return (
      <aside className="snk-board snk-board--chips" aria-label="Pins this code uses">
        <span className="snk-board__title">Pins</span>
        {list}
      </aside>
    )
  }

  return (
    <aside className="snk-board snk-board--side" aria-label="Pins this code uses">
      <div className="snk-board__head">
        <span className="snk-board__title">Pins in this code</span>
        <select
          className="snk-board__select"
          value={def.id}
          aria-label="Board"
          onChange={(e) => onBoardChange(e.target.value)}
        >
          {boards.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>
      <div className="snk-board__work">
        <svg
          className="snk-board__svg"
          viewBox={`0 0 ${VW} ${VH}`}
          role="img"
          aria-label={`${def.name} with ${pins.filter((p) => p.onBoard).length} pins in use`}
        >
          <rect
            x={box.x}
            y={box.y}
            width={box.w}
            height={box.h}
            rx="9"
            fill={def.pcbColor || '#1f7a44'}
            stroke="rgba(0,0,0,.35)"
            strokeWidth="1.2"
          />
          {(def.features ?? [])
            .filter((f) => f.kind !== 'led')
            .map((f, i) => (
              <rect
                key={`f${i}`}
                x={box.x + f.x * box.w}
                y={box.y + f.y * box.h}
                width={f.w * box.w}
                height={f.h * box.h}
                rx="2.5"
                fill={FEATURE_FILL[f.kind]}
                stroke="rgba(0,0,0,.35)"
                strokeWidth="0.8"
              />
            ))}
          {pads.map((p, i) => (byPad.has(i) ? null : <circle key={`h${i}`} cx={p.x} cy={p.y} r={2.3} className="snk-board__hole" />))}
          {pads.map((p, i) => {
            const pin = byPad.get(i)
            if (!pin) return null
            const l = labelProps(p, box)
            return (
              <text
                key={`t${i}`}
                x={l.x}
                y={l.y}
                textAnchor={l.anchor}
                className={`snk-board__label${active.has(pin.id) ? ' is-active' : ''}`}
              >
                {pin.id}
              </text>
            )
          })}
          {pads.map((p, i) => {
            const pin = byPad.get(i)
            return pin ? used(pin, p.x, p.y, `u${i}`) : null
          })}
          {ledPin ? (
            <>
              <text x={led.x} y={led.y + 15} textAnchor="middle" className="snk-board__silk">
                LED
              </text>
              {used(ledPin, led.x, led.y, 'led')}
            </>
          ) : (
            def.ledLabel && <circle cx={led.x} cy={led.y} r={2.6} className="snk-board__hole" />
          )}
        </svg>
        {list}
      </div>
    </aside>
  )
}

export default EmbedBoard
