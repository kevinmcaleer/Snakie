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
 *     SNKCMD buzzer tone <freq> <ms>            # play one tone, freq Hz for ms
 *     SNKCMD buzzer seq <freq:ms>,<freq:ms>,…   # play a note sequence (freq 0 = rest)
 *     SNKCMD buzzer play <rtttl>                # play an RTTTL ringtone string
 *     SNKCMD buzzer stop                        # silence the buzzer
 *     SNKCMD buzzer pin <n>                     # retarget the PWM pin
 *
 * The IDE pre-parses melodies/RTTTL (its tested {@link parseRtttl}) and sends a
 * compact `seq` note list, so the board needs no RTTTL parser. So
 * {@link buzzerTonePayload}/{@link buzzerSeqPayload}/{@link buzzerStopPayload}/
 * {@link buzzerPinPayload} (+ the legacy {@link buzzerPlayPayload}) produce exactly
 * the `<payload>` half — `sendControl('buzzer', payload)` frames the
 * `SNKCMD buzzer …` line via the shared `buildControlLine`.
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
 * The `<payload>` for a melody/ringtone as a compact NOTE SEQUENCE:
 * `seq <freq:ms>,<freq:ms>,…`. Each note is `freq:ms` (both rounded to whole,
 * non-negative numbers); a rest is `0:<ms>` (freq 0). The board plays the pairs
 * in order with no RTTTL parser of its own. Pass to
 * `sendControl('buzzer', buzzerSeqPayload([{freq:440,ms:200},{freq:0,ms:100}]))`
 * → the device sees `SNKCMD buzzer seq 440:200,0:100`.
 */
export function buzzerSeqPayload(notes: ReadonlyArray<Tone>): string {
  const pairs = notes.map((n) => {
    const f = Math.max(0, Math.round(n.freq))
    const d = Math.max(0, Math.round(n.ms))
    return `${f}:${d}`
  })
  return `seq ${pairs.join(',')}`
}

/**
 * The `<payload>` for an RTTTL ringtone: `play <rtttl>`. Internal whitespace in
 * the RTTTL string is collapsed (RTTTL has no significant spaces) so the line
 * stays one clean `SNKCMD buzzer play …` command. (Kept for the on-device RTTTL
 * fallback; the panel now prefers the pre-parsed {@link buzzerSeqPayload}.)
 */
export function buzzerPlayPayload(rtttl: string): string {
  return `play ${rtttl.replace(/\s+/g, '')}`
}

/** The `<payload>` that silences the buzzer: `stop`. */
export function buzzerStopPayload(): string {
  return 'stop'
}

/**
 * The `<payload>` that retargets the buzzer's PWM pin: `pin <n>`. The pin is
 * rounded to a whole, non-negative GPIO number. Pass to
 * `sendControl('buzzer', buzzerPinPayload(15))` → `SNKCMD buzzer pin 15`.
 */
export function buzzerPinPayload(pin: number): string {
  return `pin ${Math.max(0, Math.round(pin))}`
}

/**
 * The `<payload>` to set the board's VOLUME (PWM duty): `vol <0..1>` (clamped,
 * 2 decimals). The device maps it to `duty_u16` for sounding notes. Pass to
 * `sendControl('buzzer', buzzerVolPayload(0.7))` → `SNKCMD buzzer vol 0.7`.
 */
export function buzzerVolPayload(volume: number): string {
  const v = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 0.5))
  return `vol ${Math.round(v * 100) / 100}`
}

/**
 * Apply the live OCTAVE transpose + TEMPO time-scale to a melody at PLAYBACK
 * time, so the panel's sliders affect an already-built melody (both the local
 * preview and the on-device `seq`). `octaveShift` shifts every pitched note by
 * whole octaves (×2^shift); rests (freq 0) stay rests. `tempoScale` multiplies
 * each note's duration (clamped to ≥1 ms). Pure + non-mutating.
 */
export function transposeAndScale(
  notes: ReadonlyArray<Tone>,
  octaveShift: number,
  tempoScale: number
): Tone[] {
  const factor = Math.pow(2, octaveShift)
  const scale = tempoScale > 0 ? tempoScale : 1
  return notes.map((n) => ({
    ...n,
    freq: n.freq > 0 ? Math.round(n.freq * factor) : 0,
    ms: Math.max(1, Math.round(n.ms * scale))
  }))
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
// Melody → editor SNIPPET (#113 part C — "Paste to code")
// ---------------------------------------------------------------------------

/**
 * Render a melody as a compact, paste-into-your-program SNIPPET that balances
 * Snakie's library with vanilla MicroPython. Unlike {@link melodyToMicroPython}
 * (a standalone, runnable file), this is a fragment dropped INTO the user's
 * editor buffer: a `melody = [(freq, ms), …]` literal, a commented recipe for
 * playing it with the Snakie `instruments` library, then a runnable plain-PWM
 * loop. The `pin` (the panel's current PWM pin) appears in both the commented
 * `inst.start(buzzer_pin=…)` and the `PWM(Pin(…))`. Pure, deterministic,
 * `\n`-joined.
 */
export function melodyToCodeSnippet(melody: Tone[], pin: number): string {
  const p = Math.max(0, Math.round(pin))
  const lines: string[] = []
  lines.push('# Melody from the Snakie Buzzer instrument — (freq_hz, ms); freq 0 = a rest')
  lines.push('melody = [')
  for (const n of melody) {
    const f = Math.max(0, Math.round(n.freq))
    const ms = Math.max(0, Math.round(n.ms))
    const comment = n.label ? `  # ${n.label}` : ''
    lines.push(`    (${f}, ${ms}),${comment}`)
  }
  lines.push(']')
  lines.push('')
  lines.push('# Play it with the Snakie library (needs instruments.py on the board):')
  lines.push('#   import instruments as inst')
  lines.push(`#   inst.start(buzzer_pin=${p})`)
  lines.push('#   inst.buzzer.play_seq(melody)')
  lines.push('')
  lines.push('# …or with plain MicroPython (no library):')
  lines.push('from machine import Pin, PWM')
  lines.push('import time')
  lines.push(`_buz = PWM(Pin(${p}))`)
  lines.push('for _freq, _ms in melody:')
  lines.push('    if _freq:')
  lines.push('        _buz.freq(_freq)')
  lines.push('    _buz.duty_u16(32768 if _freq else 0)')
  lines.push('    time.sleep_ms(_ms)')
  lines.push('    _buz.duty_u16(0)')
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Buzzer pin ⟷ code sync (#113 part E — pin-mismatch warning + one-click update)
// ---------------------------------------------------------------------------

/**
 * The regex matching a `buzzer_pin = <number>` declaration in source code, with
 * its numeric value captured. Case-insensitive (so `BUZZER_PIN = 15` matches),
 * tolerant of surrounding whitespace (`buzzer_pin=15` and `buzzer_pin = 15`).
 * The value group `([0-9]+)` only matches digits, so a non-numeric assignment
 * like `buzzer_pin=BUZZER_PIN` does NOT match (the panel can't sync a symbolic
 * pin). Defined once so {@link findBuzzerPinInCode} and {@link setBuzzerPinInCode}
 * agree on the grammar. Not `/g` — both helpers act on the FIRST match.
 */
const BUZZER_PIN_RE = /buzzer_pin\s*=\s*([0-9]+)/i

/**
 * Find the numeric pin declared by a `buzzer_pin = <digits>` assignment in
 * `source` (e.g. the demo's `inst.start(buzzer_pin=15)` or a snippet's
 * `inst.start(buzzer_pin=0)`). Case-insensitive; tolerant of whitespace around
 * the `=`. Returns the FIRST such pin as a number, or `null` when the code
 * declares no numeric buzzer pin (including symbolic values like
 * `buzzer_pin=BUZZER_PIN`). Pure, never throws.
 */
export function findBuzzerPinInCode(source: string): number | null {
  const m = BUZZER_PIN_RE.exec(source)
  if (!m) return null
  return Number(m[1])
}

/**
 * Rewrite the FIRST `buzzer_pin = <digits>` assignment in `source` to `pin`,
 * preserving the surrounding text (and the author's spacing around `=`). Returns
 * the source UNCHANGED when there's no numeric `buzzer_pin` match (nothing to
 * sync). The new pin is rounded to a whole, non-negative GPIO number. Pure,
 * never mutates — backs the panel's one-click "Update code to GP{pin}". Only the
 * first match is rewritten (mirrors {@link findBuzzerPinInCode}).
 */
export function setBuzzerPinInCode(source: string, pin: number): string {
  const p = Math.max(0, Math.round(pin))
  return source.replace(BUZZER_PIN_RE, (matched: string, digits: string) => {
    // Rebuild the matched text with the new number, keeping the original prefix
    // (`buzzer_pin`, the author's casing + spacing, `=`, spacing) intact so only
    // the value changes.
    const numStart = matched.lastIndexOf(digits)
    return matched.slice(0, numStart) + String(p)
  })
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

// ---------------------------------------------------------------------------
// Editable-melody helpers (#113 part C) — pure list ops for the sequencer row.
// Each returns a NEW array (never mutates) so React state updates stay clean.
// ---------------------------------------------------------------------------

/**
 * Move the note at index `from` to index `to`, shifting the others — for the
 * drag-to-reorder interaction. Out-of-range indices are clamped into the list;
 * a no-op move returns an (equal) copy. Pure, never mutates the input.
 */
export function moveNote(notes: ReadonlyArray<Tone>, from: number, to: number): Tone[] {
  const out = notes.slice()
  if (out.length === 0) return out
  const f = Math.max(0, Math.min(out.length - 1, Math.trunc(from)))
  const t = Math.max(0, Math.min(out.length - 1, Math.trunc(to)))
  if (f === t) return out
  const [moved] = out.splice(f, 1)
  out.splice(t, 0, moved)
  return out
}

/**
 * Remove the note at `index` (click-to-delete). An out-of-range index leaves the
 * list unchanged (a copy). Pure, never mutates the input.
 */
export function removeNote(notes: ReadonlyArray<Tone>, index: number): Tone[] {
  if (index < 0 || index >= notes.length) return notes.slice()
  const out = notes.slice()
  out.splice(index, 1)
  return out
}

/** A rest is a note with `freq: 0`; this is the canonical rest `Tone`. */
export function makeRest(ms: number): Tone {
  return { freq: 0, ms: Math.max(0, Math.round(ms)), label: 'P' }
}

/**
 * Insert a rest (`freq: 0`) of `ms` at `index` (clamped to `[0, length]` so
 * `index >= length` appends). Used by the `+ rest` control and gap-drops. Pure.
 */
export function insertRest(notes: ReadonlyArray<Tone>, index: number, ms: number): Tone[] {
  const out = notes.slice()
  const at = Math.max(0, Math.min(out.length, Math.trunc(index)))
  out.splice(at, 0, makeRest(ms))
  return out
}

// ---------------------------------------------------------------------------
// Pitch → musical-staff position (#113 part D) — pure mapping for the staff row.
// ---------------------------------------------------------------------------

/**
 * Where a note sits on a 5-line treble staff + whether it needs an accidental.
 *
 * `step` is the DIATONIC step index counting up from a reference, used as the
 * vertical coordinate: every whole increment is one staff position (a line→space
 * or space→line move). We anchor `step: 0` at **B4** — the MIDDLE LINE of the
 * treble staff — so the common keyboard octave straddles the staff nicely.
 * Higher pitches get a larger `step` (drawn higher up). `accidental` is `'#'`
 * for a sharp note (a black key), else `''`. `rest` flags a freq-0 rest, which
 * has no pitch (`step: 0`) and is drawn as a rest glyph instead of a notehead.
 */
export interface StaffPos {
  /** Diatonic position; 0 = B4 (middle line), +1 per line/space upward. */
  step: number
  /** `'#'` when the pitch is a sharp/black key, else `''`. */
  accidental: '' | '#'
  /** True for a rest (`freq` 0) — no pitch, draw a rest glyph. */
  rest: boolean
}

/** Diatonic step offset (within an octave) for each chromatic semitone, C-based. */
const SEMITONE_TO_DIATONIC: ReadonlyArray<{ dia: number; sharp: boolean }> = [
  { dia: 0, sharp: false }, // C
  { dia: 0, sharp: true }, // C#
  { dia: 1, sharp: false }, // D
  { dia: 1, sharp: true }, // D#
  { dia: 2, sharp: false }, // E
  { dia: 3, sharp: false }, // F
  { dia: 3, sharp: true }, // F#
  { dia: 4, sharp: false }, // G
  { dia: 4, sharp: true }, // G#
  { dia: 5, sharp: false }, // A
  { dia: 5, sharp: true }, // A#
  { dia: 6, sharp: false } // B
]

/** The diatonic step of B4, our staff anchor: octave 4 * 7 + 6 (B) = 34. */
const B4_DIATONIC = 4 * 7 + 6

/**
 * Map a frequency (Hz) to a {@link StaffPos}. `freq <= 0` is a rest. Otherwise
 * we find the nearest 12-TET semitone (A4 = 440 ⇒ MIDI 69), split it into octave
 * + chromatic index, look up the diatonic step + sharp flag, and express the
 * position RELATIVE to B4 (the treble middle line). Deterministic + DOM-free.
 *
 * Examples (treble clef): B4 → step 0; A4 → −1; C5 → +1; F#5 → +4 with `'#'`.
 */
export function freqToStaff(freq: number): StaffPos {
  if (!Number.isFinite(freq) || freq <= 0) {
    return { step: 0, accidental: '', rest: true }
  }
  // Nearest MIDI note number (A4 = 440 Hz = MIDI 69).
  const midi = Math.round(69 + 12 * Math.log2(freq / 440))
  const octave = Math.floor(midi / 12) - 1 // MIDI octave (C-1 = 0)
  const chroma = ((midi % 12) + 12) % 12
  const { dia, sharp } = SEMITONE_TO_DIATONIC[chroma]
  const diatonic = octave * 7 + dia
  return {
    step: diatonic - B4_DIATONIC,
    accidental: sharp ? '#' : '',
    rest: false
  }
}
