"""Battery, odometry and light averages on a Pico rover.

Every accumulator below is declared a float out of habit and then only ever
gains whole numbers, so each `+=` goes through the soft-float library. Moving
to integer units is a readability trade, so the rule explains and leaves the
code alone: this file is its own `after.py`.
"""
import time
from machine import ADC, Pin

battery = ADC(29)
odometer = Pin(16, Pin.IN, Pin.PULL_UP)


def average_raw(samples):
    """Mean of `samples` raw ADC readings."""
    total = 0.0
    for _ in range(samples):
        reading = battery.read_u16()
        total += reading
        time.sleep_ms(2)
    return total / samples


def coast_ticks():
    """Count encoder edges until the wheel stops turning."""
    travelled = 0.0
    while odometer.value():
        travelled += 1
        time.sleep_ms(1)
    return travelled


def brightness(row):
    lit = 0.0
    for pixel in row:
        lit += pixel
    return lit
