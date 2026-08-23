"""A `for` leaks its variable into the scope; a generator expression does not."""


def report(samples):
    total = 0
    for sample in samples:
        total += sample
    print("last sample was", sample)
    return total
