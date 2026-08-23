"""The constructor argument changes every pass, so the object cannot move."""

from machine import Pin
from time import sleep_ms

ROW_PINS = (2, 3, 4, 5)


def strobe(times):
    for _ in range(times):
        for number in ROW_PINS:
            row = Pin(number, Pin.OUT)
            row.value(1)
            sleep_ms(1)
            row.value(0)
