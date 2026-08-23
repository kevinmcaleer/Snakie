"""No interrupts at all — a polled bumper and a polled line sensor.

Nothing here runs in interrupt context, so there is no traceback to lose and no
buffer to reserve. A rule that fired on every MicroPython file would be noise.
"""
import time
from machine import ADC, Pin

bumper = Pin(18, Pin.IN, Pin.PULL_UP)
line = ADC(Pin(27))


def bumped():
    return bumper.value() == 0


def on_line():
    return line.read_u16() < 20000


while True:
    if bumped():
        print("obstacle")
    elif on_line():
        print("edge")
    time.sleep_ms(20)
