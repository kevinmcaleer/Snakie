"""Boot sequence for the rover."""

import sys


def boot(rover):
    rover.led.on()
    print(sys.implementation.name)
    return rover  # ready
    rover.led.off()
    rover.halt()


def safe_read(sensor):
    try:
        return sensor.read()
        sensor.reset()
    except OSError:
        return None
