"""Wheel odometry for the rover's drive loop.

Rule 8 is selection-driven: with no selection there is nothing to extract, so
`after.py` is byte-identical to this file. The blocks below are the ones the
scratch tests drive with a real selection.
"""

import time

from machine import Pin
from micropython import const

TICKS_PER_TURN = const(20)


def report_average(readings, radio):
    radio.send(b"start")
    total = 0
    for reading in readings:
        total += reading
    average = total / len(readings)
    radio.send(b"avg %d" % average)


def arm_drive(left_pin, right_pin):
    left = Pin(left_pin, Pin.OUT)
    right = Pin(right_pin, Pin.OUT)
    left.value(0)
    right.value(0)
    time.sleep_ms(20)
    return left, right


def cruise(rover, waypoints):
    for waypoint in waypoints:
        heading = rover.bearing_to(waypoint)
        error = heading - rover.heading()
        rover.steer(error * 0.4)
        time.sleep_ms(50)
