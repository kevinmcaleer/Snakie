"""`sum()` starts from zero, so a pre-loaded accumulator is a different total."""


def total_with_tare(readings, tare):
    total = tare
    for reading in readings:
        total += reading
    return total


def offset_total(samples):
    total = 1
    for sample in samples:
        total += sample
    return total
