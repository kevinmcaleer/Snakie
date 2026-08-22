"""Servo trim values, measured on the bench with the arm horizontal."""

from micropython import const

# Steps away from centre, at 3.3 V.
SHOULDER_TRIM = const(-4)
ELBOW_TRIM = const(7)


def apply_trim(shoulder, elbow):
    return shoulder + SHOULDER_TRIM, elbow + ELBOW_TRIM
