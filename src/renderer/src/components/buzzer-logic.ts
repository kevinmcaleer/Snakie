/**
 * BUZZER LOGIC (#113) — the pure, DOM-free core behind the Buzzer / music-player
 * instrument panel.
 * =============================================================================
 *
 * Everything here is plain data → data so it can be unit-tested in a `node`
 * environment (mirrors `parse-pins.ts`, `instrument-host.ts`, the registry).
 * The React body (`BuzzerInstrument.tsx`) and its WebAudio preview import these;
 * the panel WRITES to the board via `window.api.device.sendControl('buzzer', …)`
 * with payloads built here so the wire grammar matches the on-device receiver.
 *
 * The on-device receiver (`micropython/instruments.py` `Buzzer`, and
 * `docs/instruments-library.md`) attests the `buzzer` control grammar:
 *
 *     SNKCMD buzzer tone <freq> <ms>      # play one tone, freq Hz for ms
 *     SNKCMD buzzer play <rtttl>          # play an RTTTL ringtone string
 *     SNKCMD buzzer stop                  # silence the buzzer
 *
 * So {@link buzzerTonePayload}/{@link buzzerPlayPayload}/{@link buzzerStopPayload}
 * produce exactly the `<payload>` half — `sendControl('buzzer', payload)` frames
 * the `SNKCMD buzzer …` line via the shared `buildControlLine`.
 */

// ---------------------------------------------------------------------------
// Note name → frequency (12-TET, A4 = 440 Hz)
// ---------------------------------------------------------------------------

/** Semitone offset (from C) for each note letter. */
const LETTER_SEMITONE: Record<string, number> = {
  c: 0,
  d: 2,
  e: 4,
  f: 5,
  g: 7,
  a: 9,
  b: 11
}

/** The note name of each chromatic step above C (sharps), for the keyboard. */
export const CHROMATIC: ReadonlyArray<{ name: string; sharp: boolean }> = [
  { name: 'C', sharp: false },
  { name: 'C#', sharp: true },
  { name: 'D', sharp: false },
  { name: 'D#', sharp: true },
  { name: 'E', sharp: false },
  { name: 'F', sharp: false },
  { name: 'F#', sharp: true },
  { name: 'G', sharp: false },
  { name: 'G#', sharp: true },
  { name: 'A', sharp: false },
  { name: 'A#', sharp: true },
  { name: 'B', sharp: false }
]

/**
 * The MIDI-ish semitone index of a note name+octave, counting semitones up from
 * C0 (so C4 = 48). Accepts a letter `a–g`/`A–G`, an optional `#`/`s` (sharp) or
 * `b` (flat) accidental, and an octave digit. Returns `null` for an unparseable
 * name.
 */
export function noteToSemitone(note: string): number | null {
  const m = /^([a-gA-G])([#sb]?)(-?\d+)$/.exec(note.trim())
  if (!m) return null
  const letter = m[1].toLowerCase()
  const accidental = m[2].toLowerCase()
  const octave = Number(m[3])
  let semis = LETTER_SEMITONE[letter]
  if (semis === undefined) return null
  if (accidental === '#' || accidental === 's') semis += 1
  else if (accidental === 'b') semis -= 1
  return octave * 12 + semis
}

/**
 * Equal-temperament frequency (Hz) of a note name (e.g. `A4` → 440, `C4` →
 * ~261.63). A4 = 440 Hz is semitone index 57 (4*12 + 9). Returns `null` for an
 * unparseable note. Rounded to 2 dp so the keyboard + export read cleanly.
 */
export function noteToFreq(note: string): number | null {
  const semi = noteToSemitone(note)
  if (semi === null) return null
  const a4 = 57 // 4 octaves * 12 + 9 (A)
  const hz = 440 * Math.pow(2, (semi - a4) / 12)
  return Math.round(hz * 100) / 100
}

/**
 * Frequency (Hz) of a chromatic step `0–11` (0 = C) in `octave`. Convenience for
 * the on-screen keyboard, which iterates {@link CHROMATIC}. Rounded to 2 dp.
 */
export function stepFreq(step: number, octave: number): number {
  const semi = octave * 12 + step
  const a4 = 57
  const hz = 440 * Math.pow(2, (semi - a4) / 12)
  return Math.round(hz * 100) / 100
}

// ---------------------------------------------------------------------------
// A note in a melody / a parsed RTTTL tone
// ---------------------------------------------------------------------------

/** One played note: a frequency in Hz (0 ⇒ a rest/pause) for `ms` milliseconds. */
export interface Tone {
  /** Frequency in Hz; `0` means a silent rest. */
  freq: number
  /** Duration in milliseconds. */
  ms: number
  /** Optional human label (e.g. `A4`, `P` for a pause) for the sequencer UI. */
  label?: string
}

// ---------------------------------------------------------------------------
// RTTTL parser
// ---------------------------------------------------------------------------

/** The defaults section of an RTTTL string (`d`uration, `o`ctave, `b`pm). */
export interface RtttlDefaults {
  duration: number
  octave: number
  bpm: number
}

export interface RtttlSong {
  /** The ringtone name (before the first `:`). */
  name: string
  /** The parsed `d`/`o`/`b` defaults. */
  defaults: RtttlDefaults
  /** The flattened note list ready to play / export. */
  notes: Tone[]
}

const RTTTL_FALLBACK: RtttlDefaults = { duration: 4, octave: 6, bpm: 63 }

/**
 * Parse the `d=…,o=…,b=…` defaults section of an RTTTL string into concrete
 * numbers, falling back to the RTTTL spec defaults (`d=4,o=6,b=63`) for any
 * missing / malformed field. Pure.
 */
export function parseRtttlDefaults(section: string): RtttlDefaults {
  const out: RtttlDefaults = { ...RTTTL_FALLBACK }
  for (const raw of section.split(',')) {
    const kv = raw.split('=')
    if (kv.length !== 2) continue
    const key = kv[0].trim().toLowerCase()
    const val = Number(kv[1].trim())
    if (!Number.isFinite(val)) continue
    if (key === 'd') out.duration = val
    else if (key === 'o') out.octave = val
    else if (key === 'b') out.bpm = val
  }
  return out
}

/**
 * Milliseconds of a whole note at `bpm`. RTTTL durations are fractions of a whole
 * note: a `4` (quarter) note is `wholeMs / 4`. A whole note spans 4 beats, so
 * `wholeMs = 4 * (60000 / bpm)`.
 */
function wholeNoteMs(bpm: number): number {
  return (60000 / bpm) * 4
}

/**
 * Parse a single RTTTL note token (e.g. `8a#5.`, `4p`, `c`) against the song
 * defaults → a {@link Tone}. Grammar (any part optional except the note letter):
 *
 *     [duration] note [#] [octave] [.]
 *
 * `duration` overrides the default duration; a trailing `.` dots the note
 * (×1.5); a `p` note is a pause/rest (`freq: 0`). Returns `null` for a token that
 * has no recognisable note letter.
 */
export function parseRtttlNote(token: string, defaults: RtttlDefaults): Tone | null {
  const t = token.trim().toLowerCase()
  if (!t) return null
  // [duration][note][sharp][octave][dot]
  const m = /^(\d*)([a-gp])(#?)(\d*)(\.?)$/.exec(t)
  if (!m) return null
  const durTok = m[1]
  const letter = m[2]
  const sharp = m[3] === '#'
  const octTok = m[4]
  const dotted = m[5] === '.'

  const duration = durTok ? Number(durTok) : defaults.duration
  if (!Number.isFinite(duration) || duration <= 0) return null

  let ms = wholeNoteMs(defaults.bpm) / duration
  if (dotted) ms *= 1.5
  ms = Math.round(ms)

  if (letter === 'p') {
    return { freq: 0, ms, label: 'P' }
  }
  const octave = octTok ? Number(octTok) : defaults.octave
  const name = `${letter.toUpperCase()}${sharp ? '#' : ''}${octave}`
  const freq = noteToFreq(name)
  if (freq === null) return null
  return { freq, ms, label: name }
}

/**
 * Parse a full RTTTL ringtone string into a {@link RtttlSong}. Format:
 *
 *     name:d=4,o=6,b=63:8a,8a,8a,8e.,…
 *
 * The three colon-separated sections are name, defaults, and the comma-separated
 * note list. A string with fewer sections is tolerated (missing name ⇒ `""`,
 * missing defaults ⇒ spec fallback). Unparseable note tokens are skipped. Pure +
 * never throws.
 */
export function parseRtttl(rtttl: string): RtttlSong {
  const parts = rtttl.split(':')
  let name = ''
  let defaultsSection = ''
  let body = ''
  if (parts.length >= 3) {
    name = parts[0].trim()
    defaultsSection = parts[1]
    body = parts.slice(2).join(':')
  } else if (parts.length === 2) {
    // Either `name:body` or `defaults:body` — detect a defaults section by `=`.
    if (/[a-z]\s*=/i.test(parts[0])) {
      defaultsSection = parts[0]
      body = parts[1]
    } else {
      name = parts[0].trim()
      body = parts[1]
    }
  } else {
    body = parts[0]
  }
  const defaults = parseRtttlDefaults(defaultsSection)
  const notes: Tone[] = []
  for (const tok of body.split(',')) {
    if (!tok.trim()) continue
    const note = parseRtttlNote(tok, defaults)
    if (note) notes.push(note)
  }
  return { name, defaults, notes }
}

// ---------------------------------------------------------------------------
// Buzzer control payload builders — match the on-device `buzzer` grammar.
// ---------------------------------------------------------------------------

/**
 * The `<payload>` for a single tone: `tone <freq> <ms>`. Frequency is rounded to
 * a whole Hz and clamped non-negative; `ms` is clamped to a whole, non-negative
 * number. Pass to `sendControl('buzzer', buzzerTonePayload(440, 200))` → the
 * device sees `SNKCMD buzzer tone 440 200`.
 */
export function buzzerTonePayload(freq: number, ms: number): string {
  const f = Math.max(0, Math.round(freq))
  const d = Math.max(0, Math.round(ms))
  return `tone ${f} ${d}`
}

/**
 * The `<payload>` for an RTTTL ringtone: `play <rtttl>`. Internal whitespace in
 * the RTTTL string is collapsed (RTTTL has no significant spaces) so the line
 * stays one clean `SNKCMD buzzer play …` command.
 */
export function buzzerPlayPayload(rtttl: string): string {
  return `play ${rtttl.replace(/\s+/g, '')}`
}

/** The `<payload>` that silences the buzzer: `stop`. */
export function buzzerStopPayload(): string {
  return 'stop'
}

// ---------------------------------------------------------------------------
// Melody → MicroPython code export
// ---------------------------------------------------------------------------

/** Options for {@link melodyToMicroPython}. */
export interface ExportOptions {
  /** The GPIO pin number the PWM buzzer is on. */
  pin: number
  /** PWM duty as 0..1 (mapped to `duty_u16`). Defaults to 0.5. */
  duty?: number
}

/**
 * Render a melody (a list of {@link Tone}s) as a runnable MicroPython program
 * using `machine.Pin`/`machine.PWM`. Rests (`freq` 0) `duty_u16(0)` and sleep;
 * notes set `freq`+duty then sleep then silence. The generated code is
 * self-contained (imports + a `play()` that the file calls), ready to paste into
 * a program. Pure string building — deterministic, newline-`\n` joined.
 */
export function melodyToMicroPython(notes: Tone[], opts: ExportOptions): string {
  const pin = Math.max(0, Math.round(opts.pin))
  const dutyFrac = Math.max(0, Math.min(1, opts.duty ?? 0.5))
  const duty = Math.round(dutyFrac * 65535)

  const lines: string[] = []
  lines.push('# Generated by Snakie — Buzzer / music player (#113)')
  lines.push('import time')
  lines.push('from machine import Pin, PWM')
  lines.push('')
  lines.push(`buzzer = PWM(Pin(${pin}))`)
  lines.push('')
  lines.push('# (freq_hz, duration_ms) — freq 0 is a rest')
  lines.push('MELODY = [')
  for (const n of notes) {
    const comment = n.label ? `  # ${n.label}` : ''
    lines.push(`    (${Math.max(0, Math.round(n.freq))}, ${Math.max(0, Math.round(n.ms))}),${comment}`)
  }
  lines.push(']')
  lines.push('')
  lines.push('')
  lines.push('def play(melody):')
  lines.push('    for freq, ms in melody:')
  lines.push('        if freq > 0:')
  lines.push('            buzzer.freq(freq)')
  lines.push(`            buzzer.duty_u16(${duty})`)
  lines.push('        else:')
  lines.push('            buzzer.duty_u16(0)')
  lines.push('        time.sleep_ms(ms)')
  lines.push('        buzzer.duty_u16(0)')
  lines.push('        time.sleep_ms(20)')
  lines.push('')
  lines.push('')
  lines.push('play(MELODY)')
  lines.push('buzzer.duty_u16(0)')
  lines.push('')
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Small formatting helpers shared by the body's readout strip.
// ---------------------------------------------------------------------------

/** Format a frequency for the readout (`—— Hz` when null/0). */
export function fmtFreq(freq: number | null): string {
  if (freq === null || freq <= 0) return '—— Hz'
  return `${Math.round(freq)} Hz`
}

/** Total duration (ms) of a melody, summing every note + rest. */
export function melodyDurationMs(notes: Tone[]): number {
  return notes.reduce((sum, n) => sum + Math.max(0, n.ms), 0)
}
