"""Battery and payload maths for the rover."""


def pack_voltage(cells):
    total = 0
    for cell in cells:
        total += cell.voltage()
    print("pack", total)
    return total


def step_count(steps):
    total = 0
    for step in steps:
        total += step
    return total


def payload_grams(parts):
    mass = 0
    for part in parts:
        mass += part.grams * part.count
    return mass / 1000
