"""A two-space file: the new line takes the indentation it lands in."""

from time import ticks_ms


class Rover:
  def __init__(self, left, right):
    self.left = left
    self.right = right

  def blend(self, base, trim):
    if base + trim * 2 > 255:
      return 255
    return base + trim * 2


def wait_for(deadline, now):
  while now < deadline - 250:
    now = ticks_ms()
  return deadline - 250
