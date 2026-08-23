"""A framing helper that packs once per call, outside any loop."""
import struct
from machine import UART

link = UART(1, 115200)
HEADER = "<4sHH"


def open_stream(rate_hz, channels):
    link.write(struct.pack(HEADER, b"IMU0", rate_hz, channels))


def close_stream():
    link.write(struct.pack("<4s", b"DONE"))
