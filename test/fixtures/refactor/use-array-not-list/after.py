"""Gait and brightness tables for the four-legged walker.

Every table below lives on the heap for the whole run, and none of them ever
holds anything but numbers.
"""

from machine import PWM, Pin

hip = PWM(Pin(16))

# One quarter of a hip sweep, in servo microseconds.
SWEEP = [1500, 1587, 1673, 1757, 1837, 1913, 1983, 2048, 2106, 2156]

# Perceptual brightness ramp for the status LED.
GAMMA = [0, 1, 2, 4, 7, 11, 17, 25, 36, 50, 68, 91, 119, 154, 196, 246]

# Per-leg trim, in degrees, measured on the bench.
TRIM = [0.0, -1.5, 2.25, 0.75, -0.5, 1.0, 0.25, -2.0]

history = [0] * 64


def step(frame):
    """Drive the hip to the next point on the sweep and log the frame."""
    hip.duty_u16(SWEEP[frame % len(SWEEP)] * 20)
    history[frame % 64] = frame
    return GAMMA[frame % len(GAMMA)]
