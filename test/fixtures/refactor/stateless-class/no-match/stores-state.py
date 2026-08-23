"""The instance remembers the pin, so it is a real object."""

import time
from machine import Pin


class Blinker:
    def __init__(self, pin):
        self.led = Pin(pin, Pin.OUT)

    def flash(self, times, gap_ms):
        for _ in range(times):
            self.led.on()
            time.sleep_ms(gap_ms)
            self.led.off()
            time.sleep_ms(gap_ms)
