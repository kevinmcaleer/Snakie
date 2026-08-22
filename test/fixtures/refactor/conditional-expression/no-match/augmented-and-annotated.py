"""Augmented and annotated assignments are not the same statement twice."""


def accumulate(total, tick, enabled):
    if enabled:
        total += tick
    else:
        total = 0
    return total


def baud(fast):
    if fast:
        rate: int = 400_000
    else:
        rate: int = 100_000
    return rate
