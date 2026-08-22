"""Two loops whose delay a millisecond tick check cannot stand in for.

The first sleeps for microseconds, which `ticks_ms()` simply cannot resolve. The
second's period is a variable, so the rewrite would have to invent a number.
"""
import time
from machine import Pin

trigger = Pin(3, Pin.OUT)
echo = Pin(2, Pin.IN)
period_ms = 250
pulses = 0


def pulse_forever():
    global pulses
    while True:
        trigger.on()
        pulses = pulses + 1
        trigger.off()
        time.sleep_us(10)


def poll_forever():
    while True:
        distance = echo.value()
        print("echo", distance)
        trigger.toggle()
        time.sleep_ms(period_ms)
