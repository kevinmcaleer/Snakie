"""Two pins take turns on one name — moving either would break the alternation."""

from machine import Pin
from time import sleep_ms


def alternate(times):
    for _ in range(times):
        led = Pin(16, Pin.OUT)
        led.value(1)
        sleep_ms(100)
        led = Pin(17, Pin.OUT)
        led.value(1)
        sleep_ms(100)
