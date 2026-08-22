"""The running total is part of what gets added, so the order is the answer."""


def clamped_total(readings, ceiling):
    total = 0
    for reading in readings:
        total += min(reading, ceiling - total)
    return total


def doubling(samples):
    total = 0
    for sample in samples:
        total += total + sample
    return total
