"""Servo trim values, measured on the bench with the arm horizontal."""

# Steps away from centre, at 3.3 V.
SHOULDER_TRIM = -4
ELBOW_TRIM = 7


def apply_trim(shoulder, elbow):
    return shoulder + SHOULDER_TRIM, elbow + ELBOW_TRIM
