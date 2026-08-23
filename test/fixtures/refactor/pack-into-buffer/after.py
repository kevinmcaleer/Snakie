"""Stream IMU samples off a Pico at 200 Hz.

Every `struct.pack()` in the loops below hands back a brand-new bytes object
that is garbage a line later. The rule points at each one and explains;
choosing where the buffer lives is a human decision, so this file is its own
`after.py`.
"""
import struct
import time
from machine import I2C, Pin, UART

SAMPLE = "<Hhhh"
STATUS = "<HI"

imu = I2C(0, scl=Pin(9), sda=Pin(8))
link = UART(1, 115200)


def stream(samples):
    for n in range(samples):
        raw = imu.readfrom_mem(0x68, 0x3B, 6)
        ax, ay, az = struct.unpack(">hhh", raw)
        link.write(struct.pack(SAMPLE, n, ax, ay, az))
        time.sleep_ms(5)


def heartbeat():
    while True:
        link.write(struct.pack(STATUS, 0xBEEF, time.ticks_ms()))
        time.sleep_ms(1000)


def header():
    # Once, before the stream starts — nothing to fix here.
    link.write(struct.pack("<4sH", b"IMU0", 1))
