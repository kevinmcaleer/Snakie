"""The pack lives in a helper, so this file cannot say how often it runs."""
import struct
import time
from machine import UART

SAMPLE = "<Hhhh"
link = UART(1, 115200)


def encode(n, ax, ay, az):
    return struct.pack(SAMPLE, n, ax, ay, az)


def stream(samples, imu):
    for n in range(samples):
        ax, ay, az = imu.read()
        link.write(encode(n, ax, ay, az))
        time.sleep_ms(5)
