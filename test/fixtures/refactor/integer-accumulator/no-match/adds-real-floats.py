"""Accumulators that genuinely hold fractions — the float is doing a job."""
import time
from machine import ADC

thermistor = ADC(28)
STEP_VOLTS = 0.05


def ramp_volts(steps):
    volts = 0.0
    for _ in range(steps):
        volts += STEP_VOLTS
        time.sleep_ms(10)
    return volts


def degrees(samples):
    total = 0.0
    for _ in range(samples):
        total += 0.25
        time.sleep_ms(5)
    return total / samples
