"""Functions that look like callbacks but are never handed to a timer.

`render_status` and `snapshot` allocate happily — they are called from the main
loop. The timer that does exist is only used for its id, with no `callback=` at
all, so nothing in this file runs in interrupt context.
"""
import time
from machine import ADC, Pin, Timer

battery = ADC(Pin(26))
history = []


def snapshot(timer=None):
    return {"ms": time.ticks_ms(), "raw": battery.read_u16()}


def render_status(timer=None):
    return "battery {:.2f} V".format(battery.read_u16() * 3.3 / 65535)


spare = Timer(-1)

while True:
    history.append(snapshot())
    print(render_status())
    time.sleep(1)
