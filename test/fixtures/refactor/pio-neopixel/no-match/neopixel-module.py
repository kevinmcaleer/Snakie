"""The same status light-bar, driven by the built-in `neopixel` module.

This is one of the two answers the hint recommends, so it must never be hinted
at itself — the module does the bit timing in C, and nothing in this file writes
the data pin by hand.
"""
import time
import neopixel
from machine import Pin

BAR = neopixel.NeoPixel(Pin(16), 4)

RED = (0, 32, 0)
AMBER = (20, 32, 0)
GREEN = (32, 0, 0)


def show(colours):
    for index, colour in enumerate(colours):
        BAR[index] = colour
    BAR.write()


def sweep(colour, gap_ms=40):
    for index in range(len(BAR)):
        BAR.fill((0, 0, 0))
        BAR[index] = colour
        BAR.write()
        time.sleep_ms(gap_ms)


show([RED, AMBER, GREEN, GREEN])
sweep(AMBER)
