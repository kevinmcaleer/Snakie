import { useCallback, useState, type CSSProperties } from 'react'
import { InstrumentWindow, type FloatProps } from './InstrumentWindow'
import { type InstrumentDef } from './instruments-registry'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
import { useWorkspace } from '../store/workspace'
import { SAM_DEMO, SAM_DEMO_NAME } from './sam-demo'
import './SamInstrument.css'

/**
 * SAM — Software Automated Mouth (#167).
 * =============================================================================
 *
 * Type into the speech bubble, pick the buzzer/speaker pin, and SPEAK: the IDE
 * makes sure the `sam` library is on the board (mip-installing it from
 * github:kevinmcaleer/sam — which carries the `sam_render.mpy` native
 * accelerator — when it's missing), then exec-s `SAM(pin=N).say("…")` so the
 * board synthesises the text out of that single pin. "Open demo" drops a small
 * runnable `sam_demo.py` into the editor. Library: https://github.com/kevinmcaleer/sam
 */

/** The exec snippet that speaks `text` out of `pin` via the SAM library. */
function saySnippet(pin: number, text: string): string {
  // JSON.stringify yields a valid double-quoted Python string literal (the \n,
  // \", \\, \uXXXX escapes all match), so arbitrary user text is safe to embed.
  return `from sam import SAM\nSAM(pin=${pin}).say(${JSON.stringify(text)})`
}

export interface SamInstrumentProps {
  def: InstrumentDef
  onClose?: () => void
  docked?: boolean
  onToggleDock?: () => void
  float?: FloatProps
}

type SamState = 'idle' | 'installing' | 'speaking'

export function SamInstrument({ def, onClose, docked = true, onToggleDock, float }: SamInstrumentProps): JSX.Element {
  const status = useDeviceStatus()
  const connected = status.state === 'connected'
  const { openBuffer } = useWorkspace()

  const [text, setText] = useState('Hello, I am Sam')
  const [pin, setPin] = useState(0)
  const [state, setState] = useState<SamState>('idle')
  const [error, setError] = useState<string | null>(null)

  const busy = state !== 'idle'

  const speak = useCallback(async () => {
    if (!connected || !text.trim() || busy) return
    setError(null)
    try {
      // Ensure the SAM library (+ its sam_render.mpy accelerator) is on the board.
      // `packages.install` mip-installs any name / github: / https: spec (the
      // catalog-based `modules.install` has no `sam` entry), returning {ok, log}.
      const present = await window.api.modules.probeInstalled(['sam'])
      if (!present.includes('sam')) {
        setState('installing')
        const res = await window.api.packages.install('github:kevinmcaleer/sam')
        if (!res.ok) {
          setError(`Couldn't install SAM: ${res.log.split('\n').filter(Boolean).pop() ?? 'mip failed'}`)
          return
        }
      }
      setState('speaking')
      const r = await window.api.device.exec(saySnippet(pin, text.trim()))
      const err = (r.stderr ?? '').trim()
      if (err) setError(err.split('\n').filter(Boolean).pop() ?? 'Speak failed.')
    } catch {
      setError('Speak failed — is the board connected?')
    } finally {
      setState('idle')
    }
  }, [connected, text, pin, busy])

  const stateLabel =
    state === 'installing' ? 'Installing SAM…' : state === 'speaking' ? 'Speaking…' : 'Ready'

  return (
    <InstrumentWindow
      name={def.name.toUpperCase()}
      source={`PIN ${pin}`}
      docked={docked}
      onClose={onClose}
      onToggleDock={onToggleDock}
      {...float}
    >
      <div className="sam" style={{ '--accent': def.accent, '--accent-border': def.border } as CSSProperties}>
        <div className="sam__bubble">
          <textarea
            className="sam__text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type something for SAM to say…"
            rows={2}
            aria-label="Text for SAM to speak"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                void speak()
              }
            }}
          />
        </div>

        <div className="sam__controls">
          <label className="sam__pin">
            <span>BUZZER PIN</span>
            <input
              type="number"
              min={0}
              max={48}
              value={pin}
              onChange={(e) => setPin(Math.max(0, Math.min(48, Number(e.target.value) || 0)))}
              aria-label="Buzzer pin (GPIO number)"
            />
          </label>
          <button
            type="button"
            className="sam__speak"
            onClick={() => void speak()}
            disabled={!connected || busy || !text.trim()}
            title={connected ? 'Speak the text via the buzzer pin (Ctrl/Cmd+Enter)' : 'Connect a board first'}
          >
            {state === 'speaking' ? 'SPEAKING…' : state === 'installing' ? 'INSTALLING…' : '🔊 SPEAK'}
          </button>
        </div>

        <div className="sam__foot">
          <span className={`sam__status${error ? ' sam__status--error' : ''}`}>
            {error ?? (connected ? stateLabel : 'Connect a board to speak.')}
          </span>
          <button
            type="button"
            className="sam__demo"
            onClick={() => openBuffer(SAM_DEMO_NAME, SAM_DEMO)}
            title="Open a runnable SAM demo program in the editor"
          >
            Open demo
          </button>
        </div>
      </div>
    </InstrumentWindow>
  )
}
