"""The reader is inside a loop the assignment is outside of: `base + rate` would
be worked out on every pass, and `base` changes on every pass too."""

LIMIT = 4096


def climb(base, rate):
    step = base + rate
    while base < LIMIT:
        base = base + step
    return base
