"""Ultrasonic ranging on the rover's front HC-SR04, timed two different ways.

`ping_hand_rolled()` spins on the echo pin and reads the clock either side;
`ping_time_pulse()` hands the same job to C. The rule points at both — firmly at
the first, gently at the second — and rewrites neither, so this file is its own
`after.py`.
"""
import machine
import time
from machine import Pin

trigger = Pin(14, Pin.OUT, value=0)
echo = Pin(15, Pin.IN)

US_PER_CM = 58.0
TIMEOUT_US = 30_000


def _send_burst():
    trigger.value(0)
    time.sleep_us(5)
    trigger.value(1)
    time.sleep_us(10)
    trigger.value(0)


def ping_hand_rolled():
    """Time the echo pulse with two ticks_us() readings."""
    _send_burst()
    start = time.ticks_us()
    while echo.value() == 0:
        start = time.ticks_us()
    while echo.value() == 1:
        pass
    end = time.ticks_us()
    return time.ticks_diff(end, start) / US_PER_CM


def ping_time_pulse():
    """The same measurement, but the spinning happens in C."""
    _send_burst()
    us = machine.time_pulse_us(echo, 1, TIMEOUT_US)
    if us < 0:
        return None
    return us / US_PER_CM


for _ in range(5):
    print(ping_hand_rolled(), ping_time_pulse())
    time.sleep_ms(60)
