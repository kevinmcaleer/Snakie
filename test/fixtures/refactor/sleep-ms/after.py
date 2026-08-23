"""Blink and beep, paced in fractions of a second."""

import time
from machine import Pin

led = Pin("LED", Pin.OUT)


def blink(times):
    for _ in range(times):
        led.on()
        time.sleep_ms(100)
        led.off()
        time.sleep_ms(250)


def settle():
    # Give the sensor a moment to power up.
    time.sleep(1)
    time.sleep_ms(500)
