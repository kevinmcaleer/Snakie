"""The subject is read from the bus each time — combining would halve the reads."""


def numeric_sample(bus):
    if isinstance(bus.read(), int) or isinstance(bus.read(), float):
        return True
    return False


def numeric_slot(samples, index):
    return isinstance(samples[index], int) or isinstance(samples[index], float)
