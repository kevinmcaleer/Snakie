"""Telemetry helpers for the rover's sensor bus."""

from machine import Pin


def to_millivolts(reading):
    if isinstance(reading, int) or isinstance(reading, float):
        return round(reading * 3300 / 65535)
    raise TypeError("reading must be a number")


def encode(value):
    # Scalars go out as they are; anything else is packed first.
    if isinstance(value, bool) or isinstance(value, int) or isinstance(value, float):
        return value
    return pack(value)


def resolve_pin(pin):
    if isinstance(pin, (int, str)) or isinstance(pin, Pin):
        return Pin(pin)
    return None


class Frame:
    def matches(self, other):
        return isinstance(other, Frame) or isinstance(other, bytes)
