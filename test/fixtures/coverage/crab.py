# buckets: class, inheritance, methods, @property, self.x assign, early return
import time

from machine import Pin


class Leg:
    """One leg of the crab, two servos deep."""

    def __init__(self, hip, knee):
        self.hip = hip
        self.knee = knee
        self.down = True

    @property
    def lifted(self):
        return not self.down

    def lift(self):
        if self.lifted:
            return
        self.knee.angle(120)
        self.down = False

    def plant(self):
        self.knee.angle(60)
        self.down = True


class Crab(object):
    def __init__(self, legs):
        self.legs = legs
        self.step_delay = 0.2

    def walk(self, steps):
        for _ in range(steps):
            for leg in self.legs:
                leg.lift()
                time.sleep(self.step_delay)
                leg.plant()

    def halt(self):
        for leg in self.legs:
            leg.plant()
