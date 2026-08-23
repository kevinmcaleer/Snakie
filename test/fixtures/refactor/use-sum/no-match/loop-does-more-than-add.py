"""There is other work in the body, so the loop is not only an accumulator."""


def logged_total(readings):
    total = 0
    for reading in readings:
        print(reading)
        total += reading
    return total


def subtracts(samples, baseline):
    total = 0
    for sample in samples:
        total -= sample - baseline
    return total
