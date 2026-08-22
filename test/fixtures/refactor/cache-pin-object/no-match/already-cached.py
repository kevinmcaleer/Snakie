"""Built once and kept — exactly what the hint asks for."""

from machine import Pin
from time import sleep_ms

led = Pin(25, Pin.OUT)


def heartbeat(beats):
    for _ in range(beats):
        led.value(1)
        sleep_ms(80)
        led.value(0)
        sleep_ms(400)


class Bumper:
    def __init__(self, pin):
        self.pin = Pin(pin, Pin.IN, Pin.PULL_UP)

    def hit(self):
        return self.pin.value() == 0
