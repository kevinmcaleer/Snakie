"""Status LEDs — a two-space file, folded at whatever indent each `if` sits at."""

import sys

BAUD = 400_000 if sys.platform == "rp2" else 100_000


def indicate(led, linked):
  led.colour = (0, 32, 0) if linked else (32, 0, 0)
  for zone in led.zones:
    zone.level = 255 if zone.active else 0
  return led
