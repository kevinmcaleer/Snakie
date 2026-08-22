"""A display driver whose `init()` also takes a `callback=`.

`redraw` allocates freely, and that is fine: `screen` is a display, not a
`machine.Timer`, so its callback runs on the main thread like any other call.
The rule must prove the receiver is a timer before it warns about one.
"""
import time
from machine import I2C, Pin


class Display:
    def __init__(self, bus):
        self.bus = bus
        self.on_refresh = None

    def init(self, contrast=128, callback=None):
        self.on_refresh = callback

    def refresh(self, rows):
        if self.on_refresh:
            self.on_refresh(rows)


def redraw(rows):
    return ["{:>16}".format(row) for row in rows]


screen = Display(I2C(0, scl=Pin(5), sda=Pin(4)))
screen.init(contrast=200, callback=redraw)

while True:
    screen.refresh(["ready"])
    time.sleep(1)
