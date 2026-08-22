"""A quadrature encoder class — imports `const`, but never the module itself."""
from micropython import const
from machine import Pin
DEBOUNCE_US = const(400)
STEPS_PER_REV = const(20)


class Wheel:
    def __init__(self, pin_no):
        self.count = 0
        self.last_us = 0
        self.pin = Pin(pin_no, Pin.IN, Pin.PULL_UP)
        self.pin.irq(trigger=Pin.IRQ_RISING, handler=self._on_edge)

    def _on_edge(self, pin):
        self.count += 1

    def revolutions(self):
        return self.count / STEPS_PER_REV
