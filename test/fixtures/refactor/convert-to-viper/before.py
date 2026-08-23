"""Integer helpers for the wheel-encoder odometry loop."""

import micropython


def crc8(seed, byte):
    """Dallas 1-Wire CRC over one byte of the sensor's serial number."""
    crc = seed ^ byte
    for _ in range(8):
        if crc & 1:
            crc = ((crc >> 1) ^ 0x8C) & 0xFF
        else:
            crc = (crc >> 1) & 0xFF
    return crc


def isqrt(value):
    """Integer square root, so a squared encoder delta becomes a distance."""
    guess = value
    result = 0
    for _ in range(20):
        if guess == 0:
            break
        result = (guess + value // guess) >> 1
        if result == guess:
            break
        guess = result
    return result


def log_distance(ticks):
    print("travelled", ticks)
