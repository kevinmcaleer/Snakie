"""`speed` changes between the two copies, so they were never the same value."""


def ramp(speed, trim):
    first = speed * 100 + trim
    speed = speed + 1
    second = speed * 100 + trim
    return first, second
