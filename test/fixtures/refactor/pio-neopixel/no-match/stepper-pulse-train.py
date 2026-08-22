"""Step/direction pulses for the rover's lead-screw stepper.

A loop that writes a pin and sleeps for microseconds — the same shape as a
bit-banged LED strip, but at 500 us a Python loop holds the timing perfectly
well, and nothing here claims to be driving addressable pixels.
"""
import time
from machine import Pin

step = Pin(20, Pin.OUT)
direction = Pin(21, Pin.OUT)
enable = Pin(22, Pin.OUT, value=1)

PULSE_US = 500


def move(steps, forward=True):
    direction.value(1 if forward else 0)
    enable.value(0)
    for _ in range(steps):
        step.value(1)
        time.sleep_us(PULSE_US)
        step.value(0)
        time.sleep_us(PULSE_US)
    enable.value(1)


move(400)
move(400, forward=False)
