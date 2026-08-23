"""Accumulators fed by a *computed* float, not a float literal.

Nothing here adds a `0.25`, so a literal-only check would call these integer
sums and be wrong twice over. In Python 3 a single `/` yields a float even for
two whole numbers, so `raw * 3.3 / 65535` and `VREF / 65535` are floats, and so
is anything built out of them.
"""
import time
from machine import ADC

battery = ADC(29)
VREF = 3.3
SCALE = VREF / 65535


def average_volts(samples):
    total = 0.0
    for _ in range(samples):
        volts = battery.read_u16() * 3.3 / 65535
        total += volts
        time.sleep_ms(2)
    return total / samples


def average_scaled(samples):
    total = 0.0
    for _ in range(samples):
        reading = battery.read_u16() * SCALE
        total += reading
        time.sleep_ms(2)
    return total / samples


def duty_ramp(steps):
    total = 0.0
    for n in range(steps):
        share = n / steps
        total += share
    return total


def parsed_total(rows):
    total = 0.0
    for row in rows:
        value = float(row)
        total += value
    return total
