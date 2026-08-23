"""The status bar driven by the `neopixel` module, with a piezo alert beside it.

The regression this pins down: the word "neopixel" appears twice in `alert()`,
because the author took this very rule's advice and moved the strip onto the
built-in module. The loop underneath it is a piezo chirp — a pin write and a
500 us sleep, which a Python loop holds perfectly well — and it has nothing to
do with WS2812 timing. Reading the whole enclosing function for the word would
tell this author their buzzer is a hand-rolled WS2812 driver, which is the exact
wrong hint the rule's narrowness exists to avoid.
"""
import time
import neopixel
from machine import Pin

bar = neopixel.NeoPixel(Pin(16), 4)
buzzer = Pin(20, Pin.OUT)

RED = (0, 32, 0)
CHIRP_US = 500


def alert(chirps=3):
    """Flash the neopixel bar red and chirp the piezo."""
    bar.fill(RED)
    bar.write()
    for _ in range(chirps):
        # A 500 us half-period is 1 kHz; the interpreter has no trouble with it.
        buzzer.value(1)
        time.sleep_us(CHIRP_US)
        buzzer.value(0)
        time.sleep_us(CHIRP_US)
    bar.fill((0, 0, 0))
    bar.write()


alert()
