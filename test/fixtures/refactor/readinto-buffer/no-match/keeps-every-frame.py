"""Capture a burst of IMU frames and hand the whole lot back for analysis.

Every frame is kept, so the buffer must NOT be reused: one shared bytearray
would leave `frames` holding a hundred references to the last reading.
"""

import machine

imu = machine.SPI(0, baudrate=8_000_000)


def burst(samples):
    frames = []
    for _ in range(samples):
        frame = imu.read(12)
        frames.append(frame)
    return frames


def burst_by_index(samples):
    frames = {}
    for i in range(samples):
        frame = imu.read(12)
        frames[i] = frame
    return frames


def burst_paired(samples):
    frames = []
    for i in range(samples):
        frame = imu.read(12)
        frames.append((i, frame))
    return frames
