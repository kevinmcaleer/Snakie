"""Follow the line for as long as the reflectance sensor sees it.

The loop condition reads a pin and the function does use ticks_us() for its
control period, but the body drives motors and logs — this is the robot's main
loop, not an edge-wait, and PIO has nothing to offer it.
"""
import time
from machine import Pin, PWM

line = Pin(13, Pin.IN)
left = PWM(Pin(6))
right = PWM(Pin(7))

BASE = 32000


def follow(bias=4000):
    last = time.ticks_us()
    while line.value() == 1:
        now = time.ticks_us()
        dt = time.ticks_diff(now, last)
        left.duty_u16(BASE + bias)
        right.duty_u16(BASE - bias)
        print("dt", dt)
        last = now
    left.duty_u16(0)
    right.duty_u16(0)


follow()
