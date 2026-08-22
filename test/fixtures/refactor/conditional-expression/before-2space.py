"""Status LEDs — a two-space file, folded at whatever indent each `if` sits at."""

import sys

if sys.platform == "rp2":
  BAUD = 400_000
else:
  BAUD = 100_000


def indicate(led, linked):
  if linked:
    led.colour = (0, 32, 0)
  else:
    led.colour = (32, 0, 0)
  for zone in led.zones:
    if zone.active:
      zone.level = 255
    else:
      zone.level = 0
  return led
