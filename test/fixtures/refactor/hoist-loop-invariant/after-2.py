"""A two-space file with two invariants in the same loop."""
BASE = 1000


def pulse(pins, config):
  high = BASE + config.trim
  low = BASE - config.trim
  for pin in pins:
    pin.duty_u16(high)
    pin.duty_u16(low)


def hold(pins, config):
  level = BASE // 2
  while config.armed:
    for pin in pins:
      pin.duty_u16(level)
      pin.off()
