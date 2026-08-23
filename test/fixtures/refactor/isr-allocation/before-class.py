"""A rotary-encoder driver that registers its own methods as interrupts.

`_on_edge` formats a string in interrupt context; `_on_direction` does the same
job with integers and a buffer allocated at construction time. Only the first is
flagged — and neither is rewritten, so this file is its own `after.py`.
"""
import micropython
from machine import Pin

micropython.alloc_emergency_exception_buf(100)


class RotaryEncoder:
    def __init__(self, clk, dt, name="wheel"):
        self.name = name
        self.position = 0
        self.history = bytearray(8)
        self.clk = Pin(clk, Pin.IN, Pin.PULL_UP)
        self.dt = Pin(dt, Pin.IN, Pin.PULL_UP)
        self.clk.irq(trigger=Pin.IRQ_RISING | Pin.IRQ_FALLING, handler=self._on_edge)
        self.dt.irq(trigger=Pin.IRQ_RISING, handler=self._on_direction)

    def _on_edge(self, pin):
        print("{}: {}".format(self.name, self.position))

    def _on_direction(self, pin):
        self.position += 1 if self.dt.value() else -1
        self.history[self.position % len(self.history)] = pin.value()
