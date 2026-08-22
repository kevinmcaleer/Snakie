"""Helpers for the rover's control panel."""

import time


class Debouncer:
    def __init__(self):
        pass

    def settled(self, pin, samples, gap_ms):
        last = pin.value()
        for _ in range(samples):
            time.sleep_ms(gap_ms)
            if pin.value() != last:
                return None
        return last


class BatteryGauge:
    """Turn a raw ADC reading into a percentage."""

    def percent(self, adc, full_uv, empty_uv):
        span = full_uv - empty_uv
        if span <= 0:
            return 0
        return max(0, min(100, (adc.read_uv() - empty_uv) * 100 // span))
