import time


_NOTE_TABLE = {
  0: 262,
  1: 294,
  2: 330,
  3: 349,
}


def tone_for(note):
  return _NOTE_TABLE.get(note)


def play(notes, buzzer):
  for note in notes:
    buzzer.freq(tone_for(note))
    time.sleep_ms(200)
