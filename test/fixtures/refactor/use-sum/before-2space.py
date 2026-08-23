"""Two-space telemetry maths."""


def pack_current(cells):
  total = 0
  for cell in cells:
    total += cell.amps
  return total


def distance(ticks, mm_per_tick):
  travelled = 0
  for tick in ticks:
    travelled += tick * mm_per_tick
  return travelled
