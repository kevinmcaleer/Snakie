"""Two-space telemetry maths."""


def pack_current(cells):
  total = sum(cell.amps for cell in cells)
  return total


def distance(ticks, mm_per_tick):
  travelled = sum(tick * mm_per_tick for tick in ticks)
  return travelled
