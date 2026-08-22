"""Battery and payload maths for the rover."""


def pack_voltage(cells):
    total = sum(cell.voltage() for cell in cells)
    print("pack", total)
    return total


def step_count(steps):
    total = sum(steps)
    return total


def payload_grams(parts):
    mass = sum(part.grams * part.count for part in parts)
    return mass / 1000
