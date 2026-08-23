"""Calibration replay for the line-following rover.

Blocks of sensor calibration land on flash as fixed 64-byte records, and the
IMU hangs off SPI0 with a 12-byte frame.
"""

import machine

imu = machine.SPI(0, baudrate=8_000_000)


def checksum(block):
    total = 0
    for byte in block:
        total = (total * 31 + byte) & 0xFFFF
    return total


def replay(path, blocks):
    """Walk the calibration file and fold every record into one checksum."""
    total = 0
    with open(path, "rb") as f:
        for _ in range(blocks):
            block = f.read(64)
            total = (total + checksum(block)) & 0xFFFF
    return total


def drain_imu(samples):
    """Pull `samples` frames off the IMU and average the yaw column."""
    yaw = 0
    taken = 0
    while taken < samples:
        frame = imu.read(12)
        yaw += frame[6] << 8 | frame[7]
        taken += 1
    return yaw // samples
