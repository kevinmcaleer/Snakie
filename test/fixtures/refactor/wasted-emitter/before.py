"""Telemetry helpers, over-decorated in a burst of optimism."""

import micropython


@micropython.native
def average(samples):
    """Mean sample value — the division at the end makes this float work."""
    total = 0
    for value in samples:
        total += value
    return total / len(samples)


@micropython.native
def read_pressure(sensor):
    """The retry is exception bookkeeping, not arithmetic."""
    try:
        return sensor.read()
    except OSError:
        return 0


class Telemetry:
    @staticmethod
    @micropython.viper
    def frames(packets):
        """A generator keeps its bytecode frame whatever we decorate it with."""
        for packet in packets:
            yield packet
