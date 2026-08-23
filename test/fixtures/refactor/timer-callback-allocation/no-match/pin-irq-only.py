"""An allocating pin interrupt, and no timer callback anywhere.

`Timer` is imported and armed, but the only thing that allocates is the `.irq()`
handler — which is rule 36's territory (`isr-allocation`). Rule 89 must not
double-report it.
"""
import micropython
import time
from machine import Pin, Timer

micropython.alloc_emergency_exception_buf(100)

button = Pin(15, Pin.IN, Pin.PULL_UP)
presses = []
uptime_s = 0


def on_press(pin):
    presses.append({"ms": time.ticks_ms()})


def tick(timer):
    global uptime_s
    uptime_s += 1


button.irq(trigger=Pin.IRQ_FALLING, handler=on_press)

clock = Timer(-1)
clock.init(period=1000, mode=Timer.PERIODIC, callback=tick)
