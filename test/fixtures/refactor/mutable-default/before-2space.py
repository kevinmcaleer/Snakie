import time


def blink_pattern(led, pattern=[], gap_ms=100):
  """Blink `led` through every step of the pattern."""
  for step in pattern:
    led.value(step)
    time.sleep_ms(gap_ms)
  return len(pattern)
