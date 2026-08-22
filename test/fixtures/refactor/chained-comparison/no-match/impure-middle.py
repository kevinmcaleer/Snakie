"""Chaining would call the middle term once instead of twice."""


def settling(sensor, lo, hi):
    # Two ADC reads become one, and the second sample is the one that decides.
    if lo < sensor.read() and sensor.read() < hi:
        return True
    # Same trap through a subscript: `__getitem__` can be anybody's code.
    if lo <= window[0] and window[0] <= hi:
        return True
    return False
