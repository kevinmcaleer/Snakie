import time


def tone_for(note):
  if note == 0:
    return 262
  elif note == 1:
    return 294
  elif note == 2:
    return 330
  elif note == 3:
    return 349


def play(notes, buzzer):
  for note in notes:
    buzzer.freq(tone_for(note))
    time.sleep_ms(200)
