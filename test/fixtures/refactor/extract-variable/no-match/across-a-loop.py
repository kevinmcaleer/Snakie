"""The two copies live in different blocks, so neither is hoisted past the other."""


def sweep(steps, offset):
    total = 0
    for step in steps:
        total += offset * 4 + 12
    print(offset * 4 + 12)
    return total
