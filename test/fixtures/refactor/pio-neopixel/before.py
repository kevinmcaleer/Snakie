"""Status light-bar on the rover's Pico, bit-banged one WS2812 bit at a time.

Two loops here time a WS2812 from Python. The rule points at each of them and
sends the reader to the stock `asm_pio` program and the `neopixel` module; it
never rewrites the driver, so this file is its own `after.py`.
"""
from machine import Pin
from time import sleep_us

data = Pin(16, Pin.OUT)
ring = Pin(17, Pin.OUT)

RED = (0, 32, 0)
AMBER = (20, 32, 0)
GREEN = (32, 0, 0)

NEOPIXEL_T0H_US = 1
NEOPIXEL_T1H_US = 1


def send_pixel(colour):
    """Shift one 24-bit GRB word out of the data pin, high bit first."""
    green, red, blue = colour
    word = (green << 16) | (red << 8) | blue
    for _bit in range(24):
        if word & 0x800000:
            data.value(1)
            sleep_us(1)
            data.value(0)
            sleep_us(1)
        else:
            data.value(1)
            sleep_us(1)
            data.value(0)
            sleep_us(2)
        word <<= 1


def send_ring_word(word, bits):
    """The arm ring's driver, with the bit periods hidden behind names."""
    mask = 1 << (bits - 1)
    while mask:
        ring.value(1)
        sleep_us(NEOPIXEL_T1H_US if word & mask else NEOPIXEL_T0H_US)
        ring.value(0)
        sleep_us(NEOPIXEL_T0H_US)
        mask >>= 1


def show(bar):
    for colour in bar:
        send_pixel(colour)
    # The strip latches after a long-enough gap on the data line.
    sleep_us(300)


show([RED, AMBER, GREEN, GREEN])
send_ring_word(0x203040, 24)
