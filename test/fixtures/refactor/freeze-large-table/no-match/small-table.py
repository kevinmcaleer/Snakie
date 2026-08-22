"""A handful of named steps is not a table."""

STEPS = [0, 64, 128, 192, 255]


def step(i):
    return STEPS[i]
