"""Wait at the bottom of the file for the start button, with a clock reader above.

The regression this pins down: the spin loop is at module level, and the only
`ticks_us()` in the file is inside `uptime()`, which this loop never calls. The
loop is not timing anything — it is waiting for a finger — so reading every
function in the file for a clock call would report a pulse measurement that does
not exist. Nothing here is an echo, and PIO has nothing to offer it.
"""
import time
from machine import Pin

start_button = Pin(12, Pin.IN, Pin.PULL_UP)
ready_led = Pin(25, Pin.OUT)


def uptime():
    """Microseconds since boot, for the run log."""
    return time.ticks_us()


ready_led.on()
while start_button.value() == 1:
    pass
ready_led.off()

print("started at", uptime())
