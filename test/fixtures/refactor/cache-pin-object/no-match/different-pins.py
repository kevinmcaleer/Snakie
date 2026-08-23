"""Four different pins — every construction claims a different pad."""

from machine import Pin


def setup_keypad():
    rows = [
        Pin(2, Pin.OUT),
        Pin(3, Pin.OUT),
        Pin(4, Pin.OUT),
        Pin(5, Pin.OUT)
    ]
    return rows
