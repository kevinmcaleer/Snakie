"""Allocations that are not peripherals — the rule stays out of the way."""

from time import sleep_ms


def collect(sensor, samples):
    readings = []
    for _ in range(samples):
        buffer = bytearray(16)
        sensor.readinto(buffer)
        readings.append(bytes(buffer))
        sleep_ms(10)
    return readings
