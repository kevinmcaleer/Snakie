"""A logger that defines its own `int()`, so the builtin is not what runs here."""
from machine import ADC

battery = ADC(29)


def int(value):
    """Round half up — deliberately not the builtin's truncation."""
    whole = value // 1
    return whole + 1 if value - whole >= 0.5 else whole


def millivolts(raw):
    return int(raw * 3300 / 65535)
