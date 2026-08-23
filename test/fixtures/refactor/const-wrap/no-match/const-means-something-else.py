"""Here `const` is the project's own helper, so a bare const() would call it."""


def const(value):
    """Clamp a value into the sane servo range."""
    return max(500, min(value, 2500))


BAUD_RATE = 115200
NEUTRAL_US = 1500
