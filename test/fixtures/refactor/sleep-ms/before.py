"""Blink and beep, paced in fractions of a second."""

import time
from machine import Pin

led = Pin("LED", Pin.OUT)


def blink(times):
    for _ in range(times):
        led.on()
        time.sleep(0.1)
        led.off()
        time.sleep(0.25)


def settle():
    # Give the sensor a moment to power up.
    time.sleep(1)
    time.sleep(0.5)
