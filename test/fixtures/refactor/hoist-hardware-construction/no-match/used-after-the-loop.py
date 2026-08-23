"""The object outlives the loop, so its lifetime is part of the meaning."""

from machine import ADC, Pin
from time import sleep_ms


def settle(tries):
    for _ in range(tries):
        probe = ADC(Pin(28))
        sleep_ms(5)
    return probe.read_u16()
