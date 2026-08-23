"""The fixed version: one bytearray, filled in place, forever."""
import struct
import time
from machine import UART

SAMPLE = "<Hhhh"
frame = bytearray(struct.calcsize(SAMPLE))
link = UART(1, 115200)


def stream(samples, imu):
    for n in range(samples):
        ax, ay, az = imu.read()
        struct.pack_into(SAMPLE, frame, 0, n, ax, ay, az)
        link.write(frame)
        time.sleep_ms(5)
