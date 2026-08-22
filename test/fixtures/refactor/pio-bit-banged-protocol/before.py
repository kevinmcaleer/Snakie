"""Shift a byte out to a shift register, MSB first."""

from machine import Pin

data = Pin(2, Pin.OUT)
clock = Pin(3, Pin.OUT)


def shift_out(byte):
    for i in range(8):
        data.value((byte >> (7 - i)) & 1)
        clock.value(1)
        clock.value(0)
