"""Deep nesting at module scope: there is no function to extract from."""

import time

from machine import Pin

LEDS = [Pin(n, Pin.OUT) for n in (2, 3, 4)]

for cycle in range(3):
    for led in LEDS:
        if led.value():
            for _ in range(2):
                if time.ticks_ms() % 2:
                    led.off()
                    time.sleep_ms(10)
