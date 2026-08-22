"""An allocating timer callback and no `.irq()` anywhere.

This is the same hazard through a different door, and it belongs to rule 89
(`timer-callback-allocation`). Rule 36 must leave it alone rather than double-
report it.
"""
import micropython
import time
from machine import ADC, Pin, Timer

micropython.alloc_emergency_exception_buf(100)

battery = ADC(Pin(26))
log = []


def sample(timer):
    log.append({"ms": time.ticks_ms(), "raw": battery.read_u16()})


sampler = Timer(-1)
sampler.init(period=100, mode=Timer.PERIODIC, callback=sample)
