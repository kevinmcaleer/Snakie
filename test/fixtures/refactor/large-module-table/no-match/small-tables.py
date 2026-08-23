"""Configuration for a four-wheel rover — every table here is small."""
from machine import Pin

LEG_ORDER = ("fl", "fr", "rl", "rr")
MOTOR_PINS = {"fl": (2, 3), "fr": (4, 5), "rl": (6, 7), "rr": (8, 9)}
LED_PINS = [14, 15, 16, 17]
MODES = {"idle", "drive", "charge"}
RAMP = [0, 16, 32, 48, 64, 80, 96, 112, 128, 144, 160, 176, 192, 208, 224, 240]


def motor(name):
    return tuple(Pin(n, Pin.OUT) for n in MOTOR_PINS[name])
