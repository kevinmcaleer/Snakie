"""The fixed version: integer accumulators, scaled once at the end."""
import time
from machine import ADC

battery = ADC(29)
MILLIVOLTS_PER_COUNT = 3300


def average_millivolts(samples):
    total_raw = 0
    for _ in range(samples):
        total_raw += battery.read_u16()
        time.sleep_ms(2)
    return total_raw * MILLIVOLTS_PER_COUNT // (samples * 65535)


def coast_ticks(odometer):
    travelled = 0
    while odometer.value():
        travelled += 1
        time.sleep_ms(1)
    return travelled
