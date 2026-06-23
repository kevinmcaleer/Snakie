import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from 'react'
import { InstrumentWindow, PhosphorScreen } from './InstrumentWindow'
import { type InstrumentDef } from './instruments-registry'
import {
  CHROMATIC,
  buzzerPlayPayload,
  buzzerStopPayload,
  buzzerTonePayload,
  fmtFreq,
  melodyDurationMs,
  melodyToMicroPython,
  parseRtttl,
  stepFreq,
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
 *   - a NOTE/MELODY SEQUENCER — append clicked keys into a short melody, scrub
 *     it, clear it, and PLAY it back (timed tones, local + on-device);
 *   - an RTTTL paste box — paste a ringtone, PLAY it (parsed → timed tones), or
 *     send a single `buzzer play <rtttl>` line for an on-device RTTTL player;
 *   - TEMPO (note length) + VOLUME (PWM duty) sliders, a buzzer PIN picker, a
 *     STOP that silences the buzzer, and an EXPORT that copies a runnable
 *     `Pin`/`PWM` MicroPython melody to the clipboard.
 *
 * The on-device receiver (`micropython/instruments.py` `Buzzer` +
 * `docs/instruments-library.md`) attests the grammar this writes:
 * `tone <freq> <ms>`, `play <rtttl>`, `stop` — built by `buzzer-logic`'s payload
 * helpers and sent via `window.api.device.sendControl('buzzer', payload)`.
 *
 * All audible IDE feedback is generated locally with the built-in WebAudio API
 * (no dependency); the board is driven purely over the existing control channel.
 */

export interface BuzzerInstrumentProps {
  /** The registry def driving the name, accent, icon and source pill. */
  def: InstrumentDef
  /** Close (hide) this instrument — same close→hide model as the other windows. */
  onClose?: () => void
  /** Whether the window is docked (always true in the dock today). */
  docked?: boolean
}

/** The single octave of keys the on-screen keyboard renders. */
const KEYBOARD_OCTAVE_DEFAULT = 4

/** Tempo presets (note length in ms for a sequencer step) the slider spans. */
const MIN_NOTE_MS = 80
const MAX_NOTE_MS = 600

/** A short, recognisable RTTTL placeholder so the box reads as "paste here". */
const RTTTL_PLACEHOLDER =
  'Nokia:d=4,o=5,b=125:8e6,8d6,4f#,4g#,8c#6,8b,4d,4e,8b,8a,4c#,4e,2a'

/** Fire-and-forget a control line; swallow errors so the UI never throws. */
function sendBuzzer(payload: string): void {
  try {
    void window.api?.device?.sendControl?.('buzzer', payload)
  } catch {
    /* offline / no device — the local WebAudio preview still plays. */
  }
}

export function BuzzerInstrument({
  def,
  onClose,
  docked = true
}: BuzzerInstrumentProps): JSX.Element {
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
    sendBuzzer(buzzerStopPayload())
    setStatus('standby')
    setActiveKey(null)
  }, [previewOff])

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
      sendBuzzer(buzzerTonePayload(freq, ms))
      const off = setTimeout(() => previewOff(), ms)
      timersRef.current.push(off)
    },
    [previewOn, previewOff]
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
  /** Play a list of timed tones back-to-back (local + on-device), then idle. */
  const playSequence = useCallback(
    (notes: Tone[]): void => {
      if (notes.length === 0) return
      stopAll()
      setStatus('playing')
      let when = 0
      for (const n of notes) {
        const at = when
        const t = setTimeout(() => {
          setLastFreq(n.freq > 0 ? n.freq : null)
          previewOn(n.freq)
          sendBuzzer(buzzerTonePayload(n.freq, n.ms))
        }, at)
        timersRef.current.push(t)
        when += n.ms
      }
      const done = setTimeout(() => {
        previewOff()
        setStatus('standby')
      }, when)
      timersRef.current.push(done)
    },
    [previewOn, previewOff, stopAll]
  )

  const addRest = useCallback((): void => {
    setMelody((m) => [...m, { freq: 0, ms: noteMs, label: 'P' }])
  }, [noteMs])

  const clearMelody = useCallback((): void => setMelody([]), [])

  const removeLast = useCallback((): void => setMelody((m) => m.slice(0, -1)), [])

  // --- RTTTL -----------------------------------------------------------------
  const parsedRtttl = useMemo(() => (rtttl.trim() ? parseRtttl(rtttl) : null), [rtttl])

  /** Play the pasted RTTTL: locally as timed tones, on-device as one play line. */
  const playRtttl = useCallback((): void => {
    if (!parsedRtttl || parsedRtttl.notes.length === 0) return
    // On-device: hand the whole ringtone to the board's RTTTL player.
    sendBuzzer(buzzerPlayPayload(rtttl))
    // Locally: schedule the parsed notes for an audible IDE preview.
    playSequence(parsedRtttl.notes)
  }, [parsedRtttl, rtttl, playSequence])

  /** Load the parsed RTTTL into the editable sequencer melody. */
  const rtttlToMelody = useCallback((): void => {
    if (parsedRtttl) setMelody(parsedRtttl.notes)
  }, [parsedRtttl])

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
      source={source}
      docked={docked}
      onClose={onClose}
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
            <span className="buzzer__small">{status === 'playing' ? '▶ playing' : '■ standby'}</span>
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

        {/* Sequencer strip — the built melody as scrubbable chips. */}
        <div className="buzzer__seq" aria-label="Melody sequencer">
          <div className="buzzer__seq-head">
            <span className="buzzer__seq-title">MELODY</span>
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
                  className={`buzzer__chip${n.freq === 0 ? ' buzzer__chip--rest' : ''}`}
                  onClick={() => playNote(n.freq, n.ms)}
                  title={`${n.label ?? fmtFreq(n.freq)} · ${n.ms} ms — click to preview`}
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
              onClick={() => playSequence(melody)}
              disabled={melody.length === 0}
            >
              ▶ Play
            </button>
            <button type="button" className="buzzer__btn" onClick={addRest}>
              + Rest
            </button>
            <button
              type="button"
              className="buzzer__btn"
              onClick={removeLast}
              disabled={melody.length === 0}
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
              onChange={(e) => setPin(Number(e.target.value))}
            >
              {Array.from({ length: 29 }, (_, i) => i).map((p) => (
                <option key={p} value={p}>
                  GP{p}
                </option>
              ))}
            </select>
          </label>
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
              onChange={(e) => setVolume(Number(e.target.value))}
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
