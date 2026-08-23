"""A tail of defaults is not a row of anonymous numbers.

This is the shape of every display and radio driver in micropython-lib: one
required argument and a handful of optional tuning knobs. The call site is
`SSD1306(i2c)` and `blink(14)` — nothing here is hard to read, and nothing here
travels together as an unnamed idea.
"""


class SSD1306:
    def __init__(self, i2c, addr=0x3C, width=128, height=64, external_vcc=False, reset=None):
        self.i2c = i2c
        self.addr = addr
        self.width = width
        self.height = height
        self.external_vcc = external_vcc
        self.reset = reset


def blink(pin, times=3, gap_ms=100, brightness=255, fade=False, invert=False):
    print(pin, times, gap_ms, brightness, fade, invert)
