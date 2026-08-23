"""Telemetry maths that runs in viper — and can wrap without saying so."""

import micropython


@micropython.viper
def sum_window(buf, count: int) -> int:
    """Total a window of raw ADC counts before we average it."""
    total = 0
    for i in range(count):
        total += int(buf[i])
    return total


@micropython.viper
def ticks_to_microns(ticks: int, numerator: int, denominator: int) -> int:
    """Fixed-point conversion from encoder ticks to travel along the floor."""
    return (ticks * numerator) // denominator
