# buckets: module docstring, constants, comment run, trailing comment
"""Small helpers shared by the workshop programs.

Nothing in here touches the hardware; it is all arithmetic, so it can be
tested on a laptop before it ever reaches a board.
"""

# Ranges the sensors come back with, measured on the bench rather than
# taken from a datasheet.
RAW_MIN = 300
RAW_MAX = 64000


def clamp(value, low, high):
    if value < low:
        return low
    if value > high:
        return high
    return value


def remap(value, out_low, out_high):
    span = RAW_MAX - RAW_MIN  # never zero on real hardware
    return out_low + (value - RAW_MIN) * (out_high - out_low) / span
