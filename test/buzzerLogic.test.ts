import { describe, it, expect } from 'vitest'
import {
  noteToSemitone,
  noteToFreq,
  stepFreq,
  parseRtttlDefaults,
  parseRtttlNote,
  parseRtttl,
  buzzerTonePayload,
  buzzerPlayPayload,
  buzzerStopPayload,
  buzzerSeqPayload,
  buzzerPinPayload,
  moveNote,
  removeNote,
  insertRest,
  makeRest,
  freqToStaff,
  melodyToMicroPython,
  melodyToCodeSnippet,
  findBuzzerPinInCode,
  setBuzzerPinInCode,
  fmtFreq,
  melodyDurationMs,
  type Tone
} from '../src/renderer/src/components/buzzer-logic'
import { buildControlLine } from '../src/renderer/src/components/snakie-control'

describe('buzzer-logic noteToSemitone', () => {
  it('maps C4 to 48 and A4 to 57', () => {
    expect(noteToSemitone('C4')).toBe(48)
    expect(noteToSemitone('A4')).toBe(57)
  })

  it('handles sharps and flats', () => {
    expect(noteToSemitone('C#4')).toBe(49)
    expect(noteToSemitone('Db4')).toBe(49) // enharmonic with C#4
    expect(noteToSemitone('Cs4')).toBe(49) // 's' accidental form
  })

  it('is case-insensitive on the letter', () => {
    expect(noteToSemitone('a4')).toBe(57)
  })

  it('returns null for garbage', () => {
    expect(noteToSemitone('H4')).toBeNull()
    expect(noteToSemitone('')).toBeNull()
    expect(noteToSemitone('A')).toBeNull()
  })
})

describe('buzzer-logic noteToFreq (12-TET, A4=440)', () => {
  it('anchors A4 at exactly 440', () => {
    expect(noteToFreq('A4')).toBe(440)
  })

  it('gives C4 ~261.63 and A5 = 880 (octave doubles)', () => {
    expect(noteToFreq('C4')).toBeCloseTo(261.63, 2)
    expect(noteToFreq('A5')).toBe(880)
    expect(noteToFreq('A3')).toBe(220)
  })

  it('gives a semitone above A4 (A#4) ~466.16', () => {
    expect(noteToFreq('A#4')).toBeCloseTo(466.16, 2)
  })

  it('returns null for an unparseable note', () => {
    expect(noteToFreq('zz')).toBeNull()
  })
})

describe('buzzer-logic stepFreq', () => {
  it('step 9 (A) octave 4 is 440', () => {
    expect(stepFreq(9, 4)).toBe(440)
  })
  it('step 0 (C) octave 4 matches noteToFreq C4', () => {
    expect(stepFreq(0, 4)).toBe(noteToFreq('C4'))
  })
})

describe('buzzer-logic parseRtttlDefaults', () => {
  it('parses d/o/b', () => {
    expect(parseRtttlDefaults('d=8,o=5,b=120')).toEqual({ duration: 8, octave: 5, bpm: 120 })
  })

  it('falls back to spec defaults (d=4,o=6,b=63) for missing fields', () => {
    expect(parseRtttlDefaults('')).toEqual({ duration: 4, octave: 6, bpm: 63 })
    expect(parseRtttlDefaults('o=4')).toEqual({ duration: 4, octave: 4, bpm: 63 })
  })

  it('tolerates whitespace and ignores bad numbers', () => {
    expect(parseRtttlDefaults(' d = 16 , b=nope ')).toEqual({
      duration: 16,
      octave: 6,
      bpm: 63
    })
  })
})

describe('buzzer-logic parseRtttlNote', () => {
  const d = { duration: 4, octave: 6, bpm: 120 } // quarter @120bpm = 500ms

  it('uses default duration + octave when omitted', () => {
    const n = parseRtttlNote('a', d)
    expect(n).toMatchObject({ label: 'A6' })
    expect(n?.ms).toBe(500)
    expect(n?.freq).toBe(noteToFreq('A6'))
  })

  it('honours an explicit duration (8th note = 250ms)', () => {
    expect(parseRtttlNote('8a', d)?.ms).toBe(250)
  })

  it('applies a dotted note (×1.5)', () => {
    // dotted quarter = 500 * 1.5 = 750
    expect(parseRtttlNote('4a.', d)?.ms).toBe(750)
  })

  it('parses a sharp + explicit octave', () => {
    const n = parseRtttlNote('8a#5', d)
    expect(n?.label).toBe('A#5')
    expect(n?.freq).toBe(noteToFreq('A#5'))
    expect(n?.ms).toBe(250)
  })

  it('parses a pause (p) as a rest of freq 0', () => {
    const n = parseRtttlNote('4p', d)
    expect(n).toMatchObject({ freq: 0, label: 'P' })
    expect(n?.ms).toBe(500)
  })

  it('returns null for an unrecognised token', () => {
    expect(parseRtttlNote('x', d)).toBeNull()
    expect(parseRtttlNote('', d)).toBeNull()
  })
})

describe('buzzer-logic parseRtttl (full song)', () => {
  it('parses name, defaults and notes', () => {
    const song = parseRtttl('Test:d=4,o=5,b=120:c,8d,e')
    expect(song.name).toBe('Test')
    expect(song.defaults).toEqual({ duration: 4, octave: 5, bpm: 120 })
    expect(song.notes).toHaveLength(3)
    expect(song.notes[0]).toMatchObject({ label: 'C5', ms: 500 })
    expect(song.notes[1]).toMatchObject({ label: 'D5', ms: 250 }) // 8th
    expect(song.notes[2]).toMatchObject({ label: 'E5', ms: 500 })
  })

  it('handles a realistic ringtone with pauses, dots and sharps', () => {
    const song = parseRtttl('Beep:d=4,o=6,b=160:8c6,8p,16d#6,c.,8p')
    const labels = song.notes.map((n) => n.label)
    expect(labels).toEqual(['C6', 'P', 'D#6', 'C6', 'P'])
    // 8th @160bpm: whole = (60000/160)*4 = 1500ms; /8 = 187.5 -> 188 (rounded)
    expect(song.notes[0].ms).toBe(188)
    // dotted quarter 'c.' = 1500/4 * 1.5 = 562.5 -> 563
    expect(song.notes[3].ms).toBe(563)
    // the pause is a rest
    expect(song.notes[1].freq).toBe(0)
  })

  it('skips unparseable note tokens but keeps the rest', () => {
    const song = parseRtttl('X:d=4,o=5,b=120:c,zz,e')
    expect(song.notes.map((n) => n.label)).toEqual(['C5', 'E5'])
  })

  it('tolerates a missing name section (defaults:body)', () => {
    const song = parseRtttl('d=4,o=5,b=120:c')
    expect(song.name).toBe('')
    expect(song.defaults.octave).toBe(5)
    expect(song.notes[0].label).toBe('C5')
  })

  it('tolerates a bare note body with spec-default defaults', () => {
    const song = parseRtttl('a,b')
    expect(song.defaults).toEqual({ duration: 4, octave: 6, bpm: 63 })
    expect(song.notes.map((n) => n.label)).toEqual(['A6', 'B6'])
  })
})

describe('buzzer-logic payload builders (match device grammar)', () => {
  it('buzzerTonePayload → "tone <freq> <ms>" and frames into SNKCMD', () => {
    expect(buzzerTonePayload(440, 200)).toBe('tone 440 200')
    // rounds + clamps
    expect(buzzerTonePayload(440.6, 199.4)).toBe('tone 441 199')
    expect(buzzerTonePayload(-5, -5)).toBe('tone 0 0')
    expect(buildControlLine('buzzer', buzzerTonePayload(440, 200))).toBe(
      'SNKCMD buzzer tone 440 200\n'
    )
  })

  it('buzzerPlayPayload → "play <rtttl>" with whitespace collapsed', () => {
    expect(buzzerPlayPayload('Beep:d=4,o=6,b=63:c,d,e')).toBe('play Beep:d=4,o=6,b=63:c,d,e')
    expect(buzzerPlayPayload('Beep: d=4 , o=6 :c')).toBe('play Beep:d=4,o=6:c')
    expect(buildControlLine('buzzer', buzzerPlayPayload('X:d=4,o=6,b=63:c'))).toBe(
      'SNKCMD buzzer play X:d=4,o=6,b=63:c\n'
    )
  })

  it('buzzerStopPayload → "stop"', () => {
    expect(buzzerStopPayload()).toBe('stop')
    expect(buildControlLine('buzzer', buzzerStopPayload())).toBe('SNKCMD buzzer stop\n')
  })
})

describe('buzzer-logic melodyToMicroPython', () => {
  const melody: Tone[] = [
    { freq: 440, ms: 200, label: 'A4' },
    { freq: 0, ms: 100, label: 'P' },
    { freq: 523.25, ms: 200, label: 'C5' }
  ]

  it('emits runnable Pin/PWM tone code with the chosen pin + duty', () => {
    const code = melodyToMicroPython(melody, { pin: 15, duty: 0.5 })
    expect(code).toContain('from machine import Pin, PWM')
    expect(code).toContain('buzzer = PWM(Pin(15))')
    expect(code).toContain('buzzer.duty_u16(32768)') // 0.5 * 65535 rounded
    expect(code).toContain('(440, 200),')
    expect(code).toContain('(0, 100),') // rest
    expect(code).toContain('(523, 200),') // freq rounded
    expect(code).toContain('play(MELODY)')
  })

  it('clamps duty into 0..1 and rounds the pin', () => {
    const code = melodyToMicroPython([], { pin: 2.7, duty: 5 })
    expect(code).toContain('buzzer = PWM(Pin(3))')
    expect(code).toContain('buzzer.duty_u16(65535)') // duty clamped to 1.0
  })

  it('defaults duty to 0.5 when omitted', () => {
    const code = melodyToMicroPython([], { pin: 0 })
    expect(code).toContain('buzzer.duty_u16(32768)')
  })
})

describe('buzzer-logic formatting helpers', () => {
  it('fmtFreq shows Hz or a dash placeholder', () => {
    expect(fmtFreq(440)).toBe('440 Hz')
    expect(fmtFreq(0)).toBe('—— Hz')
    expect(fmtFreq(null)).toBe('—— Hz')
  })

  it('melodyDurationMs sums note + rest durations', () => {
    expect(
      melodyDurationMs([
        { freq: 440, ms: 200 },
        { freq: 0, ms: 100 }
      ])
    ).toBe(300)
    expect(melodyDurationMs([])).toBe(0)
  })
})

describe('buzzer-logic buzzerSeqPayload (note sequence wire form)', () => {
  it('renders a list of notes as "seq <freq:ms>,…" with a rest as 0:ms', () => {
    expect(
      buzzerSeqPayload([
        { freq: 440, ms: 200 },
        { freq: 0, ms: 100 }
      ])
    ).toBe('seq 440:200,0:100')
  })

  it('rounds + clamps freq and ms to whole, non-negative numbers', () => {
    expect(
      buzzerSeqPayload([
        { freq: 440.6, ms: 199.4 },
        { freq: -5, ms: -5 }
      ])
    ).toBe('seq 441:199,0:0')
  })

  it('frames into a single SNKCMD line', () => {
    expect(buildControlLine('buzzer', buzzerSeqPayload([{ freq: 262, ms: 250 }]))).toBe(
      'SNKCMD buzzer seq 262:250\n'
    )
  })
})

describe('buzzer-logic buzzerPinPayload (retarget the PWM pin)', () => {
  it('renders "pin <n>" rounding + clamping the pin', () => {
    expect(buzzerPinPayload(15)).toBe('pin 15')
    expect(buzzerPinPayload(2.7)).toBe('pin 3')
    expect(buzzerPinPayload(-1)).toBe('pin 0')
  })

  it('frames into a single SNKCMD line', () => {
    expect(buildControlLine('buzzer', buzzerPinPayload(16))).toBe('SNKCMD buzzer pin 16\n')
  })
})

describe('buzzer-logic editable-melody helpers (part C)', () => {
  const melody: Tone[] = [
    { freq: 262, ms: 200, label: 'C4' },
    { freq: 294, ms: 200, label: 'D4' },
    { freq: 330, ms: 200, label: 'E4' }
  ]

  it('moveNote reorders without mutating the input', () => {
    const out = moveNote(melody, 0, 2)
    expect(out.map((n) => n.label)).toEqual(['D4', 'E4', 'C4'])
    // original untouched
    expect(melody.map((n) => n.label)).toEqual(['C4', 'D4', 'E4'])
  })

  it('moveNote clamps out-of-range indices and is a no-op on equal indices', () => {
    expect(moveNote(melody, -5, 99).map((n) => n.label)).toEqual(['D4', 'E4', 'C4'])
    expect(moveNote(melody, 1, 1).map((n) => n.label)).toEqual(['C4', 'D4', 'E4'])
    expect(moveNote([], 0, 1)).toEqual([])
  })

  it('removeNote deletes one note (copy) and ignores a bad index', () => {
    expect(removeNote(melody, 1).map((n) => n.label)).toEqual(['C4', 'E4'])
    expect(removeNote(melody, 9).map((n) => n.label)).toEqual(['C4', 'D4', 'E4'])
    expect(melody).toHaveLength(3) // not mutated
  })

  it('insertRest adds a freq-0 rest at the index (clamped, appends past end)', () => {
    const a = insertRest(melody, 1, 120)
    expect(a.map((n) => `${n.freq}`)).toEqual(['262', '0', '294', '330'])
    expect(a[1]).toMatchObject({ freq: 0, ms: 120, label: 'P' })
    const appended = insertRest(melody, 99, 80)
    expect(appended[appended.length - 1]).toMatchObject({ freq: 0, ms: 80 })
  })

  it('makeRest builds a canonical rest (freq 0)', () => {
    expect(makeRest(150)).toEqual({ freq: 0, ms: 150, label: 'P' })
    expect(makeRest(-10)).toMatchObject({ freq: 0, ms: 0 })
  })

  it('a rest round-trips into the seq payload as 0:ms', () => {
    const m = insertRest([{ freq: 440, ms: 200 }], 1, 100)
    expect(buzzerSeqPayload(m)).toBe('seq 440:200,0:100')
  })
})

describe('buzzer-logic melodyToCodeSnippet (part C — paste to code)', () => {
  const melody: Tone[] = [
    { freq: 440, ms: 200, label: 'A4' },
    { freq: 0, ms: 100, label: 'P' },
    { freq: 523.25, ms: 200, label: 'C5' }
  ]

  it('emits a melody literal with rounded (freq, ms) pairs', () => {
    const snippet = melodyToCodeSnippet(melody, 0)
    expect(snippet).toContain('melody = [')
    expect(snippet).toContain('(440, 200),')
    expect(snippet).toContain('(0, 100),') // rest
    expect(snippet).toContain('(523, 200),') // freq rounded
    expect(snippet).toContain(']')
  })

  it('documents the Snakie library recipe with the chosen pin', () => {
    const snippet = melodyToCodeSnippet(melody, 7)
    expect(snippet).toContain('import instruments as inst')
    expect(snippet).toContain('#   inst.start(buzzer_pin=7)')
    expect(snippet).toContain('inst.buzzer.play_seq(melody)')
  })

  it('includes a runnable plain-MicroPython PWM loop on the same pin', () => {
    const snippet = melodyToCodeSnippet(melody, 7)
    expect(snippet).toContain('from machine import Pin, PWM')
    expect(snippet).toContain('import time')
    expect(snippet).toContain('_buz = PWM(Pin(7))')
    expect(snippet).toContain('for _freq, _ms in melody:')
    expect(snippet).toContain('_buz.duty_u16(32768 if _freq else 0)')
    expect(snippet).toContain('time.sleep_ms(_ms)')
  })

  it('rounds + clamps the pin into both recipe and loop', () => {
    const snippet = melodyToCodeSnippet([], 2.7)
    expect(snippet).toContain('inst.start(buzzer_pin=3)')
    expect(snippet).toContain('_buz = PWM(Pin(3))')
    expect(melodyToCodeSnippet([], -4)).toContain('_buz = PWM(Pin(0))')
  })

  it('the snippet declares a numeric buzzer pin that the sync helpers find', () => {
    // Round-trip: the snippet we paste is itself recognised by findBuzzerPinInCode.
    expect(findBuzzerPinInCode(melodyToCodeSnippet(melody, 11))).toBe(11)
  })
})

describe('buzzer-logic findBuzzerPinInCode (part E — read code pin)', () => {
  it('finds a plain buzzer_pin = N declaration', () => {
    expect(findBuzzerPinInCode('inst.start(buzzer_pin = 15)')).toBe(15)
  })

  it('tolerates no spaces and is case-insensitive', () => {
    expect(findBuzzerPinInCode('buzzer_pin=0')).toBe(0)
    expect(findBuzzerPinInCode('BUZZER_PIN = 15')).toBe(15)
  })

  it('returns the FIRST match when several are present', () => {
    expect(findBuzzerPinInCode('a buzzer_pin=4\nb buzzer_pin=9')).toBe(4)
  })

  it('returns null when there is no buzzer pin declared', () => {
    expect(findBuzzerPinInCode('print("no pin here")')).toBeNull()
    expect(findBuzzerPinInCode('')).toBeNull()
  })

  it('ignores a non-numeric (symbolic) assignment', () => {
    expect(findBuzzerPinInCode('buzzer_pin=BUZZER_PIN')).toBeNull()
  })
})

describe('buzzer-logic setBuzzerPinInCode (part E — one-click sync)', () => {
  it('rewrites the first numeric buzzer pin, preserving spacing', () => {
    expect(setBuzzerPinInCode('inst.start(buzzer_pin = 15)', 2)).toBe(
      'inst.start(buzzer_pin = 2)'
    )
    expect(setBuzzerPinInCode('buzzer_pin=0', 13)).toBe('buzzer_pin=13')
  })

  it('preserves the original casing of the identifier', () => {
    expect(setBuzzerPinInCode('BUZZER_PIN = 15', 3)).toBe('BUZZER_PIN = 3')
  })

  it('only rewrites the FIRST match', () => {
    expect(setBuzzerPinInCode('buzzer_pin=4\nbuzzer_pin=9', 1)).toBe(
      'buzzer_pin=1\nbuzzer_pin=9'
    )
  })

  it('returns the source unchanged when there is no numeric match', () => {
    expect(setBuzzerPinInCode('no pin here', 5)).toBe('no pin here')
    expect(setBuzzerPinInCode('buzzer_pin=BUZZER_PIN', 5)).toBe('buzzer_pin=BUZZER_PIN')
  })

  it('rounds + clamps the new pin', () => {
    expect(setBuzzerPinInCode('buzzer_pin=0', 2.7)).toBe('buzzer_pin=3')
    expect(setBuzzerPinInCode('buzzer_pin=0', -1)).toBe('buzzer_pin=0')
  })

  it('round-trips with findBuzzerPinInCode', () => {
    const updated = setBuzzerPinInCode('inst.start(buzzer_pin=15)', 22)
    expect(findBuzzerPinInCode(updated)).toBe(22)
  })
})

describe('buzzer-logic freqToStaff (pitch → staff position, part D)', () => {
  it('anchors B4 on the middle line (step 0, no accidental)', () => {
    const b4 = noteToFreq('B4')!
    expect(freqToStaff(b4)).toEqual({ step: 0, accidental: '', rest: false })
  })

  it('A4 is one step below the middle line; C5 is one above', () => {
    expect(freqToStaff(noteToFreq('A4')!).step).toBe(-1)
    expect(freqToStaff(noteToFreq('C5')!).step).toBe(1)
  })

  it('octaves move by 7 diatonic steps', () => {
    expect(freqToStaff(noteToFreq('B5')!).step).toBe(7)
    expect(freqToStaff(noteToFreq('B3')!).step).toBe(-7)
  })

  it('marks a sharp note with the # accidental, sharing the natural step', () => {
    const fSharp5 = freqToStaff(noteToFreq('F#5')!)
    expect(fSharp5.accidental).toBe('#')
    expect(fSharp5.step).toBe(freqToStaff(noteToFreq('F5')!).step) // same line as F
  })

  it('treats freq 0 / negative as a rest', () => {
    expect(freqToStaff(0)).toEqual({ step: 0, accidental: '', rest: true })
    expect(freqToStaff(-1).rest).toBe(true)
  })
})
