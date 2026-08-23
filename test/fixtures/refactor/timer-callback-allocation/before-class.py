"""A heater controller driven by a hardware timer it owns.

`_step` is armed with `self.tim.init(callback=...)`, so it runs in interrupt
context — and appends a new list to `self.trace` twenty times a second. The fix
is a pre-allocated ring buffer, which is the author's call, so this file is its
own `after.py`.
"""
import micropython
from machine import ADC, Pin, Timer

micropython.alloc_emergency_exception_buf(100)


class Heater:
    def __init__(self, sense_pin, drive_pin, target=60.0):
        self.sense = ADC(Pin(sense_pin))
        self.drive = Pin(drive_pin, Pin.OUT)
        self.target = target
        self.error = 0.0
        self.trace = []
        self.tim = Timer(-1)
        self.tim.init(period=50, mode=Timer.PERIODIC, callback=self._step)

    def _step(self, timer):
        self.trace.append([self.sense.read_u16(), self.error])
        self.drive.value(1 if self.error > 0 else 0)

    def stop(self):
        self.tim.deinit()
        self.drive.value(0)
