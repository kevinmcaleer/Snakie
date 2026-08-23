"""A four-pin table under a wall of explanation.

The source span is well past four hundred characters, but almost all of it is
comment: the list itself is four small integers, which is nothing. Comments
cost no heap at all, so they must not count towards "this table is big".
"""
from machine import Pin

MOTOR_PINS = [
    # Wiring for the rev-C carrier board, looking at it from the front with
    # the USB socket towards you. Left motor first, then right, and each pair
    # is (forward, reverse) — the H-bridge inputs, not the enable line, which
    # lives on GP20 and is shared. If you rewire it, fix the comment too: the
    # numbers below are the only place the pinout is written down.
    2,
    3,
    4,
    5,
]


def motors():
    return tuple(Pin(n, Pin.OUT) for n in MOTOR_PINS)
