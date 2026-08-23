"""Plenty of allocation here, none of it in interrupt context.

The only handler registered with `.irq()` is `on_button`, which sets a flag.
`describe`, `build_report` and the main loop all allocate freely — they run on
the main thread, where that is exactly what you are supposed to do.
"""
import micropython
import time
from machine import Pin

micropython.alloc_emergency_exception_buf(100)

button = Pin(15, Pin.IN, Pin.PULL_UP)
pressed = False
readings = []


def on_button(pin):
    global pressed
    pressed = True


def describe(sensor, value):
    return f"{sensor}: {value:.2f}"


def build_report(samples):
    rows = [describe(name, value) for name, value in samples]
    return {"count": len(rows), "rows": rows, "at": time.ticks_ms()}


button.irq(trigger=Pin.IRQ_FALLING, handler=on_button)

while True:
    if pressed:
        pressed = False
        readings.append(build_report([("range", 12.5)]))
        print("captured " + str(len(readings)))
    time.sleep_ms(50)
