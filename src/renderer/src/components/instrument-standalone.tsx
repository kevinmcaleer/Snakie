import type { InstrumentWindowPayload, InstrumentWindowConn } from '../../../shared/instrument-window'
import type { UsedPins } from './parse-pins'
import { Oscilloscope } from './Oscilloscope'
import { Multimeter } from './Multimeter'
import { Plotter } from './Plotter'
import { InstrumentWindow } from './InstrumentWindow'
import { renderSingleton, useTelemetryFeed } from './InstrumentHost'
import { instrumentById } from './instruments-registry'
import { scopeSamplesFor, meterReadingFor } from './instrument-telemetry-feed'

const noop = (): void => {}

/** Rebuild a renderer {@link UsedPins} from the serialized window payload conn. */
function toUsedPins(conn: InstrumentWindowConn): UsedPins {
  return {
    type: conn.type as UsedPins['type'],
    pins: conn.pins,
    variable: conn.variable,
    constructor: conn.constructor,
    instrument: conn.instrument,
    roles: conn.roles,
    bus: conn.bus
  }
}

/**
 * Render ONE instrument standalone in a detached OS window (issue #205).
 *
 * The instrument is fed by the live device telemetry stream — the main process
 * relays `device:data`/`device:status` to this window — and drives the board via
 * the shared `device.sendControl`/`exec` IPC, exactly like its docked twin. The
 * window's native resize makes the body fill it (see `.instr-window` in
 * InstrumentHost.css), so the Plotter and scope reflow via their ResizeObserver.
 *
 * `onDock` closes this window; the main window then re-docks the instrument. The
 * live REPL-poll fallback stays in the main window — detached instruments rely on
 * the passive telemetry stream (the primary, non-invasive source).
 */
export function StandaloneInstrument({
  payload,
  onDock
}: {
  payload: InstrumentWindowPayload
  onDock: () => void
}): JSX.Element {
  const telemetry = useTelemetryFeed()

  if (payload.kind === 'scope' && payload.conn) {
    const conn = toUsedPins(payload.conn)
    const samples = scopeSamplesFor(telemetry, conn.variable)
    return (
      <Oscilloscope
        conn={conn}
        sources={[conn]}
        fileSource={conn.constructor}
        samples={samples.length > 0 ? samples : undefined}
        docked
        onToggleDock={onDock}
        onClose={onDock}
        onSelectSource={noop}
      />
    )
  }

  if (payload.kind === 'meter' && payload.conn) {
    const conn = toUsedPins(payload.conn)
    return (
      <Multimeter
        conn={conn}
        sources={[conn]}
        liveValue={meterReadingFor(telemetry, conn.variable)}
        docked
        onToggleDock={onDock}
        onClose={onDock}
        onSelectSource={noop}
      />
    )
  }

  // Singletons. The Plotter is rendered specially (it isn't in renderSingleton's
  // switch) and self-subscribes to the device stream.
  if (payload.defId === 'plotter') {
    return (
      <InstrumentWindow
        name="PLOTTER"
        helpId="inst-plotter"
        source="serial · live"
        docked
        onToggleDock={onDock}
        onClose={onDock}
      >
        <Plotter />
      </InstrumentWindow>
    )
  }

  const def = payload.defId ? instrumentById(payload.defId) : undefined
  if (def) {
    return renderSingleton(def, onDock, { docked: true, onToggleDock: onDock })
  }

  return (
    <div style={{ padding: 16, fontFamily: 'monospace', color: '#cdd2d8' }}>
      Unknown instrument: {payload.title}
    </div>
  )
}
