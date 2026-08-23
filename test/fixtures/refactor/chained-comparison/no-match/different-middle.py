"""Nothing is shared between the two comparisons, so there is no chain."""


def bounds(x, y, lo, hi, servo):
    if lo < x and y < hi:
        return "both"
    # Written differently, so we cannot prove it is the same value.
    if lo <= servo.angle and servo.get_angle() <= hi:
        return "angle"
    if lo < x and x + 1 < hi:
        return "offset"
    return "neither"
