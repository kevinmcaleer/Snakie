"""A beacon whose uptime stamp is a module global, written through `global`.

Nothing at module level assigns `last_tick`, so a scan of the module's own
statements says the name is free — but `note_reset()` claims it with a `global`,
and its assignment hides inside that function's locals. The timestamp the
rewrite introduces has to pick a different name, or the two would share one
variable and stamp on each other every pass.
"""
import time
from machine import Pin

led = Pin(25, Pin.OUT)


def note_reset():
    global last_tick
    last_tick = time.ticks_ms()
    print("reset at", last_tick)


note_reset()

last_tick2 = time.ticks_ms()
while True:
    if time.ticks_diff(time.ticks_ms(), last_tick2) >= 500:
        last_tick2 = time.ticks_ms()
        led.toggle()
        note_reset()
