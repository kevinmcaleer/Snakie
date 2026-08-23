"""Waypoints and rover state for the line-follower."""

from machine import Pin


class Waypoint:
    def __init__(self, x, y, name="wp"):
        self.x = x
        self.y = y
        self.name = name


class Rover:
    """Everything the rover knows about itself."""

    def __init__(self, left_pin, right_pin, speed=0):
        self.left = Pin(left_pin, Pin.OUT)
        self.right = Pin(right_pin, Pin.OUT)
        self.speed = speed
        self.stalled = False

    def drive(self, speed):
        self.speed = speed
