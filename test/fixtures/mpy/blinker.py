# Source for blinker.mpy — a driver-shaped module used by mpyInfo.test.ts.
# Regenerate the .mpy with:  mpy-cross -o blinker.mpy blinker.py   (mpy-cross 1.29.0)
VERSION = "1.2.3"

_GREETING = "hello from the blinker"


class Blinker:
    def __init__(self, pin, interval=0.5):
        self.pin = pin
        self.interval = interval

    def blink(self, times=3):
        for _ in range(times):
            self.pin.toggle()


def make_blinker(pin):
    return Blinker(pin, interval=0.25)
