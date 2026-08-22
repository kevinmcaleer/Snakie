"""The same trick with the memory windows imported by name.

`from machine import mem32` is the other spelling people use for register
banging, and it is just as unreadable without a name on the address.
"""

from machine import mem16, mem32


def arm_pwm(slice_mask):
    mem32[0x40050098] = slice_mask


def counter():
    return mem16[0x40050010]
