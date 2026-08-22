"""Chains that only look like the smell: a spare clause, or the wrong operator."""


def usable(value):
    if isinstance(value, int) or value is None:
        return True
    if isinstance(value, str) and isinstance(value, bytes):
        return False
    return isinstance(value, float) or len(value) > 0
