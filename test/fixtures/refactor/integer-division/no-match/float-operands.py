"""Divisions the file itself says are floats — `//` would change the type.

`int()` always returns an `int`. `//` only does when both operands are
integers: `int(7.5 / 2)` is `3`, but `7.5 // 2` is `3.0`. A float index or a
float passed to `range()` is a TypeError, so none of these may be offered.
"""

STEP_MM = 0.5
VREF_VOLTS = 3.3
BANDS = [0] * 16


def steps_for(travel_mm):
    # A named float constant is still a float.
    return int(travel_mm / STEP_MM)


def band_for(reading):
    # This was `BANDS[int(reading / 0.1)]`; `reading // 0.1` is a float, and a
    # float subscript raises TypeError.
    return BANDS[int(reading / 0.1)]


def half_of(total):
    return int(total / 2.0)


def scaled(raw):
    return int(raw * 1.5 / 2)


def divisions(total):
    return range(int(total / 1e3))


def from_text(text):
    return int(float(text) / 2)


def volts_per_step(steps):
    return int(VREF_VOLTS / steps)
