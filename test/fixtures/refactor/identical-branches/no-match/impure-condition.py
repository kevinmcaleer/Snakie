"""Dropping the test would skip a real hardware read."""

import time


def flash(sensor, led):
    if sensor.read() > 100:
        led.on()
        time.sleep_ms(20)
    else:
        led.on()
        time.sleep_ms(20)
