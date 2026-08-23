# Wheel encoder odometry, timed with the microsecond counter.
import utime
from machine import Pin


class Encoder:
    def __init__(self, gpio):
        self.pin = Pin(gpio, Pin.IN, Pin.PULL_UP)
        self.last_edge = utime.ticks_us()
        self.period_us = 0

    def on_edge(self, _pin):
        now = utime.ticks_us()
        self.period_us = utime.ticks_diff(now, self.last_edge)
        self.last_edge = now

    def stalled(self, limit_us):
        return utime.ticks_diff(utime.ticks_us(), self.last_edge) > limit_us


def spin_cost(step):
    t0 = utime.ticks_cpu()
    step()
    return utime.ticks_diff(utime.ticks_cpu(), t0)
