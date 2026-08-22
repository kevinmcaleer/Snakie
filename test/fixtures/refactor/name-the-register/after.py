"""Direct SIO access for the quadrature decoder's fast path.

`Pin.value()` costs a method call per edge, which the decoder cannot afford at
40 kHz, so the pin is driven straight through the single-cycle IO block.
"""

import machine


def blink(count):
    """Toggle the on-board LED by writing the XOR register by hand."""
    for _ in range(count):
        machine.mem32[0xD000001C] = 1 << 25


def read_pad():
    """Read the pad control word for the encoder's A channel."""
    return machine.mem32[0x4001C00C]


def set_drive(strength):
    """Set drive strength and slew on the encoder pads."""
    machine.mem32[0x4001C010] = strength
    machine.mem16[0x4001C014] = strength & 0xFFFF
    machine.mem8[1073856532] = strength & 0xFF
