"""Calibration helpers that call `int()` for reasons the rule must leave alone."""

RAW_FULL_SCALE = 65535


def as_whole(reading):
    # No division at all — just a conversion.
    return int(reading)


def from_hex(text):
    # A base argument, not a division.
    return int(text, 16)


def scaled(reading, gain):
    return int(reading * gain)


def nearest(total, count):
    # `round()` is a different question with a different answer.
    return round(total / count)


def already_truncated(total, count):
    return int(total // count)
