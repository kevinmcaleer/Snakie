"""Bumper switch tallies on the rover's front corners.

Two pin reads and two counters in a polling loop — the same ingredients as a
quadrature decoder, but the two inputs are never combined into one reading, so
they are simply two independent switches and PIO would not help.
"""
import time
from machine import Pin

left_bumper = Pin(10, Pin.IN, Pin.PULL_UP)
right_bumper = Pin(11, Pin.IN, Pin.PULL_UP)

left_hits = 0
right_hits = 0


def watch_bumpers(seconds):
    global left_hits, right_hits
    deadline = time.ticks_add(time.ticks_ms(), int(seconds * 1000))
    while time.ticks_diff(deadline, time.ticks_ms()) > 0:
        if left_bumper.value() == 0:
            left_hits += 1
        if right_bumper.value() == 0:
            right_hits += 1
        time.sleep_ms(20)


watch_bumpers(5.0)
print("bumps", left_hits, right_hits)
