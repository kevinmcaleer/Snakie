"""A two-space file: the new line takes the indentation it lands in."""

from time import ticks_ms


class Rover:
  def __init__(self, left, right):
    self.left = left
    self.right = right

  def blend(self, base, trim):
    value = base + trim * 2
    if value > 255:
      return 255
    return value


def wait_for(deadline, now):
  value = deadline - 250
  while now < value:
    now = ticks_ms()
  return value
