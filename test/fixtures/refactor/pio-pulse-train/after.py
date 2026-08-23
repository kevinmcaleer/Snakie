"""Hold a hobby servo at centre by hand."""

import time
from machine import Pin

servo = Pin(15, Pin.OUT)


def hold_centre():
    while True:
        servo.value(1)
        time.sleep_us(1500)
        servo.value(0)
        time.sleep_us(18500)
