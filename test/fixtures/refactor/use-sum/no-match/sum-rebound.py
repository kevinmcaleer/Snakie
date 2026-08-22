"""This module defines its own `sum`, so the built-in is not the one in scope."""


def sum(values):
    return values


def pack_voltage(cells):
    total = 0
    for cell in cells:
        total += cell.volts
    return total
