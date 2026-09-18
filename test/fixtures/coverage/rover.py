# buckets: class, inheritance, methods, self.x.y() call, global, docstring
import time

from machine import Pin


class Wheels:
    def __init__(self, left, right):
        self.left = left
        self.right = right

    def both(self, speed):
        self.left.drive(speed)
        self.right.drive(speed)


class Rover(Wheels):
    """A two-wheeled rover with a bump switch on the front."""

    def __init__(self, left, right, bumper):
        self.left = left
        self.right = right
        self.bumper = Pin(bumper, Pin.IN, Pin.PULL_UP)
        self.running = False

    def go(self, speed):
        self.running = True
        self.both(speed)

    def stop(self):
        self.running = False
        self.both(0)

    def patrol(self, speed):
        self.go(speed)
        while self.running:
            if self.bumper.value() == 0:
                self.stop()
            time.sleep(0.02)
