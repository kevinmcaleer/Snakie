"""Hex subscripts that are not registers at all.

`frame` is a packet buffer, `OPCODES` is a lookup table keyed by command byte,
and this module's own `mem32` is a shadow copy of a peripheral's registers with
no `machine` import anywhere in sight.
"""

frame = bytearray(64)

OPCODES = {0x01: "ping", 0x02: "drive", 0x03: "stop"}

mem32 = {}


def command():
    return OPCODES[frame[0x02]]


def cache(address, value):
    mem32[0x40050098] = value
    return mem32[address]
