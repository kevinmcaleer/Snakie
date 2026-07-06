import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { reporter } from '../lib/report-error'
import { InstrumentWindow, PhosphorScreen, type FloatProps } from './InstrumentWindow'
import { type InstrumentDef } from './instruments-registry'
import { useSnakiePresence } from './snakie-presence'
import { useDeviceStatus } from '../hooks/useDeviceStatus'
import { useWorkspace } from '../store/workspace'
import { buzzerDemo, BUZZER_DEMO_NAME } from './buzzer-demo'
import {
  CHROMATIC,
  buzzerPinPayload,
  buzzerSeqPayload,
  buzzerStopPayload,
  buzzerTonePayload,
  buzzerVolPayload,
  transposeAndScale,
  findBuzzerPinInCode,
  fmtFreq,
  freqToStaff,
  insertRest,
  melodyDurationMs,
  melodyToCodeSnippet,
  melodyToMicroPython,
  moveNote,
  parseRtttl,
  removeNote,
  setBuzzerPinInCode,
  stepFreq,
  type StaffPos,
  type Tone
} from './buzzer-logic'
import './BuzzerInstrument.css'

/**
 * BUZZER / MUSIC PLAYER (#113) — a real dock instrument body for a piezo buzzer
 * on a PWM pin.
 * =============================================================================
 *
 * Self-contained panel rendered through the shared {@link InstrumentWindow} +
 * {@link PhosphorScreen} chrome (same prop shape as `PlaceholderInstrument`):
 *
 *   - a small PIANO KEYBOARD (one octave) — clicking a key sounds the note live
 *     (a WebAudio preview in the IDE) AND writes a `buzzer tone …` control line
 *     so a connected board plays it;
 *   - an EDITABLE NOTE/MELODY SEQUENCER — append clicked keys, DRAG chips to
 *     reorder, CLICK a chip to remove it, insert rests, and PLAY it back as one
 *     compact `buzzer seq …` line (local WebAudio + on-device);
 *   - a MUSICAL STAFF row that, during Play, places each note on a 5-line staff
 *     and highlights the currently-playing note;
 *   - an RTTTL paste box — paste a ringtone, PLAY it (parsed → a `seq` line), or
 *     load it into the editable sequencer;
 *   - TEMPO (note length) + VOLUME (PWM duty) sliders, a buzzer PIN picker (a
 *     `buzzer pin <n>` line on change), a STOP that silences the buzzer, and an
 *     EXPORT that copies a runnable `Pin`/`PWM` MicroPython melody to clipboard.
 *
 * Presence-aware (mirrors {@link WifiScanInstrument}): when a Snakie program is
 * live (`SNK READY` heartbeat via {@link useSnakiePresence}) the panel drives it
 * over the control channel; when none is, ▶ Play offers to open + run the bundled
 * `buzzer_demo.py` (which does `inst.start(buzzer_pin=15)`), or Dismiss. The
 * local WebAudio preview always plays so keys click audibly in the IDE.
 *
 * The on-device receiver (`micropython/instruments.py` `Buzzer` +
 * `docs/instruments-library.md`) attests the grammar this writes:
 * `tone <freq> <ms>`, `seq <freq:ms>,…`, `stop`, `pin <n>` — built by
 * `buzzer-logic`'s payload helpers and sent via `sendControl('buzzer', payload)`.
 */

export interface BuzzerInstrumentProps {
  /** The registry def driving the name, accent, icon and source pill. */
  def: InstrumentDef
  /** Close (hide) this instrument — same close→hide model as the other windows. */
  onClose?: () => void
  /** Whether the window is docked (always true in the dock today). */
  docked?: boolean
  /** Float ⟷ dock toggle (the dock-to-side key) + drag placement when floating. */
  onToggleDock?: () => void
  float?: FloatProps
}

/** The single octave of keys the on-screen keyboard renders. */
const KEYBOARD_OCTAVE_DEFAULT = 4

/** Tempo presets (note length in ms for a sequencer step) the slider spans. */
const MIN_NOTE_MS = 80
const MAX_NOTE_MS = 600
/** The tempo at which a built melody plays unchanged (the default note length). */
const BASE_TEMPO_MS = 220

/** A short, recognisable RTTTL placeholder so the box reads as "paste here". */
const RTTTL_PLACEHOLDER = 'Nokia:d=4,o=5,b=125:8e6,8d6,4f#,4g#,8c#6,8b,4d,4e,8b,8a,4c#,4e,2a'

/** Fire-and-forget a control line; swallow errors so the UI never throws. */
function sendBuzzer(payload: string): void {
  try {
    void window.api?.device?.sendControl?.('buzzer', payload)?.catch(reporter('buzzer send'))
  } catch {
    /* offline / no device — the local WebAudio preview still plays. */
  }
}

export function BuzzerInstrument({
  def,
  onClose,
  docked = true,
  onToggleDock,
  float
}: BuzzerInstrumentProps): JSX.Element {
  const deviceStatus = useDeviceStatus()
  const connected = deviceStatus.state === 'connected'
  const { present } = useSnakiePresence()
  const { openBuffer, openFiles, activeId, updateContent } = useWorkspace()

  // The active editor buffer (if any) — the target for "Paste to code" + the
  // source we scan for a declared buzzer pin to warn on a mismatch.
  const activeFile = useMemo(
    () => openFiles.find((f) => f.id === activeId) ?? null,
    [openFiles, activeId]
  )

  // Sticky "a Snakie program has serviced control this session" flag. Presence
  // is detected from the `SNK READY` heartbeat, which can briefly lapse (a busy
  // loop, a slow tick) — and a hard `present` gate would then silently DROP a ▶
  // Play even though the program is running. So once we've seen a program, we
  // keep sending; a board that has NEVER run one (a bare REPL) still gets
  // nothing (a SNKCMD there just SyntaxErrors). Reset on disconnect.
  const everPresent = useRef(false)
  useEffect(() => {
    if (present) everPresent.current = true
  }, [present])
  useEffect(() => {
    if (!connected) everPresent.current = false
  }, [connected])

  // Only WRITE to the board when connected AND a Snakie program has serviced the
  // control channel (now, or earlier this session). The local WebAudio preview
  // is separate and always plays, so the keyboard still sounds in the IDE.
  const txBuzzer = useCallback(
    (payload: string): void => {
      if (connected && (present || everPresent.current)) sendBuzzer(payload)
    },
    [connected, present]
  )

  // --- Controls --------------------------------------------------------------
  const [pin, setPin] = useState(15)
  const [octave, setOctave] = useState(KEYBOARD_OCTAVE_DEFAULT)
  const [noteMs, setNoteMs] = useState(220) // sequencer step length (tempo)
  const [volume, setVolume] = useState(0.5) // 0..1 → PWM duty
  const [melody, setMelody] = useState<Tone[]>([])
  const [rtttl, setRtttl] = useState('')
  const [status, setStatus] = useState<'standby' | 'playing'>('standby')
  const [lastFreq, setLastFreq] = useState<number | null>(null)
  const [activeKey, setActiveKey] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)
  // Shown when ▶ Play can't reach a live program (offer to run the demo).
  const [prompt, setPrompt] = useState(false)
  // True while opening + running the demo (disables the prompt buttons).
  const [busy, setBusy] = useState(false)
  // The melody index currently sounding during Play (drives the staff highlight
  // + the chip "playing" state); null when idle.
  const [playingIdx, setPlayingIdx] = useState<number | null>(null)
  // The melody snapshot shown on the staff (set when Play starts).
  const [staffNotes, setStaffNotes] = useState<Tone[]>([])
  // Drag-reorder state: the index being dragged (HTML5 drag).
  const [dragIdx, setDragIdx] = useState<number | null>(null)

  // --- WebAudio preview (lazy, single shared context) ------------------------
  const audioRef = useRef<AudioContext | null>(null)
  const oscRef = useRef<OscillatorNode | null>(null)
  const gainRef = useRef<GainNode | null>(null)
  // Tracks any in-flight scheduled-playback timers so STOP can cancel them.
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  const getAudio = useCallback((): AudioContext | null => {
    if (typeof window === 'undefined') return null
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    if (!audioRef.current) {
      try {
        audioRef.current = new Ctor()
      } catch {
        return null
      }
    }
    return audioRef.current
  }, [])

  /** Start/continue a tone at `freq` Hz locally (0 ⇒ silence). */
  const previewOn = useCallback(
    (freq: number): void => {
      const ctx = getAudio()
      if (!ctx) return
      if (ctx.state === 'suspended') void ctx.resume()
      if (!oscRef.current) {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'square' // buzzer-like timbre
        gain.gain.value = 0
        osc.connect(gain).connect(ctx.destination)
        osc.start()
        oscRef.current = osc
        gainRef.current = gain
      }
      const gain = gainRef.current!
      const osc = oscRef.current!
      if (freq > 0) {
        osc.frequency.setValueAtTime(freq, ctx.currentTime)
        gain.gain.setTargetAtTime(Math.max(0, Math.min(1, volume)) * 0.2, ctx.currentTime, 0.005)
      } else {
        gain.gain.setTargetAtTime(0, ctx.currentTime, 0.005)
      }
    },
    [getAudio, volume]
  )

  /** Silence the local preview oscillator (keeps it alive for reuse). */
  const previewOff = useCallback((): void => {
    const ctx = audioRef.current
    const gain = gainRef.current
    if (ctx && gain) gain.gain.setTargetAtTime(0, ctx.currentTime, 0.01)
  }, [])

  /** Cancel every scheduled playback timer + silence everything (STOP). */
  const stopAll = useCallback((): void => {
    for (const t of timersRef.current) clearTimeout(t)
    timersRef.current = []
    previewOff()
    txBuzzer(buzzerStopPayload())
    setStatus('standby')
    setActiveKey(null)
    setPlayingIdx(null)
  }, [previewOff, txBuzzer])

  // Tear the audio graph down on unmount.
  useEffect(() => {
    return () => {
      for (const t of timersRef.current) clearTimeout(t)
      timersRef.current = []
      try {
        oscRef.current?.stop()
      } catch {
        /* already stopped */
      }
      void audioRef.current?.close()
    }
  }, [])

  // --- Keyboard --------------------------------------------------------------
  /** Play a single note now: local preview + on-device tone + record last freq. */
  const playNote = useCallback(
    (freq: number, ms: number): void => {
      setLastFreq(freq > 0 ? freq : null)
      previewOn(freq)
      txBuzzer(buzzerTonePayload(freq, ms))
      const off = setTimeout(() => previewOff(), ms)
      timersRef.current.push(off)
    },
    [previewOn, previewOff, txBuzzer]
  )

  const onKeyDown = useCallback(
    (step: number): void => {
      const freq = stepFreq(step, octave)
      setActiveKey(step)
      playNote(freq, noteMs)
    },
    [octave, noteMs, playNote]
  )

  const onKeyUp = useCallback((): void => {
    setActiveKey(null)
    previewOff()
  }, [previewOff])

  /** Append the played key to the sequencer melody. */
  const appendKey = useCallback(
    (step: number): void => {
      const freq = stepFreq(step, octave)
      setMelody((m) => [...m, { freq, ms: noteMs, label: `${CHROMATIC[step].name}${octave}` }])
    },
    [octave, noteMs]
  )

  // --- Sequencer playback ----------------------------------------------------
  /**
   * Play a list of timed tones back-to-back: locally via WebAudio AND on-device
   * as ONE compact `buzzer seq …` line (the board plays the pairs on core 1). The
   * staff highlights the currently-playing note as the local schedule advances.
   */
  const playSequence = useCallback(
    (notes: Tone[]): void => {
      if (notes.length === 0) return
      stopAll()
      // Apply the live OCTAVE (transpose) + TEMPO (time-scale) controls AT PLAYBACK
      // so the sliders affect an already-built melody — both the local preview and
      // the on-device seq.
      const eff = transposeAndScale(notes, octave - KEYBOARD_OCTAVE_DEFAULT, noteMs / BASE_TEMPO_MS)
      setStatus('playing')
      setStaffNotes(eff)
      // On-device: (re)target the pin + set the VOLUME (duty), then hand the whole
      // melody over in one seq command.
      txBuzzer(buzzerPinPayload(pin))
      txBuzzer(buzzerVolPayload(volume))
      txBuzzer(buzzerSeqPayload(eff))
      // Locally: schedule the (transformed) notes for an audible IDE preview.
      let when = 0
      eff.forEach((n, i) => {
        const at = when
        const t = setTimeout(() => {
          setLastFreq(n.freq > 0 ? n.freq : null)
          setPlayingIdx(i)
          previewOn(n.freq)
        }, at)
        timersRef.current.push(t)
        when += n.ms
      })
      const done = setTimeout(() => {
        previewOff()
        setStatus('standby')
        setPlayingIdx(null)
      }, when)
      timersRef.current.push(done)
    },
    [octave, noteMs, pin, volume, previewOn, previewOff, stopAll, txBuzzer]
  )

  /**
   * ▶ Play the melody. Presence-aware: when no Snakie program is live, surface
   * the prompt to open + run the demo instead of sending into the void. The local
   * preview + staff still play regardless once a program is present (or after the
   * demo starts).
   */
  const onPlayMelody = useCallback((): void => {
    if (melody.length === 0) return
    // Always play the local WebAudio preview + staff; playSequence's sticky send
    // drives the board. Only nudge to run the demo if we've NEVER seen a Snakie
    // program — otherwise the send handles it and a "no program" prompt is wrong.
    playSequence(melody)
    setPrompt(connected && !present && !everPresent.current)
  }, [melody, connected, present, playSequence])

  // --- Editable melody (drag reorder / click remove / insert rest) -----------
  const addRest = useCallback((): void => {
    setMelody((m) => insertRest(m, m.length, noteMs))
  }, [noteMs])

  const clearMelody = useCallback((): void => setMelody([]), [])

  const removeLast = useCallback((): void => setMelody((m) => m.slice(0, -1)), [])

  /** Click a chip → remove that note from the melody. */
  const onChipRemove = useCallback((index: number): void => {
    setMelody((m) => removeNote(m, index))
  }, [])

  /** HTML5 drag-drop reorder: drop the dragged chip onto another chip's slot. */
  const onChipDrop = useCallback(
    (to: number): void => {
      setMelody((m) => (dragIdx === null ? m : moveNote(m, dragIdx, to)))
      setDragIdx(null)
    },
    [dragIdx]
  )

  // --- RTTTL -----------------------------------------------------------------
  const parsedRtttl = useMemo(() => (rtttl.trim() ? parseRtttl(rtttl) : null), [rtttl])

  /** Play the pasted RTTTL: locally as timed tones + a single on-device seq line. */
  const playRtttl = useCallback((): void => {
    if (!parsedRtttl || parsedRtttl.notes.length === 0) return
    playSequence(parsedRtttl.notes)
    setPrompt(connected && !present && !everPresent.current)
  }, [parsedRtttl, connected, present, playSequence])

  /** Load the parsed RTTTL into the editable sequencer melody. */
  const rtttlToMelody = useCallback((): void => {
    if (parsedRtttl) setMelody(parsedRtttl.notes)
  }, [parsedRtttl])

  // --- Demo fallback (mirror WifiScanInstrument.runDemo) ---------------------
  /**
   * Open the buzzer demo in a new tab and run it: interrupt any running program
   * (back to a REPL prompt), drop the demo in the editor, then paste-run it. The
   * demo's `inst.start(buzzer_pin=15)` brings the control service up (→ READY →
   * present) so the panel's keys/melody drive the speaker.
   */
  const runDemo = useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      const src = buzzerDemo(pin) // wire the demo to the panel's selected pin
      await window.api.device.interrupt().catch(() => undefined)
      openBuffer(BUZZER_DEMO_NAME, src)
      await new Promise((resolve) => setTimeout(resolve, 200))
      await window.api.device.sendData(`\x05${src}\x04`)
      setPrompt(false)
    } catch {
      /* offline — the prompt stays dismissable; local preview still works */
    } finally {
      setBusy(false)
    }
  }, [openBuffer, pin])

  // --- PIN selector: retarget the on-device PWM pin --------------------------
  const onPinChange = useCallback(
    (next: number): void => {
      setPin(next)
      txBuzzer(buzzerPinPayload(next))
    },
    [txBuzzer]
  )

  // VOLUME sets both the local WebAudio gain (via `volume` in previewOn) and the
  // board's PWM duty (sent live so it applies to the next key/▶ Play too).
  const onVolumeChange = useCallback(
    (next: number): void => {
      setVolume(next)
      txBuzzer(buzzerVolPayload(next))
    },
    [txBuzzer]
  )

  // --- Paste to code: drop a melody snippet into the active editor buffer -----
  /**
   * Insert a generated melody snippet ({@link melodyToCodeSnippet}) into the
   * user's program so the tune lives in their code (Snakie-library recipe +
   * runnable plain-MicroPython loop, both on the panel's current `pin`). Appends
   * to the active buffer with a blank-line separator; if no file is open, opens a
   * fresh `buzzer_melody.py` buffer with the snippet. No-op on an empty melody.
   */
  const onPasteToCode = useCallback((): void => {
    if (melody.length === 0) return
    const snippet = melodyToCodeSnippet(melody, pin)
    if (activeFile) {
      updateContent(activeFile.id, `${activeFile.content}\n\n${snippet}`)
    } else {
      openBuffer('buzzer_melody.py', snippet)
    }
  }, [melody, pin, activeFile, updateContent, openBuffer])

  // --- Pin mismatch: warn when the open code targets a different pin ----------
  // The numeric buzzer pin declared in the active editor buffer, or null when the
  // code declares none (no warning then). When it differs from the panel's pin we
  // surface a one-click "update code" to retarget the code to the panel's pin.
  const codePin = useMemo(
    () => (activeFile ? findBuzzerPinInCode(activeFile.content) : null),
    [activeFile]
  )
  const pinMismatch = codePin !== null && codePin !== pin

  /** Rewrite the active buffer's buzzer pin to the panel's current pin. */
  const onUpdateCodePin = useCallback((): void => {
    if (!activeFile) return
    updateContent(activeFile.id, setBuzzerPinInCode(activeFile.content, pin))
  }, [activeFile, pin, updateContent])

  // --- Export ----------------------------------------------------------------
  const exportCode = useMemo(
    () => melodyToMicroPython(melody, { pin, duty: volume }),
    [melody, pin, volume]
  )

  const onExport = useCallback((): void => {
    try {
      void navigator.clipboard?.writeText(exportCode)
      setCopied(true)
      const t = setTimeout(() => setCopied(false), 1400)
      timersRef.current.push(t)
    } catch {
      /* clipboard blocked — code is still shown in the title attr */
    }
  }, [exportCode])

  // --- Derived readouts ------------------------------------------------------
  const totalMs = useMemo(() => melodyDurationMs(melody), [melody])
  const bpm = Math.round(60000 / Math.max(1, noteMs * 2)) // rough beats/min from step len

  const source = useMemo(() => `PWM · GP${pin}`, [pin])

  return (
    <InstrumentWindow
      name={def.name.toUpperCase()}
      helpId={`inst-${def.id}`}
      source={source}
      docked={docked}
      onClose={onClose}
      onToggleDock={onToggleDock}
      {...float}
    >
      <div
        className="buzzer"
        style={
          {
            '--accent': def.accent,
            '--accent-border': def.border
          } as CSSProperties
        }
      >
        <PhosphorScreen className="buzzer__screen">
          <div className="buzzer__readout-now" aria-hidden="true">
            <span className="buzzer__big">{fmtFreq(lastFreq)}</span>
            <span className="buzzer__small">
              {status === 'playing' ? '▶ playing' : '■ standby'}
            </span>
          </div>

          {/* The piano keyboard — one octave. White keys are the row; black keys
              overlay between them. Pointer-down sounds + (with shift held) appends. */}
          <div className="buzzer__keys" role="group" aria-label="Piano keyboard">
            {CHROMATIC.map((k, step) =>
              k.sharp ? null : (
                <button
                  key={step}
                  type="button"
                  className={`buzzer__key buzzer__key--white${
                    activeKey === step ? ' is-active' : ''
                  }`}
                  onPointerDown={(e) => {
                    onKeyDown(step)
                    if (e.shiftKey) appendKey(step)
                  }}
                  onPointerUp={onKeyUp}
                  onPointerLeave={onKeyUp}
                  title={`${k.name}${octave} — ${Math.round(stepFreq(step, octave))} Hz (Shift-click to add)`}
                  aria-label={`Play ${k.name}${octave}`}
                >
                  <span className="buzzer__key-lbl">{k.name}</span>
                </button>
              )
            )}
            {/* Black keys positioned over the white row by their step. */}
            <div className="buzzer__blacks" aria-hidden="false">
              {CHROMATIC.map((k, step) =>
                k.sharp ? (
                  <button
                    key={step}
                    type="button"
                    className={`buzzer__key buzzer__key--black buzzer__key--at-${step}${
                      activeKey === step ? ' is-active' : ''
                    }`}
                    onPointerDown={(e) => {
                      onKeyDown(step)
                      if (e.shiftKey) appendKey(step)
                    }}
                    onPointerUp={onKeyUp}
                    onPointerLeave={onKeyUp}
                    title={`${k.name}${octave} — ${Math.round(stepFreq(step, octave))} Hz (Shift-click to add)`}
                    aria-label={`Play ${k.name}${octave}`}
                  />
                ) : null
              )}
            </div>
          </div>
        </PhosphorScreen>

        {/* Demo prompt — shown when ▶ Play can't reach a live Snakie program. */}
        {prompt && (
          <div className="buzzer__prompt" role="alert">
            {connected ? (
              <>
                <p className="buzzer__prompt-msg">
                  No Snakie program is running to drive the buzzer.
                </p>
                <div className="buzzer__prompt-actions">
                  <button
                    type="button"
                    className="buzzer__btn buzzer__btn--play"
                    onClick={() => void runDemo()}
                    disabled={busy}
                  >
                    {busy ? 'STARTING…' : '▶ Run buzzer demo'}
                  </button>
                  <button
                    type="button"
                    className="buzzer__btn"
                    onClick={() => setPrompt(false)}
                    disabled={busy}
                  >
                    Dismiss
                  </button>
                </div>
                <p className="buzzer__prompt-hint">
                  Plays in the IDE now; to drive the board, open the demo (or run your
                  own program calling <code>inst.start(buzzer_pin={pin})</code> +{' '}
                  <code>inst.control.poll()</code>).
                </p>
              </>
            ) : (
              <>
                <p className="buzzer__prompt-msg">Connect a board to sound the buzzer.</p>
                <div className="buzzer__prompt-actions">
                  <button
                    type="button"
                    className="buzzer__btn"
                    onClick={() => setPrompt(false)}
                  >
                    Dismiss
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Sequencer strip — the editable melody as draggable, removable chips. */}
        <div className="buzzer__seq" aria-label="Melody sequencer">
          <div className="buzzer__seq-head">
            <span className="buzzer__seq-title">MELODY</span>
            <span
              className={`buzzer__live ${
                !connected
                  ? 'buzzer__live--off'
                  : present
                    ? 'buzzer__live--on'
                    : 'buzzer__live--idle'
              }`}
              title={
                !connected
                  ? 'No board connected — ▶ Play sounds in the IDE only.'
                  : present
                    ? 'A Snakie program is running and servicing the buzzer — ▶ Play drives the board.'
                    : 'No Snakie program detected. Run the buzzer demo (or a program that calls inst.start(buzzer_pin=…) + inst.control.poll()), then ▶ Play.'
              }
            >
              <span className="buzzer__live-dot" aria-hidden="true" />
              {!connected ? 'no board' : present ? 'program live' : 'no program'}
            </span>
            <span className="buzzer__seq-meta">
              {melody.length} note{melody.length === 1 ? '' : 's'} · {totalMs} ms
            </span>
          </div>
          <div className="buzzer__seq-track">
            {melody.length === 0 ? (
              <span className="buzzer__seq-empty">
                Shift-click keys to add notes, or load an RTTTL below
              </span>
            ) : (
              melody.map((n, i) => (
                <button
                  key={i}
                  type="button"
                  draggable
                  onDragStart={() => setDragIdx(i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => onChipDrop(i)}
                  onDragEnd={() => setDragIdx(null)}
                  className={`buzzer__chip${n.freq === 0 ? ' buzzer__chip--rest' : ''}${
                    playingIdx === i ? ' is-playing' : ''
                  }${dragIdx === i ? ' is-dragging' : ''}`}
                  onClick={() => onChipRemove(i)}
                  title={`${n.label ?? fmtFreq(n.freq)} · ${n.ms} ms — drag to reorder, click to remove`}
                  aria-label={`${n.label ?? fmtFreq(n.freq)} — click to remove`}
                >
                  {n.label ?? (n.freq === 0 ? 'P' : `${Math.round(n.freq)}`)}
                </button>
              ))
            )}
          </div>
          <div className="buzzer__seq-actions">
            <button
              type="button"
              className="buzzer__btn buzzer__btn--play"
              onClick={onPlayMelody}
              disabled={melody.length === 0}
            >
              ▶ Play
            </button>
            <button type="button" className="buzzer__btn" onClick={addRest}>
              + Rest
            </button>
            <button
              type="button"
              className="buzzer__btn buzzer__btn--paste"
              onClick={onPasteToCode}
              disabled={melody.length === 0}
              title="Insert this melody as MicroPython into your editor (library + plain-PWM recipes)"
            >
              ↧ Paste to code
            </button>
            <button
              type="button"
              className="buzzer__btn"
              onClick={removeLast}
              disabled={melody.length === 0}
              title="Remove the last note"
            >
              ⌫
            </button>
            <button
              type="button"
              className="buzzer__btn"
              onClick={clearMelody}
              disabled={melody.length === 0}
            >
              Clear
            </button>
          </div>
        </div>

        {/* Musical staff — shows the playing melody, highlighting the live note. */}
        {staffNotes.length > 0 && (
          <Staff notes={staffNotes} playingIdx={playingIdx} />
        )}

        {/* RTTTL paste + play. */}
        <div className="buzzer__rtttl">
          <label className="buzzer__rtttl-lbl" htmlFor={`buzzer-rtttl-${def.id}`}>
            RTTTL RINGTONE
          </label>
          <textarea
            id={`buzzer-rtttl-${def.id}`}
            className="buzzer__rtttl-in"
            value={rtttl}
            onChange={(e) => setRtttl(e.target.value)}
            placeholder={RTTTL_PLACEHOLDER}
            spellCheck={false}
            rows={2}
          />
          <div className="buzzer__rtttl-actions">
            <button
              type="button"
              className="buzzer__btn buzzer__btn--play"
              onClick={playRtttl}
              disabled={!parsedRtttl || parsedRtttl.notes.length === 0}
            >
              ▶ Play RTTTL
            </button>
            <button
              type="button"
              className="buzzer__btn"
              onClick={rtttlToMelody}
              disabled={!parsedRtttl || parsedRtttl.notes.length === 0}
            >
              → Sequencer
            </button>
            <span className="buzzer__rtttl-info">
              {parsedRtttl ? `${parsedRtttl.notes.length} notes` : 'paste a ringtone'}
            </span>
          </div>
        </div>

        {/* Controls — pin, octave, tempo, volume. */}
        <div className="buzzer__controls">
          <label className="buzzer__ctrl">
            <span className="buzzer__ctrl-lbl">PIN (PWM)</span>
            <select
              className="buzzer__select"
              value={pin}
              onChange={(e) => onPinChange(Number(e.target.value))}
            >
              {Array.from({ length: 29 }, (_, i) => i).map((p) => (
                <option key={p} value={p}>
                  GP{p}
                </option>
              ))}
            </select>
          </label>
          {/* Pin-mismatch strip: the panel retargets the board live (onPinChange),
              but the open code may still declare a different buzzer_pin. Offer a
              one-click sync to rewrite the code to match the panel. */}
          {pinMismatch && (
            <div className="buzzer__pinwarn" role="status">
              <span className="buzzer__pinwarn-msg">
                Panel pin GP{pin} differs from your code (GP{codePin})
              </span>
              <button
                type="button"
                className="buzzer__btn buzzer__pinwarn-btn"
                onClick={onUpdateCodePin}
                title={`Rewrite buzzer_pin in your code to GP${pin}`}
              >
                Update code to GP{pin}
              </button>
            </div>
          )}
          <label className="buzzer__ctrl">
            <span className="buzzer__ctrl-lbl">OCTAVE</span>
            <input
              className="buzzer__range"
              type="range"
              min={2}
              max={7}
              step={1}
              value={octave}
              onChange={(e) => setOctave(Number(e.target.value))}
            />
            <span className="buzzer__ctrl-val">{octave}</span>
          </label>
          <label className="buzzer__ctrl">
            <span className="buzzer__ctrl-lbl">TEMPO</span>
            <input
              className="buzzer__range"
              type="range"
              min={MIN_NOTE_MS}
              max={MAX_NOTE_MS}
              step={10}
              value={noteMs}
              onChange={(e) => setNoteMs(Number(e.target.value))}
            />
            <span className="buzzer__ctrl-val">{bpm} bpm</span>
          </label>
          <label className="buzzer__ctrl">
            <span className="buzzer__ctrl-lbl">VOLUME</span>
            <input
              className="buzzer__range"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(e) => onVolumeChange(Number(e.target.value))}
            />
            <span className="buzzer__ctrl-val">{Math.round(volume * 100)}%</span>
          </label>
        </div>

        {/* Bottom 3-column readout strip + actions. */}
        <div className="buzzer__bottom">
          <div className="buzzer__strip">
            <Cell label="FREQ" value={fmtFreq(lastFreq)} />
            <span className="buzzer__div" aria-hidden="true" />
            <Cell label="DUTY" value={`${Math.round(volume * 100)}%`} />
            <span className="buzzer__div" aria-hidden="true" />
            <Cell label="STATE" value={status} />
          </div>
          <div className="buzzer__main-actions">
            <button
              type="button"
              className="buzzer__btn buzzer__btn--stop"
              onClick={stopAll}
              title="Silence the buzzer (sends SNKCMD buzzer stop)"
            >
              ■ Stop
            </button>
            <button
              type="button"
              className="buzzer__btn buzzer__btn--export"
              onClick={onExport}
              disabled={melody.length === 0}
              title="Copy the melody as runnable MicroPython (Pin/PWM tone code)"
            >
              {copied ? '✓ Copied' : '⧉ Export .py'}
            </button>
          </div>
        </div>
      </div>
    </InstrumentWindow>
  )
}

/** One labelled readout cell, mirroring the scope/meter readout strips. */
function Cell({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="buzzer__cell">
      <span className="buzzer__cell-lbl">{label}</span>
      <span className="buzzer__cell-val">{value}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Musical staff (#113 part D) — a lightweight SVG 5-line staff that lays out the
// melody's notes by pitch (via the pure {@link freqToStaff} mapping) and
// highlights the currently-playing note. No new dependency: plain SVG + CSS.
// ---------------------------------------------------------------------------

/** Vertical pixels between adjacent staff positions (a line→space step). */
const STAFF_STEP_PX = 5
/** Horizontal pixels between successive noteheads. */
const STAFF_NOTE_DX = 22
/** SVG viewport height; the 5 lines sit centred in it. */
const STAFF_H = 70
/** The y of the staff's MIDDLE line (B4, `step` 0) — our vertical anchor. */
const STAFF_MID_Y = STAFF_H / 2

/** y-coordinate of a {@link StaffPos} step (higher pitch → smaller y → higher up). */
function staffY(step: number): number {
  return STAFF_MID_Y - step * STAFF_STEP_PX
}

function Staff({
  notes,
  playingIdx
}: {
  notes: ReadonlyArray<Tone>
  playingIdx: number | null
}): JSX.Element {
  const positions: StaffPos[] = useMemo(() => notes.map((n) => freqToStaff(n.freq)), [notes])
  const width = Math.max(120, notes.length * STAFF_NOTE_DX + STAFF_NOTE_DX)
  // The 5 staff lines straddle the middle (B4) line: 2 above, the middle, 2 below.
  const lineYs = [-4, -2, 0, 2, 4].map((s) => staffY(s))

  return (
    <div className="buzzer__staff" aria-label="Musical staff">
      <div className="buzzer__staff-head">
        <span className="buzzer__seq-title">STAFF</span>
      </div>
      <div className="buzzer__staff-scroll">
        <svg
          className="buzzer__staff-svg"
          width={width}
          height={STAFF_H}
          viewBox={`0 0 ${width} ${STAFF_H}`}
          role="img"
          aria-label={`${notes.length} notes on a staff`}
        >
          {/* 5 staff lines */}
          {lineYs.map((y, i) => (
            <line
              key={i}
              className="buzzer__staff-line"
              x1={4}
              x2={width - 4}
              y1={y}
              y2={y}
            />
          ))}
          {positions.map((pos, i) => {
            const x = STAFF_NOTE_DX * (i + 1)
            const on = playingIdx === i
            if (pos.rest) {
              return (
                <text
                  key={i}
                  className={`buzzer__staff-rest${on ? ' is-playing' : ''}`}
                  x={x}
                  y={STAFF_MID_Y + 4}
                  textAnchor="middle"
                >
                  𝄽
                </text>
              )
            }
            const y = staffY(pos.step)
            return (
              <g key={i} className={`buzzer__staff-note${on ? ' is-playing' : ''}`}>
                {pos.accidental === '#' && (
                  <text className="buzzer__staff-acc" x={x - 9} y={y + 3} textAnchor="middle">
                    ♯
                  </text>
                )}
                <ellipse className="buzzer__staff-head-el" cx={x} cy={y} rx={3.4} ry={2.6} />
                {/* Ledger line for notes far below/above the staff. */}
                {pos.step <= -6 && (
                  <line className="buzzer__staff-line" x1={x - 6} x2={x + 6} y1={y} y2={y} />
                )}
                {pos.step >= 6 && (
                  <line className="buzzer__staff-line" x1={x - 6} x2={x + 6} y1={y} y2={y} />
                )}
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}
