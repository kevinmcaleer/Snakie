"""The `while` condition reads the very name the body binds."""

from machine import ADC, Pin
from time import sleep_ms

probe = None

while probe is None or probe.read_u16() < 1000:
    probe = ADC(Pin(27))
    sleep_ms(20)
