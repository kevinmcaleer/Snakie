"""Sweep and heartbeat for the rover.

Both loops picked up a `gc.collect()` after a MemoryError that turned out to be
coming from the telemetry buffer, not from either of these.
"""

import gc
import time
from machine import Pin, PWM

led = Pin("LED", Pin.OUT)
hip = PWM(Pin(16))


def sweep(steps):
    """Walk the hip servo across its range one step at a time."""
    for step in range(steps):
        hip.duty_u16(1500 + step * 20)
        time.sleep_ms(20)


def heartbeat(beats):
    """Blink the on-board LED so we can see the loop is still alive."""
    beat = 0
    while beat < beats:
        led.toggle()
        time.sleep_ms(500)
        beat += 1
