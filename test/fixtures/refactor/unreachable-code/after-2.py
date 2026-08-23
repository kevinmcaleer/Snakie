"""Boot sequence for the rover."""

import sys


def boot(rover):
    rover.led.on()
    print(sys.implementation.name)
    return rover  # ready


def safe_read(sensor):
    try:
        return sensor.read()
    except OSError:
        return None
