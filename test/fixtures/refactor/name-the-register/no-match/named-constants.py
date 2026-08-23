"""The same register banging, already documented.

Every address carries the name the RP2040 datasheet gives it, and the offsets
hang off a named base, which is exactly how the datasheet reads.
"""

from micropython import const

import machine

SIO_BASE = const(0xD0000000)
SIO_GPIO_OUT_XOR = const(0xD000001C)
PADS_BANK0_BASE = const(0x4001C000)
LED_MASK = const(1 << 25)


def blink(count):
    for _ in range(count):
        machine.mem32[SIO_GPIO_OUT_XOR] = LED_MASK


def read_pad(gpio):
    return machine.mem32[PADS_BANK0_BASE + 0x04 + gpio * 4]


def gpio_out():
    return machine.mem32[SIO_BASE + 0x10]
