"""The instance is the first parameter, whatever the author called it.

`Blinker` plainly holds a pin. Looking for the literal name `self` finds nothing
in here at all, and the rule would then announce that the class holds no state —
the most confidently wrong thing it could say.
"""

import time
from machine import Pin


class Blinker:
    def __init__(s, pin):
        s.led = Pin(pin, Pin.OUT)

    def flash(s, times, gap_ms):
        for _ in range(times):
            s.led.toggle()
            time.sleep_ms(gap_ms)
