"""An import that looks unused but is not — the trap this slot hands to ruff.

`boot_pins` is imported for what it does on import (it drives the enable pin
high), and `_` is the conventional throwaway loop name. A hand-rolled unused
check would flag both; ruff's F401/F841 know better, which is the whole argument
for delegating this one.
"""

import boot_pins
from machine import Pin


def blink(pin, times):
    led = Pin(pin, Pin.OUT)
    for _ in range(times):
        led.toggle()
