"""Collecting where a pause costs nothing.

Once before the timing-critical sweep, once after the job is done, and once in
the idle path while the rover waits for the start button.
"""

import gc
import time
from machine import Pin, PWM

start = Pin(14, Pin.IN, Pin.PULL_UP)
hip = PWM(Pin(16))


def sweep(steps):
    gc.collect()
    for step in range(steps):
        hip.duty_u16(1500 + step * 20)
        time.sleep_ms(20)
    gc.collect()


def wait_for_start():
    while start.value():
        gc.collect()


def top_up(passes):
    for _ in range(passes):
        if gc.mem_free() < 4096:
            gc.collect()
        time.sleep_ms(100)
