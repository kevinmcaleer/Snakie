"""The index is never used to reach into the sequence, so there is nothing to swap."""

import time


def blink_each(leds, delay_ms):
    for i in range(len(leds)):
        print("step", i)
        time.sleep_ms(delay_ms)


def countdown(steps):
    for i in range(len(steps)):
        print(len(steps) - i)
