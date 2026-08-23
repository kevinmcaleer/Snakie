"""Module-level code: there is no enclosing `def` for the new one to sit beside."""

import time

from machine import Pin

led = Pin(25, Pin.OUT)
for _ in range(3):
    led.value(1)
    time.sleep_ms(120)
    led.value(0)
    time.sleep_ms(120)
