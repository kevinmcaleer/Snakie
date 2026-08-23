"""Already written as one call — the rule must not fire on its own output."""


def to_millivolts(reading):
    if isinstance(reading, (int, float)):
        return round(reading * 3300 / 65535)
    raise TypeError("reading must be a number")


def is_buffer(value):
    return isinstance(value, (bytes, bytearray, memoryview))
