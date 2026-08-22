"""A two-space file with two invariants in the same loop."""
BASE = 1000


def pulse(pins, config):
  for pin in pins:
    high = BASE + config.trim
    low = BASE - config.trim
    pin.duty_u16(high)
    pin.duty_u16(low)


def hold(pins, config):
  while config.armed:
    level = BASE // 2
    for pin in pins:
      pin.duty_u16(level)
      pin.off()
