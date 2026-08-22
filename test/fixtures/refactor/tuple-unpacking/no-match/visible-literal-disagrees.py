"""We can see what is being indexed, and unpacking it would not do the same."""


def limits():
    bounds = [0, 90, 180, 270]
    low = bounds[0]
    mid = bounds[1]
    return low, mid


def actions():
    lookup = {0: "stop", 1: "go"}
    first = lookup[0]
    second = lookup[1]
    return first, second
