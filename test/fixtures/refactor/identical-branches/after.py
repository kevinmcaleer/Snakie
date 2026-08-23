"""Gear, status and fault helpers for the rover."""

import time

FATAL = (2, 5, 9)


def pick_gear(load, gearbox):
    gearbox.select("low")
    gearbox.engage()


def battery_icon(level):
    return "battery-ok"


def blink_pattern(count, led):
    for _ in range(count):
        led.toggle()
        time.sleep_ms(50)


def report_fault(radio, code):
    # Fatal or not, the base station wants to know.
    radio.send(code)
    radio.flush()
