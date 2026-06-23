# SPDX-License-Identifier: MIT
"""Quadrature rotary-encoder helper (Snakie module #120).

This is the driver behind the dock **Encoder** instrument (#117). It decodes the
two-bit Gray-code transitions of a quadrature rotary encoder into a running step
count + direction.

Usage on a board::

    from rotary import Rotary
    import instruments as inst

    enc = Rotary(clk=2, dt=3)
    while True:
        inst.plot(steps=enc.value())   # -> Encoder / Plotter

The pure transition decode (`step_delta`) is split out so it can be unit-tested
under CPython with no pins — the IDE drives it with synthetic state sequences.
"""

# Quadrature transition table: index by (prev_state << 2) | new_state, where each
# 2-bit state is (clk << 1) | dt. +1 = clockwise step, -1 = counter-clockwise,
# 0 = no movement / invalid (bounce) transition.
_TABLE = (
    0, -1, 1, 0,
    1, 0, 0, -1,
    -1, 0, 0, 1,
    0, 1, -1, 0,
)


def step_delta(prev_state, new_state):
    """Return the step delta (-1, 0, +1) for a quadrature transition. Pure.

    `prev_state` / `new_state` are 2-bit values ``(clk << 1) | dt``. Invalid /
    bounce transitions yield ``0``. This is the whole decode logic, hardware-free
    so the IDE can unit-test the direction handling.
    """
    return _TABLE[((prev_state & 0b11) << 2) | (new_state & 0b11)]


class Rotary:
    """Polled quadrature rotary encoder on the `clk` and `dt` pins."""

    def __init__(self, clk, dt):
        from machine import Pin

        self._clk = clk if isinstance(clk, Pin) else Pin(clk, Pin.IN, Pin.PULL_UP)
        self._dt = dt if isinstance(dt, Pin) else Pin(dt, Pin.IN, Pin.PULL_UP)
        self._count = 0
        self._state = (self._clk.value() << 1) | self._dt.value()

    def poll(self):
        """Sample the pins, fold in any step, and return the latest count.

        Call this often (e.g. each loop iteration); it is non-blocking.
        """
        new_state = (self._clk.value() << 1) | self._dt.value()
        self._count += step_delta(self._state, new_state)
        self._state = new_state
        return self._count

    def value(self):
        """Return the current accumulated step count (after `poll`)."""
        return self._count

    def reset(self):
        """Reset the step count to zero."""
        self._count = 0
